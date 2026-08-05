import { describe, expect, it } from "vitest";
import { LineCrossingCounter } from "./counter";
import type { Line, TrackedPoint } from "./types";

// Vertical line at x = 10, spanning y ∈ [0, 20]. With no forwardDirection the
// default applies: rightward is forward, so px > 10 is the forward side.
const VLINE: Line = { id: "v", p1: { x: 10, y: 0 }, p2: { x: 10, y: 20 } };
const REVERSED_VLINE: Line = {
	...VLINE,
	p1: VLINE.p2,
	p2: VLINE.p1,
};
const LEFTWARD_VLINE: Line = {
	...VLINE,
	forwardDirection: { x: -1, y: 0 },
};

function tp(trackId: number, x: number, y: number): TrackedPoint {
	return { trackId, point: { x, y } };
}

describe("LineCrossingCounter basic crossing", () => {
	it("counts nothing on the first frame (no previous point)", () => {
		const c = new LineCrossingCounter();
		c.update([tp(1, 5, 10)], [VLINE]);
		expect(c.getLineCount("v")).toEqual({ forward: 0, backward: 0 });
	});

	it("counts a left→right move as forward, right→left as backward", () => {
		const c = new LineCrossingCounter();
		// left→right: onto the side the default direction points at → forward
		c.update([tp(1, 5, 10)], [VLINE]);
		c.update([tp(1, 15, 10)], [VLINE]);
		expect(c.getLineCount("v")).toEqual({ forward: 1, backward: 0 });

		c.update([tp(2, 15, 10)], [VLINE]);
		c.update([tp(2, 5, 10)], [VLINE]);
		expect(c.getLineCount("v")).toEqual({ forward: 1, backward: 1 });
	});

	it("counts the same direction when the endpoints are reversed", () => {
		const c = new LineCrossingCounter();
		c.update([tp(1, 5, 10)], [VLINE]);
		// A caller may supply the same segment with p1/p2 swapped next frame.
		c.update([tp(1, 15, 10)], [REVERSED_VLINE]);
		expect(c.getLineCount("v")).toEqual({ forward: 1, backward: 0 });
	});

	it("follows forwardDirection independently of endpoint order", () => {
		const c = new LineCrossingCounter();
		c.update([tp(1, 5, 10)], [LEFTWARD_VLINE]);
		c.update(
			[tp(1, 15, 10)],
			[{ ...REVERSED_VLINE, forwardDirection: { x: -1, y: 0 } }],
		);
		expect(c.getLineCount("v")).toEqual({ forward: 0, backward: 1 });
	});

	it("falls back to the default when forwardDirection is parallel to the line", () => {
		const c = new LineCrossingCounter();
		const parallel: Line = { ...VLINE, forwardDirection: { x: 0, y: 1 } };
		c.update([tp(1, 5, 10)], [parallel]);
		c.update([tp(1, 15, 10)], [parallel]);
		expect(c.getLineCount("v")).toEqual({ forward: 1, backward: 0 });
	});

	it("takes the first non-parallel entry of a forwardDirection list", () => {
		const c = new LineCrossingCounter();
		// One screen-wide policy: top-left is forward, up breaks the tie for a
		// line that happens to run exactly top-left → bottom-right.
		const forwardDirection = [
			{ x: -1, y: -1 },
			{ x: 0, y: -1 },
		];
		const diagonal: Line = {
			id: "d",
			p1: { x: 0, y: 0 },
			p2: { x: 20, y: 20 },
			forwardDirection,
		};
		// Below-left of the diagonal → above-right of it, i.e. upward.
		c.update([tp(1, 5, 15)], [diagonal]);
		c.update(
			[tp(1, 15, 5)],
			[{ ...diagonal, p1: diagonal.p2, p2: diagonal.p1 }],
		);
		expect(c.getLineCount("d")).toEqual({ forward: 1, backward: 0 });
	});

	it("resolves top-left as forward for a line it is not parallel to", () => {
		const c = new LineCrossingCounter();
		const horizontal: Line = {
			id: "h",
			p1: { x: 0, y: 10 },
			p2: { x: 20, y: 10 },
			forwardDirection: { x: -1, y: -1 },
		};
		const reversedHorizontal: Line = {
			...horizontal,
			p1: horizontal.p2,
			p2: horizontal.p1,
		};
		c.update([tp(1, 10, 15)], [horizontal]);
		c.update([tp(1, 10, 5)], [reversedHorizontal]);
		expect(c.getLineCount("h")).toEqual({ forward: 1, backward: 0 });
	});

	it("does not count a move that stays on one side", () => {
		const c = new LineCrossingCounter();
		c.update([tp(1, 2, 10)], [VLINE]);
		c.update([tp(1, 8, 10)], [VLINE]); // both left of x=10
		expect(c.getLineCount("v")).toEqual({ forward: 0, backward: 0 });
	});

	it("does not count when the line flips but the segments miss (outside endpoints)", () => {
		const c = new LineCrossingCounter();
		const shortLine: Line = {
			id: "s",
			p1: { x: 10, y: 0 },
			p2: { x: 10, y: 5 },
		};
		// Movement at y = 10 crosses the infinite line x=10 but is above the segment (y ≤ 5).
		c.update([tp(1, 5, 10)], [shortLine]);
		c.update([tp(1, 15, 10)], [shortLine]);
		expect(c.getLineCount("s")).toEqual({ forward: 0, backward: 0 });
	});

	it("does not count when a point lands exactly on the line (collinear)", () => {
		const c = new LineCrossingCounter();
		c.update([tp(1, 5, 10)], [VLINE]);
		c.update([tp(1, 10, 10)], [VLINE]); // on the line → side 0
		expect(c.getLineCount("v")).toEqual({ forward: 0, backward: 0 });
	});

	it("tallies multiple lines independently", () => {
		const c = new LineCrossingCounter();
		const v2: Line = { id: "w", p1: { x: 12, y: 0 }, p2: { x: 12, y: 20 } };
		c.update([tp(1, 5, 10)], [VLINE, v2]);
		c.update([tp(1, 15, 10)], [VLINE, v2]); // crosses both x=10 and x=12
		expect(c.getLineCount("v")).toEqual({ forward: 1, backward: 0 });
		expect(c.getLineCount("w")).toEqual({ forward: 1, backward: 0 });
	});
});

describe("LineCrossingCounter accessors and resets", () => {
	it("getLineCount returns a fresh object for unknown lines", () => {
		const c = new LineCrossingCounter();
		const a = c.getLineCount("nope");
		a.forward = 99;
		expect(c.getLineCount("nope")).toEqual({ forward: 0, backward: 0 });
	});

	it("getAllCounts returns a mutable snapshot", () => {
		const c = new LineCrossingCounter();
		c.update([tp(1, 5, 10)], [VLINE]);
		c.update([tp(1, 15, 10)], [VLINE]);
		const snap = c.getAllCounts();
		expect(snap.get("v")).toEqual({ forward: 1, backward: 0 });
		const entry = snap.get("v");
		if (entry) entry.forward = 99;
		expect(c.getLineCount("v")).toEqual({ forward: 1, backward: 0 });
	});

	it("resetCounts clears counts but keeps positions", () => {
		const c = new LineCrossingCounter();
		c.update([tp(1, 5, 10)], [VLINE]);
		c.update([tp(1, 15, 10)], [VLINE]);
		c.resetCounts();
		expect(c.getLineCount("v")).toEqual({ forward: 0, backward: 0 });
		// Position for track 1 is still x=15 (right). Moving back left counts backward.
		c.update([tp(1, 5, 10)], [VLINE]);
		expect(c.getLineCount("v")).toEqual({ forward: 0, backward: 1 });
	});

	it("clearPositions keeps counts but drops the previous point", () => {
		const c = new LineCrossingCounter();
		c.update([tp(1, 5, 10)], [VLINE]);
		c.update([tp(1, 15, 10)], [VLINE]); // forward 1
		c.clearPositions();
		expect(c.getLineCount("v")).toEqual({ forward: 1, backward: 0 });
		// No previous point now → moving back does not count.
		c.update([tp(1, 5, 10)], [VLINE]);
		expect(c.getLineCount("v")).toEqual({ forward: 1, backward: 0 });
	});

	it("reset clears everything", () => {
		const c = new LineCrossingCounter();
		c.update([tp(1, 5, 10)], [VLINE]);
		c.update([tp(1, 15, 10)], [VLINE]);
		c.reset();
		expect(c.getLineCount("v")).toEqual({ forward: 0, backward: 0 });
		c.update([tp(1, 5, 10)], [VLINE]); // fresh: no previous point
		expect(c.getLineCount("v")).toEqual({ forward: 0, backward: 0 });
	});

	it("removeLine forgets one line's tally", () => {
		const c = new LineCrossingCounter();
		c.update([tp(1, 5, 10)], [VLINE]);
		c.update([tp(1, 15, 10)], [VLINE]);
		c.removeLine("v");
		expect(c.getLineCount("v")).toEqual({ forward: 0, backward: 0 });
	});

	it("does not retain references to caller-mutated points", () => {
		const c = new LineCrossingCounter();
		const moving: TrackedPoint = { trackId: 1, point: { x: 5, y: 10 } };
		c.update([moving], [VLINE]);
		moving.point.x = 999; // caller reuses the same object
		moving.point.y = 999;
		c.update([{ trackId: 1, point: { x: 15, y: 10 } }], [VLINE]);
		// The stored previous point was a copy of (5,10), so this is a clean left→right.
		expect(c.getLineCount("v")).toEqual({ forward: 1, backward: 0 });
	});
});

describe("LineCrossingCounter assist — cooldown", () => {
	it("suppresses a repeat count on the same line within the cooldown window", () => {
		const c = new LineCrossingCounter();
		const assist = { enabled: true, cooldownFrames: 10 };
		c.update([tp(1, 5, 10)], [VLINE], { assist });
		c.update([tp(1, 15, 10)], [VLINE], { assist }); // forward 1, cooldown set
		c.update([tp(1, 5, 10)], [VLINE], { assist }); // would be backward, but cooled down
		expect(c.getLineCount("v")).toEqual({ forward: 1, backward: 0 });
	});

	it("counts the back-and-forth when assist is disabled", () => {
		const c = new LineCrossingCounter();
		c.update([tp(1, 5, 10)], [VLINE]);
		c.update([tp(1, 15, 10)], [VLINE]); // forward 1
		c.update([tp(1, 5, 10)], [VLINE]); // backward 1 (no cooldown)
		expect(c.getLineCount("v")).toEqual({ forward: 1, backward: 1 });
	});
});

describe("LineCrossingCounter assist — rescue", () => {
	it("inherits a lost track's history so a crossing across an ID switch still counts", () => {
		const c = new LineCrossingCounter();
		const assist = { enabled: true, rescueDistance: 60, rescueFrames: 15 };
		c.update([tp(1, 5, 10)], [VLINE], { assist }); // track 1 left of line
		c.update([], [VLINE], { assist }); // track 1 lost → retained for rescue
		// New id 2 appears on the right, near track 1's last point (dist 10 ≤ 60).
		c.update([tp(2, 15, 10)], [VLINE], { assist });
		expect(c.getLineCount("v")).toEqual({ forward: 1, backward: 0 });
	});

	it("does not count the ID switch when assist is disabled", () => {
		const c = new LineCrossingCounter();
		c.update([tp(1, 5, 10)], [VLINE]);
		c.update([], [VLINE]);
		c.update([tp(2, 15, 10)], [VLINE]); // brand-new id, no previous point
		expect(c.getLineCount("v")).toEqual({ forward: 0, backward: 0 });
	});

	it("drops a lost track once rescueFrames elapse", () => {
		const c = new LineCrossingCounter();
		const assist = { enabled: true, rescueDistance: 60, rescueFrames: 1 };
		c.update([tp(1, 5, 10)], [VLINE], { assist }); // seen
		c.update([], [VLINE], { assist }); // lost, framesAgo 0
		c.update([], [VLINE], { assist }); // aged → framesAgo 1
		c.update([], [VLINE], { assist }); // aged → framesAgo 2 > 1 → dropped
		c.update([tp(2, 15, 10)], [VLINE], { assist }); // nothing to rescue
		expect(c.getLineCount("v")).toEqual({ forward: 0, backward: 0 });
	});
});
