import type * as ort from "onnxruntime-web";
import { describe, expect, it } from "vitest";
import { postprocess } from "./postprocess";
import type { Detection } from "./types";

// Minimal shape — postprocess only reads .data and .dims, so a structural
// stand-in is enough and lets the test suite avoid loading the ORT runtime.
function fakeTensor(data: Float32Array, dims: readonly number[]): ort.Tensor {
	return { data, dims } as unknown as ort.Tensor;
}

// Float32 round-trips lose precision for non-binary-exact decimals (0.9 →
// 0.8999999...). Compare coordinates / classId exactly but score within tolerance.
function expectDetection(
	actual: Detection | undefined,
	expected: Detection,
): void {
	expect(actual).toBeDefined();
	if (!actual) return;
	expect(actual.x1).toBeCloseTo(expected.x1, 4);
	expect(actual.y1).toBeCloseTo(expected.y1, 4);
	expect(actual.x2).toBeCloseTo(expected.x2, 4);
	expect(actual.y2).toBeCloseTo(expected.y2, 4);
	expect(actual.score).toBeCloseTo(expected.score, 4);
	expect(actual.classId).toBe(expected.classId);
}

function endToEnd(boxes: number[][]): ort.Tensor {
	return fakeTensor(new Float32Array(boxes.flat()), [1, boxes.length, 6]);
}

function endToEndTransposed(boxes: number[][]): ort.Tensor {
	const n = boxes.length;
	const data = new Float32Array(6 * n);
	for (let i = 0; i < n; i++) {
		const row = boxes[i] as number[];
		for (let j = 0; j < 6; j++) {
			data[j * n + i] = row[j] as number;
		}
	}
	return fakeTensor(data, [1, 6, n]);
}

// Build a [1, 4 + numClasses, numBoxes] tensor where attrs are cx,cy,w,h then
// per-class scores. Scores are [0, 1] so sigmoid is not triggered.
function standard(
	rows: {
		cx: number;
		cy: number;
		w: number;
		h: number;
		classScores: number[];
	}[],
): ort.Tensor {
	const numBoxes = rows.length;
	const first = rows[0] as { classScores: number[] };
	const numClasses = first.classScores.length;
	const numAttrs = 4 + numClasses;
	const data = new Float32Array(numAttrs * numBoxes);
	for (let i = 0; i < numBoxes; i++) {
		const r = rows[i] as (typeof rows)[number];
		data[i] = r.cx;
		data[numBoxes + i] = r.cy;
		data[2 * numBoxes + i] = r.w;
		data[3 * numBoxes + i] = r.h;
		for (let c = 0; c < numClasses; c++) {
			data[(4 + c) * numBoxes + i] = r.classScores[c] as number;
		}
	}
	return fakeTensor(data, [1, numAttrs, numBoxes]);
}

function standardTransposed(
	rows: {
		cx: number;
		cy: number;
		w: number;
		h: number;
		classScores: number[];
	}[],
): ort.Tensor {
	const numBoxes = rows.length;
	const first = rows[0] as { classScores: number[] };
	const numClasses = first.classScores.length;
	const numAttrs = 4 + numClasses;
	const data = new Float32Array(numBoxes * numAttrs);
	for (let i = 0; i < numBoxes; i++) {
		const r = rows[i] as (typeof rows)[number];
		const off = i * numAttrs;
		data[off] = r.cx;
		data[off + 1] = r.cy;
		data[off + 2] = r.w;
		data[off + 3] = r.h;
		for (let c = 0; c < numClasses; c++) {
			data[off + 4 + c] = r.classScores[c] as number;
		}
	}
	return fakeTensor(data, [1, numBoxes, numAttrs]);
}

describe("postprocess — end-to-end", () => {
	it("parses [1, N, 6] returning detections in input order, skipping zero-score padding", () => {
		const t = endToEnd([
			[10, 20, 30, 40, 0.9, 0],
			[50, 60, 70, 80, 0.5, 0],
			[0, 0, 0, 0, 0, 0],
		]);
		const out = postprocess(t, { format: "end-to-end" });
		expect(out).toHaveLength(2);
		expectDetection(out[0], {
			x1: 10,
			y1: 20,
			x2: 30,
			y2: 40,
			score: 0.9,
			classId: 0,
		});
		expect(out[1]?.score).toBe(0.5);
	});

	it("rounds non-integer classId from end-to-end output", () => {
		const t = endToEnd([[0, 0, 1, 1, 0.9, 2.4]]);
		expect(
			postprocess(t, { format: "end-to-end", classFilter: "all" })[0]?.classId,
		).toBe(2);
	});

	it("filters out scores strictly below confThreshold (boundary kept)", () => {
		const t = endToEnd([
			[0, 0, 1, 1, 0.5, 0],
			[2, 2, 3, 3, 0.4999, 0],
		]);
		const out = postprocess(t, { format: "end-to-end", confThreshold: 0.5 });
		expect(out).toHaveLength(1);
		expect(out[0]?.score).toBe(0.5);
	});

	it("clamps results at maxDetections", () => {
		const t = endToEnd(
			Array.from({ length: 50 }, (_, i) => [i, 0, i + 1, 1, 0.5, 0]),
		);
		expect(
			postprocess(t, { format: "end-to-end", maxDetections: 7 }),
		).toHaveLength(7);
	});

	it("supports 2D [N, 6] fallback under explicit end-to-end", () => {
		const data = new Float32Array([10, 20, 30, 40, 0.9, 0]);
		const t = { data, dims: [1, 6] } as unknown as ort.Tensor;
		expect(postprocess(t, { format: "end-to-end" })).toHaveLength(1);
	});
});

describe("postprocess — end-to-end-transposed", () => {
	it("transposes [1, 6, N] then parses identically", () => {
		const boxes: number[][] = [
			[10, 20, 30, 40, 0.9, 0],
			[50, 60, 70, 80, 0.5, 0],
		];
		const t = endToEndTransposed(boxes);
		const out = postprocess(t, { format: "end-to-end-transposed" });
		expect(out).toHaveLength(2);
		expectDetection(out[0], {
			x1: 10,
			y1: 20,
			x2: 30,
			y2: 40,
			score: 0.9,
			classId: 0,
		});
	});
});

describe("postprocess — standard", () => {
	it("converts cx,cy,w,h → x1,y1,x2,y2 and runs NMS", () => {
		const rows = [
			{ cx: 50, cy: 50, w: 20, h: 20, classScores: [0.9] },
			// Almost identical box, lower score → suppressed by NMS
			{ cx: 51, cy: 51, w: 20, h: 20, classScores: [0.7] },
			// Disjoint box → kept
			{ cx: 200, cy: 200, w: 20, h: 20, classScores: [0.6] },
		];
		const out = postprocess(standard(rows), { format: "standard" });
		expect(out).toHaveLength(2);
		expectDetection(out[0], {
			x1: 40,
			y1: 40,
			x2: 60,
			y2: 60,
			score: 0.9,
			classId: 0,
		});
		expect(out[1]?.classId).toBe(0);
	});

	it("triggers sigmoid when raw scores fall outside [0, 1]", () => {
		// Raw score 5 → sigmoid(5) ≈ 0.993 — should be kept under default conf.
		const rows = [{ cx: 0, cy: 0, w: 10, h: 10, classScores: [5] }];
		const out = postprocess(standard(rows), { format: "standard" });
		expect(out).toHaveLength(1);
		expect(out[0]?.score).toBeCloseTo(1 / (1 + Math.exp(-5)), 5);
	});
});

describe("postprocess — standard-transposed", () => {
	it("transposes [1, boxes, attrs] then matches the standard result", () => {
		const rows = [
			{ cx: 50, cy: 50, w: 20, h: 20, classScores: [0.9] },
			{ cx: 200, cy: 200, w: 20, h: 20, classScores: [0.6] },
		];
		const out = postprocess(standardTransposed(rows), {
			format: "standard-transposed",
		});
		expect(out).toHaveLength(2);
		expectDetection(out[0], {
			x1: 40,
			y1: 40,
			x2: 60,
			y2: 60,
			score: 0.9,
			classId: 0,
		});
	});
});

describe("postprocess — class filter", () => {
	it("default [0] keeps only person", () => {
		const t = endToEnd([
			[0, 0, 1, 1, 0.9, 0],
			[0, 0, 1, 1, 0.9, 1],
		]);
		const out = postprocess(t, { format: "end-to-end" });
		expect(out).toHaveLength(1);
		expect(out[0]?.classId).toBe(0);
	});

	it("'all' keeps everything regardless of class", () => {
		const t = endToEnd([
			[0, 0, 1, 1, 0.9, 0],
			[0, 0, 1, 1, 0.9, 5],
		]);
		const out = postprocess(t, { format: "end-to-end", classFilter: "all" });
		expect(out).toHaveLength(2);
	});

	it("custom whitelist filters accordingly", () => {
		const t = endToEnd([
			[0, 0, 1, 1, 0.9, 0],
			[0, 0, 1, 1, 0.9, 1],
			[0, 0, 1, 1, 0.9, 2],
		]);
		const out = postprocess(t, {
			format: "end-to-end",
			classFilter: [1, 2],
		});
		expect(out.map((d) => d.classId).sort()).toEqual([1, 2]);
	});
});

describe("postprocess — explicit format mismatch", () => {
	it("throws when shape does not match requested format", () => {
		const standardShape = standard([
			{ cx: 0, cy: 0, w: 1, h: 1, classScores: [0.9] },
		]);
		expect(() => postprocess(standardShape, { format: "end-to-end" })).toThrow(
			/does not match requested format "end-to-end"/,
		);
	});
});

describe("postprocess — auto", () => {
	it("dispatches end-to-end [1, N, 6]", () => {
		const t = endToEnd([[10, 20, 30, 40, 0.9, 0]]);
		expect(postprocess(t, { format: "auto" })).toHaveLength(1);
	});

	it("dispatches end-to-end-transposed [1, 6, N]", () => {
		const t = endToEndTransposed([[10, 20, 30, 40, 0.9, 0]]);
		const out = postprocess(t, { format: "auto" });
		expect(out).toHaveLength(1);
		expect(out[0]?.x1).toBe(10);
	});

	it("dispatches standard [1, attrs, boxes] when attrs < boxes", () => {
		const rows = Array.from({ length: 10 }, (_, i) => ({
			cx: 100 * i,
			cy: 0,
			w: 10,
			h: 10,
			classScores: [0.9],
		}));
		const t = standard(rows); // [1, 5, 10]
		const out = postprocess(t, { format: "auto" });
		expect(out).toHaveLength(10);
	});

	it("dispatches standard-transposed [1, boxes, attrs] when boxes > attrs", () => {
		const rows = Array.from({ length: 10 }, (_, i) => ({
			cx: 100 * i,
			cy: 0,
			w: 10,
			h: 10,
			classScores: [0.9],
		}));
		const t = standardTransposed(rows); // [1, 10, 5]
		const out = postprocess(t, { format: "auto" });
		expect(out).toHaveLength(10);
	});

	it("dispatches 2D [N, 6] end-to-end", () => {
		const data = new Float32Array([10, 20, 30, 40, 0.9, 0]);
		const t = { data, dims: [1, 6] } as unknown as ort.Tensor;
		expect(postprocess(t, { format: "auto" })).toHaveLength(1);
	});

	it("returns [] for unsupported shapes", () => {
		const t = {
			data: new Float32Array(8),
			dims: [2, 2, 2],
		} as unknown as ort.Tensor;
		expect(postprocess(t, { format: "auto" })).toEqual([]);
	});
});
