import type * as ort from "onnxruntime-web";
import type { ExecutionProvider, InitSessionOptions } from "@/onnx/types";

/**
 * A single object detection produced by the YOLO postprocess pipeline.
 *
 * Coordinates are in **model input space** (i.e. `0..inputSize` in both axes).
 * To map a `Detection` back to original source-image space, use
 * `reverseLetterboxBox` (for letterboxed captures) or `reverseStretchBox`
 * (for stretched captures) from the `source` subpath.
 *
 * The `score` field name (rather than `confidence`) aligns with the
 * `Observation` contract consumed by the `bytetrack` tracker, so detections
 * from this module can be fed directly into ByteTrack without remapping.
 */
export interface Detection {
	/** Left edge of the bounding box, in model input pixels. */
	x1: number;
	/** Top edge of the bounding box, in model input pixels. */
	y1: number;
	/** Right edge of the bounding box, in model input pixels. */
	x2: number;
	/** Bottom edge of the bounding box, in model input pixels. */
	y2: number;
	/** Confidence score in `[0, 1]`. */
	score: number;
	/** Integer class index, model-dependent (e.g. COCO: `0` = person). */
	classId: number;
}

/**
 * Tensor layout of the YOLO output, used to select the correct decoder.
 *
 * - `"end-to-end"` — `[1, N, 6]` or `[N, 6]`. NMS has already been applied;
 *   each row is `[x1, y1, x2, y2, score, classId]`. Zero-filled rows are
 *   treated as padding and skipped.
 * - `"end-to-end-transposed"` — `[1, 6, N]`. Same semantics as `"end-to-end"`
 *   but the box and attribute axes are swapped; the decoder transposes
 *   before decoding.
 * - `"standard"` — `[1, attrs, N]`. Raw model output prior to NMS. `attrs` is
 *   `4 + numClasses` (cx, cy, w, h followed by per-class scores). The decoder
 *   converts xywh → xyxy, picks the argmax class, applies confidence and
 *   class filtering, and runs NMS internally. Class scores may be raw logits
 *   or already-sigmoided probabilities; the decoder auto-detects by sampling.
 * - `"standard-transposed"` — `[1, N, attrs]`. Same as `"standard"` with axes
 *   swapped; transposed before decoding.
 * - `"auto"` — Inspect tensor shape at runtime and dispatch to the best-fit
 *   format. Logs the chosen format once per page lifetime via `console.log`.
 */
export type OutputFormat =
	| "end-to-end"
	| "end-to-end-transposed"
	| "standard"
	| "standard-transposed"
	| "auto";

/**
 * Selects which classIds are kept after decoding. Either an explicit allow-list
 * of class indices, or `"all"` to keep every class.
 */
export type ClassFilter = readonly number[] | "all";

/**
 * Options for {@link postprocess}.
 */
export interface PostprocessOptions {
	/** Output tensor layout. Defaults to `"end-to-end"`. */
	format?: OutputFormat;
	/** Minimum score to keep a detection. Defaults to `0.15`. */
	confThreshold?: number;
	/**
	 * IoU threshold for greedy NMS. Only consulted when the format requires
	 * internal NMS (`"standard"` / `"standard-transposed"`). Defaults to `0.45`.
	 */
	iouThreshold?: number;
	/** Maximum number of detections to return. Defaults to `30`. */
	maxDetections?: number;
	/**
	 * Class filter. Defaults to `[0]` — the COCO person class, suitable for
	 * crowd-detection workflows. Pass `"all"` to disable filtering.
	 */
	classFilter?: ClassFilter;
}

/**
 * Options for {@link nms}.
 */
export interface NmsOptions {
	/** IoU threshold above which a lower-scoring box is suppressed. Defaults to `0.45`. */
	iouThreshold?: number;
	/** Maximum number of detections to keep. Defaults to `30`. */
	maxDetections?: number;
}

/**
 * Options for {@link createYoloDetector}.
 */
export interface YoloDetectorOptions {
	/** Path to the ONNX model file, or raw model bytes. Forwarded to `initSession`. */
	modelPath: string | ArrayBufferLike | Uint8Array;
	/** Execution provider to use. No automatic fallback is performed. */
	executionProvider: ExecutionProvider;
	/** Square edge length of the model input. Defaults to `640`. */
	inputSize?: number;
	/** Postprocess options. See {@link PostprocessOptions} for defaults. */
	postprocess?: PostprocessOptions;
	/**
	 * Additional `initSession` options (graph optimization level, raw session
	 * options). `executionProvider` is taken from the top-level field and
	 * cannot be set here.
	 */
	session?: Omit<InitSessionOptions, "executionProvider">;
	/**
	 * Caller-owned preprocess buffer reused across every `detect()` call. Must
	 * have length `3 * inputSize * inputSize`. When omitted, the detector
	 * allocates one buffer internally and reuses it.
	 *
	 * Provide this when you want to share a single buffer between multiple
	 * detectors or with other preprocessing code, or to make the allocation
	 * explicit at the call site.
	 */
	preprocessBuffer?: Float32Array;
}

/**
 * A configured YOLO detector returned by {@link createYoloDetector}.
 *
 * Each `detect()` call preprocesses the given frame, runs inference, and
 * returns decoded detections in model input space.
 */
export interface YoloDetector {
	/**
	 * Runs preprocess → inference → postprocess on a single frame.
	 *
	 * @param imageData - An `ImageData` whose dimensions match `inputSize × inputSize`.
	 * @returns Detections in model input-space coordinates. Use the `source`
	 *   subpath's reverse-transform helpers to map back to original source space.
	 */
	detect(imageData: ImageData): Promise<Detection[]>;
	/** The execution provider the underlying session was created with. */
	readonly backend: ExecutionProvider;
	/** The square edge length the detector was configured for. */
	readonly inputSize: number;
	/** The underlying ONNX Runtime session. Exposed for advanced use cases. */
	readonly session: ort.InferenceSession;
}
