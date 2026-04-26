import { describe, expect, it } from "vitest";
import { nms } from "./nms";
import type { Detection } from "./types";

function det(
	x1: number,
	y1: number,
	x2: number,
	y2: number,
	score: number,
	classId = 0,
): Detection {
	return { x1, y1, x2, y2, score, classId };
}

describe("nms", () => {
	it("returns empty when given empty input", () => {
		expect(nms([])).toEqual([]);
	});

	it("keeps both boxes when they do not overlap", () => {
		const a = det(0, 0, 10, 10, 0.9);
		const b = det(100, 100, 110, 110, 0.8);
		expect(nms([a, b])).toEqual([a, b]);
	});

	it("suppresses the lower-scoring box of a heavily overlapping pair", () => {
		const high = det(0, 0, 10, 10, 0.9);
		const low = det(1, 1, 11, 11, 0.5);
		const out = nms([low, high]);
		expect(out).toHaveLength(1);
		expect(out[0]).toBe(high);
	});

	it("respects iouThreshold parameter", () => {
		// IOU of these two ≈ 81/119 ≈ 0.68
		const a = det(0, 0, 10, 10, 0.9);
		const b = det(1, 1, 11, 11, 0.7);
		expect(nms([a, b], { iouThreshold: 0.45 })).toHaveLength(1);
		expect(nms([a, b], { iouThreshold: 0.9 })).toHaveLength(2);
	});

	it("caps results at maxDetections", () => {
		const inputs = Array.from({ length: 50 }, (_, i) =>
			det(i * 100, 0, i * 100 + 10, 10, 0.5 + i / 1000),
		);
		expect(nms(inputs, { maxDetections: 5 })).toHaveLength(5);
		expect(nms(inputs, { maxDetections: 30 })).toHaveLength(30);
	});

	it("does not mutate the input array order", () => {
		const a = det(0, 0, 10, 10, 0.5);
		const b = det(100, 100, 110, 110, 0.9);
		const input = [a, b];
		nms(input);
		expect(input).toEqual([a, b]);
	});
});
