import type * as ort from "onnxruntime-web/webgpu";
import { isWebGpuAvailable } from "./backend";
import type { InitSessionOptions, SessionResult } from "./types";

/**
 * Initializes an ONNX Runtime session for the specified model and execution provider.
 * @param modelPath - The path to the ONNX model file, or an ArrayBuffer or Uint8Array containing the model data.
 * @param options - The options for initializing the session, including the execution provider, graph optimization level, and session options.
 * @returns A promise that resolves to an object containing the initialized session and the backend used for execution.
 *
 * @throws {Error} When `executionProvider` is `"webgpu"` but `navigator.gpu` is unavailable
 *   (e.g. unsupported browser, or executed in an SSR/Node environment).
 *   The check happens before any module load, so the dynamic import of `onnxruntime-web` is skipped in this case.
 * @throws Re-throws any error from `InferenceSession.create`, such as invalid model bytes,
 *   failed model fetch, or execution provider initialization failure.
 *
 * @remarks
 *
 * `onnxruntime-web` is loaded via dynamic `import()` on the first call, not at module
 * evaluation time. This keeps the module SSR-safe, but means the first invocation pays
 * the cost of fetching and evaluating the runtime bundle (including WASM assets), which
 * can take hundreds of milliseconds to several seconds depending on network and device.
 * Any side effects of importing `onnxruntime-web` (such as logging) also occur at that time.
 *
 * When `options.wasmPaths` is provided, it is assigned to `ort.env.wasm.wasmPaths`
 * immediately after the runtime is imported and before the session is created, so the
 * runtime resolves its WebAssembly assets from the given location. This mutates a
 * process-global singleton — see {@link InitSessionOptions.wasmPaths}.
 */
export async function initSession(
	modelPath: string | ArrayBufferLike | Uint8Array,
	options: InitSessionOptions,
): Promise<SessionResult> {
	const {
		executionProvider,
		graphOptimizationLevel = "all",
		wasmPaths,
		sessionOptions,
	} = options;

	if (executionProvider === "webgpu" && !isWebGpuAvailable()) {
		throw new Error(
			'initSession: executionProvider "webgpu" was requested but navigator.gpu is unavailable in this environment',
		);
	}

	const ortRuntime = await import("onnxruntime-web/webgpu");

	if (wasmPaths !== undefined) {
		ortRuntime.env.wasm.wasmPaths = wasmPaths;
	}

	const session = await ortRuntime.InferenceSession.create(
		modelPath as Parameters<typeof ort.InferenceSession.create>[0],
		{
			...sessionOptions,
			executionProviders: [executionProvider],
			graphOptimizationLevel,
		},
	);

	return { session, backend: executionProvider };
}
