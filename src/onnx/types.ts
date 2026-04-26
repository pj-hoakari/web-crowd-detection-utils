import type * as ort from "onnxruntime-web";

export type ExecutionProvider = "webgpu" | "wasm";

export interface SessionResult {
	session: ort.InferenceSession;
	backend: ExecutionProvider;
}

export type GraphOptimizationLevel = NonNullable<
	ort.InferenceSession.SessionOptions["graphOptimizationLevel"]
>;

export interface InitSessionOptions {
	executionProvider: ExecutionProvider;
	graphOptimizationLevel?: GraphOptimizationLevel;
	sessionOptions?: Omit<
		ort.InferenceSession.SessionOptions,
		"executionProviders"
	>;
}

export interface PreprocessOptions {
	inputSize?: number;
	buffer?: Float32Array;
}
