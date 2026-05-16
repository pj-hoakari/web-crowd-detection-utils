import type { STrack } from "./strack";
import type { Observation } from "./types";

/**
 * IoU of two `xyxy` boxes. Uses an `+ 1e-7` denominator guard to avoid NaN
 * when both boxes are degenerate.
 *
 * @internal
 */
function iouSingle(
	a: [number, number, number, number],
	b: [number, number, number, number],
): number {
	const ix1 = Math.max(a[0], b[0]);
	const iy1 = Math.max(a[1], b[1]);
	const ix2 = Math.min(a[2], b[2]);
	const iy2 = Math.min(a[3], b[3]);

	const inter = Math.max(0, ix2 - ix1) * Math.max(0, iy2 - iy1);
	const areaA = (a[2] - a[0]) * (a[3] - a[1]);
	const areaB = (b[2] - b[0]) * (b[3] - b[1]);

	return inter / (areaA + areaB - inter + 1e-7);
}

/**
 * Builds the `tracks.length × observations.length` cost matrix of
 * `1 - IoU` values for use as input to the Hungarian assignment.
 *
 * @internal
 */
export function iouDistance(
	tracks: STrack[],
	observations: Observation[],
): number[][] {
	return tracks.map((t) => {
		const tb = t.bbox;
		return observations.map((d) => 1 - iouSingle(tb, [d.x1, d.y1, d.x2, d.y2]));
	});
}

/**
 * Track × track `1 - IoU` cost matrix, used by {@link removeDuplicateStracks}.
 *
 * @internal
 */
function iouDistanceTracks(a: STrack[], b: STrack[]): number[][] {
	return a.map((ta) => b.map((tb) => 1 - iouSingle(ta.bbox, tb.bbox)));
}

/**
 * Set union of two track lists keyed by `trackId`; entries in `a` take
 * precedence over identically-IDed entries in `b`.
 *
 * @internal
 */
export function jointStracks(a: STrack[], b: STrack[]): STrack[] {
	const ids = new Set(a.map((t) => t.trackId));
	const result = [...a];
	for (const t of b) {
		if (!ids.has(t.trackId)) {
			ids.add(t.trackId);
			result.push(t);
		}
	}
	return result;
}

/**
 * Set difference: returns entries of `a` whose `trackId` does not appear in `b`.
 *
 * @internal
 */
export function subStracks(a: STrack[], b: STrack[]): STrack[] {
	const ids = new Set(b.map((t) => t.trackId));
	return a.filter((t) => !ids.has(t.trackId));
}

/**
 * Drops pairs of tracks across `a` and `b` whose IoU distance is below
 * `duplicateIouThresh`. When two tracks are deemed duplicates, the one with
 * the shorter lifetime (`endFrame - startFrame`) is removed.
 *
 * @internal
 */
export function removeDuplicateStracks(
	a: STrack[],
	b: STrack[],
	duplicateIouThresh: number,
): [STrack[], STrack[]] {
	if (a.length === 0 || b.length === 0) return [a, b];

	const dists = iouDistanceTracks(a, b);
	const dupaSet = new Set<number>();
	const dupbSet = new Set<number>();

	for (let i = 0; i < dists.length; i++) {
		const row = dists[i] as number[];
		const ai = a[i] as STrack;
		for (let j = 0; j < row.length; j++) {
			if ((row[j] as number) < duplicateIouThresh) {
				const bj = b[j] as STrack;
				const timeA = ai.endFrame - ai.startFrame;
				const timeB = bj.endFrame - bj.startFrame;
				if (timeA > timeB) dupbSet.add(j);
				else dupaSet.add(i);
			}
		}
	}

	return [
		a.filter((_, i) => !dupaSet.has(i)),
		b.filter((_, i) => !dupbSet.has(i)),
	];
}
