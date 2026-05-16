import { describe, expect, it } from "vitest";
import {
	createPreprocessBuffer,
	createPreprocessor,
	rgbaToFloat32Chw,
} from "./preprocess";

function makeImageData(size: number, fill: number): ImageData {
	const data = new Uint8ClampedArray(size * size * 4);
	for (let i = 0; i < size * size; i++) {
		data[i * 4] = fill;
		data[i * 4 + 1] = fill;
		data[i * 4 + 2] = fill;
		data[i * 4 + 3] = 255;
	}
	return { data, width: size, height: size, colorSpace: "srgb" } as ImageData;
}

describe("createPreprocessBuffer", () => {
	it("allocates a Float32Array of length 3 * inputSize * inputSize", () => {
		const buffer = createPreprocessBuffer(320);
		expect(buffer).toBeInstanceOf(Float32Array);
		expect(buffer.length).toBe(3 * 320 * 320);
	});

	it("defaults inputSize to 640", () => {
		const buffer = createPreprocessBuffer();
		expect(buffer.length).toBe(3 * 640 * 640);
	});
});

describe("rgbaToFloat32Chw", () => {
	it("scales pixel values to [0, 1] in CHW order", () => {
		const img = makeImageData(2, 255);
		const buffer = rgbaToFloat32Chw(img, { inputSize: 2 });
		expect(buffer.length).toBe(3 * 2 * 2);
		for (let i = 0; i < buffer.length; i++) {
			expect(buffer[i]).toBeCloseTo(1);
		}
	});

	it("returns a freshly allocated buffer when options.buffer is omitted (no shared state)", () => {
		const imgA = makeImageData(2, 100);
		const imgB = makeImageData(2, 200);
		const featureA = rgbaToFloat32Chw(imgA, { inputSize: 2 });
		const featureB = rgbaToFloat32Chw(imgB, { inputSize: 2 });

		expect(featureA).not.toBe(featureB);
		expect(featureA[0]).toBeCloseTo(100 / 255);
		expect(featureB[0]).toBeCloseTo(200 / 255);
	});

	it("writes into and returns the caller-provided buffer", () => {
		const img = makeImageData(2, 128);
		const buffer = createPreprocessBuffer(2);
		const result = rgbaToFloat32Chw(img, { inputSize: 2, buffer });
		expect(result).toBe(buffer);
		expect(result[0]).toBeCloseTo(128 / 255);
	});

	it("throws when caller-provided buffer length does not match inputSize", () => {
		const img = makeImageData(2, 0);
		const wrongBuffer = new Float32Array(3 * 4 * 4);
		expect(() =>
			rgbaToFloat32Chw(img, { inputSize: 2, buffer: wrongBuffer }),
		).toThrow(/buffer length/);
	});

	it("places channels in R-then-G-then-B order", () => {
		const size = 2;
		const data = new Uint8ClampedArray(size * size * 4);
		for (let i = 0; i < size * size; i++) {
			data[i * 4] = 10;
			data[i * 4 + 1] = 20;
			data[i * 4 + 2] = 30;
			data[i * 4 + 3] = 255;
		}
		const img = {
			data,
			width: size,
			height: size,
			colorSpace: "srgb",
		} as ImageData;
		const buffer = rgbaToFloat32Chw(img, { inputSize: size });
		const channelSize = size * size;
		expect(buffer[0]).toBeCloseTo(10 / 255);
		expect(buffer[channelSize]).toBeCloseTo(20 / 255);
		expect(buffer[2 * channelSize]).toBeCloseTo(30 / 255);
	});
});

describe("createPreprocessor", () => {
	it("owns a single reusable buffer of the expected size", () => {
		const pre = createPreprocessor(2);
		expect(pre.inputSize).toBe(2);
		expect(pre.buffer).toBeInstanceOf(Float32Array);
		expect(pre.buffer.length).toBe(3 * 2 * 2);
	});

	it("returns the same buffer instance across process() calls", () => {
		const pre = createPreprocessor(2);
		const a = pre.process(makeImageData(2, 100));
		const b = pre.process(makeImageData(2, 200));
		expect(a).toBe(b);
		expect(a).toBe(pre.buffer);
	});

	it("does not share state between instances", () => {
		const preA = createPreprocessor(2);
		const preB = createPreprocessor(2);
		const featureA = preA.process(makeImageData(2, 100));
		const featureB = preB.process(makeImageData(2, 200));

		expect(preA.buffer).not.toBe(preB.buffer);
		expect(featureA[0]).toBeCloseTo(100 / 255);
		expect(featureB[0]).toBeCloseTo(200 / 255);
	});

	it("defaults inputSize to 640", () => {
		const pre = createPreprocessor();
		expect(pre.inputSize).toBe(640);
		expect(pre.buffer.length).toBe(3 * 640 * 640);
	});
});
