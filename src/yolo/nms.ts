import type { Detection, NmsOptions } from "./types";

/** Default IoU threshold for greedy NMS. Matches the YOLO reference default. */
export const DEFAULT_IOU_THRESHOLD = 0.45;

/** Default maximum number of detections kept after NMS. */
export const DEFAULT_MAX_DETECTIONS = 30;

/**
 * Intersection-over-Union of two axis-aligned bounding boxes.
 *
 * @internal
 */
function iou(a: Detection, b: Detection): number {
	const ix1 = Math.max(a.x1, b.x1);
	const iy1 = Math.max(a.y1, b.y1);
	const ix2 = Math.min(a.x2, b.x2);
	const iy2 = Math.min(a.y2, b.y2);

	const interArea = Math.max(0, ix2 - ix1) * Math.max(0, iy2 - iy1);
	const aArea = (a.x2 - a.x1) * (a.y2 - a.y1);
	const bArea = (b.x2 - b.x1) * (b.y2 - b.y1);

	return interArea / (aArea + bArea - interArea);
}

/**
 * Greedy Non-Maximum Suppression over a list of detections.
 *
 * Sorts the input by `score` descending, then keeps each box unless its IoU
 * with any already-kept box exceeds `iouThreshold`. Iteration stops once
 * `maxDetections` boxes have been kept.
 *
 * @param detections - Candidate detections. Not mutated; a shallow copy is sorted internally.
 * @param options - IoU threshold and maximum detection cap. See defaults
 *   {@link DEFAULT_IOU_THRESHOLD} and {@link DEFAULT_MAX_DETECTIONS}.
 * @returns A new array of detections, ordered by score descending, with the
 *   same `Detection` object references as the input (no deep copy).
 *
 * @remarks
 * NMS is class-agnostic: boxes from different `classId`s suppress each other.
 * If you need per-class NMS, split by `classId` and call this function per group.
 */
export function nms(
	detections: Detection[],
	options: NmsOptions = {},
): Detection[] {
	const iouThreshold = options.iouThreshold ?? DEFAULT_IOU_THRESHOLD;
	const maxDetections = options.maxDetections ?? DEFAULT_MAX_DETECTIONS;

	const sorted = [...detections].sort((a, b) => b.score - a.score);

	const kept: Detection[] = [];
	for (const det of sorted) {
		if (kept.length >= maxDetections) break;

		let dominated = false;
		for (const k of kept) {
			if (iou(det, k) > iouThreshold) {
				dominated = true;
				break;
			}
		}
		if (!dominated) {
			kept.push(det);
		}
	}

	return kept;
}
