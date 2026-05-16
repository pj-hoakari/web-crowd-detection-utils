import type * as ort from "onnxruntime-web/webgpu";

/**
 * ONNX Runtime Web execution provider to use for inference.
 *
 * - `"webgpu"` — GPU-accelerated via the WebGPU API. Requires `navigator.gpu`.
 * - `"wasm"` — CPU execution via WebAssembly. Available in any modern browser.
 */
export type ExecutionProvider = "webgpu" | "wasm";

/**
 * Result of a successful {@link InitSessionOptions | session initialization}.
 */
export interface SessionResult {
	/** The initialized ONNX Runtime inference session. */
	session: ort.InferenceSession;
	/** The execution provider the session was created with. Mirrors the requested provider. */
	backend: ExecutionProvider;
}

/**
 * Graph optimization level passed through to ONNX Runtime Web.
 * See ONNX Runtime documentation for the semantics of each level.
 */
export type GraphOptimizationLevel = NonNullable<
	ort.InferenceSession.SessionOptions["graphOptimizationLevel"]
>;

/**
 * Options for initializing an ONNX Runtime session.
 */
export interface InitSessionOptions {
	/** Execution provider to request. No automatic fallback is performed. */
	executionProvider: ExecutionProvider;
	/** Graph optimization level. Defaults to `"all"` when omitted. */
	graphOptimizationLevel?: GraphOptimizationLevel;
	/**
	 * Additional `InferenceSession.SessionOptions` to merge in.
	 * `executionProviders` is intentionally omitted — it is set from
	 * {@link InitSessionOptions.executionProvider} and cannot be overridden here.
	 */
	sessionOptions?: Omit<
		ort.InferenceSession.SessionOptions,
		"executionProviders"
	>;
}

/**
 * Options for RGBA → CHW Float32 preprocessing.
 */
export interface PreprocessOptions {
	/** Expected square edge length of the input image, in pixels. Defaults to 640. */
	inputSize?: number;
	/**
	 * Caller-owned destination buffer. Must have length `3 * inputSize * inputSize`.
	 *
	 * When omitted, the preprocessing function allocates a fresh buffer per call
	 * and returns ownership to the caller. Pass a reusable buffer here to avoid
	 * per-call allocation in hot loops.
	 */
	buffer?: Float32Array;
}

/**
 * A reusable preprocessor that owns a single `Float32Array` buffer for repeated
 * RGBA → CHW Float32 conversion at a fixed `inputSize`.
 *
 * Each `Preprocessor` instance has its own buffer, so independent pipelines do
 * not share state. The buffer is overwritten on every `process` call; callers
 * who need to retain a result beyond the next call should copy it.
 */
export interface Preprocessor {
	/** The square edge length this preprocessor was created for. */
	readonly inputSize: number;
	/**
	 * The internal owned buffer. Exposed for debugging and for callers that need
	 * to construct tensors referencing the same memory.
	 */
	readonly buffer: Float32Array;
	/**
	 * Converts the given `ImageData` into the owned buffer and returns it.
	 * The returned `Float32Array` is the same instance as {@link Preprocessor.buffer}
	 * and is overwritten by the next call.
	 */
	process(imageData: ImageData): Float32Array;
}
