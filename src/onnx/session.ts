import * as ort from "onnxruntime-web";
import { isWebGpuAvailable } from "./backend";
import type { InitSessionOptions, SessionResult } from "./types";

export async function initSession(
	modelPath: string | ArrayBufferLike | Uint8Array,
	options: InitSessionOptions,
): Promise<SessionResult> {
	const {
		executionProvider,
		graphOptimizationLevel = "all",
		sessionOptions,
	} = options;

	if (executionProvider === "webgpu" && !isWebGpuAvailable()) {
		throw new Error(
			'initSession: executionProvider "webgpu" was requested but navigator.gpu is unavailable in this environment',
		);
	}

	const session = await ort.InferenceSession.create(
		modelPath as Parameters<typeof ort.InferenceSession.create>[0],
		{
			...sessionOptions,
			executionProviders: [executionProvider],
			graphOptimizationLevel,
		},
	);

	return { session, backend: executionProvider };
}
