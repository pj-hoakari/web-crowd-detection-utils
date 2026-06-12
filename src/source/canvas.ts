import type { CaptureCanvas } from "./types";

/**
 * A 2D rendering context paired with a {@link CaptureCanvas}. Both variants
 * (`CanvasRenderingContext2D` for a DOM canvas, `OffscreenCanvasRenderingContext2D`
 * for an `OffscreenCanvas`) expose the same `drawImage` / `getImageData` /
 * `fillRect` surface the capturers rely on, so callers can treat them uniformly.
 *
 * @internal
 */
type ScratchCanvas2DContext =
	| CanvasRenderingContext2D
	| OffscreenCanvasRenderingContext2D;

/**
 * An off-screen scratch canvas together with its acquired 2D context.
 *
 * @internal
 */
export interface ScratchCanvas2D {
	canvas: CaptureCanvas;
	ctx: ScratchCanvas2DContext;
}

/**
 * Creates an off-screen `width × height` scratch canvas and its 2D context,
 * selecting an implementation that works in the current execution context.
 *
 * An `OffscreenCanvas` is used when the constructor is available — this covers
 * both the main thread and Web Workers (where the DOM is absent) — falling back
 * to a DOM `<canvas>` via `document.createElement` otherwise. The 2D context is
 * created with `willReadFrequently: true` so that repeated `getImageData` calls
 * take the CPU-readable path rather than copying back from the GPU.
 *
 * @param width - Canvas width in pixels. Assumed already validated by the caller.
 * @param height - Canvas height in pixels. Assumed already validated by the caller.
 * @param label - Caller name prefixed onto thrown error messages (e.g. the
 *   factory function name) so failures are attributable.
 * @returns The created {@link CaptureCanvas} and its 2D rendering context.
 *
 * @throws {Error} If a 2D rendering context cannot be acquired, or if neither an
 *   `OffscreenCanvas` constructor nor a DOM `document` is available (e.g. a bare
 *   Node process).
 *
 * @internal
 */
export function createScratchCanvas2D(
	width: number,
	height: number,
	label: string,
): ScratchCanvas2D {
	if (typeof OffscreenCanvas !== "undefined") {
		const canvas = new OffscreenCanvas(width, height);
		const ctx = canvas.getContext("2d", {
			willReadFrequently: true,
		}) as OffscreenCanvasRenderingContext2D | null;
		if (!ctx) {
			throw new Error(
				`${label}: failed to acquire a 2D rendering context from OffscreenCanvas`,
			);
		}
		return { canvas, ctx };
	}

	if (
		typeof document !== "undefined" &&
		typeof document.createElement === "function"
	) {
		const canvas = document.createElement("canvas");
		canvas.width = width;
		canvas.height = height;
		const ctx = canvas.getContext("2d", { willReadFrequently: true });
		if (!ctx) {
			throw new Error(`${label}: failed to acquire a 2D rendering context`);
		}
		return { canvas, ctx };
	}

	throw new Error(
		`${label}: no canvas implementation available (neither an OffscreenCanvas constructor nor a DOM document)`,
	);
}
