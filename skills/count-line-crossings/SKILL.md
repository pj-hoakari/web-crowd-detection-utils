---
name: count-line-crossings
description: >
  Count how many tracked objects cross each virtual line, per direction, with
  LineCrossingCounter. Load when an agent counts people entering / exiting across
  a line, adds in/out counting after BYTETracker, calls update / getLineCount /
  getAllCounts / reset / resetCounts / clearPositions, defines lines by two anchor
  endpoints plus an optional forward direction
  { id, p1, p2, forwardDirection }, draws that direction with forwardNormal,
  flips a line's direction with reverseDirection, or
  tunes crossing-assist (rescueDistance / rescueFrames / cooldownFrames). Covers
  caller-anchored TrackedPoint { trackId, point } input
  (the counter never reads boxes), the side-of-line + segment-intersection crossing
  test, statefulness (one instance per stream), the shared-coordinate-space
  requirement (no scaling), forward/backward direction configured independently of
  endpoint order (single Vector or ordered Vector[] fallback,
  DEFAULT_FORWARD_DIRECTION), and rescue / cooldown ID-churn assist.
metadata:
  type: core
  library: web-crowd-detection-utils
  library_version: "0.0.0"
sources:
  - "pj-hoakari/web-crowd-detection-utils:src/line-crossing/counter.ts"
  - "pj-hoakari/web-crowd-detection-utils:src/line-crossing/direction.ts"
  - "pj-hoakari/web-crowd-detection-utils:src/line-crossing/types.ts"
  - "pj-hoakari/web-crowd-detection-utils:src/line-crossing/constants.ts"
  - "pj-hoakari/web-crowd-detection-utils:src/line-crossing/index.ts"
  - "pj-hoakari/web-crowd-detection-utils:CLAUDE.md"
---

# Count tracked objects crossing virtual lines

`LineCrossingCounter` tallies how many tracked objects cross each line, per direction, across a stream of frames. It is **detector- and tracker-agnostic** and does **no drawing**: the caller reduces each tracked detection to an anchor point (e.g. the bounding-box foot) and passes `{ trackId, point }`, plus the lines — each a segment defined by its two anchor endpoints and, when a semantic direction is needed, the direction that counts as `forward`: `{ id, p1, p2, forwardDirection }`. It is **stateful** (one instance per stream; it compares each track's point against the point it held last frame) and does **no scaling**, so the points and the line endpoints must live in one coordinate space. Optional crossing-assist compensates for tracker ID churn.

## Setup

```ts
import { LineCrossingCounter } from "@pj-hoakari/web-crowd-detection-utils/line-crossing";
import type { Line } from "@pj-hoakari/web-crowd-detection-utils/line-crossing";

const counter = new LineCrossingCounter(); // one instance, lives across all frames
// Lines in the SAME coordinate space as the points fed below (here: source space).
const lines: Line[] = [{
  id: "door",
  p1: { x: 320, y: 0 },
  p2: { x: 320, y: 480 },
  forwardDirection: { x: 1, y: 0 }, // crossings toward the right count as forward
}];

while (!signal.aborted) {
  const { imageData, params } = capturer.capture(video);
  const dets = await detector.detect(imageData);
  const inSource = reverseLetterboxBoxes(dets, params);
  const tracked = tracker.update(inSource);            // stable trackIds, source space

  // Reduce each tracked box to its anchor point (foot = bottom-center).
  const points = tracked.map((t) => ({
    trackId: t.trackId,
    point: { x: (t.x1 + t.x2) / 2, y: t.y2 },
  }));
  counter.update(points, lines, { assist: { enabled: true } });

  const { forward, backward } = counter.getLineCount("door");
}
```

## Core Patterns

### In/out counting on an entry line

```ts
// forward = crossings onto the side forwardDirection points at, whatever order
// p1 / p2 were given in. Here that is entering from the left of the door.
const { forward, backward } = counter.getLineCount("door");
const occupancy = forward - backward; // net inside
```

### One forward policy for every line on screen

```ts
// The first direction that is NOT parallel to the line wins. Two directions that
// are not parallel to each other therefore cover every possible line, so lines the
// user draws at any angle all resolve deterministically.
const FORWARD = [
  { x: -1, y: -1 }, // top-left is forward
  { x: 0, y: -1 },  // ...except on an exactly top-left/bottom-right line: up
];

const lines: Line[] = drawn.map((l) => ({ ...l, forwardDirection: FORWARD }));
```

Omitting `forwardDirection` applies `DEFAULT_FORWARD_DIRECTION` — rightward, or
downward for a horizontal line.

### Flip one line's direction

```ts
import { reverseDirection } from "@pj-hoakari/web-crowd-detection-utils/line-crossing";

// forwardDirection is per line, so reversing one leaves the others alone.
// reverseDirection() with no argument reverses DEFAULT_FORWARD_DIRECTION, which
// covers lines that never set a direction of their own.
const lines: Line[] = drawn.map((l) => ({
  ...l,
  forwardDirection: flipped.has(l.id)
    ? reverseDirection(l.forwardDirection)
    : l.forwardDirection,
}));
```

The new direction applies from the next frame on; counts accumulated before the
flip stay as they were — see the two direction failure modes below.

### Draw the forward side

```ts
import { forwardNormal } from "@pj-hoakari/web-crowd-detection-utils/line-crossing";

// Unit normal pointing at the side counted as forward. Use it instead of
// re-deriving the direction, so the overlay cannot disagree with the tally.
const n = forwardNormal(line);
const midX = (line.p1.x + line.p2.x) / 2;
const midY = (line.p1.y + line.p2.y) / 2;
ctx.moveTo(midX, midY);
ctx.lineTo(midX + n.x * 32, midY + n.y * 32);
```

### Read every line at once

```ts
for (const [lineId, { forward, backward }] of counter.getAllCounts()) {
  console.log(lineId, "in:", forward, "out:", backward);
}
```

### Enable crossing-assist for tracker ID churn

```ts
// rescue: a new trackId near a just-lost track inherits its history, so the crossing
// is still counted across an ID switch. cooldown: suppress repeat counts on the same
// line for a few frames, killing jitter double-counts. Omitted fields use the defaults.
counter.update(points, lines, {
  assist: { enabled: true, rescueDistance: 60, rescueFrames: 15, cooldownFrames: 10 },
});
```

### Reset around source switches and pauses

```ts
counter.reset();          // clears counts + positions + assist state (new clip)
counter.resetCounts();    // zero the tallies but keep tracked positions
counter.clearPositions(); // drop positions (and assist) but KEEP counts — use when tracking pauses
counter.removeLine("door"); // forget one line's tally
```

## Common Mistakes

### CRITICAL Hand-rolling line-crossing detection

Wrong:

```ts
// App code re-implements side-of-line + prev-point tracking by hand —
// typically with no segment-intersection guard and no ID-churn assist.
const prev = new Map<number, { x: number; y: number }>();
for (const t of tracked) {
  // manual cross product, manual counting, manual prevPoint bookkeeping...
}
```

Correct:

```ts
import { LineCrossingCounter } from "@pj-hoakari/web-crowd-detection-utils/line-crossing";

const counter = new LineCrossingCounter();
const points = tracked.map((t) => ({
  trackId: t.trackId,
  point: { x: (t.x1 + t.x2) / 2, y: t.y2 },
}));
counter.update(points, lines, { assist: { enabled: true } });
```

The package consolidates the crossing test (cross-product side **and** segment intersection) plus the ID-churn assist inside `LineCrossingCounter`. Hand-rolling usually drops the segment-intersection guard (counting points that cross the *infinite* line outside the segment) and the assist.

Source: CLAUDE.md (lib-as-knowledge-sink design), src/line-crossing/counter.ts

### CRITICAL Points and lines in mismatched coordinate spaces

Wrong:

```ts
const lines = [{ id: "door", p1: { x: 320, y: 0 }, p2: { x: 320, y: 640 } }]; // 640 detection space
const inSource = reverseLetterboxBoxes(dets, params);                          // 1280×720 source space
const points = tracked.map((t) => ({
  trackId: t.trackId, point: { x: (t.x1 + t.x2) / 2, y: t.y2 },
})); // tracked is source-space → mismatched with 640-space lines
counter.update(points, lines);
```

Correct:

```ts
// Keep lines and points in ONE space. Define the lines in the space your tracked
// boxes use, then anchor the points from those same boxes.
const points = tracked.map((t) => ({
  trackId: t.trackId, point: { x: (t.x1 + t.x2) / 2, y: t.y2 },
}));
counter.update(points, linesInTrackedSpace, { assist: { enabled: true } });
```

The counter does **no scaling** — points and every `Line` endpoint must share one space. Mixing detection (640) space lines with source-space points (or vice versa) tests crossings against the wrong geometry and silently miscounts, with no error.

Source: src/line-crossing/types.ts:1-40 (Line / Point shared space), src/line-crossing/counter.ts (no scaling)

### CRITICAL Re-instantiating LineCrossingCounter per frame

Wrong:

```ts
for (const frame of frames) {
  const counter = new LineCrossingCounter(); // fresh state every frame
  counter.update(points, lines, { assist: { enabled: true } });
  // counts never advance — there is no previous point to compare against
}
```

Correct:

```ts
const counter = new LineCrossingCounter(); // once, outside the loop
for (const frame of frames) {
  counter.update(points, lines, { assist: { enabled: true } });
}
```

The counter is stateful — it compares each track's point this frame against the point it held last frame. A per-frame instance has no previous point, so no crossing is ever detected and every line stays at zero.

Source: src/line-crossing/counter.ts (prevPoint state across frames)

### HIGH Expecting the counter to compute the anchor point itself

Wrong:

```ts
// Passing raw tracked boxes — the counter does not read x1..y2
counter.update(tracked as unknown as TrackedPoint[], lines);
```

Correct:

```ts
// Caller reduces each detection to ITS chosen anchor point (foot here)
const points = tracked.map((t) => ({
  trackId: t.trackId,
  point: { x: (t.x1 + t.x2) / 2, y: t.y2 },
}));
counter.update(points, lines);
```

`update` consumes `TrackedPoint { trackId, point }`, never a bounding box; the anchor choice (foot, centroid, head) is the caller's. Passing boxes is a type error, and casting around it leaves the counter reading undefined coordinates.

Source: src/line-crossing/types.ts (TrackedPoint), src/line-crossing/counter.ts (update signature)

### MEDIUM Skipping crossing-assist under ID churn

Wrong:

```ts
// Assist off — an ID switch at the line is missed; line jitter double-counts one person
counter.update(points, lines);
```

Correct:

```ts
counter.update(points, lines, {
  // rescueDistance / rescueFrames / cooldownFrames default to proven values
  assist: { enabled: true },
});
```

With assist off, a tracker ID switch at the line (track lost on one side, a new id appears on the other) is never counted, and back-and-forth jitter at the line inflates the tally. Rescue inherits a just-lost track's history near the same point; cooldown suppresses repeat counts on a line for a few frames.

Source: src/line-crossing/counter.ts (rescue / cooldown), src/line-crossing/constants.ts

### MEDIUM Leaving a semantic direction implicit

Wrong:

```ts
// Without forwardDirection the default applies — rightward, or downward for a
// horizontal line. That is stable, but it is geometry, not "entering".
const entering = counter.getLineCount("door").forward;
```

Correct:

```ts
const lines = [{
  id: "door",
  p1: { x: 320, y: 0 },
  p2: { x: 320, y: 480 },
  forwardDirection: { x: 1, y: 0 }, // any non-zero vector toward the intended direction
}];
counter.update(points, lines);
const { forward, backward } = counter.getLineCount("door");
const entering = forward;
```

`forwardDirection` names the direction that counts as `forward` — `{ x: -1, y: -1 }` for "toward the top-left", say. Only its component perpendicular to the line matters, so swapping `p1` and `p2` never flips the tally, and no reference point has to sit on the line. Omitting it is not an error; it just means the tally follows `DEFAULT_FORWARD_DIRECTION` (rightward, downward for a horizontal line) rather than anything the scene implies.

Source: src/line-crossing/direction.ts (forwardDirection → side), src/line-crossing/types.ts:40-68 (Line.forwardDirection), src/line-crossing/constants.ts:12-15 (DEFAULT_FORWARD_DIRECTION)

### MEDIUM A forwardDirection parallel to its line resolves nothing

Wrong:

```ts
// One direction along the lines' own orientation — resolves no side for them
const lines: Line[] = drawn.map((l) => ({
  ...l,
  forwardDirection: { x: -1, y: -1 },
}));
```

Correct:

```ts
// Ordered fallback: the first entry NOT parallel to the line wins, so two
// directions that are not parallel to each other cover every possible line.
const FORWARD = [
  { x: -1, y: -1 }, // top-left is forward
  { x: 0, y: -1 },  // ...except on an exactly top-left/bottom-right line: up
];
const lines: Line[] = drawn.map((l) => ({ ...l, forwardDirection: FORWARD }));
```

A direction parallel to the line points at no side, so `DEFAULT_FORWARD_DIRECTION` silently decides instead — and `reverseDirection` becomes a no-op there, because neither the original nor the reversed list resolves a side. The same sensitivity makes a single near-parallel preference unstable: with `{ x: -1, y: -1 }`, lines at 44° and 46° end up with opposite forward sides.

Source: src/line-crossing/direction.ts:29-69 (resolveSide / forwardSideOf fallback), :119-155 (reverseDirection @remarks)

### MEDIUM Expecting a changed forwardDirection to re-tally past crossings

Wrong:

```ts
// Flip the line, then read the totals as if they were all under the new policy
line.forwardDirection = reverseDirection(line.forwardDirection);
const { forward, backward } = counter.getLineCount(line.id); // still mixed
```

Correct:

```ts
// Decide explicitly: keep the history (and label it as pre-flip), or zero the
// tally for the flipped line only. Prev-point state is untouched either way.
line.forwardDirection = reverseDirection(line.forwardDirection);
counter.removeLine(line.id); // or counter.resetCounts() to zero every line
```

`forwardDirection` is read on each `update` call, so a flip applies from the next frame on and the crossings already tallied keep the old convention — one tally then mixes both, with nothing to signal it.

Source: src/line-crossing/counter.ts:112-137 (update @param lines), :245-252 (resetCounts / removeLine clear counts only)

### HIGH Tension: crossing accuracy vs tracker ID stability

Accurate per-line counts depend on a single stable `trackId` persisting across the line. Tracker tuning that is fine for live counts — short `trackBuffer`, strict `newTrackThresh` — increases ID switches exactly at the line, so optimizing the tracker for one goal (e.g. fewer ghost tracks) silently degrades crossing accuracy. Crossing-assist mitigates this but cannot fully recover a lost ID.

See also: `integrate-tracking/SKILL.md` § Common Mistakes — tune `trackBuffer` / thresholds with crossing accuracy in mind, and feed source-space detections so IDs stay stable.

## See also

- `integrate-tracking/SKILL.md` — produces the stable `trackId`s this counter depends on; run the counter right after `tracker.update`
- `handle-frame-coordinates/SKILL.md` — the counter does no scaling, so its points and line endpoints must share one coordinate space
- `suppress-static-detections/SKILL.md` — sibling post-detection/post-tracking consumer in the same loop (suppress before tracking, count after)
