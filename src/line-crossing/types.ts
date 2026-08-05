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
 * A direction in the coordinate space shared by the counting lines and the
 * tracked points. Only its orientation matters; the magnitude is ignored.
 */
export interface Vector {
	/** Horizontal component; positive points right. */
	x: number;
	/** Vertical component; positive points down in a canvas / image space. */
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
	/** One anchor endpoint. Its order relative to {@link Line.p2} never affects the direction counts. */
	p1: Point;
	/** The other anchor endpoint. Its order relative to {@link Line.p1} never affects the direction counts. */
	p2: Point;
	/**
	 * The direction that counts as `forward`, in the shared coordinate space —
	 * `{ x: -1, y: -1 }` for "toward the top-left", say. Defaults to
	 * {@link DEFAULT_FORWARD_DIRECTION}.
	 *
	 * @remarks
	 * The side the direction points at is what is counted, so only its component
	 * perpendicular to the line matters, and swapping `p1` and `p2` leaves the
	 * tally untouched. A direction *parallel* to the line points at no side; pass
	 * an ordered list to decide that case yourself — the first entry that is not
	 * parallel to the line wins. Any two directions that are not parallel to
	 * *each other* therefore cover every possible line. If they all turn out to
	 * be parallel, {@link DEFAULT_FORWARD_DIRECTION} resolves the side.
	 *
	 * Near-parallel lines are inherently sensitive: with a single `{ x: -1, y: -1 }`
	 * preference, lines at 44° and 46° get opposite forward sides. Prefer a
	 * direction well clear of the orientations your lines actually take.
	 *
	 * @example
	 * One screen-wide policy applied to every line:
	 * ```ts
	 * const FORWARD = [
	 *   { x: -1, y: -1 }, // top-left is forward
	 *   { x: 0, y: -1 },  // ...but for an exactly top-left/bottom-right line, up is
	 * ];
	 * const lines = drawn.map((l) => ({ ...l, forwardDirection: FORWARD }));
	 * ```
	 */
	forwardDirection?: Vector | readonly Vector[];
}

/** Direction of a crossing relative to a line's {@link Line.forwardDirection}. */
export type CrossingDirection = "forward" | "backward";

/**
 * Per-line crossing tally, split by which side of the line the track ended up
 * on; see {@link LineCrossingCounter.update}.
 */
export interface LineCount {
	/**
	 * Crossings onto the side {@link Line.forwardDirection} points at — the side
	 * {@link forwardNormal} returns.
	 */
	forward: number;
	/** Crossings onto the opposite side. */
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
