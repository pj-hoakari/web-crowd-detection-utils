/**
 * Source for frame capture. Accepts any `CanvasImageSource` — typically an
 * `HTMLVideoElement`, `HTMLImageElement`, `HTMLCanvasElement`, `ImageBitmap`,
 * `OffscreenCanvas`, or `VideoFrame`.
 */
export type CaptureSource = CanvasImageSource;

/**
 * Options for {@link CanvasFrameCapturer} creation.
 *
 * The captured frame is **stretched** (non-aspect-preserving) to the specified
 * width and height. Use {@link LetterboxCapturerOptions} instead when you need
 * to preserve the source aspect ratio.
 */
export interface CanvasFrameCapturerOptions {
	/** Target output width in pixels. Must be a positive finite number. */
	width: number;
	/** Target output height in pixels. Must be a positive finite number. */
	height: number;
}

/**
 * A reusable capturer that draws a {@link CaptureSource} onto an owned
 * off-screen canvas and reads back the pixel data as `ImageData`.
 *
 * The source is **stretched** to fit `width × height` exactly; aspect ratio is
 * not preserved. To map detection coordinates back to the original source
 * dimensions, use `reverseStretchBox` (not `reverseLetterboxBox`).
 */
export interface CanvasFrameCapturer {
	/**
	 * Draws `source` onto the internal canvas (stretched to `width × height`)
	 * and returns the pixel data as a fresh `ImageData`.
	 */
	capture(source: CaptureSource): ImageData;
	/** The target output width. */
	readonly width: number;
	/** The target output height. */
	readonly height: number;
	/**
	 * The internal off-screen canvas. Exposed for debugging or for callers that
	 * need to bind the canvas to a `MediaStream` or transfer it to a worker.
	 * Mutating the canvas externally is not supported.
	 */
	readonly canvas: HTMLCanvasElement;
}

/**
 * Axis-aligned bounding box in pixel coordinates, with `(x1, y1)` as the
 * top-left corner and `(x2, y2)` as the bottom-right corner.
 */
export interface Box {
	x1: number;
	y1: number;
	x2: number;
	y2: number;
}

/**
 * Parameters produced by letterboxing a source image into a square input.
 *
 * Returned by {@link LetterboxCapturer.capture} alongside the `ImageData`, and
 * consumed by `reverseLetterboxBox` / `reverseLetterboxBoxes` to map detection
 * coordinates from letterboxed model space back to original source space.
 */
export interface LetterboxParams {
	/** Square edge length of the model input, in pixels. */
	inputSize: number;
	/** Width of the original source image, in pixels. */
	sourceWidth: number;
	/** Height of the original source image, in pixels. */
	sourceHeight: number;
	/** Uniform scale factor applied to the source: `min(inputSize / sourceWidth, inputSize / sourceHeight)`. */
	scale: number;
	/** Horizontal padding (in pixels) inserted on the left edge of the letterboxed canvas. */
	padX: number;
	/** Vertical padding (in pixels) inserted on the top edge of the letterboxed canvas. */
	padY: number;
	/** Width of the scaled source content inside the letterboxed canvas, in pixels. */
	contentWidth: number;
	/** Height of the scaled source content inside the letterboxed canvas, in pixels. */
	contentHeight: number;
}

/**
 * Options for {@link LetterboxCapturer} creation.
 */
export interface LetterboxCapturerOptions {
	/** Square edge length of the output canvas, in pixels. Must be a positive finite number. */
	inputSize: number;
	/**
	 * CSS color string used to fill the padded regions.
	 * Defaults to `"rgb(114,114,114)"` (the standard YOLO letterbox gray).
	 */
	padColor?: string;
}

/**
 * Result of a single {@link LetterboxCapturer.capture} call.
 */
export interface LetterboxCaptureResult {
	/** The letterboxed image as an `inputSize × inputSize` `ImageData`. */
	imageData: ImageData;
	/**
	 * The parameters used for this capture. Pass these to `reverseLetterboxBox`
	 * (or `reverseLetterboxBoxes`) to map detection coordinates back to the
	 * original source image space.
	 */
	params: LetterboxParams;
}

/**
 * A reusable capturer that letterboxes a {@link CaptureSource} into a square
 * `inputSize × inputSize` canvas, preserving the source aspect ratio by
 * padding the shorter axis.
 *
 * To map detection coordinates back to the original source dimensions, use
 * `reverseLetterboxBox` with the `params` returned by `capture()`.
 */
export interface LetterboxCapturer {
	/**
	 * Letterboxes `source` into the internal canvas and returns both the pixel
	 * data and the {@link LetterboxParams} needed to invert the transform.
	 */
	capture(source: CaptureSource): LetterboxCaptureResult;
	/** The square edge length of the output canvas. */
	readonly inputSize: number;
	/**
	 * The internal off-screen canvas. Exposed for debugging or for callers that
	 * need to bind the canvas to a `MediaStream` or transfer it to a worker.
	 * Mutating the canvas externally is not supported.
	 */
	readonly canvas: HTMLCanvasElement;
}
