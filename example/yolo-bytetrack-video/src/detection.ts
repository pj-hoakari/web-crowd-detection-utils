import {
	BYTETracker,
	type TrackedBox,
} from "@pj-hoakari/web-crowd-detection-utils/bytetrack";
import { isWebGpuAvailable } from "@pj-hoakari/web-crowd-detection-utils/onnx";
import {
	createLetterboxCapturer,
	reverseLetterboxBoxes,
} from "@pj-hoakari/web-crowd-detection-utils/source";
import {
	createYoloDetector,
	type YoloDetector,
} from "@pj-hoakari/web-crowd-detection-utils/yolo";

const INPUT_SIZE = 640;

export interface StartDetectionOptions {
	modelBuffer: ArrayBuffer;
	video: HTMLVideoElement;
	canvas: HTMLCanvasElement;
	signal: AbortSignal;
	onStatus?: (message: string) => void;
	onCount?: (current: number, unique: number) => void;
}

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

	const tracker = new BYTETracker();
	const uniqueIds = new Set<number>();

	while (!opts.signal.aborted) {
		if (opts.video.readyState < opts.video.HAVE_CURRENT_DATA) {
			await waitForFrame();
			continue;
		}

		syncCanvasSize(opts.canvas, opts.video);

		const { imageData, params } = capturer.capture(opts.video);
		const detections = await detector.detect(imageData);
		const mapped = reverseLetterboxBoxes(detections, params);
		const tracked = tracker.update(mapped);

		for (const t of tracked) {
			uniqueIds.add(t.trackId);
		}

		drawTracks(ctx, opts.canvas, tracked);
		drawHud(ctx, opts.canvas, tracked.length, uniqueIds.size);

		opts.onCount?.(tracked.length, uniqueIds.size);

		await waitForFrame();
	}

	ctx.clearRect(0, 0, opts.canvas.width, opts.canvas.height);
}

async function loadDetector(
	modelBuffer: ArrayBuffer,
	onStatus?: (message: string) => void,
): Promise<YoloDetector> {
	const preferred = isWebGpuAvailable() ? "webgpu" : "wasm";
	onStatus?.(`Initializing detector (backend: ${preferred})…`);
	const postprocess = { format: "auto" } as const;
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

function drawTracks(
	ctx: CanvasRenderingContext2D,
	canvas: HTMLCanvasElement,
	tracks: readonly TrackedBox[],
): void {
	ctx.clearRect(0, 0, canvas.width, canvas.height);

	const fontSize = Math.max(12, Math.round(canvas.width / 60));
	const lineWidth = Math.max(2, Math.round(canvas.width / 320));

	ctx.lineWidth = lineWidth;
	ctx.strokeStyle = "#00ff88";
	ctx.font = `${fontSize}px sans-serif`;
	ctx.textBaseline = "top";

	for (const t of tracks) {
		const w = t.x2 - t.x1;
		const h = t.y2 - t.y1;
		ctx.strokeRect(t.x1, t.y1, w, h);

		const label = `#${t.trackId}  ${Math.round(t.score * 100)}%`;
		const labelH = fontSize + 4;
		const labelW = ctx.measureText(label).width + 8;
		ctx.fillStyle = "#00ff88";
		ctx.fillRect(t.x1, t.y1 - labelH, labelW, labelH);
		ctx.fillStyle = "#000";
		ctx.fillText(label, t.x1 + 4, t.y1 - labelH + 2);
	}
}

function drawHud(
	ctx: CanvasRenderingContext2D,
	canvas: HTMLCanvasElement,
	current: number,
	unique: number,
): void {
	const fontSize = Math.max(14, Math.round(canvas.width / 48));
	const padX = Math.round(fontSize * 0.6);
	const padY = Math.round(fontSize * 0.4);
	const text = `Current: ${current}    Unique: ${unique}`;

	ctx.font = `${fontSize}px sans-serif`;
	ctx.textBaseline = "top";

	const textW = ctx.measureText(text).width;
	const boxW = textW + padX * 2;
	const boxH = fontSize + padY * 2;

	ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
	ctx.fillRect(0, 0, boxW, boxH);

	ctx.fillStyle = "#ffffff";
	ctx.fillText(text, padX, padY);
}

function waitForFrame(): Promise<void> {
	return new Promise((resolve) => {
		requestAnimationFrame(() => resolve());
	});
}
