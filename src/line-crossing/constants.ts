import type { Vector } from "./types";

/**
 * Default {@link Line.forwardDirection}: rightward, falling back to downward for
 * a horizontal line.
 *
 * @remarks
 * Also the final fallback when every direction a caller supplies happens to be
 * parallel to the line, which keeps {@link forwardNormal} total: every line with
 * two distinct endpoints resolves to a forward side.
 */
export const DEFAULT_FORWARD_DIRECTION: readonly Vector[] = [
	{ x: 1, y: 0 },
	{ x: 0, y: 1 },
];

/**
 * Default {@link CrossingAssistConfig.rescueDistance}, in coordinate-space
 * units. Proven value from the source sandbox at a 640-pixel detection space;
 * scale it with your own coordinate space.
 */
export const DEFAULT_RESCUE_DISTANCE = 60;

/**
 * Default {@link CrossingAssistConfig.rescueFrames}. Roughly half a second of
 * grace at 30 FPS before a lost track's history is discarded.
 */
export const DEFAULT_RESCUE_FRAMES = 15;

/**
 * Default {@link CrossingAssistConfig.cooldownFrames}. Roughly a third of a
 * second at 30 FPS during which a track cannot re-count the same line.
 */
export const DEFAULT_COOLDOWN_FRAMES = 10;
