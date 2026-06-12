import { BackgroundSubtractor } from "@pj-hoakari/web-crowd-detection-utils/background";
import {
	BYTETracker,
	type TrackedBox,
} from "@pj-hoakari/web-crowd-detection-utils/bytetrack";
import {
	type Line,
	LineCrossingCounter,
} from "@pj-hoakari/web-crowd-detection-utils/line-crossing";
import { isWebGpuAvailable } from "@pj-hoakari/web-crowd-detection-utils/onnx";
import {
	createLetterboxCapturer,
	type LetterboxCapturer,
	reverseLetterboxBoxes,
} from "@pj-hoakari/web-crowd-detection-utils/source";
import {
	createYoloDetector,
	type YoloDetector,
} from "@pj-hoakari/web-crowd-detection-utils/yolo";
import { clearCanvas, drawDraft, drawLine, drawTracks } from "./overlay";
import type {
	Draft,
	MainToWorker,
	PipelineConfig,
	WorkerToMain,
} from "./protocol";

const INPUT_SIZE = 640;
/** Detector confidence threshold; also the post-suppression cutoff (see below). */
const DETECT_CONF = 0.15;
/** Factor applied to the score of detections sitting in a static region. */
const SUPPRESS_FACTOR = 0.1;

// The DOM lib types `self` as a `Window`; narrow it to just the messaging
// surface we use so this file compiles without the conflicting "webworker" lib.
const workerScope = self as unknown as {
	postMessage(message: WorkerToMain, transfer?: Transferable[]): void;
	addEventListener(type: "message", listener: (ev: MessageEvent) => void): void;
};

function post(message: WorkerToMain): void {
	workerScope.postMessage(message);
}

// --- worker-owned state (the offscreen canvas + the whole stateful pipeline) ---
let canvas: OffscreenCanvas | null = null;
let render2d: OffscreenCanvasRenderingContext2D | null = null;
let capturer: LetterboxCapturer | null = null;
let bg: BackgroundSubtractor | null = null;
let tracker: BYTETracker | null = null;
let counter: LineCrossingCounter | null = null;
let uniqueIds = new Set<number>();
let detector: YoloDetector | null = null;

let line: Line | null = null;
let draft: Draft | null = null;
let config: PipelineConfig = { suppressStatic: true, crossingAssist: true };
let running = false;

/** (Re)create the stateful pipeline pieces for a fresh run. */
function resetStateful(): void {
	bg = new BackgroundSubtractor({ width: INPUT_SIZE, height: INPUT_SIZE });
	tracker = new BYTETracker();
	counter = new LineCrossingCounter();
	uniqueIds = new Set<number>();
}

/**
 * Repaint the overlay. With `tracked` (during a run) it draws boxes + line +
 * draft; without it (idle) it draws just the committed line + draft so the user
 * still sees the line they are setting up.
 */
function repaint(tracked?: readonly TrackedBox[]): void {
	if (!render2d || !canvas) {
		return;
	}
	clearCanvas(render2d, canvas);
	if (tracked && tracked.length > 0) {
		drawTracks(render2d, canvas, tracked);
	}
	if (line) {
		const count = counter?.getLineCount(line.id) ?? { forward: 0, backward: 0 };
		drawLine(render2d, canvas, line, count);
	}
	if (draft) {
		drawDraft(render2d, canvas, draft.p1, draft.p2);
	}
}

/**
 * Full crowd-detection pipeline for one frame, mirroring the steps wired in the
 * single-threaded examples — only here every stage runs off the main thread:
 *
 * 1. `source` — letterbox-capture the frame to `INPUT_SIZE` (the capturer's
 *    internal scratch canvas is an `OffscreenCanvas`, since there is no DOM here).
 * 2. `yolo` (+ `onnx`) — detect persons in model-input space.
 * 3. `background` — suppress detections in static regions (toggleable).
 * 4. `source` — reverse the letterbox back to source space.
 * 5. `bytetrack` — assign stable ids.
 * 6. `line-crossing` — tally tracks crossing the line, per direction.
 */
async function processFrame(bitmap: ImageBitmap): Promise<void> {
	if (
		!running ||
		!detector ||
		!capturer ||
		!bg ||
		!tracker ||
		!counter ||
		!canvas
	) {
		bitmap.close();
		return;
	}

	try {
		// Match the offscreen backing store to the source frame so detection
		// coordinates (and the line) land on the right pixels.
		if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
			canvas.width = bitmap.width;
			canvas.height = bitmap.height;
		}

		const { imageData, params } = capturer.capture(bitmap);

		let detections = await detector.detect(imageData);

		// Always feed the background model so it stays warm if the toggle flips
		// on; only gate the suppression itself on the toggle + warm-up `ready`.
		const ready = bg.update(imageData);
		if (config.suppressStatic && ready) {
			// suppressStatic only lowers score in static regions; re-threshold to
			// actually drop them. Non-static boxes keep their (>= DETECT_CONF) score.
			detections = bg
				.suppressStatic(detections, SUPPRESS_FACTOR)
				.filter((d) => d.score >= DETECT_CONF);
		}

		const inSource = reverseLetterboxBoxes(detections, params);
		const tracked = tracker.update(inSource);
		for (const t of tracked) {
			uniqueIds.add(t.trackId);
		}

		// Reduce each tracked box to its foot anchor (bottom-center) for crossing.
		const lines = line ? [line] : [];
		const points = tracked.map((t) => ({
			trackId: t.trackId,
			point: { x: (t.x1 + t.x2) / 2, y: t.y2 },
		}));
		counter.update(points, lines, {
			assist: { enabled: config.crossingAssist },
		});

		repaint(tracked);

		const count = line
			? counter.getLineCount(line.id)
			: { forward: 0, backward: 0 };
		post({
			type: "stats",
			stats: {
				current: tracked.length,
				unique: uniqueIds.size,
				forward: count.forward,
				backward: count.backward,
			},
		});
	} catch (err) {
		post({ type: "error", message: (err as Error).message });
	} finally {
		// Free the transferred frame whether or not processing succeeded.
		bitmap.close();
	}
}

async function loadModel(modelUrl: string): Promise<void> {
	if (detector) {
		post({ type: "ready", backend: detector.backend });
		return;
	}
	try {
		post({ type: "status", message: "Fetching model…" });
		const response = await fetch(modelUrl);
		if (!response.ok) {
			throw new Error(
				`Failed to fetch ${modelUrl}: ${response.status} ${response.statusText}`,
			);
		}
		const buffer = await response.arrayBuffer();
		detector = await loadDetector(buffer);
		post({ type: "ready", backend: detector.backend });
	} catch (err) {
		post({ type: "error", message: (err as Error).message });
	}
}

async function loadDetector(modelBuffer: ArrayBuffer): Promise<YoloDetector> {
	const preferred = isWebGpuAvailable() ? "webgpu" : "wasm";
	post({
		type: "status",
		message: `Initializing detector (backend: ${preferred})…`,
	});
	const postprocess = {
		format: "auto",
		confThreshold: DETECT_CONF,
		classFilter: [0],
	} as const;
	try {
		return await createYoloDetector({
			modelPath: modelBuffer,
			executionProvider: preferred,
			inputSize: INPUT_SIZE,
			postprocess,
		});
	} catch (err) {
		if (preferred !== "webgpu") {
			throw err;
		}
		post({
			type: "status",
			message: `WebGPU init failed (${(err as Error).message}); falling back to WASM`,
		});
		return createYoloDetector({
			modelPath: modelBuffer,
			executionProvider: "wasm",
			inputSize: INPUT_SIZE,
			postprocess,
		});
	}
}

workerScope.addEventListener("message", (ev: MessageEvent) => {
	const msg = ev.data as MainToWorker;
	switch (msg.type) {
		case "init": {
			canvas = msg.canvas;
			render2d = canvas.getContext(
				"2d",
			) as OffscreenCanvasRenderingContext2D | null;
			capturer = createLetterboxCapturer({ inputSize: INPUT_SIZE });
			resetStateful();
			repaint();
			break;
		}
		case "loadModel":
			void loadModel(msg.modelUrl);
			break;
		case "resize":
			if (
				canvas &&
				(canvas.width !== msg.width || canvas.height !== msg.height)
			) {
				canvas.width = msg.width;
				canvas.height = msg.height;
			}
			if (!running) {
				repaint();
			}
			break;
		case "start":
			resetStateful();
			running = true;
			repaint();
			break;
		case "frame":
			void processFrame(msg.bitmap);
			break;
		case "stop":
			running = false;
			repaint();
			break;
		case "setLine":
			line = msg.line;
			if (!running) {
				repaint();
			}
			break;
		case "setDraft":
			draft = msg.draft;
			if (!running) {
				repaint();
			}
			break;
		case "setConfig":
			config = msg.config;
			break;
		case "resetCounts":
			counter?.resetCounts();
			if (!running) {
				repaint();
			}
			break;
		case "clearPositions":
			counter?.clearPositions();
			if (!running) {
				repaint();
			}
			break;
	}
});
