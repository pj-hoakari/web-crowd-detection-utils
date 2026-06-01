---
name: set-up-onnx-runtime
description: >
  Use the onnx subpath (initSession, createPreprocessor / createPreprocessBuffer
  / rgbaToFloat32Chw, isWebGpuAvailable) directly for non-YOLO ONNX models or
  custom inference pipelines. Load when an agent runs a segmentation/pose/depth
  model, wires SSR-safe inference into Next.js, picks WebGPU vs WASM, debugs
  buffer ownership, or is tempted to import onnxruntime-web directly. Covers
  the lib-owns-onnxruntime-web contract (never bypass), Preprocessor buffer
  overwrite semantics, InitSessionOptions and the omitted executionProviders
  field, the Worker boundary (which subpaths are DOM-free), and dynamic-import
  SSR safety.
type: core
library: web-crowd-detection-utils
library_version: "0.0.0"
sources:
  - "pj-hoakari/web-crowd-detection-utils:src/onnx/session.ts"
  - "pj-hoakari/web-crowd-detection-utils:src/onnx/preprocess.ts"
  - "pj-hoakari/web-crowd-detection-utils:src/onnx/backend.ts"
  - "pj-hoakari/web-crowd-detection-utils:src/onnx/types.ts"
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

### Worker compatibility — which subpaths are DOM-free

| Subpath / API                                       | DOM-free | Worker-safe |
| --------------------------------------------------- | -------- | ----------- |
| `onnx/preprocess` (`createPreprocessor`, etc.)      | Yes      | Yes         |
| `onnx/session` (`initSession`)                      | Yes      | Yes (if ORT WASM/WebGPU paths configured in the worker) |
| `bytetrack` (`BYTETracker`)                         | Yes      | Yes         |
| `yolo/postprocess` (`postprocess`, `nms`)           | Yes      | Yes         |
| `source` (`create*Capturer`)                        | **No** — uses `document.createElement("canvas")` | No |
| `source/letterbox.ts:computeLetterboxParams`        | Yes      | Yes (pure function) |

Typical workerization: capture on the main thread, transfer `ImageData` (and `LetterboxParams`) to a Worker that runs `initSession` + `detector.detect` + `tracker.update`.

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

### HIGH Tension: library-owned onnxruntime-web vs consumer pinning

The owned-dependency model removes version drift but also removes the consumer's control over the ORT version. Agents seeing `import * as ort from "onnxruntime-web"` in source files often reflexively add it to consumer deps; the resulting double-bundle breaks at WASM load with errors that don't point at the cause.

See also: `set-up-detection-pipeline/SKILL.md` § Common Mistakes — `Assuming WebGPU automatically falls back to WASM` for the related backend-selection pattern.

## See also

- `set-up-detection-pipeline/SKILL.md` — `createYoloDetector` wraps `initSession` + preprocessing for the YOLO happy path
- `configure-yolo-postprocess/SKILL.md` — when running ORT directly with your own postprocess, the format / NMS knowledge still applies
