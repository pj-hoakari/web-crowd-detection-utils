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
