import { afterEach, describe, expect, it, vi } from "vitest";
import { createScratchCanvas2D } from "./canvas";

interface StubContext {
	drawImage: ReturnType<typeof vi.fn>;
	getImageData: ReturnType<typeof vi.fn>;
}

function makeStubContext(): StubContext {
	return {
		drawImage: vi.fn(),
		getImageData: vi.fn(
			(_x: number, _y: number, w: number, h: number) =>
				({
					data: new Uint8ClampedArray(w * h * 4),
					width: w,
					height: h,
					colorSpace: "srgb",
				}) as unknown as ImageData,
		),
	};
}

/**
 * Installs a mock `OffscreenCanvas` global (absent in the happy-dom test env)
 * whose `getContext` returns `ctx`. Removed by `vi.unstubAllGlobals()`.
 */
function stubOffscreenCanvas(ctx: unknown): {
	getContext: ReturnType<typeof vi.fn>;
	ctor: new (w: number, h: number) => unknown;
} {
	const getContext = vi.fn(() => ctx);
	class MockOffscreenCanvas {
		width: number;
		height: number;
		getContext = getContext;
		constructor(w: number, h: number) {
			this.width = w;
			this.height = h;
		}
	}
	vi.stubGlobal("OffscreenCanvas", MockOffscreenCanvas);
	return { getContext, ctor: MockOffscreenCanvas };
}

/** Stubs the DOM canvas 2D context (happy-dom returns null otherwise). */
function stubHtmlCanvasContext(ctx: unknown): {
	getContext: ReturnType<typeof vi.fn>;
	restore: () => void;
} {
	const original = HTMLCanvasElement.prototype.getContext;
	const getContext = vi.fn(() => ctx);
	HTMLCanvasElement.prototype.getContext =
		getContext as unknown as typeof original;
	return {
		getContext,
		restore() {
			HTMLCanvasElement.prototype.getContext = original;
		},
	};
}

describe("createScratchCanvas2D", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("prefers OffscreenCanvas when its constructor is available", () => {
		const ctx = makeStubContext();
		const { getContext, ctor } = stubOffscreenCanvas(ctx);

		const result = createScratchCanvas2D(320, 240, "test");

		expect(result.canvas).toBeInstanceOf(ctor);
		expect(result.canvas.width).toBe(320);
		expect(result.canvas.height).toBe(240);
		expect(result.ctx as unknown).toBe(ctx);
		expect(getContext).toHaveBeenCalledWith("2d", { willReadFrequently: true });
	});

	it("throws when OffscreenCanvas yields no 2D context", () => {
		stubOffscreenCanvas(null);
		expect(() =>
			createScratchCanvas2D(10, 10, "createCanvasFrameCapturer"),
		).toThrow(/2D rendering context/);
	});

	it("falls back to a DOM canvas when OffscreenCanvas is unavailable", () => {
		expect(
			typeof (globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas,
		).toBe("undefined");

		const ctx = makeStubContext();
		const stub = stubHtmlCanvasContext(ctx);
		try {
			const result = createScratchCanvas2D(100, 50, "test");

			expect(result.canvas).toBeInstanceOf(HTMLCanvasElement);
			expect(result.canvas.width).toBe(100);
			expect(result.canvas.height).toBe(50);
			expect(result.ctx as unknown).toBe(ctx);
			expect(stub.getContext).toHaveBeenCalledWith("2d", {
				willReadFrequently: true,
			});
		} finally {
			stub.restore();
		}
	});
});
