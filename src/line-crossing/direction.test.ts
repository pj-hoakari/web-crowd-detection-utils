import { describe, expect, it } from "vitest";
import { LineCrossingCounter } from "./counter";
import { forwardNormal } from "./direction";
import type { Line } from "./types";

const VLINE: Line = { id: "v", p1: { x: 10, y: 0 }, p2: { x: 10, y: 20 } };
const HLINE: Line = { id: "h", p1: { x: 0, y: 10 }, p2: { x: 20, y: 10 } };

describe("forwardNormal", () => {
	it("defaults to rightward for a vertical line", () => {
		expect(forwardNormal(VLINE)).toEqual({ x: 1, y: 0 });
	});

	it("defaults to downward for a horizontal line, which rightward cannot resolve", () => {
		expect(forwardNormal(HLINE)).toEqual({ x: 0, y: 1 });
	});

	it("returns the same normal when the endpoints are reversed", () => {
		const reversed: Line = { ...VLINE, p1: VLINE.p2, p2: VLINE.p1 };
		expect(forwardNormal(reversed)).toEqual(forwardNormal(VLINE));
	});

	it("returns a unit vector for an oblique line", () => {
		const oblique: Line = { id: "o", p1: { x: 0, y: 0 }, p2: { x: 3, y: 4 } };
		const n = forwardNormal(oblique);
		expect(Math.hypot(n.x, n.y)).toBeCloseTo(1);
		expect(n.x).toBeCloseTo(0.8);
		expect(n.y).toBeCloseTo(-0.6);
	});

	it("projects forwardDirection onto the line's normal rather than returning it", () => {
		// Top-left preference on a vertical line can only mean "left".
		const n = forwardNormal({ ...VLINE, forwardDirection: { x: -1, y: -1 } });
		expect(n).toEqual({ x: -1, y: 0 });
	});

	it("skips a forwardDirection entry parallel to the line", () => {
		const diagonal: Line = {
			id: "d",
			p1: { x: 0, y: 0 },
			p2: { x: 20, y: 20 },
			forwardDirection: [
				{ x: -1, y: -1 },
				{ x: 0, y: -1 },
			],
		};
		const n = forwardNormal(diagonal);
		// Up-and-right side of a top-left → bottom-right line.
		expect(n.x).toBeCloseTo(Math.SQRT1_2);
		expect(n.y).toBeCloseTo(-Math.SQRT1_2);
	});

	it("has no forward side for a line whose endpoints coincide", () => {
		const degenerate: Line = {
			id: "z",
			p1: { x: 5, y: 5 },
			p2: { x: 5, y: 5 },
		};
		expect(forwardNormal(degenerate)).toEqual({ x: 0, y: 0 });
	});

	it("agrees with the side the counter tallies as forward", () => {
		const line: Line = { ...VLINE, forwardDirection: { x: -1, y: -1 } };
		const n = forwardNormal(line);
		const c = new LineCrossingCounter();
		// Move from the line toward the normal: 15 → 5 follows n = (-1, 0).
		c.update([{ trackId: 1, point: { x: 15, y: 10 } }], [line]);
		c.update([{ trackId: 1, point: { x: 5, y: 10 } }], [line]);
		expect(n.x).toBeLessThan(0);
		expect(c.getLineCount("v")).toEqual({ forward: 1, backward: 0 });
	});
});
