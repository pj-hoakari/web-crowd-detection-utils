import { isWebGpuAvailable } from "@pj-hoakari/web-crowd-detection-utils/onnx";
import {
	createLetterboxCapturer,
	reverseLetterboxBoxes,
} from "@pj-hoakari/web-crowd-detection-utils/source";
import {
	createYoloDetector,
	type Detection,
	type YoloDetector,
} from "@pj-hoakari/web-crowd-detection-utils/yolo";

const INPUT_SIZE = 640;

export interface StartDetectionOptions {
	modelBuffer: ArrayBuffer;
	video: HTMLVideoElement;
	canvas: HTMLCanvasElement;
	signal: AbortSignal;
	onStatus?: (message: string) => void;
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

	while (!opts.signal.aborted) {
		if (opts.video.readyState < opts.video.HAVE_CURRENT_DATA) {
			await waitForFrame();
			continue;
		}

		syncCanvasSize(opts.canvas, opts.video);

		const { imageData, params } = capturer.capture(opts.video);
		const detections = await detector.detect(imageData);
		const mapped = reverseLetterboxBoxes(detections, params);

		drawDetections(ctx, opts.canvas, mapped);
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

function drawDetections(
	ctx: CanvasRenderingContext2D,
	canvas: HTMLCanvasElement,
	detections: readonly Detection[],
): void {
	ctx.clearRect(0, 0, canvas.width, canvas.height);

	const fontSize = Math.max(12, Math.round(canvas.width / 60));
	const lineWidth = Math.max(2, Math.round(canvas.width / 320));

	ctx.lineWidth = lineWidth;
	ctx.strokeStyle = "#00ff88";
	ctx.font = `${fontSize}px sans-serif`;
	ctx.textBaseline = "top";

	for (const d of detections) {
		const w = d.x2 - d.x1;
		const h = d.y2 - d.y1;
		ctx.strokeRect(d.x1, d.y1, w, h);

		const label = `${Math.round(d.score * 100)}%`;
		const labelH = fontSize + 4;
		const labelW = ctx.measureText(label).width + 8;
		ctx.fillStyle = "#00ff88";
		ctx.fillRect(d.x1, d.y1 - labelH, labelW, labelH);
		ctx.fillStyle = "#000";
		ctx.fillText(label, d.x1 + 4, d.y1 - labelH + 2);
	}
}

function waitForFrame(): Promise<void> {
	return new Promise((resolve) => {
		requestAnimationFrame(() => resolve());
	});
}
