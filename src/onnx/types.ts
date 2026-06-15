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
 * Location override for ONNX Runtime Web's WebAssembly runtime assets
 * (`ort-wasm-*.wasm` / `.mjs`), as accepted by `ort.env.wasm.wasmPaths`.
 *
 * Either a single base path or URL prefix the asset files are served under
 * (e.g. `"/onnxruntime/"`), or a per-file map (`{ wasm, mjs }`) for explicit
 * control. Mirrors ONNX Runtime's own `wasmPaths` type.
 */
export type WasmPaths = ort.Env.WasmPrefixOrFilePaths;

/**
 * Options for initializing an ONNX Runtime session.
 */
export interface InitSessionOptions {
	/** Execution provider to request. No automatic fallback is performed. */
	executionProvider: ExecutionProvider;
	/** Graph optimization level. Defaults to `"all"` when omitted. */
	graphOptimizationLevel?: GraphOptimizationLevel;
	/**
	 * Where ONNX Runtime Web loads its WebAssembly runtime assets
	 * (`ort-wasm-simd-threaded.asyncify.{wasm,mjs}`) from. When provided, it is
	 * assigned to `ort.env.wasm.wasmPaths` before the session is created, so the
	 * runtime fetches the assets from a location you serve rather than the
	 * bundler default.
	 *
	 * Self-hosting the assets and pointing this at them is the reliable way to
	 * ship the runtime. By default ONNX Runtime resolves the files relative to
	 * its own module URL (`import.meta.url`), which only works when the host
	 * bundler emits and serves them — not guaranteed under every setup (e.g.
	 * Next.js `output: "standalone"`, where `_next/static` assets coming from
	 * `node_modules` are not copied into the standalone server). Point this at a
	 * static path such as `"/onnxruntime/"` that serves the asset file to avoid
	 * relying on that resolution.
	 *
	 * **Side effect:** assigning `ort.env.wasm.wasmPaths` mutates a process-global
	 * singleton shared by every session in the page. When multiple sessions are
	 * created with different values, the value set immediately before the first
	 * session is created wins; later assignments do not move already-loaded
	 * runtime assets. When omitted, the global is left untouched.
	 */
	wasmPaths?: WasmPaths;
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
