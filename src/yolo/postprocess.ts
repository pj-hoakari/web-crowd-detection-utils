import type * as ort from "onnxruntime-web";
import { DEFAULT_MAX_DETECTIONS, nms } from "./nms";
import type {
	ClassFilter,
	Detection,
	OutputFormat,
	PostprocessOptions,
} from "./types";

export const DEFAULT_CONF_THRESHOLD = 0.15;
export const DEFAULT_FORMAT: OutputFormat = "end-to-end";
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

function postprocessStandard(
	data: Float32Array,
	numAttrs: number,
	numBoxes: number,
	opts: ResolvedOptions,
): Detection[] {
	const numClasses = numAttrs - 4;
	const candidates: Detection[] = [];

	// Sample first few class scores to detect if sigmoid is needed
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

function logAutoFormat(message: string, dims: readonly number[]): void {
	if (autoFormatLogged) return;
	autoFormatLogged = true;
	console.log(`[yolo] postprocess: ${message}`, dims);
}

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
