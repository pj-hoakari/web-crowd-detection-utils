# BYTETrackerOptions cheat-sheet

`BYTETrackerOptions` has 7 fields. All are optional; defaults are tuned for YOLO + COCO person detection at ~30 FPS. This reference covers each field's role in the 3-stage cascade, its default, and tuning guidance.

## At a glance

| Field                     | Default | Type                | Role                                                       |
| ------------------------- | ------- | ------------------- | ---------------------------------------------------------- |
| `highThresh`              | `0.2`   | score threshold     | Splits Stage 1 (high-conf) vs Stage 2 (low-conf) routing  |
| `matchThresh`             | `0.8`   | IoU-distance ceiling | Stage 1 association ceiling (high-conf × tracked+lost)     |
| `secondMatchThresh`       | `0.5`   | IoU-distance ceiling | Stage 2 association ceiling (low-conf × remaining tracked) |
| `unconfirmedMatchThresh`  | `0.7`   | IoU-distance ceiling | Stage 3 association ceiling (remaining high-conf × unconfirmed) |
| `newTrackThresh`          | `0.15`  | score threshold     | Minimum score for an unmatched observation to spawn a new track |
| `duplicateIouThresh`      | `0.15`  | IoU-distance        | Threshold below which two tracks are treated as duplicates (shorter-lived dropped) |
| `trackBuffer`             | `30`    | frame count         | Frames a lost track is retained before removal (~1 s at 30 FPS) |

**Reading the thresholds:**

- **Score thresholds** (`highThresh`, `newTrackThresh`) — raw `[0, 1]` scores. Higher = stricter.
- **IoU-distance thresholds** (`matchThresh`, `secondMatchThresh`, `unconfirmedMatchThresh`, `duplicateIouThresh`) — `1 - IoU`. **Lower = stricter** (require tighter overlap to consider a match).

This is the most common confusion source: tightening `matchThresh` means *lowering* it (e.g. from 0.8 to 0.6), not raising it.

## The 3-stage cascade

Each `update()` call runs:

1. **Predict** — every existing track advances its Kalman state by one frame.
2. **Stage 1** — split detections by `highThresh`. The high-conf set is matched against the pool of `tracked ∪ lost` tracks via IoU. Threshold: `matchThresh`. Matched lost tracks re-activate (re-identification across occlusions).
3. **Stage 2** — low-conf detections are matched against tracked tracks that Stage 1 didn't claim. Threshold: `secondMatchThresh`. This is ByteTrack's distinguishing idea — recovering occluded objects whose score dropped this frame.
4. **Stage 3** — high-conf detections left over from Stage 1 are matched against *unconfirmed* tracks (candidates from the previous frame). Threshold: `unconfirmedMatchThresh`.
5. **Spawn** — unmatched high-conf detections clearing `newTrackThresh` become new tracks. Unmatched low-conf detections clearing `newTrackThresh` also can — but usually `newTrackThresh > highThresh` so this never fires.
6. **Age out** — lost tracks older than `trackBuffer` frames are removed.
7. **Dedup** — tracks pairwise within `duplicateIouThresh` collapse; the shorter-lived one is dropped.

## Per-field tuning

### `highThresh` — Stage 1 vs Stage 2 routing

- **Default 0.2** — high-conf set roughly matches detections likely to be true positives.
- **Lower (e.g. 0.1)** — more detections go to Stage 1; helps re-identification of weakly-detected objects but risks false-positive associations.
- **Higher (e.g. 0.4)** — restricts Stage 1 to very confident detections; Stage 2 takes more work.

Does **not** spawn new tracks — that's `newTrackThresh`.

### `matchThresh` (Stage 1 ceiling)

- **Default 0.8** (i.e. IoU ≥ 0.2 to match) — loose by design so re-identification across occlusion gaps still works.
- **Lower (stricter, e.g. 0.5)** — fewer wrong associations across occlusion; risks dropping legitimate re-IDs.
- **Higher (looser, e.g. 0.9)** — accepts marginal overlaps; useful for fast-moving objects with sparse detections.

### `secondMatchThresh` (Stage 2 ceiling)

- **Default 0.5** (i.e. IoU ≥ 0.5) — stricter than Stage 1; low-conf detections must overlap tightly to recover.
- **Lower (stricter)** — fewer ghost associations from noise.
- **Higher (looser)** — better recall across blur / partial occlusion at the cost of ID stability.

### `unconfirmedMatchThresh` (Stage 3 ceiling)

- **Default 0.7** (i.e. IoU ≥ 0.3) — looser than Stage 2 because unconfirmed tracks have less prior; the system gives them a chance.
- **Lower (stricter)** — fewer confirmed tracks from noise.
- **Higher (looser)** — easier candidate promotion.

### `newTrackThresh` — track-spawn floor

- **Default 0.15** — accept moderate-confidence detections as new tracks; with default `confThreshold` 0.15 in YOLO postprocess, almost every detection survives this gate.
- **Higher (e.g. 0.5)** — strict; only confident first appearances spawn. Cuts ghost tracks but loses real low-confidence first frames.
- **Critical:** do NOT flatten with `highThresh`. They have different roles. Raising both together drops objects whose first appearance is below `newTrackThresh`, even if subsequent frames would have associated cleanly.

### `duplicateIouThresh` — duplicate suppression

- **Default 0.15** (i.e. IoU ≥ 0.85 considered duplicate) — only very-overlapping tracks collapse.
- **Higher (looser, e.g. 0.3)** — more aggressive collapse; useful when ghosts pile up.
- **Lower (stricter, e.g. 0.05)** — preserves near-duplicates; risk of double-counting.

The track with the longer lifetime (`endFrame - startFrame`) wins.

### `trackBuffer` — occlusion tolerance

- **Default 30** ≈ 1 second at 30 FPS.
- **Higher (e.g. 90)** — tolerates ~3 s of occlusion; useful for surveillance with pillars / doorways. Raises memory linearly and increases the chance of re-identifying the wrong person.
- **Lower (e.g. 10)** — fast retirement; ID transitions sharper but more frequent.

## Stateful API surface

```ts
class BYTETracker {
  constructor(opts?: BYTETrackerOptions);

  // Mutates internal state. Returns active tracks for this frame.
  // T preserves through (e.g. classId from Detection rides onto each TrackedBox).
  update<T extends Observation>(observations: T[]): (TrackedBox & Omit<T, keyof Observation>)[];

  // Clears all state, resets frameId to 0 and the ID generator to 1.
  reset(): void;

  // nextId - 1. Monotonically increasing until reset().
  readonly totalCount: number;
}
```

## TrackState

```ts
const TrackState = { New: 0, Tracked: 1, Lost: 2, Removed: 3 } as const;
```

Public API only surfaces `TrackState` through internal `STrack.state` (not exposed on `TrackedBox`). The exported value is useful for narrowing if you read through `BYTETracker` internals; consumer code rarely needs it.

Transitions:

- `New → Tracked` on first successful association
- `Tracked → Lost` when no matching observation this frame
- `Lost → Tracked` on re-association within `trackBuffer`
- `Lost → Removed` after `trackBuffer` frames without re-association
- `New → Removed` when an unconfirmed candidate fails Stage 3

## Source

- `src/bytetrack/tracker.ts:55-308` — `BYTETracker` class
- `src/bytetrack/types.ts:80-119` — `BYTETrackerOptions` per-field TSDoc
- `src/bytetrack/constants.ts` — all `DEFAULT_*` values
- `src/bytetrack/association.ts` — `iouDistance`, `removeDuplicateStracks`
