import { describe, expect, it } from "vitest";
import { DEFAULT_FORWARD_DIRECTION } from "./constants";
import { LineCrossingCounter } from "./counter";
import { forwardNormal, reverseDirection } from "./direction";
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

describe("reversing a forward policy", () => {
	const LINES: readonly Line[] = [
		VLINE,
		HLINE,
		{ id: "d", p1: { x: 0, y: 0 }, p2: { x: 20, y: 20 } }, // exactly 45°
		{ id: "o", p1: { x: 0, y: 0 }, p2: { x: 3, y: 4 } },
		{ id: "r", p1: { x: 20, y: 20 }, p2: { x: 0, y: 0 } }, // reversed endpoints
	];

	it.each(LINES.map((line) => [line.id, line] as const))(
		"reversing every direction flips the forward side of the %s line",
		(_id, line) => {
			const base = forwardNormal(line);
			const flipped = forwardNormal({
				...line,
				forwardDirection: reverseDirection(),
			});
			// The same list entry still resolves the side; only its sign changes.
			expect(flipped.x).toBeCloseTo(-base.x);
			expect(flipped.y).toBeCloseTo(-base.y);
		},
	);

	it("does not flip when every reversed direction is still parallel to the line", () => {
		// A parallel direction resolves no side, so both fall through to the
		// default — reversing a policy only flips lines it can actually resolve.
		const down = forwardNormal({ ...VLINE, forwardDirection: { x: 0, y: 1 } });
		const up = forwardNormal({ ...VLINE, forwardDirection: { x: 0, y: -1 } });
		expect(up).toEqual(down);
		expect(up).toEqual(forwardNormal(VLINE));
	});

	it("reverses a single direction into a one-entry list", () => {
		expect(reverseDirection({ x: 1, y: 0 })).toEqual([{ x: -1, y: 0 }]);
	});

	it("reverses the default when given no directions", () => {
		expect(reverseDirection()).toEqual([
			{ x: -1, y: 0 },
			{ x: 0, y: -1 },
		]);
	});

	it("keeps each entry's position so the resolving entry stays the same", () => {
		const policy = [
			{ x: -1, y: -1 },
			{ x: 0, y: -1 },
		];
		expect(reverseDirection(policy)).toEqual([
			{ x: 1, y: 1 },
			{ x: 0, y: 1 },
		]);
	});

	it("does not mutate the directions it is given", () => {
		const policy = [{ x: 1, y: 0 }];
		reverseDirection(policy);
		expect(policy).toEqual([{ x: 1, y: 0 }]);
	});

	it("returns to the original policy when applied twice", () => {
		const policy = [
			{ x: -1, y: -1 },
			{ x: 0, y: -1 },
		];
		expect(reverseDirection(reverseDirection(policy))).toEqual(policy);
	});

	it("flips one line while the rest keep the shared policy", () => {
		const c = new LineCrossingCounter();
		const shared: Line = {
			id: "shared",
			p1: { x: 10, y: 0 },
			p2: { x: 10, y: 20 },
		};
		const flipped: Line = {
			id: "flipped",
			p1: { x: 12, y: 0 },
			p2: { x: 12, y: 20 },
			forwardDirection: reverseDirection(),
		};
		const lines = [
			{ ...shared, forwardDirection: DEFAULT_FORWARD_DIRECTION },
			flipped,
		];
		// One rightward move crosses both lines at x = 10 and x = 12.
		c.update([{ trackId: 1, point: { x: 5, y: 10 } }], lines);
		c.update([{ trackId: 1, point: { x: 15, y: 10 } }], lines);
		expect(c.getLineCount("shared")).toEqual({ forward: 1, backward: 0 });
		expect(c.getLineCount("flipped")).toEqual({ forward: 0, backward: 1 });
	});
});
