import type { PreprocessOptions, Preprocessor } from "./types";

const DEFAULT_INPUT_SIZE = 640;

/**
 * Allocates a new `Float32Array` sized for one CHW RGB image of `inputSize × inputSize`.
 *
 * @param inputSize - Square edge length of the target image. Defaults to 640.
 * @returns A fresh `Float32Array` of length `3 * inputSize * inputSize`.
 *
 * @remarks
 * This function only allocates; it does not touch any image data. Use it when you
 * want to own a buffer and pass it to {@link rgbaToFloat32Chw} via `options.buffer`,
 * or when implementing your own preprocessing loop.
 *
 * @example
 * ```ts
 * const buffer = createPreprocessBuffer(640);
 * console.log(buffer.length); // 1228800 (3 * 640 * 640)
 * ```
 */
export function createPreprocessBuffer(
	inputSize: number = DEFAULT_INPUT_SIZE,
): Float32Array {
	return new Float32Array(3 * inputSize * inputSize);
}

/**
 * Converts RGBA pixel data from an `ImageData` object to a `Float32Array` in CHW format,
 * scaled to the range `[0, 1]` by dividing by 255.
 *
 * @param imageData - The `ImageData` object containing RGBA pixel data to be converted.
 *   The width and height of the image must match the `inputSize` specified in options
 *   (default 640); otherwise the result is undefined.
 * @param options - Preprocessing options. `inputSize` controls the expected square edge
 *   length. `buffer`, when provided, is a caller-owned `Float32Array` of length
 *   `3 * inputSize * inputSize` that this function writes into and returns.
 * @returns A `Float32Array` containing the RGB pixel data in CHW format
 *   (all R values, then all G values, then all B values), scaled to `[0, 1]`.
 *   When `options.buffer` is provided, the returned reference is that same instance;
 *   otherwise a freshly allocated buffer is returned and owned by the caller.
 *
 * @remarks
 * This function is pure with respect to module state: no buffers are cached or
 * shared between calls. If you want to avoid per-frame allocation in a hot loop,
 * either pass a reusable buffer via `options.buffer`, or use {@link createPreprocessor}
 * to bundle a single owned buffer with its conversion call.
 *
 * @throws {Error} If the provided `options.buffer` length does not match `3 * inputSize * inputSize`.
 *
 * @example
 * Per-call allocation (safe to retain the result):
 * ```ts
 * const featureA = rgbaToFloat32Chw(frameA);
 * const featureB = rgbaToFloat32Chw(frameB);
 * // featureA and featureB are independent buffers
 * ```
 *
 * @example
 * Reused caller-owned buffer (zero-allocation hot loop):
 * ```ts
 * const buffer = createPreprocessBuffer(640);
 * for (const frame of frames) {
 *   const float32 = rgbaToFloat32Chw(frame, { buffer });
 *   await session.run({ input: new Tensor("float32", float32, [1, 3, 640, 640]) });
 * }
 * ```
 */
export function rgbaToFloat32Chw(
	imageData: ImageData,
	options: PreprocessOptions = {},
): Float32Array {
	const inputSize = options.inputSize ?? DEFAULT_INPUT_SIZE;
	const channelSize = inputSize * inputSize;
	const required = 3 * channelSize;

	const buffer = options.buffer ?? new Float32Array(required);
	if (buffer.length !== required) {
		throw new Error(
			`rgbaToFloat32Chw: buffer length ${buffer.length} does not match expected ${required} for inputSize=${inputSize}`,
		);
	}

	const { data } = imageData;
	for (let i = 0; i < channelSize; i++) {
		const rgbaIdx = i * 4;
		buffer[i] = (data[rgbaIdx] as number) / 255;
		buffer[channelSize + i] = (data[rgbaIdx + 1] as number) / 255;
		buffer[2 * channelSize + i] = (data[rgbaIdx + 2] as number) / 255;
	}

	return buffer;
}

/**
 * Creates a {@link Preprocessor} that owns a single reusable `Float32Array` buffer
 * sized for `inputSize × inputSize` CHW input.
 *
 * @param inputSize - Square edge length of the target image. Defaults to 640.
 * @returns A {@link Preprocessor} whose `process` method runs {@link rgbaToFloat32Chw}
 *   against the owned buffer. The returned buffer is overwritten on each call.
 *
 * @remarks
 * Use this for hot inference loops where per-frame allocation would create GC pressure.
 * Ownership is explicit: each `Preprocessor` instance has its own buffer, so independent
 * pipelines do not interfere with each other. The buffer is released when the
 * `Preprocessor` becomes unreachable.
 *
 * @example
 * ```ts
 * const preprocessor = createPreprocessor(640);
 * for (const frame of frames) {
 *   const float32 = preprocessor.process(frame);
 *   await session.run({ input: new Tensor("float32", float32, [1, 3, 640, 640]) });
 * }
 * ```
 */
export function createPreprocessor(
	inputSize: number = DEFAULT_INPUT_SIZE,
): Preprocessor {
	const buffer = createPreprocessBuffer(inputSize);
	return {
		inputSize,
		get buffer(): Float32Array {
			return buffer;
		},
		process(imageData: ImageData): Float32Array {
			return rgbaToFloat32Chw(imageData, { inputSize, buffer });
		},
	};
}
