import type * as ort from "onnxruntime-web/webgpu";
import { createPreprocessBuffer, initSession, rgbaToFloat32Chw } from "@/onnx";
import { postprocess } from "./postprocess";
import type { Detection, YoloDetector, YoloDetectorOptions } from "./types";

const DEFAULT_INPUT_SIZE = 640;

/**
 * Creates a high-level YOLO detector that wires together session
 * initialization, preprocessing, inference, and postprocessing.
 *
 * Each `detect(imageData)` call runs the full pipeline:
 * RGBA → CHW Float32 → `InferenceSession.run` → decode → {@link Detection}[].
 *
 * @param options - See {@link YoloDetectorOptions}. At minimum, `modelPath`
 *   and `executionProvider` are required.
 * @returns A {@link YoloDetector} ready for repeated `detect()` calls.
 *
 * @throws {Error} From `initSession` — e.g. when `"webgpu"` is requested but
 *   `navigator.gpu` is unavailable.
 * @throws {Error} If the loaded model exposes no input or output names.
 * @throws {Error} From `detect()` — if `session.run` does not return the
 *   expected output tensor.
 *
 * @remarks
 * The detector owns a single preprocess buffer of size
 * `3 * inputSize * inputSize` and reuses it across every `detect()` call to
 * avoid per-frame allocation. Pass `options.preprocessBuffer` to provide an
 * external buffer (e.g. to share with another consumer).
 *
 * Input `ImageData` passed to `detect()` must be exactly `inputSize × inputSize`.
 * Use `createLetterboxCapturer` or `createCanvasFrameCapturer` from the
 * `source` subpath to produce correctly-sized frames from video or images.
 *
 * Returned `Detection` coordinates are in **model input space**. Use
 * `reverseLetterboxBox` (paired with a letterbox capturer) or
 * `reverseStretchBox` (paired with a stretch capturer) to map them back to
 * the original source dimensions.
 *
 * @example
 * ```ts
 * const detector = await createYoloDetector({
 *   modelPath: "/models/yolov8n.onnx",
 *   executionProvider: "webgpu",
 *   inputSize: 640,
 *   postprocess: { format: "auto", confThreshold: 0.25 },
 * });
 *
 * const capturer = createLetterboxCapturer({ inputSize: 640 });
 * const { imageData, params } = capturer.capture(videoElement);
 * const inModelSpace = await detector.detect(imageData);
 * const inSourceSpace = reverseLetterboxBoxes(inModelSpace, params);
 * ```
 */
export async function createYoloDetector(
	options: YoloDetectorOptions,
): Promise<YoloDetector> {
	const inputSize = options.inputSize ?? DEFAULT_INPUT_SIZE;
	const postprocessOptions = options.postprocess ?? {};

	const { session, backend } = await initSession(options.modelPath, {
		executionProvider: options.executionProvider,
		...options.session,
	});

	const ortRuntime = await import("onnxruntime-web/webgpu");
	const TensorCtor: typeof ort.Tensor = ortRuntime.Tensor;

	const buffer = options.preprocessBuffer ?? createPreprocessBuffer(inputSize);
	const inputName = session.inputNames[0];
	const outputName = session.outputNames[0];
	if (!inputName || !outputName) {
		throw new Error(
			"createYoloDetector: session is missing input or output names",
		);
	}

	return {
		session,
		backend,
		inputSize,
		async detect(imageData: ImageData): Promise<Detection[]> {
			const float32 = rgbaToFloat32Chw(imageData, { inputSize, buffer });
			const tensor = new TensorCtor("float32", float32, [
				1,
				3,
				inputSize,
				inputSize,
			]);
			const results = await session.run({ [inputName]: tensor });
			const output = results[outputName];
			if (!output) {
				throw new Error(
					`createYoloDetector.detect: session.run did not return output "${outputName}"`,
				);
			}
			return postprocess(output, postprocessOptions);
		},
	};
}
