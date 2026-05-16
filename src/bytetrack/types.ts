/**
 * Lifecycle state of a tracked object inside {@link BYTETracker}.
 *
 * Transitions:
 * - `New` → `Tracked` on first successful association.
 * - `Tracked` → `Lost` when no matching observation is found in a frame.
 * - `Lost` → `Tracked` when a later frame re-associates an observation
 *   (re-identification after occlusion).
 * - `Lost` → `Removed` after the configured `trackBuffer` frames elapse
 *   without re-association.
 * - `New` → `Removed` if the candidate fails to be confirmed.
 *
 * Exposed as a `const` object so consumers can both name the states and
 * compare numeric values returned from `STrack.state`.
 */
export const TrackState = {
	New: 0,
	Tracked: 1,
	Lost: 2,
	Removed: 3,
} as const;
export type TrackState = (typeof TrackState)[keyof typeof TrackState];

/**
 * Per-frame detection input to {@link BYTETracker.update}.
 *
 * Structurally compatible with any object that exposes axis-aligned box
 * coordinates and a confidence score. The `Detection` type emitted by the
 * `yolo` subpath satisfies this contract directly, so YOLO outputs can be
 * passed into ByteTrack without remapping.
 *
 * Additional fields on a subtype `T` (e.g. `classId`, custom metadata) are
 * preserved on the tracker output; see {@link BYTETracker.update} for the
 * exact pass-through semantics.
 */
export interface Observation {
	/** Left edge of the bounding box, in source-image pixels. */
	x1: number;
	/** Top edge of the bounding box, in source-image pixels. */
	y1: number;
	/** Right edge of the bounding box, in source-image pixels. */
	x2: number;
	/** Bottom edge of the bounding box, in source-image pixels. */
	y2: number;
	/** Confidence score in `[0, 1]`. Splits high/low confidence at {@link BYTETrackerOptions.highThresh}. */
	score: number;
}

/**
 * Per-frame tracker output element. Combines a Kalman-filtered bounding box
 * with a stable `trackId` that persists across frames for the same object.
 *
 * The `bbox` returned here comes from the Kalman filter, not directly from
 * the latest observation, so coordinates are smoothed and survive single-frame
 * detection misses (within the `trackBuffer` window).
 */
export interface TrackedBox {
	/** Left edge of the smoothed bounding box, in source-image pixels. */
	x1: number;
	/** Top edge of the smoothed bounding box, in source-image pixels. */
	y1: number;
	/** Right edge of the smoothed bounding box, in source-image pixels. */
	x2: number;
	/** Bottom edge of the smoothed bounding box, in source-image pixels. */
	y2: number;
	/** Score of the most recently associated observation. */
	score: number;
	/** Stable identifier that persists for the lifetime of the track. */
	trackId: number;
}

/**
 * Configuration for {@link BYTETracker}. Every field is optional and falls back
 * to a YOLO/COCO-tuned default; see the `DEFAULT_*` constants for each value.
 *
 * IoU-distance thresholds use the metric `1 - IoU`, so **lower values are
 * stricter** (require tighter overlap to consider boxes a match). Score
 * thresholds use raw scores, so **higher values are stricter**.
 */
export interface BYTETrackerOptions {
	/**
	 * Score threshold separating high vs. low confidence observations.
	 * Observations at or above this are routed to Stage 1 matching; below
	 * to Stage 2. Default: `0.2`.
	 */
	highThresh?: number;
	/**
	 * Stage 1 IoU-distance threshold (high-confidence detections × tracked
	 * and lost tracks). Default: `0.8`.
	 */
	matchThresh?: number;
	/**
	 * Stage 2 IoU-distance threshold (low-confidence detections × tracked
	 * tracks unmatched by Stage 1). Default: `0.5`.
	 */
	secondMatchThresh?: number;
	/**
	 * Stage 3 IoU-distance threshold (remaining high-confidence detections ×
	 * unconfirmed tracks). Default: `0.7`.
	 */
	unconfirmedMatchThresh?: number;
	/**
	 * Minimum score required for an unmatched observation to spawn a new
	 * track. Filters out spurious detections from becoming tracks. Default: `0.15`.
	 */
	newTrackThresh?: number;
	/**
	 * IoU-distance below which two tracks are considered duplicates; the
	 * shorter-lived one is dropped. Lower values are stricter (require closer
	 * boxes to be considered duplicates). Default: `0.15`.
	 */
	duplicateIouThresh?: number;
	/**
	 * Number of frames a lost track is retained before being removed. Larger
	 * values tolerate longer occlusions at the cost of memory and the risk
	 * of incorrect re-identification. Default: `30`.
	 */
	trackBuffer?: number;
}
