import { BackgroundSubtractor } from "@pj-hoakari/web-crowd-detection-utils/background";
import { BYTETracker } from "@pj-hoakari/web-crowd-detection-utils/bytetrack";
import {
	type Line,
	LineCrossingCounter,
	type Point,
} from "@pj-hoakari/web-crowd-detection-utils/line-crossing";
import { isWebGpuAvailable } from "@pj-hoakari/web-crowd-detection-utils/onnx";
import {
	createLetterboxCapturer,
	reverseLetterboxBoxes,
} from "@pj-hoakari/web-crowd-detection-utils/source";
import {
	createYoloDetector,
	type YoloDetector,
} from "@pj-hoakari/web-crowd-detection-utils/yolo";
import { clearCanvas, drawDraft, drawLine, drawTracks } from "./overlay";

const INPUT_SIZE = 640;
/** Detector confidence threshold; also the post-suppression cutoff (see below). */
const DETECT_CONF = 0.15;
/** Factor applied to the score of detections sitting in a static region. */
const SUPPRESS_FACTOR = 0.1;

/** Live, per-frame readable toggles owned by the UI. */
export interface PipelineConfig {
	/** Attenuate + drop detections in static regions via `BackgroundSubtractor`. */
	suppressStatic: boolean;
	/** Enable `LineCrossingCounter`'s rescue / cooldown ID-churn assist. */
	crossingAssist: boolean;
}

/** A line being drawn but not yet committed. */
export interface Draft {
	p1: Point;
	p2: Point;
}

/** Per-frame counters surfaced to the UI. */
export interface PipelineStats {
	/** Tracks present this frame. */
	current: number;
	/** Distinct track ids seen since the run started. */
	unique: number;
	/** Crossings of the line toward its positive (`p1`→`p2`) side. */
	forward: number;
	/** Crossings of the line toward its negative side. */
	backward: number;
}

/** Imperative handle the loop hands back to the UI for counter lifecycle calls. */
export interface PipelineControls {
	/** Zero the line tally, keeping tracked positions (a fresh measurement). */
	resetCounts(): void;
	/** Drop tracked positions so a stale point can't fabricate a crossing. */
	clearPositions(): void;
}

export interface StartDetectionOptions {
	modelBuffer: ArrayBuffer;
	video: HTMLVideoElement;
	canvas: HTMLCanvasElement;
	signal: AbortSignal;
	/** The committed counting line, or `null` while none is set. Read each frame. */
	getLine: () => Line | null;
	/** The in-progress line preview, or `null`. Read each frame for the overlay. */
	getDraft: () => Draft | null;
	/** Live UI toggles, read each frame. */
	getConfig: () => PipelineConfig;
	/** Receives the imperative counter handle once the loop is ready. */
	onControls?: (controls: PipelineControls | null) => void;
	onStatus?: (message: string) => void;
	onStats?: (stats: PipelineStats) => void;
}

/** Stable id for the single counting line this example manages. */
export const LINE_ID = "line";

/**
 * Full crowd-detection pipeline on a video file, wiring together every subpath
 * of the package:
 *
 * 1. `source` — letterbox-capture each frame to `INPUT_SIZE`.
 * 2. `yolo` (+ `onnx`) — detect persons in model-input space.
 * 3. `background` — suppress detections in static regions (toggleable).
 * 4. `source` — reverse the letterbox back to source space.
 * 5. `bytetrack` — assign stable ids.
 * 6. `line-crossing` — tally tracks crossing the line, per direction.
 */
export async function startDetection(
	opts: StartDetectionOptions,
): Promise<void> {
	const detector = await loadDetector(opts.modelBuffer, opts.onStatus);
	opts.onStatus?.(`Running (backend: ${detector.backend})`);

	const capturer = createLetterboxCapturer({ inputSize: INPUT_SIZE });
	const ctx = opts.canvas.getContext("2d");
	if (!ctx) {
		throw new Error("Failed to acquire 2D canvas context");
	}

	// One instance each, for the whole stream — all three are stateful.
	const bg = new BackgroundSubtractor({
		width: INPUT_SIZE,
		height: INPUT_SIZE,
	});
	const tracker = new BYTETracker();
	const counter = new LineCrossingCounter();
	const uniqueIds = new Set<number>();

	opts.onControls?.({
		resetCounts: () => counter.resetCounts(),
		clearPositions: () => counter.clearPositions(),
	});

	try {
		while (!opts.signal.aborted) {
			if (opts.video.readyState < opts.video.HAVE_CURRENT_DATA) {
				await waitForFrame();
				continue;
			}

			syncCanvasSize(opts.canvas, opts.video);
			const config = opts.getConfig();

			const { imageData, params } = capturer.capture(opts.video);
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
			const line = opts.getLine();
			const lines = line ? [line] : [];
			const points = tracked.map((t) => ({
				trackId: t.trackId,
				point: { x: (t.x1 + t.x2) / 2, y: t.y2 },
			}));
			counter.update(points, lines, {
				assist: { enabled: config.crossingAssist },
			});

			clearCanvas(ctx, opts.canvas);
			drawTracks(ctx, opts.canvas, tracked);
			const count = line
				? counter.getLineCount(line.id)
				: { forward: 0, backward: 0 };
			if (line) {
				drawLine(ctx, opts.canvas, line, count);
			}
			const draft = opts.getDraft();
			if (draft) {
				drawDraft(ctx, opts.canvas, draft.p1, draft.p2);
			}

			opts.onStats?.({
				current: tracked.length,
				unique: uniqueIds.size,
				forward: count.forward,
				backward: count.backward,
			});

			await waitForFrame();
		}
	} finally {
		// Don't clear here: once the run ends the UI flips to a non-running phase
		// and the idle effect in App repaints the committed line. Clearing would
		// race that repaint and blank the line.
		opts.onControls?.(null);
	}
}

async function loadDetector(
	modelBuffer: ArrayBuffer,
	onStatus?: (message: string) => void,
): Promise<YoloDetector> {
	const preferred = isWebGpuAvailable() ? "webgpu" : "wasm";
	onStatus?.(`Initializing detector (backend: ${preferred})…`);
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
		onStatus?.(
			`WebGPU init failed (${(err as Error).message}); falling back to WASM`,
		);
		return createYoloDetector({
			modelPath: modelBuffer,
			executionProvider: "wasm",
			inputSize: INPUT_SIZE,
			postprocess,
		});
	}
}

function syncCanvasSize(canvas: HTMLCanvasElement, video: HTMLVideoElement) {
	const w = video.videoWidth;
	const h = video.videoHeight;
	if (w > 0 && h > 0 && (canvas.width !== w || canvas.height !== h)) {
		canvas.width = w;
		canvas.height = h;
	}
}

function waitForFrame(): Promise<void> {
	return new Promise((resolve) => {
		requestAnimationFrame(() => resolve());
	});
}
