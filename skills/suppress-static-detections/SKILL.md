---
name: suppress-static-detections
description: >
  Add the detector-agnostic BackgroundSubtractor (EMA background model + 3×3
  morphological open) to a working detection loop to attenuate the confidence of
  static detections and cut false positives on posters / mannequins / parked
  scenery. Load when an agent adds background subtraction, calls suppressStatic /
  foregroundRatio / update / reset, tunes alpha / diffThreshold /
  minForegroundRatio, or is tempted to hand-roll frame differencing. Covers the
  update() warm-up + ready boolean, suppressStatic (score attenuation, NOT
  removal — exclude downstream), the background-model pixel-space requirement
  (apply BEFORE the reverse transform; subtractor width×height must match the box
  space), Box / ScoredBox compatibility with Detection / Observation / TrackedBox,
  and reset() on source switch.
type: core
library: web-crowd-detection-utils
library_version: "0.0.0"
sources:
  - "pj-hoakari/web-crowd-detection-utils:src/background/subtractor.ts"
  - "pj-hoakari/web-crowd-detection-utils:src/background/types.ts"
  - "pj-hoakari/web-crowd-detection-utils:src/background/constants.ts"
  - "pj-hoakari/web-crowd-detection-utils:src/background/index.ts"
  - "pj-hoakari/web-crowd-detection-utils:CLAUDE.md"
---

# Suppress static false positives with the background model

`BackgroundSubtractor` learns a per-pixel EMA background and attenuates the confidence of detections sitting in static regions — false positives on posters, mannequins, and parked scenery. It is **detector-agnostic** (consumes its own `ScoredBox = { x1, y1, x2, y2, score }`, never a YOLO type) and **stateful** (one instance per stream; every `update` mutates the model in place, frames in temporal order). It operates in **background-model pixel space** — the `width × height` it was constructed with, which must equal both the frames passed to `update` and the boxes passed to `suppressStatic`. `suppressStatic` only lowers `score`; it never removes boxes, so the actual exclusion (cutout / threshold) happens downstream.

## Setup

```ts
import { BackgroundSubtractor } from "@pj-hoakari/web-crowd-detection-utils/background";

const INPUT_SIZE = 640;
const bg = new BackgroundSubtractor({ width: INPUT_SIZE, height: INPUT_SIZE });
const CONF_CUTOFF = 0.3;

while (!signal.aborted) {
  const { imageData, params } = capturer.capture(video); // INPUT_SIZE × INPUT_SIZE
  let dets = await detector.detect(imageData);            // model-input space (0..640)

  const ready = bg.update(imageData);                     // SAME frame fed to the detector
  if (ready) {
    dets = bg.suppressStatic(dets, 0.3);                  // model space — spaces match
    dets = dets.filter((d) => d.score >= CONF_CUTOFF);    // suppressStatic only lowers score
  }

  const inSource = reverseLetterboxBoxes(dets, params);   // reverse AFTER suppression
  const tracked = tracker.update(inSource);
  await new Promise<void>((r) => requestAnimationFrame(() => r()));
}
```

`update` returns `false` on the first frame (and the first after `reset()`) while it seeds the background; gate `suppressStatic` on that boolean.

## Core Patterns

### Suppress any scored box (detector-agnostic, fields preserved)

```ts
import type { Detection } from "@pj-hoakari/web-crowd-detection-utils/yolo";

const dets: Detection[] = await detector.detect(imageData);
// suppressStatic<T extends ScoredBox> preserves T — classId stays typed on the result.
const adjusted: Detection[] = bg.suppressStatic(dets, 0.3);
for (const d of adjusted) console.log(d.classId, d.score);
```

The same call accepts a `bytetrack` `Observation` / `TrackedBox` or any custom `{ x1, y1, x2, y2, score }`; extra fields (`classId`, `trackId`) ride through onto the returned objects.

### Tune for stationary subjects

```ts
// Default alpha 0.01 ≈ 3–4 s (at 30 FPS) before a still object merges into the
// background. For crowds where people stand still, adapt SLOWER so real people
// stay foreground longer:
const bg = new BackgroundSubtractor({
  width: 640,
  height: 640,
  alpha: 0.005,             // slower background adaptation
  diffThreshold: 20,        // luma units 0..255; raise to ignore more sensor noise
  minForegroundRatio: 0.05, // foreground fraction of a box required to count as "active"
});

// The tuning fields are mutable at runtime:
bg.alpha = 0.002;
```

### Reset after switching sources

```ts
function switchSource(video: HTMLVideoElement, nextUrl: string): void {
  video.src = nextUrl;
  bg.reset(); // discard the old scene; the next update() re-seeds (returns false once)
}
```

### Gate on foregroundRatio directly

```ts
// foregroundRatio(box) returns the foreground fraction in [0,1] for any box in
// model space. Use it for a custom decision instead of suppressStatic's scaling.
const ratio = bg.foregroundRatio(box);
if (ratio < bg.minForegroundRatio) {
  // box sits in a static region — drop it, dim it, or skip an expensive crop
}
```

## Common Mistakes

### CRITICAL Hand-rolling background subtraction instead of using BackgroundSubtractor

Wrong:

```ts
// App code re-implements EMA background subtraction by hand
const bg = new Float32Array(w * h);
for (const frame of frames) {
  // manual grayscale + EMA + threshold — no morphological denoise, no warm-up
  // handling; diverges from the library and silently rots
}
```

Correct:

```ts
import { BackgroundSubtractor } from "@pj-hoakari/web-crowd-detection-utils/background";

const bg = new BackgroundSubtractor({ width: 640, height: 640 });
const ready = bg.update(imageData);
if (ready) detections = bg.suppressStatic(detections, 0.3);
```

The package consolidates the background-subtraction PoC (BT.601 luma, EMA model, 3×3 morphological open, warm-up handling) inside `BackgroundSubtractor` so it improves centrally. Re-implementing frame differencing in app code re-fragments that knowledge and usually drops the denoise / warm-up steps.

Source: CLAUDE.md (lib-as-knowledge-sink design), src/background/subtractor.ts:10-47

### CRITICAL Applying suppressStatic after the reverse transform

Wrong:

```ts
const { imageData, params } = capturer.capture(video); // 640×640
let dets = await detector.detect(imageData);            // model space
const sourceSpace = reverseLetterboxBoxes(dets, params); // 1280×720 space
bg.update(imageData);
const suppressed = bg.suppressStatic(sourceSpace, 0.3); // source-space boxes vs 640×640 model
```

Correct:

```ts
const { imageData, params } = capturer.capture(video); // 640×640
let dets = await detector.detect(imageData);            // model space
const ready = bg.update(imageData);                     // SAME 640×640 frame
if (ready) dets = bg.suppressStatic(dets, 0.3);         // spaces match
const sourceSpace = reverseLetterboxBoxes(dets, params);
const tracked = tracker.update(sourceSpace);
```

`suppressStatic` / `foregroundRatio` measure boxes in the subtractor's `width × height` (= the frame fed to `update`). Reverse-transforming to source space first clamps every box to the `0..inputSize` bounds and reads wrong foreground ratios — silently, with no throw.

Source: src/background/types.ts:1-21 (Box is in background-model pixel space), src/background/subtractor.ts:122-127

### HIGH Expecting suppressStatic to drop boxes

Wrong:

```ts
const kept = bg.suppressStatic(dets, 0); // assume static boxes are gone
for (const d of kept) ctx.strokeRect(d.x1, d.y1, d.x2 - d.x1, d.y2 - d.y1);
// static boxes still drawn — score is 0 but the box was never removed
```

Correct:

```ts
const adjusted = bg.suppressStatic(dets, 0.3);
// suppressStatic only lowers score — perform the actual exclusion downstream
const kept = adjusted.filter((d) => d.score >= confCutoff);
```

`suppressStatic` returns a copy in which static boxes have `score *= suppressFactor`; the boxes are still present. Treating it as a filter leaves attenuated static detections in the pipeline, where they reappear in rendering or tracking.

Source: src/background/subtractor.ts:200-241 (returns copy with scaled score, no removal)

### HIGH Suppressing on the warm-up frame / ignoring update()'s return

Wrong:

```ts
bg.update(imageData);                 // return value ignored
dets = bg.suppressStatic(dets, 0.3);  // frame 1: every detection attenuated
```

Correct:

```ts
const ready = bg.update(imageData);
if (ready) dets = bg.suppressStatic(dets, 0.3); // skip until the mask is valid
```

`update` returns `false` on the first frame (and the first after `reset()`) while the background is seeded; until a valid mask exists `foregroundRatio` returns `0` for every box, so every box falls below `minForegroundRatio` and `suppressStatic` attenuates ALL detections.

Source: src/background/subtractor.ts:104-167 (update returns false on first frame), :169-199 (foregroundRatio 0 before mask)

### MEDIUM Default alpha absorbs stationary people into the background

Wrong:

```ts
// Faster adaptation 'to react quicker' — stationary people vanish sooner
const bg = new BackgroundSubtractor({ width: 640, height: 640, alpha: 0.1 });
```

Correct:

```ts
// Crowds with stationary subjects: adapt the background SLOWLY so real people
// stay foreground longer. Lower alpha (or raise diffThreshold) and verify on
// footage with standing subjects before shipping.
const bg = new BackgroundSubtractor({ width: 640, height: 640, alpha: 0.005 });
```

The background is an EMA with `alpha` (default `0.01` ≈ 3–4 s to merge at 30 FPS). Anything that stays still long enough — including real people standing in a crowd — merges into the background and is attenuated as "static".

Source: src/background/constants.ts:13-30 (alpha / diffThreshold / minForegroundRatio rationale)

### MEDIUM Not calling reset() after switching sources

Wrong:

```ts
video.src = nextClipUrl;             // new scene, same subtractor
const ready = bg.update(imageData);  // stale background, wrong mask for many frames
```

Correct:

```ts
video.src = nextClipUrl;
bg.reset(); // discard the old scene; next update() re-seeds (returns false once)
```

The learned background describes the scene it was trained on. After a source switch without `reset()`, the stale model treats the new scene's genuinely-static regions as foreground and mis-suppresses until `alpha` slowly relearns.

Source: src/background/subtractor.ts:243-253 (reset @remarks: use after switching sources)

### HIGH Tension: static suppression vs stationary-crowd recall

Background subtraction removes false positives on static scenery, but with the same `alpha` a genuinely stationary person merges into the background and is attenuated as "static". Agents enabling `suppressStatic` to clean up posters / mannequins silently drop people who stand still long enough to merge into the EMA background — the opposite of the crowd-counting goal. Verify recall on footage with stationary subjects, and lower `alpha` when people are expected to hold still.

See also: `integrate-tracking/SKILL.md` § Common Mistakes — the attenuated, re-thresholded output is what `tracker.update` should receive.

## See also

- `handle-frame-coordinates/SKILL.md` — `suppressStatic` runs in model space BEFORE the reverse transform; this is the source↔model space round-trip it depends on
- `set-up-detection-pipeline/SKILL.md` — the detect loop background subtraction slots into, right after `detect()` and reusing the same letterboxed frame
- `integrate-tracking/SKILL.md` — feed the attenuated, re-thresholded output to `tracker.update`; persistent ghost tracks on static scenery are best fixed upstream here
