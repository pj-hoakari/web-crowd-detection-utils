---
name: set-up-detection-pipeline
description: >
  Wire createYoloDetector + createLetterboxCapturer + reverseLetterboxBoxes to
  turn a video or image into Detection[] in source-image space. Load when an
  agent is setting up YOLO person/crowd detection in the browser for the first
  time, choosing executionProvider ("webgpu" / "wasm") with manual fallback,
  sizing inputSize, or wiring detect() into a requestAnimationFrame loop.
  Covers the happy path through @pj-hoakari/web-crowd-detection-utils/yolo
  and /onnx and /source subpaths.
type: core
library: web-crowd-detection-utils
library_version: "0.0.0"
sources:
  - "pj-hoakari/web-crowd-detection-utils:src/yolo/detector.ts"
  - "pj-hoakari/web-crowd-detection-utils:src/yolo/index.ts"
  - "pj-hoakari/web-crowd-detection-utils:src/yolo/types.ts"
  - "pj-hoakari/web-crowd-detection-utils:src/onnx/session.ts"
  - "pj-hoakari/web-crowd-detection-utils:example/yolo-webcam/src/detection.ts"
---

# Set up a YOLO detection pipeline

Compose `createYoloDetector` (yolo subpath) with a capturer (source subpath) and a reverse transform to produce `Detection[]` in original source-image pixel space for a single frame. The detector is awaited once at startup; `detect()` is then called per frame inside a `requestAnimationFrame` loop.

## Setup

```ts
import { isWebGpuAvailable } from "@pj-hoakari/web-crowd-detection-utils/onnx";
import {
  createLetterboxCapturer,
  reverseLetterboxBoxes,
} from "@pj-hoakari/web-crowd-detection-utils/source";
import {
  createYoloDetector,
  type Detection,
} from "@pj-hoakari/web-crowd-detection-utils/yolo";

const INPUT_SIZE = 640;

async function startDetection(
  modelBuffer: ArrayBuffer,
  video: HTMLVideoElement,
  signal: AbortSignal,
  onFrame: (dets: readonly Detection[]) => void,
): Promise<void> {
  const preferred = isWebGpuAvailable() ? "webgpu" : "wasm";
  let detector;
  try {
    detector = await createYoloDetector({
      modelPath: modelBuffer,
      executionProvider: preferred,
      inputSize: INPUT_SIZE,
      postprocess: { format: "auto" },
    });
  } catch (err) {
    if (preferred !== "webgpu") throw err;
    detector = await createYoloDetector({
      modelPath: modelBuffer,
      executionProvider: "wasm",
      inputSize: INPUT_SIZE,
      postprocess: { format: "auto" },
    });
  }

  const capturer = createLetterboxCapturer({ inputSize: INPUT_SIZE });

  while (!signal.aborted) {
    if (video.readyState < video.HAVE_CURRENT_DATA) {
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
      continue;
    }
    const { imageData, params } = capturer.capture(video);
    const dets = await detector.detect(imageData);
    onFrame(reverseLetterboxBoxes(dets, params));
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
  }
}
```

## Core Patterns

### Load the model as an ArrayBuffer, not a URL string

```ts
const response = await fetch("/models/yolo26n.onnx");
if (!response.ok) throw new Error(`Model fetch failed: ${response.status}`);
const modelBuffer = await response.arrayBuffer();
// modelPath accepts string | ArrayBufferLike | Uint8Array — buffer form
// lets the host app control caching, retry, and error handling.
const detector = await createYoloDetector({
  modelPath: modelBuffer,
  executionProvider: "webgpu",
  postprocess: { format: "auto" },
});
```

### Use `format: "auto"` for first-pass setup

```ts
// "auto" dispatches based on tensor shape — works for Ultralytics stock
// exports (standard) AND for exports with built-in NMS (end-to-end).
const detector = await createYoloDetector({
  modelPath,
  executionProvider: "webgpu",
  postprocess: { format: "auto" },
});
```

The library default is `"end-to-end"` (matches NMS-included exports). Stock Ultralytics exports use the `"standard"` layout — omitting `format` will throw a shape-mismatch error on those.

### Reuse the detector across frames; never re-create per frame

```ts
const detector = await createYoloDetector({ modelPath, executionProvider });
while (!signal.aborted) {
  const { imageData, params } = capturer.capture(video);
  const dets = await detector.detect(imageData); // reuses owned preprocessBuffer
  // ...
}
```

`createYoloDetector` owns a `Float32Array` of size `3 * inputSize * inputSize` and reuses it across every `detect()` call. Re-creating the detector per frame defeats this and triggers fresh WASM/WebGPU initialization each time.

### Manual WebGPU → WASM fallback (no auto-fallback)

```ts
const preferred = isWebGpuAvailable() ? "webgpu" : "wasm";
try {
  detector = await createYoloDetector({ modelPath, executionProvider: preferred, ... });
} catch (err) {
  if (preferred !== "webgpu") throw err;
  detector = await createYoloDetector({ modelPath, executionProvider: "wasm", ... });
}
```

`initSession` never silently falls back. `isWebGpuAvailable()` checks for `navigator.gpu` presence but the GPU adapter can still fail at session create — the try/catch is required.

## Common Mistakes

### CRITICAL Default format mismatches stock Ultralytics export

Wrong:

```ts
const detector = await createYoloDetector({
  modelPath: "/models/yolov8n.onnx",
  executionProvider: "webgpu",
});
await detector.detect(imageData); // throws: shape does not match "end-to-end"
```

Correct:

```ts
const detector = await createYoloDetector({
  modelPath: "/models/yolov8n.onnx",
  executionProvider: "webgpu",
  postprocess: { format: "auto" },
});
```

`DEFAULT_FORMAT` is `"end-to-end"` (expects `[N, 6]` rows). Stock Ultralytics ONNX exports emit `[1, attrs, N]` (standard). The mismatch throws on the first `detect()` call.

Source: src/yolo/postprocess.ts:299 (shapeMismatch), src/yolo/postprocess.ts:17 (DEFAULT_FORMAT)

### CRITICAL Drawing detections without applying reverse transform

Wrong:

```ts
const dets = await detector.detect(imageData);
for (const d of dets) ctx.strokeRect(d.x1, d.y1, d.x2 - d.x1, d.y2 - d.y1);
// Boxes are drawn at 0..640 coords onto a 1280x720 canvas — cluster in top-left.
```

Correct:

```ts
const { imageData, params } = capturer.capture(video);
const dets = await detector.detect(imageData);
const inSource = reverseLetterboxBoxes(dets, params);
for (const d of inSource) ctx.strokeRect(d.x1, d.y1, d.x2 - d.x1, d.y2 - d.y1);
```

`Detection` coordinates are in model input space (`0..inputSize`). Always apply `reverseLetterboxBox(es)` (paired with letterbox capturer) or `reverseStretchBox` (paired with stretch capturer).

Source: src/yolo/detector.ts:32-38, src/yolo/types.ts:9-13

### HIGH Assuming WebGPU automatically falls back to WASM

Wrong:

```ts
const detector = await createYoloDetector({
  modelPath,
  executionProvider: "webgpu",
});
// throws on Safari, SSR, Firefox without flag — no auto fallback
```

Correct:

```ts
const preferred = isWebGpuAvailable() ? "webgpu" : "wasm";
try {
  return await createYoloDetector({ modelPath, executionProvider: preferred, ... });
} catch (err) {
  if (preferred !== "webgpu") throw err;
  return createYoloDetector({ modelPath, executionProvider: "wasm", ... });
}
```

`initSession` throws synchronously when `webgpu` is requested but `navigator.gpu` is missing, and rethrows any session-create failure. The fallback is the consumer's responsibility.

Source: src/onnx/session.ts:35-39

### HIGH Calling createYoloDetector at module top level

Wrong:

```ts
// detection.ts — runs at import time, breaks SSR / Node
export const detector = await createYoloDetector({
  modelPath: "/models/yolo26n.onnx",
  executionProvider: "webgpu",
});
```

Correct:

```ts
// detection.ts — defer to a browser-only event handler
export async function getDetector() {
  return createYoloDetector({
    modelPath: await fetchModel(),
    executionProvider: "webgpu",
  });
}
// call from useEffect / event handler, not during SSR render
```

`onnxruntime-web` is loaded via dynamic `import()` on first call to keep the module SSR-safe. Top-level await defeats that and accesses `navigator.gpu` on the server.

Source: src/onnx/session.ts:17-23 (@remarks SSR-safe)

### HIGH Feeding mis-sized ImageData to detect()

Wrong:

```ts
const ctx = videoCanvas.getContext("2d");
const imageData = ctx.getImageData(0, 0, video.videoWidth, video.videoHeight);
await detector.detect(imageData); // silently wrong if dims ≠ inputSize
```

Correct:

```ts
const capturer = createLetterboxCapturer({ inputSize: 640 });
const { imageData } = capturer.capture(video);
await detector.detect(imageData);
```

`rgbaToFloat32Chw` assumes `imageData.width/height === inputSize`. The library validates buffer length but not image dimensions, so a wrong-size frame silently corrupts the input tensor.

Source: src/onnx/preprocess.ts:32-39 (@param contract), src/yolo/detector.ts:30-33

### HIGH Tension: convenience default vs explicit-format-clarity

The library default `format: "end-to-end"` targets production exports with built-in NMS; the example apps use `"auto"` for first-run success. Agents that omit `format` per the API surface get shape-mismatch errors on stock exports.

See also: `configure-yolo-postprocess/SKILL.md` § Common Mistakes — `Blind trust in "format: \"auto\"" on edge-shape models` documents when `"auto"` itself misfires.

## See also

- `handle-frame-coordinates/SKILL.md` — letterbox vs stretch capture and the paired reverse transform
- `configure-yolo-postprocess/SKILL.md` — tuning OutputFormat, thresholds, NMS, and classFilter when the first-pass yields no detections or a shape error
- `set-up-onnx-runtime/SKILL.md` — `initSession` and backend selection details when debugging at the runtime layer
- `integrate-tracking/SKILL.md` — adding `BYTETracker` on top of detections for stable IDs
