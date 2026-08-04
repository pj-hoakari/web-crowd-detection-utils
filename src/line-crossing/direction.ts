import { DEFAULT_FORWARD_DIRECTION } from "./constants";
import type { Line, Vector } from "./types";

/**
 * Sign of the 2-D cross product `(ax, ay) × (bx, by)`: `1` / `-1` for the two
 * orientations and `0` when the two vectors are parallel (either direction) or
 * one of them is zero.
 *
 * @internal
 */
export function crossSign(
	ax: number,
	ay: number,
	bx: number,
	by: number,
): number {
	const cross = ax * by - ay * bx;
	if (cross > 0) return 1;
	if (cross < 0) return -1;
	return 0;
}

/**
 * Side of the line `(dx, dy)` the first non-parallel entry of `directions`
 * points at, or `0` when every entry is parallel to the line.
 *
 * @internal
 */
function resolveSide(
	dx: number,
	dy: number,
	directions: readonly Vector[],
): number {
	for (const d of directions) {
		const side = crossSign(dx, dy, d.x, d.y);
		if (side !== 0) return side;
	}
	return 0;
}

/**
 * Signed side of `line` that its crossings count as `forward`, matching the sign
 * convention of the counter's internal side test.
 *
 * @internal
 */
export function forwardSideOf(line: Line): number {
	const dx = line.p2.x - line.p1.x;
	const dy = line.p2.y - line.p1.y;
	const configured = line.forwardDirection;
	if (configured !== undefined) {
		const side = resolveSide(
			dx,
			dy,
			Array.isArray(configured) ? configured : [configured],
		);
		if (side !== 0) return side;
	}
	// Every configured direction is parallel to (or degenerate for) this line.
	return resolveSide(dx, dy, DEFAULT_FORWARD_DIRECTION) || 1;
}

/**
 * Unit vector perpendicular to `line`, pointing at the side whose crossings are
 * counted as `forward` by {@link LineCrossingCounter}.
 *
 * @param line - The line to resolve, including its optional
 *   {@link Line.forwardDirection} preference.
 * @returns A fresh unit {@link Vector} perpendicular to `p1`–`p2`, or
 *   `{ x: 0, y: 0 }` when the two endpoints coincide (such a line can never be
 *   crossed, so it has no forward side).
 *
 * @remarks
 * Resolving {@link Line.forwardDirection} to an actual side is otherwise
 * internal to the counter; this function exposes the result so callers that
 * visualize a line (an arrow at its midpoint, a shaded forward half) stay
 * consistent with the tally without reimplementing the rule. The returned
 * vector is perpendicular to the line, so it is the projection of the
 * configured preference onto the line's normal — not the preference itself.
 *
 * @example
 * ```ts
 * import { forwardNormal } from "@pj-hoakari/web-crowd-detection-utils/line-crossing";
 *
 * const n = forwardNormal(line);
 * const midX = (line.p1.x + line.p2.x) / 2;
 * const midY = (line.p1.y + line.p2.y) / 2;
 * ctx.moveTo(midX, midY);
 * ctx.lineTo(midX + n.x * 32, midY + n.y * 32);
 * ```
 */
export function forwardNormal(line: Line): Vector {
	const dx = line.p2.x - line.p1.x;
	const dy = line.p2.y - line.p1.y;
	const len = Math.hypot(dx, dy);
	if (len === 0) return { x: 0, y: 0 };
	const scale = forwardSideOf(line) / len;
	return { x: unsigned(-dy * scale), y: unsigned(dx * scale) };
}

/**
 * Maps `-0` to `0`, keeping every other value as is, so an axis-aligned normal
 * never hands the caller a negative zero.
 *
 * @internal
 */
function unsigned(v: number): number {
	return v === 0 ? 0 : v;
}
