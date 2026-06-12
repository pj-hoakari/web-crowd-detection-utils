import { createScratchCanvas2D } from "./canvas";
import type {
	CanvasFrameCapturer,
	CanvasFrameCapturerOptions,
	CaptureSource,
} from "./types";

/**
 * Creates a {@link CanvasFrameCapturer} that draws a source onto an owned
 * off-screen canvas at exactly `width × height` and returns the pixel data
 * as `ImageData`.
 *
 * The source is **stretched** to fit the target dimensions; aspect ratio is
 * not preserved. For aspect-preserving capture with padding, use
 * {@link createLetterboxCapturer} instead. To map detection coordinates back
 * to original source dimensions, pair with `reverseStretchBox`.
 *
 * @param options - Target output dimensions for the captured frame.
 * @returns A capturer whose `capture()` method can be called repeatedly; the
 *   underlying canvas and 2D context are created once and reused across calls.
 *
 * @throws {Error} If `width` or `height` is not a positive finite number.
 * @throws {Error} If a 2D rendering context cannot be acquired, or if neither an
 *   `OffscreenCanvas` constructor nor a DOM `document` is available (e.g. a bare
 *   Node process).
 *
 * @remarks
 * Works on the main thread and inside Web Workers: an `OffscreenCanvas` is used
 * when its constructor is available (covering both contexts), falling back to a
 * DOM `<canvas>` via `document.createElement` otherwise. The 2D context is
 * created with `willReadFrequently: true` so that repeated `getImageData` calls
 * take the CPU-readable path rather than copying back from the GPU.
 *
 * @example
 * ```ts
 * const capturer = createCanvasFrameCapturer({ width: 640, height: 480 });
 * const video = document.querySelector("video");
 * if (video) {
 *   const frame = capturer.capture(video);
 *   // frame: ImageData (640 × 480 RGBA)
 * }
 * ```
 */
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

	const { canvas, ctx } = createScratchCanvas2D(
		width,
		height,
		"createCanvasFrameCapturer",
	);

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
