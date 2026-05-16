import type * as ort from "onnxruntime-web";
import { DEFAULT_MAX_DETECTIONS, nms } from "./nms";
import type {
	ClassFilter,
	Detection,
	OutputFormat,
	PostprocessOptions,
} from "./types";

/** Default minimum confidence score for a detection to be kept. */
export const DEFAULT_CONF_THRESHOLD = 0.15;

/**
 * Default output tensor format. `"end-to-end"` matches YOLO exports with a
 * built-in NMS plugin.
 */
export const DEFAULT_FORMAT: OutputFormat = "end-to-end";

/**
 * Default class filter: keep only COCO class `0` (person), matching this
 * package's crowd-detection focus. Pass `"all"` in {@link PostprocessOptions}
 * to disable filtering.
 */
export const DEFAULT_CLASS_FILTER: ClassFilter = [0];

interface ResolvedOptions {
	format: OutputFormat;
	confThreshold: number;
	iouThreshold: number | undefined;
	maxDetections: number;
	classFilter: ClassFilter;
}

function resolve(options: PostprocessOptions): ResolvedOptions {
	return {
		format: options.format ?? DEFAULT_FORMAT,
		confThreshold: options.confThreshold ?? DEFAULT_CONF_THRESHOLD,
		iouThreshold: options.iouThreshold,
		maxDetections: options.maxDetections ?? DEFAULT_MAX_DETECTIONS,
		classFilter: options.classFilter ?? DEFAULT_CLASS_FILTER,
	};
}

function passesClassFilter(classId: number, filter: ClassFilter): boolean {
	if (filter === "all") return true;
	return filter.includes(classId);
}

function sigmoid(x: number): number {
	return 1 / (1 + Math.exp(-x));
}

function postprocessEndToEnd(
	data: Float32Array,
	numBoxes: number,
	opts: ResolvedOptions,
): Detection[] {
	const results: Detection[] = [];

	for (let i = 0; i < numBoxes; i++) {
		const offset = i * 6;
		const x1 = data[offset] as number;
		const y1 = data[offset + 1] as number;
		const x2 = data[offset + 2] as number;
		const y2 = data[offset + 3] as number;
		const score = data[offset + 4] as number;
		const rawClassId = data[offset + 5] as number;

		// Skip padding (zero-filled entries)
		if (score <= 0) continue;
		if (score < opts.confThreshold) continue;

		const classId = Math.round(rawClassId);
		if (!passesClassFilter(classId, opts.classFilter)) continue;

		results.push({ x1, y1, x2, y2, score, classId });
		if (results.length >= opts.maxDetections) break;
	}

	return results;
}

function transposeEndToEnd(data: Float32Array, numBoxes: number): Float32Array {
	const out = new Float32Array(numBoxes * 6);
	for (let i = 0; i < numBoxes; i++) {
		for (let j = 0; j < 6; j++) {
			out[i * 6 + j] = data[j * numBoxes + i] as number;
		}
	}
	return out;
}

/**
 * Decodes the `"standard"` YOLO output (`[1, attrs, N]`) into a list of
 * detections. Converts `cx, cy, w, h` to `x1, y1, x2, y2`, picks the argmax
 * class, applies confidence and class filtering, and runs greedy NMS.
 *
 * Auto-detects whether class scores are raw logits or already-sigmoided
 * probabilities by sampling the first few values. If any sample falls outside
 * `[0, 1]`, sigmoid is applied to every score. This avoids requiring callers
 * to know whether their exported model includes the final activation.
 *
 * @internal
 */
function postprocessStandard(
	data: Float32Array,
	numAttrs: number,
	numBoxes: number,
	opts: ResolvedOptions,
): Detection[] {
	const numClasses = numAttrs - 4;
	const candidates: Detection[] = [];

	let needsSigmoid = false;
	const sampleCount = Math.min(10, numBoxes);
	for (let i = 0; i < sampleCount; i++) {
		const sample = data[4 * numBoxes + i] as number;
		if (sample > 1.0 || sample < 0.0) {
			needsSigmoid = true;
			break;
		}
	}

	for (let i = 0; i < numBoxes; i++) {
		let bestClassId = -1;
		let bestScore = Number.NEGATIVE_INFINITY;

		for (let c = 0; c < numClasses; c++) {
			let score = data[(4 + c) * numBoxes + i] as number;
			if (needsSigmoid) score = sigmoid(score);
			if (score > bestScore) {
				bestScore = score;
				bestClassId = c;
			}
		}

		if (!passesClassFilter(bestClassId, opts.classFilter)) continue;
		if (bestScore < opts.confThreshold) continue;

		const cx = data[i] as number;
		const cy = data[numBoxes + i] as number;
		const w = data[2 * numBoxes + i] as number;
		const h = data[3 * numBoxes + i] as number;

		candidates.push({
			x1: cx - w / 2,
			y1: cy - h / 2,
			x2: cx + w / 2,
			y2: cy + h / 2,
			score: bestScore,
			classId: bestClassId,
		});
	}

	return nms(candidates, {
		iouThreshold: opts.iouThreshold,
		maxDetections: opts.maxDetections,
	});
}

function transposeStandard(
	data: Float32Array,
	dim1: number,
	dim2: number,
): Float32Array {
	// Input layout [dim1 boxes, dim2 attrs] → [dim2 attrs, dim1 boxes]
	const out = new Float32Array(dim1 * dim2);
	for (let i = 0; i < dim2; i++) {
		for (let j = 0; j < dim1; j++) {
			out[i * dim1 + j] = data[j * dim2 + i] as number;
		}
	}
	return out;
}

let autoFormatLogged = false;

/**
 * Logs the format chosen by `dispatchAuto` exactly once per module lifetime,
 * to aid debugging without flooding the console on every frame.
 *
 * @internal
 */
function logAutoFormat(message: string, dims: readonly number[]): void {
	if (autoFormatLogged) return;
	autoFormatLogged = true;
	console.log(`[yolo] postprocess: ${message}`, dims);
}

/**
 * Inspects tensor shape and dispatches to the appropriate decoder.
 *
 * Heuristic:
 * - `[1, N, 6]` → `"end-to-end"`
 * - `[1, 6, N]` → `"end-to-end-transposed"`
 * - `[1, attrs, N]` with `attrs < N` → `"standard"`
 * - `[1, N, attrs]` with `N > attrs` → `"standard-transposed"`
 * - `[N, 6]` → `"end-to-end"` (2D variant)
 *
 * Unrecognized shapes log a warning and return `[]`.
 *
 * @internal
 */
function dispatchAuto(output: ort.Tensor, opts: ResolvedOptions): Detection[] {
	const data = output.data as Float32Array;
	const dims = output.dims;

	if (dims.length === 3) {
		const dim1 = dims[1] as number;
		const dim2 = dims[2] as number;

		if (dim2 === 6) {
			logAutoFormat(`end-to-end [1, ${dim1}, 6] — NMS済み`, dims);
			return postprocessEndToEnd(data, dim1, opts);
		}
		if (dim1 === 6) {
			logAutoFormat(
				`end-to-end transposed [1, 6, ${dim2}] → transpose → [1, ${dim2}, 6]`,
				dims,
			);
			return postprocessEndToEnd(transposeEndToEnd(data, dim2), dim2, opts);
		}
		if (dim1 < dim2) {
			logAutoFormat(
				`standard [1, ${dim1} attrs, ${dim2} boxes] — NMS必要`,
				dims,
			);
			return postprocessStandard(data, dim1, dim2, opts);
		}
		if (dim1 > dim2) {
			logAutoFormat(
				`standard transposed [1, ${dim1} boxes, ${dim2} attrs] → transpose`,
				dims,
			);
			return postprocessStandard(
				transposeStandard(data, dim1, dim2),
				dim2,
				dim1,
				opts,
			);
		}
	}

	if (dims.length === 2 && dims[1] === 6) {
		const dim0 = dims[0] as number;
		logAutoFormat(`2D end-to-end [${dim0}, 6] — NMS済み`, dims);
		return postprocessEndToEnd(data, dim0, opts);
	}

	console.warn("[yolo] postprocess: 未対応の出力形状:", dims.join(", "));
	return [];
}

function shapeMismatch(format: OutputFormat, dims: readonly number[]): Error {
	return new Error(
		`YOLO postprocess: tensor shape [${dims.join(", ")}] does not match requested format "${format}"`,
	);
}

/**
 * Decodes a raw YOLO output tensor into a list of {@link Detection}s in
 * model input-space coordinates.
 *
 * Dispatches on `options.format`:
 * - `"end-to-end"` / `"end-to-end-transposed"` — model output already contains
 *   NMS-applied `[x1, y1, x2, y2, score, classId]` rows. The decoder skips
 *   padding rows and applies confidence + class filtering.
 * - `"standard"` / `"standard-transposed"` — model output is raw `cx, cy, w, h`
 *   plus per-class scores. The decoder converts to xyxy, picks argmax class,
 *   applies filters, and runs greedy NMS.
 * - `"auto"` — Inspects the tensor shape and picks the best-fit format,
 *   logging the choice once per module lifetime.
 *
 * @param output - YOLO output tensor with `data: Float32Array`. Common dims:
 *   `[1, N, 6]`, `[1, 6, N]`, `[1, attrs, N]`, `[1, N, attrs]`, or `[N, 6]`.
 * @param options - See {@link PostprocessOptions}.
 * @returns Detections in **model input space** (`0..inputSize` per axis).
 *   To map back to the original source image, use `reverseLetterboxBox` or
 *   `reverseStretchBox` from the `source` subpath.
 *
 * @throws {Error} When a non-`"auto"` format is requested but the tensor shape
 *   does not match the expected layout for that format.
 *
 * @remarks
 * For the `"standard"` formats, class scores may be raw logits or already
 * sigmoided; the decoder auto-detects by sampling and applies sigmoid only
 * when needed. This avoids requiring callers to know their export pipeline.
 *
 * @example
 * ```ts
 * const tensor = (await session.run({ input }))[outputName];
 * const detections = postprocess(tensor, {
 *   format: "auto",
 *   confThreshold: 0.25,
 *   classFilter: [0], // person only
 * });
 * ```
 */
export function postprocess(
	output: ort.Tensor,
	options: PostprocessOptions = {},
): Detection[] {
	const opts = resolve(options);
	const data = output.data as Float32Array;
	const dims = output.dims;

	switch (opts.format) {
		case "auto":
			return dispatchAuto(output, opts);

		case "end-to-end": {
			if (dims.length === 3 && dims[2] === 6) {
				return postprocessEndToEnd(data, dims[1] as number, opts);
			}
			if (dims.length === 2 && dims[1] === 6) {
				return postprocessEndToEnd(data, dims[0] as number, opts);
			}
			throw shapeMismatch(opts.format, dims);
		}

		case "end-to-end-transposed": {
			if (dims.length === 3 && dims[1] === 6) {
				const numBoxes = dims[2] as number;
				return postprocessEndToEnd(
					transposeEndToEnd(data, numBoxes),
					numBoxes,
					opts,
				);
			}
			throw shapeMismatch(opts.format, dims);
		}

		case "standard": {
			if (dims.length === 3) {
				const numAttrs = dims[1] as number;
				const numBoxes = dims[2] as number;
				return postprocessStandard(data, numAttrs, numBoxes, opts);
			}
			throw shapeMismatch(opts.format, dims);
		}

		case "standard-transposed": {
			if (dims.length === 3) {
				const numBoxes = dims[1] as number;
				const numAttrs = dims[2] as number;
				return postprocessStandard(
					transposeStandard(data, numBoxes, numAttrs),
					numAttrs,
					numBoxes,
					opts,
				);
			}
			throw shapeMismatch(opts.format, dims);
		}
	}
}
