import type * as ort from "onnxruntime-web";
import type { ExecutionProvider, InitSessionOptions } from "@/onnx/types";

// Detection emitted by the YOLO postprocess pipeline.
// `score` (renamed from sandbox's `confidence`) aligns with the bytetrack
// Observation contract documented in CLAUDE.md.
export interface Detection {
	x1: number;
	y1: number;
	x2: number;
	y2: number;
	score: number;
	classId: number;
}

export type OutputFormat =
	| "end-to-end"
	| "end-to-end-transposed"
	| "standard"
	| "standard-transposed"
	| "auto";

export type ClassFilter = readonly number[] | "all";

export interface PostprocessOptions {
	format?: OutputFormat;
	confThreshold?: number;
	iouThreshold?: number;
	maxDetections?: number;
	classFilter?: ClassFilter;
}

export interface NmsOptions {
	iouThreshold?: number;
	maxDetections?: number;
}

export interface YoloDetectorOptions {
	modelPath: string | ArrayBufferLike | Uint8Array;
	executionProvider: ExecutionProvider;
	inputSize?: number;
	postprocess?: PostprocessOptions;
	session?: Omit<InitSessionOptions, "executionProvider">;
	preprocessBuffer?: Float32Array;
}

export interface YoloDetector {
	detect(imageData: ImageData): Promise<Detection[]>;
	readonly backend: ExecutionProvider;
	readonly inputSize: number;
	readonly session: ort.InferenceSession;
}

export type CaptureSource = CanvasImageSource;

export interface CanvasFrameCapturerOptions {
	width: number;
	height: number;
}

export interface CanvasFrameCapturer {
	capture(source: CaptureSource): ImageData;
	readonly width: number;
	readonly height: number;
	readonly canvas: HTMLCanvasElement;
}
