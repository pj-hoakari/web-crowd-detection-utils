/**
 * Default {@link BYTETrackerOptions.highThresh}. Observations with score
 * at or above this go to Stage 1 matching; below to Stage 2.
 */
export const DEFAULT_HIGH_THRESH = 0.2;

/**
 * Default {@link BYTETrackerOptions.matchThresh}. IoU-distance ceiling for
 * Stage 1 (high-confidence detections × tracked + lost tracks).
 */
export const DEFAULT_MATCH_THRESH = 0.8;

/**
 * Default {@link BYTETrackerOptions.secondMatchThresh}. IoU-distance ceiling
 * for Stage 2 (low-confidence detections × tracked tracks unmatched by Stage 1).
 */
export const DEFAULT_SECOND_MATCH_THRESH = 0.5;

/**
 * Default {@link BYTETrackerOptions.unconfirmedMatchThresh}. IoU-distance
 * ceiling for Stage 3 (remaining high-confidence detections × unconfirmed tracks).
 */
export const DEFAULT_UNCONFIRMED_MATCH_THRESH = 0.7;

/**
 * Default {@link BYTETrackerOptions.newTrackThresh}. Minimum score for an
 * unmatched observation to spawn a new track.
 */
export const DEFAULT_NEW_TRACK_THRESH = 0.15;

/**
 * Default {@link BYTETrackerOptions.duplicateIouThresh}. IoU-distance below
 * which two tracks are treated as duplicates; the shorter-lived one is dropped.
 */
export const DEFAULT_DUPLICATE_IOU_THRESH = 0.15;

/**
 * Default {@link BYTETrackerOptions.trackBuffer}. Frames a lost track is
 * retained before removal. At 30 FPS this corresponds to roughly one second
 * of tolerated occlusion.
 */
export const DEFAULT_TRACK_BUFFER = 30;
