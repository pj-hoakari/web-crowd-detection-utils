/**
 * Minimal axis-aligned bounding box consumed by
 * {@link BackgroundSubtractor.foregroundRatio}.
 *
 * Coordinates are in the background model's pixel space — the same
 * `width × height` grid the {@link BackgroundSubtractor} was constructed with
 * and that every {@link BackgroundSubtractor.update} frame is supplied in. This
 * module is **detector-agnostic**: any box living in that space is accepted,
 * including the `yolo` `Detection` and the `bytetrack` `Observation` /
 * `TrackedBox`, which are all structurally compatible without remapping.
 */
export interface Box {
	/** Left edge of the box, in background-model pixels. */
	x1: number;
	/** Top edge of the box, in background-model pixels. */
	y1: number;
	/** Right edge of the box, in background-model pixels. */
	x2: number;
	/** Bottom edge of the box, in background-model pixels. */
	y2: number;
}

/**
 * A {@link Box} carrying a confidence score, consumed by
 * {@link BackgroundSubtractor.suppressStatic}.
 *
 * The `score` field name matches the `Observation` (bytetrack) and `Detection`
 * (yolo) contracts, so detections from those subpaths flow into
 * `suppressStatic` without remapping. `suppressStatic` is generic over any
 * subtype `T extends ScoredBox` and preserves every extra field (e.g.
 * `classId`, `trackId`) on its returned objects.
 */
export interface ScoredBox extends Box {
	/** Confidence score in `[0, 1]`. Scaled down for detections in static regions. */
	score: number;
}

/**
 * Options for {@link BackgroundSubtractor}. Every field is optional and falls
 * back to the corresponding `DEFAULT_*` constant.
 */
export interface BackgroundSubtractorOptions {
	/**
	 * Width of the frames fed to {@link BackgroundSubtractor.update}, in pixels.
	 * Every `update` frame and every {@link Box} queried must share this width.
	 * Defaults to {@link DEFAULT_WIDTH}.
	 */
	width?: number;
	/**
	 * Height of the frames fed to {@link BackgroundSubtractor.update}, in pixels.
	 * Defaults to {@link DEFAULT_HEIGHT}.
	 */
	height?: number;
	/**
	 * EMA learning rate in `(0, 1]` for the background model. Lower values adapt
	 * the background more slowly, so an object must stay still longer before it
	 * merges into the background. Defaults to {@link DEFAULT_ALPHA}.
	 */
	alpha?: number;
	/**
	 * Minimum absolute deviation from the background, in luma units `0..255`,
	 * for a pixel to count as foreground. Defaults to
	 * {@link DEFAULT_DIFF_THRESHOLD}.
	 */
	diffThreshold?: number;
	/**
	 * Foreground-pixel fraction in `[0, 1]` at or above which a box is
	 * considered active (non-static). Boxes below this are treated as static by
	 * {@link BackgroundSubtractor.suppressStatic}. Defaults to
	 * {@link DEFAULT_MIN_FOREGROUND_RATIO}.
	 */
	minForegroundRatio?: number;
}
