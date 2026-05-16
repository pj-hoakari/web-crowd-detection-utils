import type {
	Box,
	CaptureSource,
	LetterboxCaptureResult,
	LetterboxCapturer,
	LetterboxCapturerOptions,
	LetterboxParams,
} from "./types";

const DEFAULT_PAD_COLOR = "rgb(114,114,114)";

/**
 * Computes the geometric parameters for letterboxing a source image into a
 * square `inputSize × inputSize` canvas while preserving aspect ratio.
 *
 * The scale factor is `min(inputSize / sourceWidth, inputSize / sourceHeight)`,
 * so the entire source fits without cropping. The shorter axis is centered
 * with symmetric padding.
 *
 * @param sourceWidth - Width of the source image, in pixels.
 * @param sourceHeight - Height of the source image, in pixels.
 * @param inputSize - Square edge length of the target canvas, in pixels.
 * @returns The {@link LetterboxParams} describing the transform.
 *
 * @throws {Error} If `sourceWidth` or `sourceHeight` is not a positive finite number.
 * @throws {Error} If `inputSize` is not a positive finite number.
 *
 * @remarks
 * Pure function — no DOM dependency. Safe to call in workers, Node, or SSR.
 *
 * `contentWidth` / `contentHeight` are rounded and `padX` / `padY` are floored,
 * so `2 * padX + contentWidth` may differ from `inputSize` by one pixel on
 * either side. The asymmetry stays under one pixel.
 *
 * @example
 * ```ts
 * const params = computeLetterboxParams(1280, 720, 640);
 * // { scale: 0.5, contentWidth: 640, contentHeight: 360, padX: 0, padY: 140, ... }
 * ```
 */
export function computeLetterboxParams(
	sourceWidth: number,
	sourceHeight: number,
	inputSize: number,
): LetterboxParams {
	if (
		!Number.isFinite(sourceWidth) ||
		!Number.isFinite(sourceHeight) ||
		sourceWidth <= 0 ||
		sourceHeight <= 0
	) {
		throw new Error(
			`computeLetterboxParams: sourceWidth and sourceHeight must be positive finite numbers (got width=${sourceWidth}, height=${sourceHeight})`,
		);
	}
	if (!Number.isFinite(inputSize) || inputSize <= 0) {
		throw new Error(
			`computeLetterboxParams: inputSize must be a positive finite number (got ${inputSize})`,
		);
	}

	const scale = Math.min(inputSize / sourceWidth, inputSize / sourceHeight);
	const contentWidth = Math.round(sourceWidth * scale);
	const contentHeight = Math.round(sourceHeight * scale);
	const padX = Math.floor((inputSize - contentWidth) / 2);
	const padY = Math.floor((inputSize - contentHeight) / 2);

	return {
		inputSize,
		sourceWidth,
		sourceHeight,
		scale,
		padX,
		padY,
		contentWidth,
		contentHeight,
	};
}

/**
 * Reads the intrinsic pixel dimensions of a {@link CaptureSource}, dispatching
 * on element type to pick the correct property (`videoWidth` for video,
 * `naturalWidth` for image, `codedWidth` for `VideoFrame`, plain `width` otherwise).
 *
 * @internal
 */
function resolveSourceSize(source: CaptureSource): {
	width: number;
	height: number;
} {
	if (
		typeof HTMLVideoElement !== "undefined" &&
		source instanceof HTMLVideoElement
	) {
		return { width: source.videoWidth, height: source.videoHeight };
	}
	if (
		typeof HTMLImageElement !== "undefined" &&
		source instanceof HTMLImageElement
	) {
		return { width: source.naturalWidth, height: source.naturalHeight };
	}
	if (typeof VideoFrame !== "undefined" && source instanceof VideoFrame) {
		return { width: source.codedWidth, height: source.codedHeight };
	}
	const s = source as { width: number; height: number };
	return { width: s.width, height: s.height };
}

/**
 * Creates a {@link LetterboxCapturer} that draws a source into a square
 * `inputSize × inputSize` canvas, preserving aspect ratio by padding the
 * shorter axis with `padColor`.
 *
 * Each `capture()` call returns both the resulting `ImageData` and the
 * {@link LetterboxParams} used; pass the params to `reverseLetterboxBox` (or
 * `reverseLetterboxBoxes`) to map detection coordinates from letterboxed
 * model space back to original source space.
 *
 * @param options - Target `inputSize` and optional `padColor` (defaults to
 *   the YOLO standard `"rgb(114,114,114)"`).
 * @returns A capturer whose `capture()` method can be called repeatedly; the
 *   underlying canvas and 2D context are created once and reused across calls.
 *
 * @throws {Error} If `inputSize` is not a positive finite number.
 * @throws {Error} If a 2D rendering context cannot be acquired from the
 *   internal canvas (e.g. when running outside a browser-like DOM).
 * @throws {Error} From `capture()`: when the source's intrinsic dimensions
 *   are zero or non-finite (e.g. an `HTMLVideoElement` before metadata loads).
 *
 * @remarks
 * Requires a DOM; this function does not work in Node, Web Workers, or SSR
 * contexts. The 2D context is created with `willReadFrequently: true`.
 *
 * Source dimensions are re-evaluated on every `capture()` call, so this
 * capturer correctly handles a single video element whose resolution changes
 * mid-stream.
 *
 * @example
 * ```ts
 * const capturer = createLetterboxCapturer({ inputSize: 640 });
 * const { imageData, params } = capturer.capture(videoElement);
 * const detections = await detector.detect(imageData);
 * const inSourceSpace = reverseLetterboxBoxes(detections, params);
 * ```
 */
export function createLetterboxCapturer(
	options: LetterboxCapturerOptions,
): LetterboxCapturer {
	const { inputSize, padColor = DEFAULT_PAD_COLOR } = options;
	if (!Number.isFinite(inputSize) || inputSize <= 0) {
		throw new Error(
			`createLetterboxCapturer: inputSize must be a positive finite number (got ${inputSize})`,
		);
	}

	const canvas = document.createElement("canvas");
	canvas.width = inputSize;
	canvas.height = inputSize;
	const ctx = canvas.getContext("2d", { willReadFrequently: true });
	if (!ctx) {
		throw new Error(
			"createLetterboxCapturer: failed to acquire a 2D rendering context",
		);
	}

	return {
		canvas,
		inputSize,
		capture(source: CaptureSource): LetterboxCaptureResult {
			const { width: srcW, height: srcH } = resolveSourceSize(source);
			if (
				!Number.isFinite(srcW) ||
				!Number.isFinite(srcH) ||
				srcW <= 0 ||
				srcH <= 0
			) {
				throw new Error(
					`createLetterboxCapturer.capture: source dimensions must be positive finite numbers (got width=${srcW}, height=${srcH}). For HTMLVideoElement, ensure metadata has loaded.`,
				);
			}

			const params = computeLetterboxParams(srcW, srcH, inputSize);

			ctx.fillStyle = padColor;
			ctx.fillRect(0, 0, inputSize, inputSize);
			ctx.drawImage(
				source,
				params.padX,
				params.padY,
				params.contentWidth,
				params.contentHeight,
			);
			const imageData = ctx.getImageData(0, 0, inputSize, inputSize);
			return { imageData, params };
		},
	};
}

/**
 * Maps a box from letterboxed model space back to the original source image space
 * by undoing the scale and padding from {@link computeLetterboxParams}.
 *
 * The generic parameter `B extends Box` preserves any extra fields on the input
 * (e.g. `score`, `classId`, `trackId` on a `Detection`); only `x1`/`y1`/`x2`/`y2`
 * are transformed, everything else is shallow-copied through.
 *
 * @param box - Box in letterboxed model-space coordinates.
 * @param params - The {@link LetterboxParams} returned by the corresponding capture.
 * @returns A new box with coordinates in original source-image space.
 *
 * @remarks
 * Pair this with {@link createLetterboxCapturer}. For boxes produced from a
 * stretched (non-letterbox) capture, use {@link reverseStretchBox} instead —
 * the two transforms are not interchangeable.
 *
 * @example
 * ```ts
 * const { imageData, params } = capturer.capture(video);
 * const detections = await detector.detect(imageData);
 * const inSourceSpace = detections.map((d) => reverseLetterboxBox(d, params));
 * ```
 */
export function reverseLetterboxBox<B extends Box>(
	box: B,
	params: LetterboxParams,
): B {
	const inv = 1 / params.scale;
	return {
		...box,
		x1: (box.x1 - params.padX) * inv,
		y1: (box.y1 - params.padY) * inv,
		x2: (box.x2 - params.padX) * inv,
		y2: (box.y2 - params.padY) * inv,
	};
}

/**
 * Batch form of {@link reverseLetterboxBox}. Maps each box in `boxes` back to
 * original source-image space, returning a new array of the same length and order.
 *
 * @param boxes - Read-only array of boxes in letterboxed model-space coordinates.
 * @param params - The {@link LetterboxParams} returned by the corresponding capture.
 * @returns A new array of boxes in original source-image space, preserving any
 *   extra fields on each input box.
 */
export function reverseLetterboxBoxes<B extends Box>(
	boxes: readonly B[],
	params: LetterboxParams,
): B[] {
	return boxes.map((b) => reverseLetterboxBox(b, params));
}

/**
 * Maps a box from stretched model space back to original source image space,
 * by scaling each axis independently by `sourceWidth / inputSize` and
 * `sourceHeight / inputSize`.
 *
 * The generic parameter `B extends Box` preserves extra fields on the input;
 * only the coordinates are transformed.
 *
 * @param box - Box in stretched model-space coordinates.
 * @param sourceWidth - Width of the original source image, in pixels.
 * @param sourceHeight - Height of the original source image, in pixels.
 * @param inputSize - Square edge length of the model input that produced `box`.
 * @returns A new box with coordinates in original source-image space.
 *
 * @remarks
 * Pair this with {@link createCanvasFrameCapturer} (which stretches the source
 * to fit). For boxes produced from a letterboxed capture, use
 * {@link reverseLetterboxBox} instead.
 */
export function reverseStretchBox<B extends Box>(
	box: B,
	sourceWidth: number,
	sourceHeight: number,
	inputSize: number,
): B {
	const sx = sourceWidth / inputSize;
	const sy = sourceHeight / inputSize;
	return {
		...box,
		x1: box.x1 * sx,
		y1: box.y1 * sy,
		x2: box.x2 * sx,
		y2: box.y2 * sy,
	};
}
