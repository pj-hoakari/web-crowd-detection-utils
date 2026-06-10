import { describe, expect, it } from "vitest";
import {
	DEFAULT_ALPHA,
	DEFAULT_DIFF_THRESHOLD,
	DEFAULT_HEIGHT,
	DEFAULT_MIN_FOREGROUND_RATIO,
	DEFAULT_WIDTH,
} from "./constants";
import { BackgroundSubtractor } from "./subtractor";

/**
 * Builds a uniform-gray RGBA frame, optionally overwriting a rectangular
 * region with a different gray value. Used to plant a foreground patch against
 * a static background.
 */
function makeFrame(
	width: number,
	height: number,
	background: number,
	patch?: { x1: number; y1: number; x2: number; y2: number; value: number },
): ImageData {
	const data = new Uint8ClampedArray(width * height * 4);
	for (let i = 0; i < width * height; i++) {
		const idx = i * 4;
		data[idx] = background;
		data[idx + 1] = background;
		data[idx + 2] = background;
		data[idx + 3] = 255;
	}
	if (patch) {
		for (let y = patch.y1; y < patch.y2; y++) {
			for (let x = patch.x1; x < patch.x2; x++) {
				const idx = (y * width + x) * 4;
				data[idx] = patch.value;
				data[idx + 1] = patch.value;
				data[idx + 2] = patch.value;
				data[idx + 3] = 255;
			}
		}
	}
	return { data, width, height, colorSpace: "srgb" } as ImageData;
}

describe("BackgroundSubtractor constructor", () => {
	it("defaults width/height/tuning to the exported DEFAULT_* constants", () => {
		const bg = new BackgroundSubtractor();
		expect(bg.width).toBe(DEFAULT_WIDTH);
		expect(bg.height).toBe(DEFAULT_HEIGHT);
		expect(bg.alpha).toBe(DEFAULT_ALPHA);
		expect(bg.diffThreshold).toBe(DEFAULT_DIFF_THRESHOLD);
		expect(bg.minForegroundRatio).toBe(DEFAULT_MIN_FOREGROUND_RATIO);
	});

	it("applies overrides", () => {
		const bg = new BackgroundSubtractor({
			width: 32,
			height: 16,
			alpha: 0.2,
			diffThreshold: 10,
			minForegroundRatio: 0.1,
		});
		expect(bg.width).toBe(32);
		expect(bg.height).toBe(16);
		expect(bg.alpha).toBe(0.2);
		expect(bg.diffThreshold).toBe(10);
		expect(bg.minForegroundRatio).toBe(0.1);
	});

	it.each([
		["zero width", { width: 0 }],
		["negative height", { height: -4 }],
		["non-integer width", { width: 12.5 }],
		["NaN height", { height: Number.NaN }],
	])("throws on %s", (_label, opts) => {
		expect(() => new BackgroundSubtractor(opts)).toThrow();
	});
});

describe("BackgroundSubtractor.update", () => {
	it("returns false on the first frame and true afterwards", () => {
		const bg = new BackgroundSubtractor({ width: 8, height: 8 });
		expect(bg.update(makeFrame(8, 8, 100))).toBe(false);
		expect(bg.update(makeFrame(8, 8, 100))).toBe(true);
	});

	it("throws when the frame size does not match the configured dimensions", () => {
		const bg = new BackgroundSubtractor({ width: 8, height: 8 });
		expect(() => bg.update(makeFrame(16, 16, 100))).toThrow();
	});

	it("returns false again after reset()", () => {
		const bg = new BackgroundSubtractor({ width: 8, height: 8 });
		bg.update(makeFrame(8, 8, 100));
		bg.update(makeFrame(8, 8, 100));
		bg.reset();
		expect(bg.update(makeFrame(8, 8, 100))).toBe(false);
	});
});

describe("BackgroundSubtractor.foregroundRatio", () => {
	it("is ~0 for a fully static scene", () => {
		const bg = new BackgroundSubtractor({ width: 16, height: 16 });
		bg.update(makeFrame(16, 16, 120));
		bg.update(makeFrame(16, 16, 120));
		expect(bg.foregroundRatio({ x1: 0, y1: 0, x2: 16, y2: 16 })).toBe(0);
	});

	it("is high inside a region that changed sharply, ~0 outside it", () => {
		const bg = new BackgroundSubtractor({ width: 32, height: 32 });
		bg.update(makeFrame(32, 32, 100));
		// A 12×12 bright patch appears against the learned background. After the
		// 3×3 open the interior of the patch remains foreground.
		bg.update(
			makeFrame(32, 32, 100, { x1: 8, y1: 8, x2: 20, y2: 20, value: 255 }),
		);

		const inside = bg.foregroundRatio({ x1: 8, y1: 8, x2: 20, y2: 20 });
		const outside = bg.foregroundRatio({ x1: 24, y1: 24, x2: 32, y2: 32 });
		expect(inside).toBeGreaterThan(0.3);
		expect(outside).toBe(0);
	});

	it("returns 0 for a degenerate or out-of-frame box", () => {
		const bg = new BackgroundSubtractor({ width: 16, height: 16 });
		bg.update(makeFrame(16, 16, 100));
		bg.update(makeFrame(16, 16, 100));
		expect(bg.foregroundRatio({ x1: 5, y1: 5, x2: 5, y2: 10 })).toBe(0);
		expect(bg.foregroundRatio({ x1: 100, y1: 100, x2: 120, y2: 120 })).toBe(0);
	});
});

describe("BackgroundSubtractor.suppressStatic", () => {
	it("scales the score of static detections and leaves active ones untouched", () => {
		const bg = new BackgroundSubtractor({ width: 32, height: 32 });
		bg.update(makeFrame(32, 32, 100));
		bg.update(
			makeFrame(32, 32, 100, { x1: 8, y1: 8, x2: 20, y2: 20, value: 255 }),
		);

		const active = { x1: 8, y1: 8, x2: 20, y2: 20, score: 0.9 };
		const staticBox = { x1: 24, y1: 24, x2: 32, y2: 32, score: 0.8 };
		const out = bg.suppressStatic([active, staticBox], 0.25);

		expect(out[0]?.score).toBeCloseTo(0.9);
		expect(out[1]?.score).toBeCloseTo(0.2);
	});

	it("preserves extra fields on the detection subtype", () => {
		const bg = new BackgroundSubtractor({ width: 16, height: 16 });
		bg.update(makeFrame(16, 16, 100));
		bg.update(makeFrame(16, 16, 100)); // fully static → everything suppressed

		const det = { x1: 0, y1: 0, x2: 16, y2: 16, score: 0.6, classId: 7 };
		const out = bg.suppressStatic([det], 0.5);
		expect(out[0]?.classId).toBe(7);
		expect(out[0]?.score).toBeCloseTo(0.3);
	});

	it("does not mutate the input array or its objects", () => {
		const bg = new BackgroundSubtractor({ width: 16, height: 16 });
		bg.update(makeFrame(16, 16, 100));
		bg.update(makeFrame(16, 16, 100));

		const det = { x1: 0, y1: 0, x2: 16, y2: 16, score: 0.6 };
		const out = bg.suppressStatic([det], 0);
		expect(det.score).toBe(0.6);
		expect(out[0]).not.toBe(det);
	});
});
