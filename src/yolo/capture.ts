import type {
	CanvasFrameCapturer,
	CanvasFrameCapturerOptions,
	CaptureSource,
} from "./types";

export function createCanvasFrameCapturer(
	options: CanvasFrameCapturerOptions,
): CanvasFrameCapturer {
	const { width, height } = options;
	if (
		!Number.isFinite(width) ||
		!Number.isFinite(height) ||
		width <= 0 ||
		height <= 0
	) {
		throw new Error(
			`createCanvasFrameCapturer: width and height must be positive finite numbers (got width=${width}, height=${height})`,
		);
	}

	const canvas = document.createElement("canvas");
	canvas.width = width;
	canvas.height = height;
	const ctx = canvas.getContext("2d", { willReadFrequently: true });
	if (!ctx) {
		throw new Error(
			"createCanvasFrameCapturer: failed to acquire a 2D rendering context",
		);
	}

	return {
		canvas,
		width,
		height,
		capture(source: CaptureSource): ImageData {
			ctx.drawImage(source, 0, 0, width, height);
			return ctx.getImageData(0, 0, width, height);
		},
	};
}
