---
name: configure-yolo-postprocess
description: >
  Tune OutputFormat (auto / end-to-end / end-to-end-transposed / standard /
  standard-transposed), confThreshold, iouThreshold, maxDetections, and
  classFilter for the loaded YOLO ONNX model. Load when the agent debugs zero
  detections, a shape-mismatch error, an unexpected class set, or a >30
  detection ceiling. Covers postprocess() and nms() low-level entry points,
  sigmoid auto-detection in standard formats, and the dispatchAuto heuristic
  limits documented as failure modes.
type: core
library: web-crowd-detection-utils
library_version: "0.0.0"
sources:
  - "KasumiMercury/web-crowd-detection-utils:src/yolo/postprocess.ts"
  - "KasumiMercury/web-crowd-detection-utils:src/yolo/nms.ts"
  - "KasumiMercury/web-crowd-detection-utils:src/yolo/types.ts"
---

# Configure YOLO postprocess for your model export

`PostprocessOptions` selects the decoder, score floor, NMS behavior, detection cap, and class filter. Defaults are tuned for COCO-class person detection with NMS-included exports; almost any deviation (custom-trained model, stock Ultralytics export, crowd >30 people) requires overriding at least one field.

## Setup

```ts
import {
  createYoloDetector,
  postprocess,
  nms,
  DEFAULT_CONF_THRESHOLD,    // 0.15
  DEFAULT_FORMAT,            // "end-to-end"
  DEFAULT_CLASS_FILTER,      // [0] (COCO person)
  DEFAULT_IOU_THRESHOLD,     // 0.45
  DEFAULT_MAX_DETECTIONS,    // 30
} from "@kasumimercury/web-crowd-detection-utils/yolo";

// Most consumers go through createYoloDetector's postprocess field:
const detector = await createYoloDetector({
  modelPath,
  executionProvider: "webgpu",
  postprocess: {
    format: "auto",
    confThreshold: 0.25,
    iouThreshold: 0.45,
    maxDetections: 100,
    classFilter: "all",
  },
});
```

## Core Patterns

### Use "auto" for first-pass; pin the format once the export pipeline is known

```ts
// Development / first-pass: let the heuristic dispatch
const dev = await createYoloDetector({
  modelPath,
  executionProvider: "webgpu",
  postprocess: { format: "auto" },
});

// Production: pin the format. dispatchAuto logs the chosen format ONCE
// per page lifetime via console.log — read it during dev, then lock it in.
const prod = await createYoloDetector({
  modelPath,
  executionProvider: "webgpu",
  postprocess: { format: "standard" }, // e.g. for stock Ultralytics export
});
```

### Use `classFilter: "all"` for non-person or multi-class detection

```ts
// Default is [0] (COCO person). Override for everything else.
const all = await createYoloDetector({
  modelPath,
  executionProvider: "webgpu",
  postprocess: { format: "auto", classFilter: "all" },
});

const vehicles = await createYoloDetector({
  modelPath,
  executionProvider: "webgpu",
  postprocess: { format: "auto", classFilter: [2, 3, 5, 7] }, // car, motorcycle, bus, truck
});
```

### Raise `maxDetections` for crowded scenes

```ts
// Default cap is 30. Counting in stadium / mall footage requires higher.
const crowded = await createYoloDetector({
  modelPath,
  executionProvider: "webgpu",
  postprocess: {
    format: "auto",
    confThreshold: 0.1,    // accept lower-score detections
    maxDetections: 300,    // lift the ceiling
  },
});
```

### Use `postprocess()` and `nms()` standalone for a foreign decoder

```ts
import type * as ort from "onnxruntime-web";

// You ran inference outside createYoloDetector — feed the raw tensor through.
const tensor: ort.Tensor = await session.run({ images: input }).then((r) => r[outputName]);
const dets = postprocess(tensor, {
  format: "auto",
  confThreshold: 0.2,
  classFilter: "all",
});

// Or run NMS on detections from a non-YOLO decoder:
const filtered = nms(myDetections, { iouThreshold: 0.5, maxDetections: 100 });
```

## Common Mistakes

### HIGH Default classFilter silently drops every non-person detection

Wrong:

```ts
// Custom-trained model where class 0 ≠ person
const detector = await createYoloDetector({
  modelPath: "/models/vehicles.onnx",
  executionProvider: "webgpu",
  postprocess: { format: "auto" },
});
// Result: only classId === 0 boxes returned; everything else dropped.
```

Correct:

```ts
const detector = await createYoloDetector({
  modelPath: "/models/vehicles.onnx",
  executionProvider: "webgpu",
  postprocess: { format: "auto", classFilter: "all" }, // or specific allow-list
});
```

`DEFAULT_CLASS_FILTER = [0]` matches COCO person and is intentional for the package's crowd-detection focus. Any other model requires an explicit override.

Source: src/yolo/postprocess.ts:19-24, src/yolo/types.ts:78-83

### HIGH Blind trust in `format: "auto"` on edge-shape models

Wrong:

```ts
// 2-class standard export has attrs = 4 + 2 = 6 — same shape as end-to-end-transposed
const detector = await createYoloDetector({
  modelPath: "/models/custom-2class.onnx",
  executionProvider: "webgpu",
  postprocess: { format: "auto" }, // picks end-to-end-transposed → garbage
});
```

Correct:

```ts
// Verify dispatchAuto's [yolo] console log matches the actual export during dev,
// then pin the format.
const detector = await createYoloDetector({
  modelPath: "/models/custom-2class.onnx",
  executionProvider: "webgpu",
  postprocess: { format: "standard" },
});
```

`dispatchAuto` decides by tensor dim positions (`dim2 === 6` → end-to-end, `dim1 === 6` → end-to-end-transposed, `dim1 < dim2` → standard, `dim1 > dim2` → standard-transposed). It misfires on 2-class standard exports, models where N ≈ attrs, and non-Ultralytics architectures (YOLOv9 / YOLO-NAS / RT-DETR). The console.warn for unrecognized shapes is easy to miss in production logs.

Source: src/yolo/postprocess.ts:202-242 (dispatchAuto), src/yolo/postprocess.ts:184-188 (log-once)

### MEDIUM Manually applying nms() after end-to-end postprocess

Wrong:

```ts
const raw = postprocess(output, { format: "end-to-end" });
const filtered = nms(raw, { iouThreshold: 0.4 }); // double NMS
```

Correct:

```ts
// end-to-end / end-to-end-transposed formats include NMS from the exported plugin.
const dets = postprocess(output, { format: "end-to-end" });
```

`nms()` is class-agnostic — boxes from different `classId`s suppress each other. Running it again over already-NMS'd output can drop valid cross-class detections.

Source: src/yolo/types.ts:33-39 (OutputFormat semantics), src/yolo/nms.ts:40-42

### MEDIUM Setting confThreshold low but expecting all candidates back

Wrong:

```ts
// Counting crowds of >30 people
const detector = await createYoloDetector({
  modelPath,
  executionProvider: "webgpu",
  postprocess: { format: "auto", confThreshold: 0.05 },
  // maxDetections defaults to 30 — silently capped after 30 keeps
});
```

Correct:

```ts
const detector = await createYoloDetector({
  modelPath,
  executionProvider: "webgpu",
  postprocess: { format: "auto", confThreshold: 0.05, maxDetections: 300 },
});
```

In end-to-end formats the iteration `break`s once `maxDetections` candidates pass; lowering `confThreshold` past the model's score floor still hits the cap. In standard formats `nms()` also caps at `maxDetections`.

Source: src/yolo/postprocess.ts:53-81 (postprocessEndToEnd break), src/yolo/nms.ts:7 (DEFAULT_MAX_DETECTIONS)

### MEDIUM Pre-sigmoiding the tensor before postprocess

Wrong:

```ts
const sigmoided = applySigmoid(output);
const dets = postprocess(sigmoided, { format: "standard" });
```

Correct:

```ts
// Pass the raw tensor as-is. postprocessStandard samples values and applies
// sigmoid only if any sample falls outside [0, 1].
const dets = postprocess(output, { format: "auto" });
```

`postprocessStandard` samples up to 10 class scores from the tensor; if any fall outside `[0, 1]`, sigmoid is applied to every score. Pre-activating in user code defeats the heuristic and can mistakenly skip sigmoid on logits that happen to sample in-range.

Source: src/yolo/postprocess.ts:113-122 (needsSigmoid sampling)

### HIGH Tension: convenience default vs explicit-format-clarity

`DEFAULT_FORMAT = "end-to-end"` favors production NMS-included exports; first-pass developers reach for `"auto"`. Pinning the format for production avoids both the default mismatch AND the `auto` heuristic limits above.

See also: `set-up-detection-pipeline/SKILL.md` § Common Mistakes — `Default format mismatches stock Ultralytics export`.

## References

- [OutputFormat dispatch table](references/output-formats.md) — tensor shape × decoder × NMS behavior, including `auto` heuristic edge cases

## See also

- `set-up-detection-pipeline/SKILL.md` — entry-point wiring; postprocess tuning is the natural next step after the first pipeline runs
- `set-up-onnx-runtime/SKILL.md` — when postprocess tuning doesn't help, drop to the runtime layer to verify the tensor shape directly
