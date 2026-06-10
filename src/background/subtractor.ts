import {
	DEFAULT_ALPHA,
	DEFAULT_DIFF_THRESHOLD,
	DEFAULT_HEIGHT,
	DEFAULT_MIN_FOREGROUND_RATIO,
	DEFAULT_WIDTH,
} from "./constants";
import type { BackgroundSubtractorOptions, Box, ScoredBox } from "./types";

/**
 * EMA background-subtraction model for static-detection suppression.
 *
 * Maintains an exponential moving average of per-pixel luma as a learned
 * background. Pixels deviating from the background by more than
 * {@link BackgroundSubtractor.diffThreshold} are marked foreground; a 3×3
 * morphological open (erode → dilate) then removes sensor noise from the
 * foreground mask. {@link BackgroundSubtractor.suppressStatic} uses that mask
 * to attenuate the confidence of detections sitting in static regions, which
 * suppresses false positives on static objects (posters, mannequins, parked
 * scenery).
 *
 * The model is **detector-agnostic**: it operates on raw frames plus any
 * {@link ScoredBox} (the `yolo` `Detection`, the `bytetrack` `Observation` /
 * `TrackedBox`, or any custom box-with-score), and never imports a YOLO type.
 *
 * @remarks
 * The model is **stateful**: every {@link BackgroundSubtractor.update} mutates
 * the background model and foreground mask in place. Frames must be fed in
 * temporal order, and all internal buffers are sized for the configured
 * `width × height` and reused across frames (no per-frame allocation after
 * construction). Call {@link BackgroundSubtractor.reset} to discard the learned
 * background and relearn from the next frame (e.g. after a source switch).
 *
 * @example
 * ```ts
 * import { BackgroundSubtractor } from "@pj-hoakari/web-crowd-detection-utils/background";
 *
 * const bg = new BackgroundSubtractor({ width: 640, height: 640 });
 * for (const frame of frames) {              // frame: ImageData (640 × 640)
 *   const ready = bg.update(frame);
 *   let detections = await detector.detect(frame); // Detection[] from yolo
 *   if (ready) {
 *     detections = bg.suppressStatic(detections, 0.3);
 *   }
 * }
 * ```
 */
export class BackgroundSubtractor {
	/** Frame width, in pixels. Every `update` frame and queried box uses this. */
	readonly width: number;
	/** Frame height, in pixels. */
	readonly height: number;
	/** EMA learning rate in `(0, 1]`; lower adapts the background more slowly. */
	alpha: number;
	/** Minimum absolute luma deviation `0..255` for a pixel to count as foreground. */
	diffThreshold: number;
	/** Foreground-pixel fraction `[0, 1]` at or above which a box counts as active. */
	minForegroundRatio: number;

	private readonly pixelCount: number;
	/** Learned background model (float for sub-pixel EMA precision); `null` until the first frame. */
	private bg: Float32Array | null = null;
	private readonly currGray: Uint8Array;
	private readonly rawDiff: Uint8Array;
	private readonly diffMap: Uint8Array;
	private readonly lineBuf: Uint8Array;
	private readonly prevLine: Uint8Array;

	/**
	 * @param options - Frame dimensions and model tuning. See
	 *   {@link BackgroundSubtractorOptions} for each field's default.
	 *
	 * @throws {Error} If `width` or `height` is not a positive integer.
	 */
	constructor(options: BackgroundSubtractorOptions = {}) {
		const width = options.width ?? DEFAULT_WIDTH;
		const height = options.height ?? DEFAULT_HEIGHT;
		if (
			!Number.isInteger(width) ||
			width <= 0 ||
			!Number.isInteger(height) ||
			height <= 0
		) {
			throw new Error(
				`BackgroundSubtractor: width and height must be positive integers, got ${width}×${height}`,
			);
		}

		this.width = width;
		this.height = height;
		this.alpha = options.alpha ?? DEFAULT_ALPHA;
		this.diffThreshold = options.diffThreshold ?? DEFAULT_DIFF_THRESHOLD;
		this.minForegroundRatio =
			options.minForegroundRatio ?? DEFAULT_MIN_FOREGROUND_RATIO;

		this.pixelCount = width * height;
		this.currGray = new Uint8Array(this.pixelCount);
		this.rawDiff = new Uint8Array(this.pixelCount);
		this.diffMap = new Uint8Array(this.pixelCount);
		this.lineBuf = new Uint8Array(width);
		this.prevLine = new Uint8Array(width);
	}

	/**
	 * Feeds a new frame, updating the background model and foreground mask.
	 *
	 * @param imageData - An RGBA frame whose dimensions equal the configured
	 *   `width × height`. Converted to grayscale via BT.601 luma.
	 * @returns `false` on the very first frame (and the first frame after
	 *   {@link BackgroundSubtractor.reset}), when the background has just been
	 *   initialized and the foreground mask is not yet valid; `true` on every
	 *   subsequent frame, when {@link BackgroundSubtractor.foregroundRatio} and
	 *   {@link BackgroundSubtractor.suppressStatic} return meaningful results.
	 *
	 * @throws {Error} If `imageData`'s dimensions do not match the configured
	 *   `width × height`.
	 *
	 * @remarks
	 * Mutates the internal background model and foreground mask. Frames must be
	 * supplied in temporal order.
	 */
	update(imageData: ImageData): boolean {
		if (imageData.width !== this.width || imageData.height !== this.height) {
			throw new Error(
				`BackgroundSubtractor.update: frame ${imageData.width}×${imageData.height} does not match configured ${this.width}×${this.height}`,
			);
		}

		const { data } = imageData;
		const pixelCount = this.pixelCount;
		const currGray = this.currGray;

		// RGBA → grayscale (BT.601 luma, fixed-point: (77r + 150g + 29b) >> 8)
		for (let i = 0; i < pixelCount; i++) {
			const idx = i * 4;
			currGray[i] =
				((data[idx] as number) * 77 +
					(data[idx + 1] as number) * 150 +
					(data[idx + 2] as number) * 29) >>
				8;
		}

		if (!this.bg) {
			// First frame: seed the background with the current frame.
			const bg = new Float32Array(pixelCount);
			for (let i = 0; i < pixelCount; i++) {
				bg[i] = currGray[i] as number;
			}
			this.bg = bg;
			return false;
		}

		// EMA-update the background and compute the raw foreground mask.
		const bg = this.bg;
		const rawDiff = this.rawDiff;
		const { alpha, diffThreshold } = this;
		for (let i = 0; i < pixelCount; i++) {
			const curr = currGray[i] as number;
			const next = (bg[i] as number) + alpha * (curr - (bg[i] as number));
			bg[i] = next;
			const d = curr - next;
			rawDiff[i] = d > diffThreshold || d < -diffThreshold ? 1 : 0;
		}

		this.morphOpen();
		return true;
	}

	/**
	 * Returns the fraction of foreground pixels inside `box`, in `[0, 1]`.
	 *
	 * @param box - A box in background-model pixel space. Clamped to the frame
	 *   bounds before measuring.
	 * @returns The foreground-pixel ratio, or `0` for a degenerate/out-of-frame
	 *   box and before the first {@link BackgroundSubtractor.update} has produced
	 *   a valid foreground mask.
	 */
	foregroundRatio(box: Box): number {
		const { width, height } = this;
		const diffMap = this.diffMap;
		const left = Math.max(0, Math.floor(box.x1));
		const top = Math.max(0, Math.floor(box.y1));
		const right = Math.min(width, Math.ceil(box.x2));
		const bottom = Math.min(height, Math.ceil(box.y2));

		const w = right - left;
		const h = bottom - top;
		if (w <= 0 || h <= 0) return 0;

		let count = 0;
		for (let y = top; y < bottom; y++) {
			const row = y * width;
			for (let x = left; x < right; x++) {
				count += diffMap[row + x] as number;
			}
		}

		return count / (w * h);
	}

	/**
	 * Returns a copy of `detections` with the score of every box in a static
	 * region scaled by `suppressFactor`; boxes in active regions pass through
	 * unchanged.
	 *
	 * A box is "static" when its {@link BackgroundSubtractor.foregroundRatio} is
	 * below {@link BackgroundSubtractor.minForegroundRatio}.
	 *
	 * @typeParam T - Any subtype of {@link ScoredBox}. Extra fields on `T` (e.g.
	 *   `classId`, `trackId`) are preserved on the returned objects.
	 * @param detections - Boxes to evaluate, in background-model pixel space.
	 * @param suppressFactor - Multiplier applied to `score` for static boxes,
	 *   normally in `[0, 1)` (e.g. `0.3` keeps 30% of the original score; `0`
	 *   zeroes it). The range is not validated.
	 * @returns A new array; each element is either the original object
	 *   (active) or a shallow copy with a reduced `score` (static). The input
	 *   array and its objects are never mutated.
	 *
	 * @remarks
	 * Call {@link BackgroundSubtractor.update} with the corresponding frame
	 * first; before the foreground mask is valid every box reads as static and
	 * would be suppressed.
	 *
	 * @example
	 * ```ts
	 * // Halve the confidence of detections that aren't moving.
	 * const adjusted = bg.suppressStatic(detections, 0.5);
	 * ```
	 */
	suppressStatic<T extends ScoredBox>(
		detections: readonly T[],
		suppressFactor: number,
	): T[] {
		const { minForegroundRatio } = this;
		return detections.map((det) => {
			if (this.foregroundRatio(det) < minForegroundRatio) {
				return { ...det, score: det.score * suppressFactor };
			}
			return det;
		});
	}

	/**
	 * Discards the learned background so it is re-seeded from the next
	 * {@link BackgroundSubtractor.update}, which will return `false` again.
	 *
	 * @remarks
	 * Use after switching input sources, where the old background no longer
	 * describes the new scene.
	 */
	reset(): void {
		this.bg = null;
	}

	/**
	 * 3×3 morphological opening: erode {@link rawDiff} then dilate into
	 * {@link diffMap}. Erosion drops isolated noise (a pixel survives only when
	 * all 8 neighbours are foreground); dilation restores eroded object edges (a
	 * pixel is set if any neighbour is foreground).
	 *
	 * @internal
	 */
	private morphOpen(): void {
		const { width, height } = this;
		const lineBuf = this.lineBuf;
		const prevLine = this.prevLine;
		const src = this.rawDiff;
		const eroded = this.diffMap; // erode pass writes into diffMap, reused as scratch
		const diffMap = this.diffMap;

		// Erode: interior pixel survives only if its full 3×3 neighbourhood is set.
		for (let y = 0; y < height; y++) {
			for (let x = 0; x < width; x++) {
				const idx = y * width + x;
				if (x === 0 || x === width - 1 || y === 0 || y === height - 1) {
					eroded[idx] = 0;
					continue;
				}
				eroded[idx] =
					(src[idx] as number) &
					(src[idx - 1] as number) &
					(src[idx + 1] as number) &
					(src[idx - width] as number) &
					(src[idx + width] as number) &
					(src[idx - width - 1] as number) &
					(src[idx - width + 1] as number) &
					(src[idx + width - 1] as number) &
					(src[idx + width + 1] as number);
			}
		}

		// Dilate the eroded mask in place. `eroded` IS `diffMap`, so each row is
		// snapshotted into `lineBuf` before being overwritten; the row above is
		// read from `prevLine`, the row below from `eroded` (not yet overwritten).
		for (let y = 0; y < height; y++) {
			const rowOff = y * width;
			lineBuf.set(eroded.subarray(rowOff, rowOff + width));

			for (let x = 0; x < width; x++) {
				const idx = rowOff + x;
				if (x === 0 || x === width - 1 || y === 0 || y === height - 1) {
					diffMap[idx] = lineBuf[x] as number;
					continue;
				}
				diffMap[idx] =
					(lineBuf[x] as number) |
					(lineBuf[x - 1] as number) |
					(lineBuf[x + 1] as number) |
					(prevLine[x] as number) |
					(prevLine[x - 1] as number) |
					(prevLine[x + 1] as number) |
					(eroded[idx + width] as number) |
					(eroded[idx + width - 1] as number) |
					(eroded[idx + width + 1] as number)
						? 1
						: 0;
			}

			prevLine.set(lineBuf);
		}
	}
}
