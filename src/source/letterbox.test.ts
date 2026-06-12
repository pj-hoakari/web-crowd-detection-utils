import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	computeLetterboxParams,
	createLetterboxCapturer,
	reverseLetterboxBox,
	reverseLetterboxBoxes,
	reverseStretchBox,
} from "./letterbox";

function stubCanvasContext(): {
	context: {
		drawImage: ReturnType<typeof vi.fn>;
		getImageData: ReturnType<typeof vi.fn>;
		fillRect: ReturnType<typeof vi.fn>;
		fillStyle: string;
	};
	getContext: ReturnType<typeof vi.fn>;
	restore: () => void;
} {
	const context = {
		fillStyle: "",
		drawImage: vi.fn(),
		fillRect: vi.fn(),
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

describe("computeLetterboxParams", () => {
	it("landscape 1280x720 → 640: pads top/bottom", () => {
		const p = computeLetterboxParams(1280, 720, 640);
		expect(p.scale).toBe(0.5);
		expect(p.contentWidth).toBe(640);
		expect(p.contentHeight).toBe(360);
		expect(p.padX).toBe(0);
		expect(p.padY).toBe(140);
		expect(p.inputSize).toBe(640);
		expect(p.sourceWidth).toBe(1280);
		expect(p.sourceHeight).toBe(720);
	});

	it("portrait 720x1280 → 640: pads left/right", () => {
		const p = computeLetterboxParams(720, 1280, 640);
		expect(p.scale).toBe(0.5);
		expect(p.contentWidth).toBe(360);
		expect(p.contentHeight).toBe(640);
		expect(p.padX).toBe(140);
		expect(p.padY).toBe(0);
	});

	it("square 640x640 → 640: no padding", () => {
		const p = computeLetterboxParams(640, 640, 640);
		expect(p.scale).toBe(1);
		expect(p.contentWidth).toBe(640);
		expect(p.contentHeight).toBe(640);
		expect(p.padX).toBe(0);
		expect(p.padY).toBe(0);
	});

	it("works at arbitrary inputSize=320", () => {
		const p = computeLetterboxParams(1280, 720, 320);
		expect(p.scale).toBe(0.25);
		expect(p.contentWidth).toBe(320);
		expect(p.contentHeight).toBe(180);
		expect(p.padX).toBe(0);
		expect(p.padY).toBe(70);
	});

	it("rejects non-positive sourceWidth/sourceHeight", () => {
		expect(() => computeLetterboxParams(0, 100, 640)).toThrow(/positive/);
		expect(() => computeLetterboxParams(100, -1, 640)).toThrow(/positive/);
		expect(() => computeLetterboxParams(Number.NaN, 100, 640)).toThrow(
			/positive/,
		);
	});

	it("rejects non-positive inputSize", () => {
		expect(() => computeLetterboxParams(1280, 720, 0)).toThrow(/positive/);
		expect(() => computeLetterboxParams(1280, 720, -1)).toThrow(/positive/);
	});
});

describe("reverseLetterboxBox", () => {
	const cases: Array<{ srcW: number; srcH: number; inputSize: number }> = [
		{ srcW: 1280, srcH: 720, inputSize: 640 },
		{ srcW: 720, srcH: 1280, inputSize: 640 },
		{ srcW: 640, srcH: 640, inputSize: 640 },
		{ srcW: 1920, srcH: 1080, inputSize: 320 },
		{ srcW: 800, srcH: 600, inputSize: 512 },
	];

	for (const { srcW, srcH, inputSize } of cases) {
		it(`round-trips box for ${srcW}x${srcH} → ${inputSize}`, () => {
			const params = computeLetterboxParams(srcW, srcH, inputSize);

			// Forward: original-image coords → model-space coords
			const original = { x1: 100, y1: 50, x2: 400, y2: 300 };
			const inModel = {
				x1: original.x1 * params.scale + params.padX,
				y1: original.y1 * params.scale + params.padY,
				x2: original.x2 * params.scale + params.padX,
				y2: original.y2 * params.scale + params.padY,
			};

			const back = reverseLetterboxBox(inModel, params);
			expect(back.x1).toBeCloseTo(original.x1, 6);
			expect(back.y1).toBeCloseTo(original.y1, 6);
			expect(back.x2).toBeCloseTo(original.x2, 6);
			expect(back.y2).toBeCloseTo(original.y2, 6);
		});
	}

	it("preserves additional fields (e.g. Detection's score/classId)", () => {
		const params = computeLetterboxParams(1280, 720, 640);
		const det = {
			x1: 0,
			y1: 140,
			x2: 640,
			y2: 500,
			score: 0.82,
			classId: 0,
		};
		const back = reverseLetterboxBox(det, params);
		expect(back.score).toBe(0.82);
		expect(back.classId).toBe(0);
		// Full-frame box in model space → full-frame in original (1280×720)
		expect(back.x1).toBeCloseTo(0);
		expect(back.y1).toBeCloseTo(0);
		expect(back.x2).toBeCloseTo(1280);
		expect(back.y2).toBeCloseTo(720);
	});
});

describe("reverseLetterboxBoxes", () => {
	it("preserves length and order", () => {
		const params = computeLetterboxParams(1280, 720, 640);
		const boxes = [
			{ x1: 0, y1: 140, x2: 320, y2: 320 },
			{ x1: 320, y1: 140, x2: 640, y2: 500 },
			{ x1: 100, y1: 200, x2: 200, y2: 400 },
		];
		const back = reverseLetterboxBoxes(boxes, params);
		expect(back.length).toBe(boxes.length);
		expect(back[0]?.x1).toBeCloseTo(0);
		expect(back[1]?.x1).toBeCloseTo(640);
		expect(back[2]?.x1).toBeCloseTo(200);
	});
});

describe("reverseStretchBox", () => {
	it("round-trips stretch transform", () => {
		const srcW = 1280;
		const srcH = 720;
		const inputSize = 640;
		const original = { x1: 100, y1: 50, x2: 400, y2: 300 };
		const stretched = {
			x1: original.x1 * (inputSize / srcW),
			y1: original.y1 * (inputSize / srcH),
			x2: original.x2 * (inputSize / srcW),
			y2: original.y2 * (inputSize / srcH),
		};
		const back = reverseStretchBox(stretched, srcW, srcH, inputSize);
		expect(back.x1).toBeCloseTo(original.x1);
		expect(back.y1).toBeCloseTo(original.y1);
		expect(back.x2).toBeCloseTo(original.x2);
		expect(back.y2).toBeCloseTo(original.y2);
	});

	it("maps full model-space box to full source rectangle", () => {
		const back = reverseStretchBox(
			{ x1: 0, y1: 0, x2: 640, y2: 640 },
			1280,
			720,
			640,
		);
		expect(back.x1).toBe(0);
		expect(back.y1).toBe(0);
		expect(back.x2).toBe(1280);
		expect(back.y2).toBe(720);
	});
});

describe("createLetterboxCapturer", () => {
	let stub: ReturnType<typeof stubCanvasContext>;

	beforeEach(() => {
		stub = stubCanvasContext();
	});
	afterEach(() => {
		stub.restore();
	});

	it("propagates inputSize to canvas", () => {
		const cap = createLetterboxCapturer({ inputSize: 320 });
		expect(cap.inputSize).toBe(320);
		expect(cap.canvas.width).toBe(320);
		expect(cap.canvas.height).toBe(320);
	});

	it("rejects non-positive inputSize", () => {
		expect(() => createLetterboxCapturer({ inputSize: 0 })).toThrow(
			/positive finite/,
		);
		expect(() => createLetterboxCapturer({ inputSize: -1 })).toThrow(
			/positive finite/,
		);
		expect(() => createLetterboxCapturer({ inputSize: Number.NaN })).toThrow(
			/positive finite/,
		);
	});

	it("requests a 2D context with willReadFrequently", () => {
		createLetterboxCapturer({ inputSize: 640 });
		expect(stub.getContext).toHaveBeenCalledWith("2d", {
			willReadFrequently: true,
		});
	});

	it("draws padding then content using letterbox params", () => {
		const cap = createLetterboxCapturer({ inputSize: 640 });
		const source = document.createElement("canvas");
		source.width = 1280;
		source.height = 720;

		const { imageData, params } = cap.capture(source);

		expect(stub.context.fillRect).toHaveBeenCalledWith(0, 0, 640, 640);
		expect(stub.context.drawImage).toHaveBeenCalledWith(
			source,
			0,
			140,
			640,
			360,
		);
		expect(imageData.width).toBe(640);
		expect(imageData.height).toBe(640);
		expect(params.scale).toBe(0.5);
		expect(params.padY).toBe(140);
	});

	it("uses custom padColor when provided", () => {
		const cap = createLetterboxCapturer({
			inputSize: 64,
			padColor: "rgb(0,0,0)",
		});
		const source = document.createElement("canvas");
		source.width = 32;
		source.height = 16;
		cap.capture(source);
		expect(stub.context.fillStyle).toBe("rgb(0,0,0)");
	});

	it("throws when source has zero/missing dimensions", () => {
		const cap = createLetterboxCapturer({ inputSize: 640 });
		const source = document.createElement("canvas");
		source.width = 0;
		source.height = 0;
		expect(() => cap.capture(source)).toThrow(/positive finite/);
	});

	it("throws when 2D context cannot be acquired", () => {
		stub.getContext.mockReturnValueOnce(null);
		expect(() => createLetterboxCapturer({ inputSize: 640 })).toThrow(
			/2D rendering context/,
		);
	});

	it("uses an OffscreenCanvas when available (worker-compatible)", () => {
		// Simulate a Web Worker: OffscreenCanvas present (it is absent in the
		// happy-dom test env by default), preferred over the DOM canvas.
		const ctx = {
			fillStyle: "",
			drawImage: vi.fn(),
			fillRect: vi.fn(),
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
		try {
			const cap = createLetterboxCapturer({ inputSize: 320 });

			expect(cap.canvas).toBeInstanceOf(MockOffscreenCanvas);
			expect(cap.canvas.width).toBe(320);
			expect(getContext).toHaveBeenCalledWith("2d", {
				willReadFrequently: true,
			});

			const source = {
				width: 640,
				height: 480,
			} as unknown as CanvasImageSource;
			const { imageData, params } = cap.capture(source);

			expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, 320, 320);
			expect(ctx.drawImage).toHaveBeenCalledWith(source, 0, 40, 320, 240);
			expect(imageData.width).toBe(320);
			expect(params.scale).toBe(0.5);
			expect(params.padY).toBe(40);
		} finally {
			vi.unstubAllGlobals();
		}
	});
});
