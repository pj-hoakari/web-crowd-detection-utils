import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCanvasFrameCapturer } from "./capture";

// happy-dom does not implement a 2D rendering context, so getContext("2d")
// returns null by default. Stub it with a tiny mock that satisfies the
// capturer's call surface (drawImage + getImageData). This isolates the test
// to the capturer's wiring logic, not browser-canvas fidelity.
function stubCanvasContext(): {
	context: {
		drawImage: ReturnType<typeof vi.fn>;
		getImageData: ReturnType<typeof vi.fn>;
	};
	getContext: ReturnType<typeof vi.fn>;
	restore: () => void;
} {
	const context = {
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
	const original = HTMLCanvasElement.prototype.getContext;
	const getContext = vi.fn(() => context);
	HTMLCanvasElement.prototype.getContext =
		getContext as unknown as typeof original;
	return {
		context,
		getContext,
		restore() {
			HTMLCanvasElement.prototype.getContext = original;
		},
	};
}

describe("createCanvasFrameCapturer", () => {
	let stub: ReturnType<typeof stubCanvasContext>;

	beforeEach(() => {
		stub = stubCanvasContext();
	});
	afterEach(() => {
		stub.restore();
	});

	it("propagates width/height to the internal canvas and metadata", () => {
		const cap = createCanvasFrameCapturer({ width: 320, height: 240 });
		expect(cap.width).toBe(320);
		expect(cap.height).toBe(240);
		expect(cap.canvas.width).toBe(320);
		expect(cap.canvas.height).toBe(240);
	});

	it("rejects non-positive dimensions", () => {
		expect(() => createCanvasFrameCapturer({ width: 0, height: 10 })).toThrow(
			/positive finite/,
		);
		expect(() => createCanvasFrameCapturer({ width: 10, height: -1 })).toThrow(
			/positive finite/,
		);
		expect(() =>
			createCanvasFrameCapturer({ width: Number.NaN, height: 10 }),
		).toThrow(/positive finite/);
	});

	it("requests a 2D context with willReadFrequently", () => {
		createCanvasFrameCapturer({ width: 64, height: 64 });
		expect(stub.getContext).toHaveBeenCalledWith("2d", {
			willReadFrequently: true,
		});
	});

	it("reuses the same canvas + ctx across repeat capture() calls", () => {
		const cap = createCanvasFrameCapturer({ width: 64, height: 64 });
		const before = stub.getContext.mock.calls.length;

		const sourceCanvas = document.createElement("canvas");
		const img1 = cap.capture(sourceCanvas);
		const img2 = cap.capture(sourceCanvas);

		expect(stub.getContext.mock.calls.length).toBe(before);
		expect(stub.context.drawImage).toHaveBeenCalledTimes(2);
		expect(stub.context.getImageData).toHaveBeenCalledTimes(2);
		expect(img1.width).toBe(64);
		expect(img2.width).toBe(64);
	});

	it("throws when 2D context cannot be acquired", () => {
		stub.getContext.mockReturnValueOnce(null);
		expect(() => createCanvasFrameCapturer({ width: 64, height: 64 })).toThrow(
			/2D rendering context/,
		);
	});
});
