import type { Detection, NmsOptions } from "./types";

export const DEFAULT_IOU_THRESHOLD = 0.45;
export const DEFAULT_MAX_DETECTIONS = 30;

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
