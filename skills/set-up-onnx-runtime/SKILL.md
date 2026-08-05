---
name: set-up-onnx-runtime
description: >
  Use the onnx subpath (initSession, createPreprocessor / createPreprocessBuffer
  / rgbaToFloat32Chw, isWebGpuAvailable) directly for non-YOLO ONNX models or
  custom inference pipelines. Load when an agent runs a segmentation/pose/depth
  model, wires SSR-safe inference into Next.js, picks WebGPU vs WASM, self-hosts
  the ONNX Runtime WASM assets (wcdu-copy-runtime-assets CLI + the wasmPaths
  option) for bundlers that don't serve them (Next.js standalone / Turbopack),
  debugs buffer ownership, or is tempted to import onnxruntime-web directly.
  Covers the lib-owns-onnxruntime-web contract (never bypass), Preprocessor
  buffer overwrite semantics, InitSessionOptions and the omitted
  executionProviders field, the wasmPaths runtime-asset location override (a
  process-global singleton), Worker compatibility (every subpath runs in a Web
  Worker — the source capturers use OffscreenCanvas — so only consumer-side
  captureStream() needs the main thread), and dynamic-import SSR safety.
metadata:
  type: core
  library: web-crowd-detection-utils
  library_version: "0.0.0"
sources:
  - "pj-hoakari/web-crowd-detection-utils:src/onnx/session.ts"
  - "pj-hoakari/web-crowd-detection-utils:src/onnx/preprocess.ts"
  - "pj-hoakari/web-crowd-detection-utils:src/onnx/backend.ts"
  - "pj-hoakari/web-crowd-detection-utils:src/onnx/types.ts"
  - "pj-hoakari/web-crowd-detection-utils:src/bin/copy-runtime-assets.ts"
  - "pj-hoakari/web-crowd-detection-utils:CLAUDE.md"
---

# Set up onnxruntime-web for a custom (non-YOLO) model

The `onnx` subpath is the library's interface to `onnxruntime-web`. It is the only correct entry point — `onnxruntime-web` is an internal dependency owned by this package and **must never be imported directly by consumers**. PoC patterns and runtime workarounds are consolidated inside this library so improvements ship to every consumer at once.

## Setup

```ts
import {
  initSession,
  isWebGpuAvailable,
  createPreprocessor,
  rgbaToFloat32Chw,
  createPreprocessBuffer,
  type InitSessionOptions,
  type SessionResult,
  type ExecutionProvider,
} from "@pj-hoakari/web-crowd-detection-utils/onnx";

const INPUT_SIZE = 640;

async function loadModel(
  modelPath: string | ArrayBufferLike | Uint8Array,
): Promise<SessionResult> {
  const preferred: ExecutionProvider = isWebGpuAvailable() ? "webgpu" : "wasm";
  try {
    return await initSession(modelPath, { executionProvider: preferred });
  } catch (err) {
    if (preferred !== "webgpu") throw err;
    return initSession(modelPath, { executionProvider: "wasm" });
  }
}
```

## Core Patterns

### Run a non-YOLO model with a reusable preprocess buffer

```ts
import type * as ort from "onnxruntime-web";
const ort = await import("onnxruntime-web/webgpu"); // ok inside an async fn / event handler

const { session } = await initSession(modelPath, { executionProvider: "webgpu" });
const preprocessor = createPreprocessor(INPUT_SIZE);
const inputName = session.inputNames[0];
if (!inputName) throw new Error("session has no input");

while (!signal.aborted) {
  const imageData = capturer.capture(video);   // ImageData of inputSize × inputSize
  const float32 = preprocessor.process(imageData); // SAME buffer every call — overwritten
  const tensor = new ort.Tensor("float32", float32, [1, 3, INPUT_SIZE, INPUT_SIZE]);
  const results = await session.run({ [inputName]: tensor });
  // custom postprocess for your model output
  await new Promise<void>((r) => requestAnimationFrame(() => r()));
}
```

### Share a preprocess buffer between detector and another consumer

```ts
const buffer = createPreprocessBuffer(640);

const detector = await createYoloDetector({
  modelPath,
  executionProvider: "webgpu",
  inputSize: 640,
  preprocessBuffer: buffer,      // detector reuses this
});

// In the same loop body — write into the same buffer for a custom branch
// (be careful: the next detector.detect() will overwrite it)
const float32 = rgbaToFloat32Chw(imageData, { inputSize: 640, buffer });
```

### SSR-safe call site

```ts
// detection.ts — NO top-level imports of onnxruntime-web. Static import of the
// onnx subpath is fine; the runtime import happens lazily inside initSession.
import { initSession } from "@pj-hoakari/web-crowd-detection-utils/onnx";

export async function loadDetector(modelPath: ArrayBuffer) {
  // First call dynamically imports onnxruntime-web; pays bundle fetch + WASM
  // init (hundreds of ms to several seconds). Subsequent calls are fast.
  return initSession(modelPath, { executionProvider: "webgpu" });
}

// In a React component: call from useEffect / onClick, never during SSR render.
```

### Self-host the ONNX Runtime WASM assets (reliable production setup)

`onnxruntime-web` fetches a WebAssembly runtime (`ort-wasm-simd-threaded.asyncify.wasm` + `.mjs`) over HTTP at first inference — the `.wasm` is **not** inlined. By default ONNX Runtime resolves those files relative to its own module URL (`import.meta.url`), which only works when the host bundler emits and serves them from `node_modules`. Several setups do **not** (e.g. Next.js `output: "standalone"`, Turbopack). Self-host the assets and point the runtime at them with `wasmPaths`:

```sh
# 1. Copy the exact assets this package needs into a served directory.
#    The CLI resolves them from the installed onnxruntime-web, so the served
#    runtime always matches the JS glue this package bundles.
npx wcdu-copy-runtime-assets public/onnxruntime
```

```jsonc
// package.json — keep the copy in sync on install and build
{
  "scripts": {
    "postinstall": "wcdu-copy-runtime-assets public/onnxruntime",
    "prebuild": "wcdu-copy-runtime-assets public/onnxruntime"
  }
}
```

```ts
// 2. Point the runtime at the served path via wasmPaths.
const { session } = await initSession(modelPath, {
  executionProvider: "webgpu",
  wasmPaths: "/onnxruntime/", // matches the copy destination (public/onnxruntime → /onnxruntime/)
});

// Through the YOLO detector the same option lives under `session`:
const detector = await createYoloDetector({
  modelPath,
  executionProvider: "webgpu",
  session: { wasmPaths: "/onnxruntime/" },
});
```

`wasmPaths` assigns `ort.env.wasm.wasmPaths`, a **process-global singleton** shared by every session on the page. Set it on (or before) the first `initSession` call — the value in effect when the first session is created wins, and later assignments do not move already-loaded assets. Alternatively, pin a CDN at the exact installed version (`https://cdn.jsdelivr.net/npm/onnxruntime-web@<version>/dist/`) and skip the copy step, at the cost of an external runtime dependency.

### Worker compatibility — every subpath runs in a Web Worker

| Subpath / API                                       | DOM-free | Worker-safe |
| --------------------------------------------------- | -------- | ----------- |
| `onnx/preprocess` (`createPreprocessor`, etc.)      | Yes      | Yes         |
| `onnx/session` (`initSession`)                      | Yes      | Yes — pass `wasmPaths` so ORT resolves its WASM assets from a path the worker can fetch |
| `bytetrack` (`BYTETracker`)                         | Yes      | Yes         |
| `yolo/postprocess` (`postprocess`, `nms`)           | Yes      | Yes         |
| `source` (`create*Capturer`)                        | Yes — prefers `OffscreenCanvas`, falls back to `document.createElement` | Yes (when the `OffscreenCanvas` constructor exists — covers all workers) |
| `source/letterbox.ts:computeLetterboxParams`        | Yes      | Yes (pure function) |

Since the OffscreenCanvas change, no subpath is main-thread-only. The capturers call `createScratchCanvas2D`, which allocates `new OffscreenCanvas(...)` whenever the constructor exists, so you can run the entire pipeline — capture included — inside a Worker. (You can still capture on the main thread and transfer `ImageData` plus `LetterboxParams` to a Worker that runs `initSession` + `detector.detect` + `tracker.update` if you prefer.) The one main-thread-only operation is consumer-side: `captureStream()` exists only on `HTMLCanvasElement`, so narrow `capturer.canvas` with `instanceof` before calling it — see `handle-frame-coordinates`.

## Common Mistakes

### CRITICAL Bypassing the library to call onnxruntime-web directly

Wrong:

```ts
// Copying the onnxruntime-web README — skips every safeguard this lib centralizes
import * as ort from "onnxruntime-web/webgpu";
const session = await ort.InferenceSession.create(modelPath, {
  executionProviders: ["webgpu"],
});
const tensor = new ort.Tensor("float32", float32, [1, 3, 640, 640]);
```

Correct:

```ts
// initSession is THE entry point. Improvements land here for every consumer.
import { initSession } from "@pj-hoakari/web-crowd-detection-utils/onnx";
const { session } = await initSession(modelPath, { executionProvider: "webgpu" });
// For custom models, run session.run yourself; for YOLO use createYoloDetector.
```

`onnxruntime-web` is an internal dependency. PoC-learned patterns (dynamic-import SSR safety, executionProvider gating, preprocess buffer reuse, future workarounds) are consolidated inside this library so they propagate to every consumer. Direct ORT use re-fragments that knowledge.

Source: src/onnx/session.ts (initSession is the public entry), CLAUDE.md (lib-as-knowledge-sink design)

### HIGH Adding onnxruntime-web to consumer package.json

Wrong:

```jsonc
// consumer-app/package.json
{
  "dependencies": {
    "@pj-hoakari/web-crowd-detection-utils": "^0.1.0",
    "onnxruntime-web": "^1.24.0"   // do not add — owned by the library
  }
}
```

Correct:

```jsonc
{
  "dependencies": {
    "@pj-hoakari/web-crowd-detection-utils": "^0.1.0"
  }
}
```

The library owns `onnxruntime-web` as a direct `dependencies` entry specifically to eliminate version drift. Listing it again in the consumer creates two installed copies; the WASM modules mismatch at load with opaque errors.

Source: CLAUDE.md (Runtime deps via dependencies by default), package.json#dependencies

### HIGH Importing onnxruntime-web at module top level

Wrong:

```ts
// detection.ts — top-level static import defeats SSR safety
import * as ort from "onnxruntime-web/webgpu";
export async function load() {
  return initSession(path, { executionProvider: "webgpu" });
}
```

Correct:

```ts
// Let initSession do the dynamic import internally on first call
import { initSession } from "@pj-hoakari/web-crowd-detection-utils/onnx";
export async function load() {
  return initSession(path, { executionProvider: "webgpu" });
}
```

`initSession` uses dynamic `import("onnxruntime-web/webgpu")` so the module is safe to import at SSR time. Top-level static import triggers `navigator.gpu` access on the server.

Source: src/onnx/session.ts:17-23 (@remarks dynamic import)

### HIGH Trusting isWebGpuAvailable() as a "safe to run" check

Wrong:

```ts
if (isWebGpuAvailable()) {
  return await initSession(path, { executionProvider: "webgpu" });
  // crashes on Linux without GPU acceleration, Safari beta, etc.
}
```

Correct:

```ts
if (isWebGpuAvailable()) {
  try {
    return await initSession(path, { executionProvider: "webgpu" });
  } catch (err) {
    console.warn("WebGPU init failed, falling back", err);
  }
}
return initSession(path, { executionProvider: "wasm" });
```

`isWebGpuAvailable()` only checks for `navigator.gpu` presence. The actual GPU adapter may still fail at session create due to driver, browser-flag, or hardware constraints.

Source: src/onnx/backend.ts:8-12 (@remarks adapter may still fail)

### HIGH Forgetting Preprocessor buffer overwrite semantics

Wrong:

```ts
const preprocessor = createPreprocessor(640);
const batch: Float32Array[] = [];
for (const frame of frames) batch.push(preprocessor.process(frame));
// All entries point to the SAME buffer — every slot holds the last frame.
```

Correct:

```ts
// Either copy per frame:
for (const frame of frames) batch.push(new Float32Array(preprocessor.process(frame)));

// Or use the per-call allocation form:
for (const frame of frames) batch.push(rgbaToFloat32Chw(frame, { inputSize: 640 }));
```

`Preprocessor.process` and `rgbaToFloat32Chw(..., { buffer })` both return the same `Float32Array` instance every call. Storing the reference and reading later sees the latest frame.

Source: src/onnx/preprocess.ts:96-110, src/onnx/types.ts:64-86 (@remarks overwrite)

### HIGH Forcing executionProviders via sessionOptions with `as any`

Wrong:

```ts
// TypeScript blocks executionProviders inside sessionOptions; agent reaches for `as any`
await initSession(path, {
  executionProvider: "webgpu",
  sessionOptions: { executionProviders: ["wasm"] as any },
});
```

Correct:

```ts
// Use executionProvider (singular). To change backend, change that field.
await initSession(path, { executionProvider: "wasm" });
```

`InitSessionOptions.sessionOptions` is typed as `Omit<..., "executionProviders">` on purpose — the singular field is the sole knob and the library forwards it correctly. `as any` overrides produce confusing "two providers" behavior or silent overrides.

Source: src/onnx/types.ts:38-45 (Omit is intentional), src/onnx/session.ts:44-48

### HIGH Relying on default WASM asset resolution under Next.js standalone / Turbopack

Wrong:

```ts
// No wasmPaths — ORT resolves ort-wasm-*.wasm relative to its own module URL.
// Under Next.js `output: "standalone"` or Turbopack the file is never emitted
// from node_modules, so the first inference fails fetching the .wasm.
const { session } = await initSession(modelPath, { executionProvider: "webgpu" });
```

Correct:

```ts
// Self-host the assets (see § Self-host the ONNX Runtime WASM assets) and point at them.
const { session } = await initSession(modelPath, {
  executionProvider: "webgpu",
  wasmPaths: "/onnxruntime/",
});
```

The `.wasm` is fetched over HTTP, not inlined. Default resolution relies on the bundler emitting the file from `node_modules`; standalone/Turbopack builds don't, so it 404s at session create / first `run` with an opaque instantiate error rather than a build-time failure. Copy the assets with `wcdu-copy-runtime-assets` and set `wasmPaths`.

Source: src/onnx/types.ts:47-69 (wasmPaths @remarks), src/bin/copy-runtime-assets.ts, README.md (Serving the ONNX Runtime WebAssembly assets)

### HIGH Self-hosting ORT assets from a mismatched onnxruntime-web version

Wrong:

```ts
// Hand-copied ort-wasm-*.wasm from a different onnxruntime-web version, or a CDN
// pinned to the wrong version. The JS glue this package bundles expects the exact
// matching build — a mismatch makes ONNX Runtime fail to initialize.
initSession(modelPath, {
  executionProvider: "wasm",
  wasmPaths: "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.0/dist/",
});
```

Correct:

```sh
# Let the CLI resolve the assets from the onnxruntime-web THIS package depends on,
# so the served runtime always matches the bundled glue.
npx wcdu-copy-runtime-assets public/onnxruntime
```

```ts
initSession(modelPath, { executionProvider: "wasm", wasmPaths: "/onnxruntime/" });
```

`wcdu-copy-runtime-assets` copies `ort-wasm-simd-threaded.asyncify.{wasm,mjs}` resolved from the installed `onnxruntime-web` (which this package owns), guaranteeing the runtime matches the glue. A hand-picked file or wrong-version CDN URL throws at session create with a runtime-init error.

Source: src/bin/copy-runtime-assets.ts:25-49 (resolves from installed onnxruntime-web), package.json#dependencies (onnxruntime-web owned)

### MEDIUM Expecting a later wasmPaths to override an already-initialized runtime

Wrong:

```ts
// First session created without wasmPaths — ORT resolves (and may fail) here.
const a = await initSession(modelA, { executionProvider: "webgpu" });
// Second session sets wasmPaths, expecting to "fix" the path globally.
const b = await initSession(modelB, {
  executionProvider: "webgpu",
  wasmPaths: "/onnxruntime/", // too late — assets already resolved for the page
});
```

Correct:

```ts
// Set wasmPaths on (or before) the FIRST session created on the page.
const a = await initSession(modelA, {
  executionProvider: "webgpu",
  wasmPaths: "/onnxruntime/",
});
const b = await initSession(modelB, { executionProvider: "webgpu" }); // inherits the global
```

`wasmPaths` writes to `ort.env.wasm.wasmPaths`, a page-global singleton. The value set immediately before the first session is created wins; later assignments don't move already-loaded runtime assets. Configure it once, at the first `initSession`.

Source: src/onnx/types.ts:63-67 (@remarks process-global singleton), src/onnx/session.ts:49-51

### HIGH Tension: library-owned onnxruntime-web vs consumer pinning

The owned-dependency model removes version drift but also removes the consumer's control over the ORT version. Agents seeing `import * as ort from "onnxruntime-web"` in source files often reflexively add it to consumer deps; the resulting double-bundle breaks at WASM load with errors that don't point at the cause.

See also: `set-up-detection-pipeline/SKILL.md` § Common Mistakes — `Assuming WebGPU automatically falls back to WASM` for the related backend-selection pattern.

## See also

- `set-up-detection-pipeline/SKILL.md` — `createYoloDetector` wraps `initSession` + preprocessing for the YOLO happy path
- `configure-yolo-postprocess/SKILL.md` — when running ORT directly with your own postprocess, the format / NMS knowledge still applies
