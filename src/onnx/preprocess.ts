import type { PreprocessOptions } from "./types";

const DEFAULT_INPUT_SIZE = 640;

const bufferCache = new Map<number, Float32Array>();

export function createPreprocessBuffer(
	inputSize: number = DEFAULT_INPUT_SIZE,
): Float32Array {
	return new Float32Array(3 * inputSize * inputSize);
}

function getOrCreateCachedBuffer(inputSize: number): Float32Array {
	let buf = bufferCache.get(inputSize);
	if (!buf) {
		buf = createPreprocessBuffer(inputSize);
		bufferCache.set(inputSize, buf);
	}
	return buf;
}

export function rgbaToFloat32Chw(
	imageData: ImageData,
	options: PreprocessOptions = {},
): Float32Array {
	const inputSize = options.inputSize ?? DEFAULT_INPUT_SIZE;
	const channelSize = inputSize * inputSize;
	const required = 3 * channelSize;

	const buffer = options.buffer ?? getOrCreateCachedBuffer(inputSize);
	if (buffer.length !== required) {
		throw new Error(
			`rgbaToFloat32Chw: buffer length ${buffer.length} does not match expected ${required} for inputSize=${inputSize}`,
		);
	}

	const { data } = imageData;
	for (let i = 0; i < channelSize; i++) {
		const rgbaIdx = i * 4;
		buffer[i] = (data[rgbaIdx] as number) / 255;
		buffer[channelSize + i] = (data[rgbaIdx + 1] as number) / 255;
		buffer[2 * channelSize + i] = (data[rgbaIdx + 2] as number) / 255;
	}

	return buffer;
}
