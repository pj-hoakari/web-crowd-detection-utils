/**
 * A 2-D point in the coordinate space shared by the counting lines and the
 * tracked points fed to {@link LineCrossingCounter}.
 */
export interface Point {
	/** X coordinate, in the shared coordinate space. */
	x: number;
	/** Y coordinate, in the shared coordinate space. */
	y: number;
}

/**
 * A counting line, defined by its two anchor endpoints {@link Line.p1} and
 * {@link Line.p2}. A tracked point crosses the line when the segment between
 * its previous and current position intersects the `p1`–`p2` segment.
 *
 * @remarks
 * The endpoints and every tracked {@link Point} must live in the same
 * coordinate space — {@link LineCrossingCounter} performs no scaling. Counts
 * are accumulated per {@link Line.id}.
 */
export interface Line {
	/** Stable identifier; crossing counts are accumulated per `id`. */
	id: string;
	/** First anchor endpoint of the line. */
	p1: Point;
	/** Second anchor endpoint of the line. */
	p2: Point;
}

/** Direction of a crossing relative to a line's `p1`→`p2` orientation. */
export type CrossingDirection = "forward" | "backward";

/**
 * Per-line crossing tally. The two directions are distinguished by the side
 * transition relative to the line's `p1`→`p2` orientation; see
 * {@link LineCrossingCounter.update}.
 */
export interface LineCount {
	/**
	 * Crossings from the negative side to the positive side of the directed line
	 * `p1`→`p2`, where the side is the sign of the 2-D cross product
	 * `(p2 − p1) × (point − p1)`.
	 */
	forward: number;
	/** Crossings in the opposite direction (positive side to negative side). */
	backward: number;
}

/**
 * A tracked object reduced to a single point for crossing tests.
 *
 * @remarks
 * The caller chooses the anchor (e.g. bounding-box foot
 * `{ x: (x1 + x2) / 2, y: y2 }`, or the centroid) before calling
 * {@link LineCrossingCounter.update}. The counter is detector- and
 * tracker-agnostic and never inspects boxes — it only needs a stable id and a
 * point per frame.
 */
export interface TrackedPoint {
	/** Stable per-object id, consistent across frames (e.g. a ByteTrack `trackId`). */
	trackId: number;
	/** The object's anchor position this frame, in the lines' coordinate space. */
	point: Point;
}

/**
 * Tuning for the crossing-assist heuristics that compensate for tracker ID
 * churn. Every numeric field is optional and falls back to the corresponding
 * `DEFAULT_*` constant while {@link CrossingAssistConfig.enabled} is `true`.
 */
export interface CrossingAssistConfig {
	/**
	 * Master switch. When `false`, the assist state (lost-track history and
	 * cooldowns) is cleared and only raw side-change counting runs.
	 */
	enabled: boolean;
	/**
	 * Maximum distance, in the lines' coordinate space, between a just-lost
	 * track's last point and a new track's point for the new track to inherit
	 * the lost track's crossing history. `0` disables rescue. Defaults to
	 * {@link DEFAULT_RESCUE_DISTANCE}.
	 */
	rescueDistance?: number;
	/**
	 * Number of frames a lost track's history is retained as a rescue candidate.
	 * Defaults to {@link DEFAULT_RESCUE_FRAMES}.
	 */
	rescueFrames?: number;
	/**
	 * After a track crosses a line, additional counts on that same line are
	 * suppressed for this many frames (per track, per line). `0` disables the
	 * cooldown. Defaults to {@link DEFAULT_COOLDOWN_FRAMES}.
	 */
	cooldownFrames?: number;
}
