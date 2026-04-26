import { createPreprocessBuffer, initSession, rgbaToFloat32Chw } from "@/onnx";
import { postprocess } from "./postprocess";
import type { Detection, YoloDetector, YoloDetectorOptions } from "./types";

const DEFAULT_INPUT_SIZE = 640;

export async function createYoloDetector(
	options: YoloDetectorOptions,
): Promise<YoloDetector> {
	const inputSize = options.inputSize ?? DEFAULT_INPUT_SIZE;
	const postprocessOptions = options.postprocess ?? {};

	const { session, backend } = await initSession(options.modelPath, {
		executionProvider: options.executionProvider,
		...options.session,
	});

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
			const tensor = rgbaToFloat32Chw(imageData, { inputSize, buffer });
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
