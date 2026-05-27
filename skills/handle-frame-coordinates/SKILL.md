---
name: handle-frame-coordinates
description: >
  Choose createLetterboxCapturer (aspect-preserving with padding) vs
  createCanvasFrameCapturer (stretch), and apply the matching reverse transform
  (reverseLetterboxBox / reverseLetterboxBoxes for letterbox, reverseStretchBox
  for stretch). Load when an agent debugs misaligned rendered boxes, source
  resolution changes mid-stream, capture-before-metadata errors, or needs to
  pick a capture strategy. Covers computeLetterboxParams, LetterboxParams
  fields, CaptureSource types (HTMLVideoElement / HTMLImageElement / VideoFrame
  / OffscreenCanvas), and per-call params re-evaluation.
type: core
library: web-crowd-detection-utils
library_version: "0.0.0"
sources:
  - "KasumiMercury/web-crowd-detection-utils:src/source/letterbox.ts"
  - "KasumiMercury/web-crowd-detection-utils:src/source/capture.ts"
  - "KasumiMercury/web-crowd-detection-utils:src/source/types.ts"
---

# Round-trip frame coordinates between source and model space

YOLO detection happens in model input space (`0..inputSize`). The `source` subpath provides two capture strategies and their inverse transforms; mixing the pair silently produces wrong coordinates.

## Setup

```ts
import {
  createLetterboxCapturer,
  reverseLetterboxBox,
  reverseLetterboxBoxes,
  createCanvasFrameCapturer,
  reverseStretchBox,
  computeLetterboxParams,
  type Box,
  type LetterboxParams,
} from "@kasumimercury/web-crowd-detection-utils/source";

const INPUT_SIZE = 640;

// Letterbox: aspect-preserving with rgb(114,114,114) padding (YOLO standard).
const letterbox = createLetterboxCapturer({ inputSize: INPUT_SIZE });

// Stretch: non-aspect-preserving, width × height.
const stretch = createCanvasFrameCapturer({ width: INPUT_SIZE, height: INPUT_SIZE });
```

## Core Patterns

### Letterbox capture with paired reverse

```ts
const capturer = createLetterboxCapturer({ inputSize: 640 });

await new Promise<void>((r) =>
  videoEl.addEventListener("loadedmetadata", () => r(), { once: true }),
);

const { imageData, params } = capturer.capture(videoEl);
const dets = await detector.detect(imageData);
const inSourceSpace = reverseLetterboxBoxes(dets, params); // ALWAYS use params from THIS capture
```

`reverseLetterboxBoxes` is the array form; `reverseLetterboxBox` handles single boxes. Both preserve any extra fields on `Box` subtypes (`score`, `classId`, `trackId`) — only the coordinates are transformed.

### Stretch capture with paired reverse

```ts
const capturer = createCanvasFrameCapturer({ width: 640, height: 640 });

const imageData = capturer.capture(videoEl);
const dets = await detector.detect(imageData);
const inSourceSpace = dets.map((d) =>
  reverseStretchBox(d, videoEl.videoWidth, videoEl.videoHeight, 640),
);
```

Use stretch when aspect distortion is acceptable (square-ish sources or single-image use cases where you control the input). For 16:9 webcam or video, prefer letterbox.

### Compute letterbox params without capturing

```ts
// Pure function — works in workers, Node, SSR. No DOM dependency.
const params: LetterboxParams = computeLetterboxParams(1280, 720, 640);
// { inputSize: 640, sourceWidth: 1280, sourceHeight: 720,
//   scale: 0.5, padX: 0, padY: 140, contentWidth: 640, contentHeight: 360 }
```

Use to map pre-computed boxes (e.g. from a worker that received raw inference output) back to source space without owning a canvas.

## Common Mistakes

### CRITICAL Mismatched capturer / reverse-transform pair

Wrong:

```ts
const capturer = createLetterboxCapturer({ inputSize: 640 });
const { imageData } = capturer.capture(video);
const dets = await detector.detect(imageData);
// Wrong: stretch reverse on a letterbox capture
const inSource = dets.map((d) =>
  reverseStretchBox(d, video.videoWidth, video.videoHeight, 640),
);
```

Correct:

```ts
const capturer = createLetterboxCapturer({ inputSize: 640 });
const { imageData, params } = capturer.capture(video);
const dets = await detector.detect(imageData);
const inSource = reverseLetterboxBoxes(dets, params);
```

The letterbox transform applies uniform scale + padding offsets; the stretch transform applies non-uniform per-axis scale. Mixing them produces silently shifted, mis-scaled boxes.

Source: src/source/letterbox.ts:212-216 (@remarks pairing constraint)

### HIGH Capturing before HTMLVideoElement metadata loads

Wrong:

```ts
video.src = url;
const { imageData, params } = capturer.capture(video); // throws — videoWidth/Height are 0
```

Correct:

```ts
video.src = url;
await video.play(); // implicit metadata wait
// or: await new Promise((r) => video.addEventListener("loadedmetadata", r, { once: true }));
const { imageData, params } = capturer.capture(video);
```

`LetterboxCapturer.capture` re-reads `video.videoWidth/Height` per call. Before `loadedmetadata` they are 0, and the explicit dimension check throws.

Source: src/source/letterbox.ts:172-181

### MEDIUM Caching LetterboxParams across frames

Wrong:

```ts
const { params } = capturer.capture(video);
// ... many frames later, video rotation / adaptive bitrate changed dims
const inSource = reverseLetterboxBoxes(dets, params); // wrong scale
```

Correct:

```ts
// Always use params from the SAME frame's capture.
const { imageData, params } = capturer.capture(video);
const dets = await detector.detect(imageData);
const inSource = reverseLetterboxBoxes(dets, params);
```

`LetterboxCapturer` re-evaluates source dimensions every `capture()` call so it handles mid-stream resolution changes correctly. Agents who "optimize" by caching params break that guarantee.

Source: src/source/letterbox.ts:138-142 (@remarks per-call re-evaluation)

### MEDIUM Using stretch capture for wide / tall sources

Wrong:

```ts
// 1920x1080 webcam forced into 640x640 — heavy horizontal squish, hurts recall
const capturer = createCanvasFrameCapturer({ width: 640, height: 640 });
```

Correct:

```ts
// Letterbox preserves aspect with YOLO-standard gray padding
const capturer = createLetterboxCapturer({ inputSize: 640 });
```

Stretch fits the source non-uniformly to `width × height`. For non-square sources this distorts boxes proportionally to source aspect ratio and noticeably degrades detection recall.

Source: src/source/capture.ts:14-17 (@remarks 'stretched'), src/source/types.ts:12-15

### HIGH Tension: letterbox correctness vs stretch simplicity

Stretch needs no `params` to thread through and works fine on square sources. Letterbox preserves recall on wide/tall sources at the cost of plumbing `LetterboxParams` through to the reverse transform. The choice ripples through `set-up-detection-pipeline` — same capture choice must be matched on both the forward and inverse paths.

See also: `set-up-detection-pipeline/SKILL.md` § Common Mistakes — `Drawing detections without applying reverse transform`.

## See also

- `set-up-detection-pipeline/SKILL.md` — wiring the capturer + detector + reverse together
- `integrate-tracking/SKILL.md` — tracker expects stable per-frame coordinate space (apply reverse BEFORE update)
