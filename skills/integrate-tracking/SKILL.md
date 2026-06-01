---
name: integrate-tracking
description: >
  Wrap per-frame Detection[] with stateful BYTETracker to get persistent
  trackIds, then count unique people with totalCount or a Set<trackId>.
  Load when an agent counts unique persons, adds re-identification, tunes
  trackBuffer for occlusions, handles multi-class detectors (one BYTETracker
  per classId), resets the tracker, or debugs unstable IDs. Covers Detection
  ↔ Observation structural compatibility (no remap), 3-stage cascade,
  TrackState lifecycle, BYTETrackerOptions thresholds, and the pass-through
  generic that preserves classId on TrackedBox.
type: core
library: web-crowd-detection-utils
library_version: "0.0.0"
sources:
  - "pj-hoakari/web-crowd-detection-utils:src/bytetrack/tracker.ts"
  - "pj-hoakari/web-crowd-detection-utils:src/bytetrack/types.ts"
  - "pj-hoakari/web-crowd-detection-utils:src/bytetrack/association.ts"
  - "pj-hoakari/web-crowd-detection-utils:src/bytetrack/constants.ts"
  - "pj-hoakari/web-crowd-detection-utils:example/yolo-bytetrack-video/src/detection.ts"
---

# Integrate ByteTrack for stable IDs and crowd counting

`BYTETracker` is detector-agnostic and **stateful** — one instance per stream, never per frame. It consumes anything matching the `Observation` shape (`{ x1, y1, x2, y2, score }`), preserves extra fields (like `classId`) through to the output, and produces `TrackedBox & Omit<T, keyof Observation>` rows with stable `trackId`.

## Setup

```ts
import {
  BYTETracker,
  type Observation,
  type TrackedBox,
  type BYTETrackerOptions,
} from "@pj-hoakari/web-crowd-detection-utils/bytetrack";

const tracker = new BYTETracker(); // one instance, lives across all frames
const uniqueIds = new Set<number>();

while (!signal.aborted) {
  const { imageData, params } = capturer.capture(video);
  const dets = await detector.detect(imageData);
  const inSource = reverseLetterboxBoxes(dets, params);  // source-space, NOT model-space
  const tracked = tracker.update(inSource);              // classId rides along

  for (const t of tracked) uniqueIds.add(t.trackId);
  // tracker.totalCount === uniqueIds.size (until tracker.reset())
}
```

## Core Patterns

### Pass detections directly (no remap)

```ts
import type { Detection } from "@pj-hoakari/web-crowd-detection-utils/yolo";

const dets: Detection[] = await detector.detect(imageData);
// Detection is structurally compatible with Observation. classId is preserved
// through the tracker's generic pass-through.
const tracked = tracker.update(dets);
for (const t of tracked) {
  console.log(t.trackId, t.classId, t.x1, t.y1, t.x2, t.y2, t.score);
}
```

### Multi-class tracking: one BYTETracker per classId

```ts
const trackers = new Map<number, BYTETracker>();

function trackMultiClass(dets: Detection[]): (TrackedBox & { classId: number })[] {
  const byClass = new Map<number, Detection[]>();
  for (const d of dets) {
    const arr = byClass.get(d.classId) ?? [];
    arr.push(d);
    byClass.set(d.classId, arr);
  }
  return [...byClass].flatMap(([cls, classDets]) => {
    if (!trackers.has(cls)) trackers.set(cls, new BYTETracker());
    const t = trackers.get(cls);
    if (!t) return [];
    return t.update(classDets);
  });
}
```

`BYTETracker`'s IoU-based association is class-agnostic — it never consults `classId`. For multi-class tracking, partition detections by class and run one tracker per class.

### Tune trackBuffer for the expected occlusion length

```ts
// At 30 FPS, default trackBuffer = 30 ≈ 1s of tolerated occlusion.
// For surveillance with longer occlusions (people passing behind pillars):
const tracker = new BYTETracker({ trackBuffer: 90 }); // ~3 s

// For short clips where you want quick ID retirement:
const fast = new BYTETracker({ trackBuffer: 10 });
```

Larger `trackBuffer` tolerates longer occlusions but raises the risk of wrong re-identification across visually similar objects.

### Read `totalCount` for cumulative unique counting

```ts
// totalCount is monotonically increasing across frames (= nextId - 1).
// Cheaper than maintaining a Set<trackId>.
const tracker = new BYTETracker();
for (const frame of frames) tracker.update(await detector.detect(frame));
console.log("Unique people seen:", tracker.totalCount);
// tracker.reset() zeros it.
```

## Common Mistakes

### CRITICAL Calling tracker.update with model-space detections

Wrong:

```ts
const dets = await detector.detect(imageData);
const tracked = tracker.update(dets); // model space (0..640)
ctx.strokeRect(tracked[0].x1, tracked[0].y1, ...); // boxes at top-left of source-sized canvas
```

Correct:

```ts
const { imageData, params } = capturer.capture(video);
const dets = await detector.detect(imageData);
const inSource = reverseLetterboxBoxes(dets, params);
const tracked = tracker.update(inSource);
```

`BYTETracker` assumes a stable per-frame coordinate space. Tracking in model space works only if the source resolution never changes; any change (rotation, adaptive bitrate) silently breaks ID stability.

Source: example/yolo-bytetrack-video/src/detection.ts:50-54

### CRITICAL Re-instantiating BYTETracker per frame

Wrong:

```ts
for (const frame of frames) {
  const tracker = new BYTETracker(); // fresh state every frame
  const tracked = tracker.update(dets);
  uniqueIds.add(tracked[0].trackId); // always 1, 1, 1...
}
```

Correct:

```ts
const tracker = new BYTETracker(); // once
for (const frame of frames) {
  const tracked = tracker.update(await detector.detect(frame));
  for (const t of tracked) uniqueIds.add(t.trackId);
}
```

`BYTETracker` is stateful — track history lives in the instance. Per-frame allocation resets the ID generator and the lost-track buffer every frame.

Source: src/bytetrack/tracker.ts:55-86 (instance fields)

### HIGH Redundant Detection → Observation remapping

Wrong:

```ts
const detections = await detector.detect(imageData);
// Unnecessary — also drops classId from pass-through, breaking multi-class flows
const observations = detections.map((d) => ({
  x1: d.x1, y1: d.y1, x2: d.x2, y2: d.y2, score: d.score,
}));
const tracked = tracker.update(observations);
```

Correct:

```ts
// Detection is structurally compatible with Observation.
// The tracker's <T extends Observation> generic preserves extra fields onto each TrackedBox.
const tracked = tracker.update(await detector.detect(imageData));
for (const t of tracked) console.log(t.trackId, t.classId); // classId survives
```

`Detection` (from `yolo`) and `Observation` (from `bytetrack`) share `x1`/`y1`/`x2`/`y2`/`score`. The defensive remap discards `classId` and any other pass-through metadata.

Source: src/yolo/types.ts:9-15 (@remarks structural compat), src/bytetrack/tracker.ts:125-135 (pass-through generic)

### HIGH Single tracker instance for multi-class detectors

Wrong:

```ts
// Person + bag detections fed to one tracker — IDs can swap on cross-class overlap
const tracker = new BYTETracker();
const tracked = tracker.update(await detector.detect(imageData));
```

Correct:

```ts
// One BYTETracker per classId — see Core Patterns § Multi-class tracking
const trackers = new Map<number, BYTETracker>();
// ... partition by classId, run each through its own tracker
```

`iouDistance` builds the assignment cost matrix from IoU alone; `classId` is metadata only. Without per-class partitioning, a person and a bag whose boxes overlap can swap IDs across frames.

Source: src/bytetrack/association.ts:30-39 (iouDistance — no classId reference)

### MEDIUM Treating totalCount as pause-resume safe

Wrong:

```ts
tracker.reset();   // clears IDs AND zeros totalCount
console.log(tracker.totalCount); // 0 — surprising if "pause" was meant
```

Correct:

```ts
// To pause without losing counts, simply stop calling update() — the track
// buffer ages out naturally. To start fresh, accept that totalCount resets.
const persisted = tracker.totalCount;
tracker.reset();
// keep `persisted + tracker.totalCount` in app state if needed across resets
```

`reset()` is "start over". `totalCount` is `nextId - 1`, so it resets too.

Source: src/bytetrack/tracker.ts:108-116 (reset semantics)

### MEDIUM Confusing highThresh and newTrackThresh roles

Wrong:

```ts
// Trying to reduce ghost tracks by flattening two knobs into one
new BYTETracker({ highThresh: 0.5, newTrackThresh: 0.5 });
// Low-conf first appearances (0.2–0.4) never spawn, so even subsequent high-conf
// detections can't associate — the track is never created.
```

Correct:

```ts
// Keep newTrackThresh strict; leave highThresh for Stage 1 vs Stage 2 routing
new BYTETracker({ highThresh: 0.2, newTrackThresh: 0.5 });
```

`highThresh` decides which stage of the 3-stage cascade an observation enters. `newTrackThresh` decides whether an unmatched observation spawns a brand-new track. Different roles, different defaults (0.2 / 0.15).

Source: src/bytetrack/types.ts:80-106, src/bytetrack/tracker.ts:151-156

### MEDIUM Treating `update()` as a pure function

Wrong:

```ts
// "Functional pipeline" — re-running update() to get the same result
const a = tracker.update(dets);
const b = tracker.update(dets); // second call advances frameId, mutates state
```

Correct:

```ts
// update() advances frameId, mutates trackedStracks/lostStracks/removedStracks,
// and increments nextId. Call exactly once per frame.
const tracked = tracker.update(dets);
```

Source: src/bytetrack/tracker.ts:118-156 (update mutates internal lists)

### HIGH Tension: stateful tracker vs functional-style pipelines

The detector is functional (per-call), the tracker is stateful (per-instance). Agents naturally write `pipeline = detect.then(track)` as a pure function and instantiate `BYTETracker` inside, breaking ID continuity. The fix is to lift the tracker out to the outer scope where the detector also lives.

See also: `set-up-detection-pipeline/SKILL.md` for the canonical outer-loop shape that holds both the detector and the tracker.

## References

- [BYTETrackerOptions cheat-sheet](references/tracker-options.md) — all 7 threshold/buffer fields with defaults, roles, and tuning guidance

## See also

- `handle-frame-coordinates/SKILL.md` — apply reverse transforms BEFORE `tracker.update`
- `set-up-detection-pipeline/SKILL.md` — the foundational loop tracking layers on top of
- `configure-yolo-postprocess/SKILL.md` — `confThreshold` interacts with `highThresh` (detection floor sets the lower bound of what the tracker sees)
