# @pj-hoakari/web-crowd-detection-utils — Skill Spec

`@pj-hoakari/web-crowd-detection-utils` is a browser-targeted TypeScript package that provides reusable building blocks for in-browser YOLO + ByteTrack crowd / person detection. It exposes six subpaths — `onnx` (model-agnostic onnxruntime-web wrapper), `yolo` (YOLO postprocess and high-level detector), `source` (frame capture and coordinate round-trip), `bytetrack` (detector-agnostic multi-object tracker), `background` (detector-agnostic EMA background model for static-detection suppression), and `line-crossing` (detector- and tracker-agnostic line-crossing counter) — designed to be composed à la carte or used through `createYoloDetector` as a one-stop pipeline. The library is also a knowledge-consolidation point: PoC patterns are folded back into the package so consumers never need to drop down to `onnxruntime-web` (or hand-roll background subtraction or line-crossing logic) directly.

## Domains

| Domain                 | Description                                                                                                                                          | Skills                                                          |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| detection-pipeline     | Composing preprocess + inference + postprocess to turn a frame into `Detection[]`. Spans the `yolo` subpath and its dependency on `onnx` primitives. | set-up-detection-pipeline, configure-yolo-postprocess           |
| frame-acquisition      | Getting browser frames into model-expected shape (letterbox vs stretch) and round-tripping detection coordinates back to source space.               | handle-frame-coordinates                                        |
| multi-object-tracking  | Turning per-frame `Detection[]` into stable, ID-bearing tracks via `BYTETracker`, including occlusion / re-identification semantics.                 | integrate-tracking                                              |
| runtime-setup          | Initializing onnxruntime-web sessions in a browser-safe way (WebGPU/WASM, SSR, preprocess buffer ownership) for both YOLO and non-YOLO models.       | set-up-onnx-runtime                                             |
| static-suppression     | Reducing false positives on static scenery by attenuating the confidence of detections that don't move, via the detector-agnostic EMA background model. | suppress-static-detections                                      |
| line-crossing-counting | Counting tracked objects that cross virtual lines (per-direction tallies) via the detector- and tracker-agnostic LineCrossingCounter, after tracking.       | count-line-crossings                                            |

## Skill Inventory

| Skill                          | Type | Domain                | What it covers                                                                                                | Failure modes |
| ------------------------------ | ---- | --------------------- | ------------------------------------------------------------------------------------------------------------- | ------------- |
| set-up-detection-pipeline      | core | detection-pipeline    | `createYoloDetector` + capturer + reverse transform — happy-path wiring, backend choice                       | 5             |
| configure-yolo-postprocess     | core | detection-pipeline    | `OutputFormat`, `postprocess`, `nms`, defaults, sigmoid auto-detection, `auto` heuristic limits               | 5             |
| handle-frame-coordinates       | core | frame-acquisition     | `createLetterboxCapturer` ↔ `reverseLetterboxBox` pair, stretch pair, `computeLetterboxParams`                | 4             |
| integrate-tracking             | core | multi-object-tracking | `BYTETracker`, stateful lifecycle, `Observation` / `Detection` compat, threshold roles, per-class pattern     | 7             |
| set-up-onnx-runtime            | core | runtime-setup         | `initSession`, `isWebGpuAvailable`, `createPreprocessor`, SSR safety, owned `onnxruntime-web`, Worker boundary | 6             |
| suppress-static-detections     | core | static-suppression    | `BackgroundSubtractor`, model-space `suppressStatic` (score attenuation, not removal), warm-up/`reset()`, tuning | 6             |
| count-line-crossings           | core | line-crossing-counting | `LineCrossingCounter`, caller-anchored `{trackId,point}` + `Line{p1,p2}`, side+segment crossing test, crossing-assist (rescue/cooldown) | 6             |

## Failure Mode Inventory

### set-up-detection-pipeline (5 failure modes)

| #   | Mistake                                                       | Priority | Source                                                          | Cross-skill?                              |
| --- | ------------------------------------------------------------- | -------- | --------------------------------------------------------------- | ----------------------------------------- |
| 1   | Default format mismatches Ultralytics standard export         | CRITICAL | src/yolo/postprocess.ts:299                                     | configure-yolo-postprocess                |
| 2   | Drawing detections without applying reverse transform         | CRITICAL | src/yolo/detector.ts:32-38                                      | handle-frame-coordinates                  |
| 3   | Assuming WebGPU automatically falls back to WASM              | HIGH     | src/onnx/session.ts:35-39                                       | set-up-onnx-runtime                       |
| 4   | Calling initSession or createYoloDetector at module top level | HIGH     | src/onnx/session.ts:17-23                                       | set-up-onnx-runtime                       |
| 5   | Feeding mis-sized ImageData to detect()                       | HIGH     | src/onnx/preprocess.ts:32-39                                    | handle-frame-coordinates                  |

### configure-yolo-postprocess (5 failure modes)

| #   | Mistake                                                       | Priority | Source                                                                       | Cross-skill? |
| --- | ------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------- | ------------ |
| 1   | Default classFilter silently drops every non-person detection | HIGH     | src/yolo/postprocess.ts:19-24                                                | —            |
| 2   | Manually applying nms() after end-to-end postprocess          | MEDIUM   | src/yolo/types.ts:33-39                                                      | —            |
| 3   | Setting confThreshold but expecting all candidates back       | MEDIUM   | src/yolo/postprocess.ts:53-81                                                | —            |
| 4   | Overriding sigmoid handling by feeding pre-activated logits   | MEDIUM   | src/yolo/postprocess.ts:113-122                                              | —            |
| 5   | Blind trust in `format: "auto"` on edge-shape models          | HIGH     | src/yolo/postprocess.ts:202-242 (dispatchAuto), maintainer interview         | —            |

### handle-frame-coordinates (4 failure modes)

| #   | Mistake                                            | Priority | Source                              | Cross-skill? |
| --- | -------------------------------------------------- | -------- | ----------------------------------- | ------------ |
| 1   | Mismatched capturer / reverse-transform pair       | CRITICAL | src/source/letterbox.ts:212-216     | —            |
| 2   | Capturing before HTMLVideoElement metadata loads   | HIGH     | src/source/letterbox.ts:172-181     | —            |
| 3   | Caching LetterboxParams across frames              | MEDIUM   | src/source/letterbox.ts:138-142     | —            |
| 4   | Using stretch capture when aspect matters          | MEDIUM   | src/source/capture.ts:14-17         | —            |

### integrate-tracking (7 failure modes)

| #   | Mistake                                                    | Priority | Source                                                                                     | Cross-skill?              |
| --- | ---------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------ | ------------------------- |
| 1   | Calling tracker.update with model-space detections         | CRITICAL | example/yolo-bytetrack-video/src/detection.ts:50-54                                        | handle-frame-coordinates  |
| 2   | Re-instantiating BYTETracker per frame                     | CRITICAL | src/bytetrack/tracker.ts:55-86                                                             | —                         |
| 3   | Forgetting update mutates and pass-through fields preserve | MEDIUM   | src/bytetrack/tracker.ts:125-135                                                           | —                         |
| 4   | Treating totalCount as pause-resume safe                   | MEDIUM   | src/bytetrack/tracker.ts:108-116                                                           | —                         |
| 5   | Confusing highThresh and newTrackThresh roles              | MEDIUM   | src/bytetrack/types.ts:80-106                                                              | —                         |
| 6   | Redundant Detection → Observation remapping                | HIGH     | src/yolo/types.ts:9-15 (compat note), src/bytetrack/tracker.ts:125-135 (pass-through)      | —                         |
| 7   | Single tracker instance for multi-class detectors          | HIGH     | src/bytetrack/association.ts:30-39 (no classId), maintainer interview                      | —                         |

### set-up-onnx-runtime (6 failure modes)

| #   | Mistake                                                       | Priority | Source                                                       | Cross-skill? |
| --- | ------------------------------------------------------------- | -------- | ------------------------------------------------------------ | ------------ |
| 1   | Bypassing the library to call onnxruntime-web directly        | CRITICAL | src/onnx/session.ts (entry point), CLAUDE.md (design intent) | —            |
| 2   | Adding onnxruntime-web to consumer package.json               | HIGH     | CLAUDE.md, package.json#dependencies                         | —            |
| 3   | Importing onnxruntime-web at module top level                 | HIGH     | src/onnx/session.ts:17-23                                    | —            |
| 4   | Trusting isWebGpuAvailable() as a 'safe to run' check         | HIGH     | src/onnx/backend.ts:8-12                                     | —            |
| 5   | Forgetting Preprocessor buffer overwrite semantics            | HIGH     | src/onnx/preprocess.ts:96-110                                | —            |
| 6   | Forcing executionProviders via sessionOptions with `as any`   | HIGH     | src/onnx/types.ts:38-45                                      | —            |

### suppress-static-detections (6 failure modes)

| #   | Mistake                                                      | Priority | Source                                                                | Cross-skill?                                       |
| --- | ------------------------------------------------------------ | -------- | --------------------------------------------------------------------- | -------------------------------------------------- |
| 1   | Hand-rolling background subtraction instead of the utility   | CRITICAL | maintainer interview, CLAUDE.md, src/background/subtractor.ts:10-47    | —                                                  |
| 2   | Applying suppressStatic after the reverse transform          | CRITICAL | src/background/types.ts:1-21, subtractor.ts:122-127, interview         | handle-frame-coordinates, integrate-tracking       |
| 3   | Expecting suppressStatic to drop boxes                       | HIGH     | src/background/subtractor.ts:200-241, maintainer interview            | —                                                  |
| 4   | Suppressing on the warm-up frame / ignoring update() return  | HIGH     | src/background/subtractor.ts:104-167, :169-199                        | —                                                  |
| 5   | Default alpha absorbs stationary people into the background  | MEDIUM   | src/background/constants.ts:13-30, maintainer interview              | —                                                  |
| 6   | Not calling reset() after switching sources                  | MEDIUM   | src/background/subtractor.ts:243-253                                  | —                                                  |

### count-line-crossings (6 failure modes)

| #   | Mistake                                                      | Priority | Source                                                                | Cross-skill?                                       |
| --- | ------------------------------------------------------------ | -------- | --------------------------------------------------------------------- | -------------------------------------------------- |
| 1   | Hand-rolling line-crossing instead of the utility            | CRITICAL | maintainer interview, CLAUDE.md, src/line-crossing/counter.ts          | —                                                  |
| 2   | Points and lines in mismatched coordinate spaces             | CRITICAL | src/line-crossing/types.ts, counter.ts (no scaling), interview         | handle-frame-coordinates, integrate-tracking       |
| 3   | Re-instantiating LineCrossingCounter per frame               | CRITICAL | src/line-crossing/counter.ts (prevPoint state), interview              | —                                                  |
| 4   | Expecting the counter to compute the anchor point itself     | HIGH     | src/line-crossing/types.ts (TrackedPoint), counter.ts                  | —                                                  |
| 5   | Skipping crossing-assist under ID churn / cooldown misuse    | MEDIUM   | src/line-crossing/counter.ts, constants.ts, maintainer interview      | —                                                  |
| 6   | Assuming forward always means left-to-right                  | MEDIUM   | src/line-crossing/counter.ts (sideOf sign), types.ts (LineCount)       | —                                                  |

## Tensions

| Tension                                            | Skills                                                  | Agent implication                                                                                                                |
| -------------------------------------------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Convenience default vs explicit-format-clarity     | set-up-detection-pipeline ↔ configure-yolo-postprocess  | Agent omits `format`; on a stock Ultralytics export this throws shape-mismatch and the lib looks broken.                         |
| Stateful tracker vs functional-style pipelines     | integrate-tracking ↔ set-up-detection-pipeline          | Agent wraps detect+track as a pure function and re-instantiates BYTETracker per call; unique-ID counting silently fails.         |
| Library-owned onnxruntime-web vs consumer pinning  | set-up-onnx-runtime                                     | Agent reflexively adds `onnxruntime-web` to consumer deps; double-bundle breaks at WASM load with opaque errors.                 |
| Letterbox correctness vs stretch simplicity        | handle-frame-coordinates ↔ set-up-detection-pipeline    | Agent picks stretch for code brevity; recall drops on 16:9 sources, no error fires, behavior just looks worse than the example.  |
| Static suppression vs stationary-crowd recall      | suppress-static-detections ↔ integrate-tracking         | Agent enables suppressStatic to kill poster/mannequin false positives; people who stand still merge into the EMA background and are silently dropped. |
| Crossing accuracy vs tracker ID stability          | count-line-crossings ↔ integrate-tracking               | Agent tunes the tracker for one goal (fewer ghost tracks) and silently degrades crossing counts via ID switches at the line; assist mitigates but cannot fully recover a lost ID. |

## Cross-References

| From                         | To                            | Reason                                                                                                            |
| ---------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| set-up-detection-pipeline    | handle-frame-coordinates      | Every pipeline needs a capturer + reverse transform; letterbox vs stretch is part of pipeline setup.              |
| set-up-detection-pipeline    | configure-yolo-postprocess    | First-pass uses defaults; the next YOLO version loaded triggers postprocess tuning.                               |
| set-up-detection-pipeline    | set-up-onnx-runtime           | `createYoloDetector` wraps `initSession` + preprocessing; backend/SSR debugging requires the runtime mental model.|
| integrate-tracking           | handle-frame-coordinates      | Tracker assumes stable coord space; reverse transforms must run before `update()`.                                |
| integrate-tracking           | set-up-detection-pipeline     | Tracking layers on top of detection; master the detection path before adding state.                               |
| configure-yolo-postprocess   | set-up-detection-pipeline     | Agents reach for postprocess tuning when the pipeline yields zero detections or shape errors.                     |
| set-up-onnx-runtime          | set-up-detection-pipeline     | Non-YOLO ONNX usage shares preprocess + session primitives with the YOLO pipeline; patterns transfer both ways.   |
| suppress-static-detections   | handle-frame-coordinates      | suppressStatic must run in model-pixel space BEFORE the reverse transform; correct placement needs the space round-trip model. |
| suppress-static-detections   | set-up-detection-pipeline     | Background subtraction slots into the detect loop right after `detect()`, reusing the same letterboxed frame.      |
| suppress-static-detections   | integrate-tracking            | Suppression runs just before tracking; the attenuated, re-thresholded output is what `tracker.update` receives.    |
| integrate-tracking           | suppress-static-detections    | Persistent ghost tracks on static scenery are often best fixed upstream by attenuating static detections.          |
| count-line-crossings         | integrate-tracking            | Crossing counts require stable trackIds; the counter runs right after `tracker.update` and is only as good as them. |
| count-line-crossings         | handle-frame-coordinates      | The counter does no scaling — its points and line endpoints must share one coordinate space.                       |
| count-line-crossings         | suppress-static-detections    | Both are post-detection/post-tracking consumers in the same loop (suppress before tracking, count after).          |
| integrate-tracking           | count-line-crossings          | Line-crossing counting is a common downstream of tracking; trackId stability determines crossing accuracy.         |

## Subsystems & Reference Candidates

| Skill                      | Subsystems                                                                                                          | Reference candidates                                                                                                                                       |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| set-up-detection-pipeline  | —                                                                                                                   | —                                                                                                                                                          |
| configure-yolo-postprocess | OutputFormat variants (end-to-end, end-to-end-transposed, standard, standard-transposed, auto)                      | OutputFormat dispatch table: per-format expected tensor dims, sigmoid heuristic, `dispatchAuto` rules + known-edge-shape caveats                            |
| handle-frame-coordinates   | Letterbox capturer + reverse pair, Canvas/stretch capturer + reverse pair                                           | LetterboxParams field reference and transform algebra                                                                                                      |
| integrate-tracking         | —                                                                                                                   | BYTETrackerOptions threshold cheat-sheet (highThresh, matchThresh, secondMatchThresh, unconfirmedMatchThresh, newTrackThresh, duplicateIouThresh, trackBuffer) |
| set-up-onnx-runtime        | —                                                                                                                   | InitSessionOptions field reference (graphOptimizationLevel, sessionOptions Omit); subpath Worker compatibility table                                       |
| suppress-static-detections | —                                                                                                                   | — (5-option config surface; no dense API or independent subsystems — no references/ file needed)                                                          |
| count-line-crossings       | —                                                                                                                   | — (single counter + 3-field assist config; no dense API or independent subsystems — no references/ file needed)                                            |

## Recommended Skill File Structure

- **Core skills:** `set-up-detection-pipeline`, `configure-yolo-postprocess`, `handle-frame-coordinates`, `integrate-tracking`, `set-up-onnx-runtime`, `suppress-static-detections`, `count-line-crossings`
- **Framework skills:** none — package is framework-agnostic; React appears only in example apps
- **Lifecycle skills:** none in this pass — go-to-production / migration guides don't yet exist for this library
- **Composition skills:** none — examples use React + Vite but the integration is generic enough that pulling it into a dedicated skill would be premature
- **Reference files:** `configure-yolo-postprocess` (OutputFormat reference), `integrate-tracking` (BYTETrackerOptions reference), `set-up-onnx-runtime` (InitSessionOptions reference + subpath worker-safety table)

## Composition Opportunities

| Library          | Integration points                                                                                                 | Composition skill needed?                                                                                 |
| ---------------- | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| onnxruntime-web  | Owned dependency; consumers must not redeclare. `initSession` returns the raw `InferenceSession` for advanced use. | No — handled inside `set-up-onnx-runtime`. The CRITICAL "bypass" failure mode covers the boundary.        |
| React + Vite     | Both example apps use them; pattern is `useRef` for video/canvas + `useEffect` lifecycle around AbortController.   | No (this pass) — pattern is generic browser-app glue, not specific to this library's surface.             |
| Ultralytics CLI  | Model export step (`yolo export ... format=onnx`) is a prerequisite for using `createYoloDetector`.                | Maybe — `prepare-yolo-onnx-model` skill (export + place in /public) would unblock first-time consumers.   |
