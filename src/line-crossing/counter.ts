import {
	DEFAULT_COOLDOWN_FRAMES,
	DEFAULT_RESCUE_DISTANCE,
	DEFAULT_RESCUE_FRAMES,
} from "./constants";
import type {
	CrossingAssistConfig,
	Line,
	LineCount,
	Point,
	TrackedPoint,
} from "./types";

/**
 * Signed side of `p` relative to the directed line `p1`→`p2`: the sign of the
 * 2-D cross product `(p2 − p1) × (p − p1)`. Returns `1` / `-1` for the two
 * sides and `0` when `p` is collinear with the line.
 *
 * @internal
 */
function sideOf(line: Line, p: Point): number {
	const dx = line.p2.x - line.p1.x;
	const dy = line.p2.y - line.p1.y;
	const ex = p.x - line.p1.x;
	const ey = p.y - line.p1.y;
	const cross = dx * ey - dy * ex;
	if (cross > 0) return 1;
	if (cross < 0) return -1;
	return 0;
}

/**
 * Whether segment `a1`–`a2` intersects segment `b1`–`b2`. Parallel or collinear
 * segments return `false`.
 *
 * @internal
 */
function segmentsIntersect(
	a1: Point,
	a2: Point,
	b1: Point,
	b2: Point,
): boolean {
	const d1x = a2.x - a1.x;
	const d1y = a2.y - a1.y;
	const d2x = b2.x - b1.x;
	const d2y = b2.y - b1.y;
	const denom = d1x * d2y - d1y * d2x;
	if (denom === 0) return false;
	const sx = a1.x - b1.x;
	const sy = a1.y - b1.y;
	const t = (d2x * sy - d2y * sx) / denom;
	const u = (d1x * sy - d1y * sx) / denom;
	return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}

/** A lost track retained as a rescue candidate. @internal */
interface LostEntry {
	point: Point;
	framesAgo: number;
	cooldowns: Map<string, number>;
}

/**
 * Counts how many tracked points cross each {@link Line}, per direction, across
 * a stream of frames.
 *
 * Detector- and tracker-agnostic: it consumes {@link TrackedPoint} (a stable id
 * plus an anchor point the caller derives from each detection) and {@link Line}
 * (two anchor endpoints), and never inspects bounding boxes or imports a YOLO /
 * ByteTrack type. It performs no drawing.
 *
 * @remarks
 * The model is **stateful**: {@link LineCrossingCounter.update} compares each
 * track's point this frame against the point it held last frame, so frames must
 * be supplied in temporal order and one instance is used per stream (never per
 * frame). The counter keeps its own copies of every point, so the caller may
 * reuse / mutate the points it passes after the call returns.
 *
 * Optional {@link CrossingAssistConfig} heuristics compensate for tracker ID
 * churn: **rescue** lets a new id inherit the crossing history of a just-lost
 * id near the same position, and **cooldown** suppresses repeat counts on the
 * same line for a few frames after a crossing.
 *
 * @example
 * ```ts
 * import { LineCrossingCounter } from "@pj-hoakari/web-crowd-detection-utils/line-crossing";
 *
 * const counter = new LineCrossingCounter();
 * const lines = [{ id: "door", p1: { x: 10, y: 0 }, p2: { x: 10, y: 480 } }];
 *
 * // Per frame, after tracking. The caller picks each detection's anchor point.
 * const points = tracked.map((t) => ({
 *   trackId: t.trackId,
 *   point: { x: (t.x1 + t.x2) / 2, y: t.y2 }, // foot
 * }));
 * counter.update(points, lines, {
 *   assist: { enabled: true },
 * });
 * const { forward, backward } = counter.getLineCount("door");
 * ```
 */
export class LineCrossingCounter {
	private prevPoint = new Map<number, Point>();
	private counts = new Map<string, LineCount>();
	private lostTracks = new Map<number, LostEntry>();
	private cooldowns = new Map<number, Map<string, number>>();

	/**
	 * Feeds one frame of tracked points, updating the per-line crossing counts.
	 *
	 * A crossing is counted for a `(track, line)` pair when, between the track's
	 * previous and current point, (1) the {@link sideOf | side} of the line
	 * flips (neither endpoint is collinear) **and** (2) the prev→current segment
	 * actually intersects the line's `p1`–`p2` segment. The direction follows
	 * the side transition: negative→positive increments `forward`, otherwise
	 * `backward`.
	 *
	 * @param points - The tracked objects this frame, each reduced to an anchor
	 *   {@link Point}. A track with no entry last frame produces no count (it has
	 *   no previous point), unless rescued via {@link CrossingAssistConfig}.
	 * @param lines - The counting lines, in the same coordinate space as
	 *   `points`. May change between frames; counts persist per {@link Line.id}.
	 * @param options - Optional crossing-assist tuning. When
	 *   `options.assist.enabled` is falsy (the default), assist state is cleared
	 *   and only raw side-change counting runs.
	 *
	 * @remarks
	 * Mutates internal state (previous points, counts, and assist bookkeeping).
	 * Call exactly once per frame, in temporal order.
	 */
	update(
		points: readonly TrackedPoint[],
		lines: readonly Line[],
		options?: { assist?: CrossingAssistConfig },
	): void {
		const assist = options?.assist;
		const enabled = assist?.enabled ?? false;

		// While assist is off, drop its bookkeeping so a later re-enable does not
		// resurrect stale lost tracks or cooldowns.
		if (!enabled) {
			this.lostTracks.clear();
			this.cooldowns.clear();
		} else {
			this.decayCooldowns();
			this.ageLostTracks(assist?.rescueFrames ?? DEFAULT_RESCUE_FRAMES);
		}

		const rescueDistance = assist?.rescueDistance ?? DEFAULT_RESCUE_DISTANCE;
		const cooldownFrames = assist?.cooldownFrames ?? DEFAULT_COOLDOWN_FRAMES;

		const seen = new Set<number>();
		for (const tp of points) {
			seen.add(tp.trackId);
			const point = tp.point;

			let prev = this.prevPoint.get(tp.trackId);
			let trackCooldowns = enabled ? this.cooldowns.get(tp.trackId) : undefined;

			// New id: inherit the state of a nearby track lost in a recent frame.
			if (!prev && enabled) {
				const rescued = this.findClosestLost(point, rescueDistance);
				if (rescued) {
					prev = rescued.point;
					trackCooldowns = rescued.cooldowns;
					this.lostTracks.delete(rescued.id);
				}
			}

			if (prev) {
				for (const line of lines) {
					if (enabled && trackCooldowns?.has(line.id)) continue;
					const sPrev = sideOf(line, prev);
					const sNow = sideOf(line, point);
					if (sPrev === 0 || sNow === 0) continue;
					if (sPrev === sNow) continue;
					if (!segmentsIntersect(prev, point, line.p1, line.p2)) continue;
					const c = this.counts.get(line.id) ?? { forward: 0, backward: 0 };
					if (sPrev < 0 && sNow > 0) {
						c.forward += 1;
					} else {
						c.backward += 1;
					}
					this.counts.set(line.id, c);

					if (enabled && cooldownFrames > 0) {
						if (!trackCooldowns) trackCooldowns = new Map();
						trackCooldowns.set(line.id, cooldownFrames);
					}
				}
			}

			// Store a copy so the counter owns its geometry state.
			this.prevPoint.set(tp.trackId, { x: point.x, y: point.y });
			if (enabled && trackCooldowns && trackCooldowns.size > 0) {
				this.cooldowns.set(tp.trackId, trackCooldowns);
			}
		}

		// Retire tracks absent this frame; keep them briefly for rescue if enabled.
		for (const id of Array.from(this.prevPoint.keys())) {
			if (seen.has(id)) continue;
			if (enabled) {
				const point = this.prevPoint.get(id);
				if (point) {
					const cooldowns = this.cooldowns.get(id) ?? new Map<string, number>();
					this.lostTracks.set(id, { point, framesAgo: 0, cooldowns });
				}
			}
			this.prevPoint.delete(id);
			this.cooldowns.delete(id);
		}
	}

	/**
	 * Clears tracked positions and assist state but keeps the accumulated counts.
	 *
	 * @remarks
	 * Use when tracking pauses, so a stale previous point cannot fabricate a
	 * crossing when tracking resumes.
	 */
	clearPositions(): void {
		this.prevPoint.clear();
		this.lostTracks.clear();
		this.cooldowns.clear();
	}

	/** Clears everything: counts, tracked positions, and assist state. */
	reset(): void {
		this.prevPoint.clear();
		this.counts.clear();
		this.lostTracks.clear();
		this.cooldowns.clear();
	}

	/** Clears only the accumulated counts, keeping tracked positions. */
	resetCounts(): void {
		this.counts.clear();
	}

	/** Forgets the accumulated count for a single line. */
	removeLine(lineId: string): void {
		this.counts.delete(lineId);
	}

	/**
	 * Returns the crossing tally for one line.
	 *
	 * @returns A fresh {@link LineCount}; mutating it does not affect internal
	 *   state. An unknown `lineId` yields `{ forward: 0, backward: 0 }`.
	 */
	getLineCount(lineId: string): LineCount {
		const c = this.counts.get(lineId);
		return c
			? { forward: c.forward, backward: c.backward }
			: { forward: 0, backward: 0 };
	}

	/**
	 * Returns a snapshot of every line's tally, keyed by {@link Line.id}.
	 *
	 * @returns A new map of fresh {@link LineCount} objects; safe to mutate.
	 */
	getAllCounts(): Map<string, LineCount> {
		const out = new Map<string, LineCount>();
		for (const [id, c] of this.counts) {
			out.set(id, { forward: c.forward, backward: c.backward });
		}
		return out;
	}

	/** @internal */
	private decayCooldowns(): void {
		for (const [trackId, lineMap] of this.cooldowns) {
			for (const [lineId, frames] of lineMap) {
				if (frames <= 1) {
					lineMap.delete(lineId);
				} else {
					lineMap.set(lineId, frames - 1);
				}
			}
			if (lineMap.size === 0) {
				this.cooldowns.delete(trackId);
			}
		}
	}

	/** @internal */
	private ageLostTracks(maxFrames: number): void {
		for (const [id, entry] of this.lostTracks) {
			entry.framesAgo += 1;
			if (entry.framesAgo > maxFrames) {
				this.lostTracks.delete(id);
			}
		}
	}

	/** @internal */
	private findClosestLost(
		point: Point,
		maxDist: number,
	): { id: number; point: Point; cooldowns: Map<string, number> } | null {
		if (maxDist <= 0) return null;
		let best: {
			id: number;
			point: Point;
			cooldowns: Map<string, number>;
		} | null = null;
		let bestDist = maxDist;
		for (const [id, entry] of this.lostTracks) {
			const dx = entry.point.x - point.x;
			const dy = entry.point.y - point.y;
			const d = Math.hypot(dx, dy);
			if (d < bestDist) {
				bestDist = d;
				best = { id, point: entry.point, cooldowns: entry.cooldowns };
			}
		}
		return best;
	}
}
