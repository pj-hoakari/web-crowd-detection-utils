# OutputFormat dispatch reference

`PostprocessOptions.format` selects which decoder runs against the model's output tensor. This reference catalogues every variant, the expected tensor shape, whether NMS is run internally, and the heuristics the `"auto"` dispatcher uses to pick between them.

## Variant catalog

| `format` value             | Expected tensor shape | NMS internal? | Sigmoid auto-detect? | When the export emits this layout                                                                       |
| -------------------------- | --------------------- | ------------- | -------------------- | ------------------------------------------------------------------------------------------------------- |
| `"end-to-end"`             | `[1, N, 6]` or `[N, 6]` | No (already applied by model plugin) | No (scores already 0..1) | YOLO exports with built-in NMS (e.g. via `nms=True` or attached ORT postprocess plugin)                  |
| `"end-to-end-transposed"`  | `[1, 6, N]`           | No (already applied) | No                  | Same plugin output with axes swapped (some ONNX simplifiers transpose the trailing axis)                 |
| `"standard"`               | `[1, attrs, N]` where `attrs = 4 + numClasses` | Yes (greedy NMS)    | Yes (samples 10 values) | Stock Ultralytics export: `yolo export model=*.pt format=onnx imgsz=640 simplify=True`                  |
| `"standard-transposed"`    | `[1, N, attrs]`       | Yes (greedy NMS)    | Yes                  | Some exporters emit the standard layout with axes transposed                                             |
| `"auto"`                   | inspects `output.dims` at runtime | depends on resolved layout | depends on resolved layout | Use during development; pin a specific format for production once `dispatchAuto` logs the chosen value |

Each row's `data` is a `Float32Array` regardless of layout. Coordinates are in **model input space** (`0..inputSize` per axis) — apply `reverseLetterboxBox` or `reverseStretchBox` from the `source` subpath to map back to source-image space.

## `"end-to-end"` decoder

Layout `[1, N, 6]` rows: `[x1, y1, x2, y2, score, classId]`.

- Skips rows where `score <= 0` (zero-filled padding).
- Skips rows where `score < confThreshold` (default 0.15).
- Skips rows where `classId` not in `classFilter` (default `[0]`).
- Rounds `classId` to nearest integer.
- **Breaks** the iteration once `results.length >= maxDetections` (default 30) — does NOT run NMS again.

## `"end-to-end-transposed"` decoder

Layout `[1, 6, N]`. The decoder first transposes to `[1, N, 6]` then runs the end-to-end path above. The transpose is an `N × 6` allocation per frame; for hot loops this is the main per-frame allocation outside the preprocess buffer.

## `"standard"` decoder

Layout `[1, attrs, N]` with `attrs = 4 + numClasses`. Channel-major:

- `data[0 * N + i]` … `data[3 * N + i]` — cx, cy, w, h for box i
- `data[4 * N + i]` … `data[(4 + C - 1) * N + i]` — class scores for box i

Decoder steps:

1. **Sigmoid sampling** — read up to 10 class-score samples from `data[4 * N + i]`. If any falls outside `[0, 1]`, set `needsSigmoid = true`.
2. For each box `i`: walk classes, pick argmax. If `needsSigmoid`, run `1 / (1 + exp(-x))` on each score.
3. Reject if argmax score < `confThreshold` or argmax class not in `classFilter`.
4. Convert `(cx, cy, w, h)` → `(x1, y1, x2, y2)`.
5. Run greedy NMS at `iouThreshold` (default 0.45), capped at `maxDetections` (default 30).

**Sigmoid sampling is the only place where pre-activated input causes a problem.** If you sigmoid the tensor yourself before passing it in, all sampled values land in `[0, 1]` and the heuristic correctly skips a second sigmoid — but only if your manual sigmoid was correct. Don't pre-activate; let the heuristic decide.

## `"standard-transposed"` decoder

Layout `[1, N, attrs]`. Same as `"standard"` after transposing `data` from `[N, attrs]` to `[attrs, N]` (an `N * attrs` allocation per frame). Same NMS and class-filter behavior.

## `"auto"` dispatch heuristic

`dispatchAuto` inspects `output.dims` and routes:

| Dims                                                | Picked format                  |
| --------------------------------------------------- | ------------------------------ |
| `[1, N, 6]` (`dims[2] === 6`)                       | `"end-to-end"`                 |
| `[1, 6, N]` (`dims[1] === 6`)                       | `"end-to-end-transposed"`      |
| `[1, dim1, dim2]` with `dim1 < dim2`                | `"standard"` (attrs < N)       |
| `[1, dim1, dim2]` with `dim1 > dim2`                | `"standard-transposed"` (N > attrs) |
| `[N, 6]` (2D variant)                               | `"end-to-end"`                 |
| anything else                                       | `console.warn`, return `[]`    |

`dispatchAuto` calls `console.log` exactly **once per page lifetime** to announce its choice (see `autoFormatLogged` module flag). The log is informational, not a warning — read it during development and pin the format for production.

### Known edge cases where `"auto"` misfires

- **2-class standard export** with `attrs = 4 + 2 = 6` produces `[1, 6, N]` — indistinguishable from `"end-to-end-transposed"`. `auto` picks the wrong branch and decodes garbage. **Fix:** pin `format: "standard"`.
- **Small N** (e.g. test models with `N ≈ attrs`) make the `dim1 < dim2` vs `dim1 > dim2` comparison meaningless. **Fix:** pin the format.
- **Non-Ultralytics architectures** (YOLOv9 / YOLO-NAS / RT-DETR) often emit shapes that don't match any branch. `dispatchAuto` warns and returns `[]`. **Fix:** either pin a known format or check the warn log.

## Tuning summary

- **Stock Ultralytics export, ≤30 detections, person only** — defaults work after setting `format: "auto"`.
- **Custom-trained or multi-class** — set `classFilter: "all"` or an explicit allow-list.
- **Crowded scenes (>30)** — raise `maxDetections` and lower `confThreshold`.
- **End-to-end exports** — do not run `nms()` again; the model already did.
- **Standard exports** — `iouThreshold` controls the internal NMS; default 0.45.

## Source

- `src/yolo/postprocess.ts:1-356` — full decoder implementations
- `src/yolo/nms.ts` — greedy NMS used by standard variants
- `src/yolo/types.ts:33-94` — `OutputFormat` / `PostprocessOptions` / `NmsOptions` definitions
