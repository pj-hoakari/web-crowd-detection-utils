/**
 * Default {@link BackgroundSubtractorOptions.width}, in pixels. Matches the
 * square `640 × 640` model-input grid this package's capture pipeline targets.
 */
export const DEFAULT_WIDTH = 640;

/**
 * Default {@link BackgroundSubtractorOptions.height}, in pixels. Matches the
 * square `640 × 640` model-input grid this package's capture pipeline targets.
 */
export const DEFAULT_HEIGHT = 640;

/**
 * Default {@link BackgroundSubtractorOptions.alpha}. At ~30 FPS this learning
 * rate means an object must stay still for roughly 3–4 seconds before it merges
 * into the learned background.
 */
export const DEFAULT_ALPHA = 0.01;

/**
 * Default {@link BackgroundSubtractorOptions.diffThreshold}. A luma deviation of
 * `20` (out of 255) separates genuine foreground change from sensor noise.
 */
export const DEFAULT_DIFF_THRESHOLD = 20;

/**
 * Default {@link BackgroundSubtractorOptions.minForegroundRatio}. A box whose
 * foreground fraction is below 5% is treated as static.
 */
export const DEFAULT_MIN_FOREGROUND_RATIO = 0.05;
