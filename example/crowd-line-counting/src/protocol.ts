import type {
	Line,
	Point,
} from "@pj-hoakari/web-crowd-detection-utils/line-crossing";

/**
 * Message protocol shared by the main thread (`App.tsx`) and the detection
 * worker (`worker.ts`).
 *
 * The worker owns the heavy pipeline (model load, YOLO inference, ByteTrack,
 * background suppression, line counting) **and** the overlay rendering, drawing
 * onto an `OffscreenCanvas` transferred from the main thread. The main thread
 * only feeds frames (`ImageBitmap`s), forwards UI state, and reflects stats.
 */

/** Stable id for the single counting line this example manages. */
export const LINE_ID = "line";

/** Live, per-frame readable toggles owned by the UI. */
export interface PipelineConfig {
	/** Attenuate + drop detections in static regions via `BackgroundSubtractor`. */
	suppressStatic: boolean;
	/** Enable `LineCrossingCounter`'s rescue / cooldown ID-churn assist. */
	crossingAssist: boolean;
}

/** A line being drawn but not yet committed. */
export interface Draft {
	p1: Point;
	p2: Point;
}

/** Per-frame counters surfaced to the UI. */
export interface PipelineStats {
	/** Tracks present this frame. */
	current: number;
	/** Distinct track ids seen since the run started. */
	unique: number;
	/** Crossings of the line toward its positive (`p1`→`p2`) side. */
	forward: number;
	/** Crossings of the line toward its negative side. */
	backward: number;
}

/** Messages the main thread sends to the worker. */
export type MainToWorker =
	/** Hand the worker the `OffscreenCanvas` it will render into (transferred). */
	| { type: "init"; canvas: OffscreenCanvas }
	/** Fetch the model and build the detector (idempotent; replies `ready`). */
	| { type: "loadModel"; modelUrl: string }
	/** Resize the offscreen backing store to the source video dimensions. */
	| { type: "resize"; width: number; height: number }
	/** Begin a run: reset the stateful pipeline and start accepting frames. */
	| { type: "start" }
	/** A captured frame to process (transferred; the worker closes it). */
	| { type: "frame"; bitmap: ImageBitmap }
	/** End the run: stop processing and repaint the idle overlay. */
	| { type: "stop" }
	| { type: "setLine"; line: Line | null }
	| { type: "setDraft"; draft: Draft | null }
	| { type: "setConfig"; config: PipelineConfig }
	| { type: "resetCounts" }
	| { type: "clearPositions" };

/** Messages the worker sends back to the main thread. */
export type WorkerToMain =
	| { type: "status"; message: string }
	| { type: "ready"; backend: string }
	| { type: "stats"; stats: PipelineStats }
	| { type: "error"; message: string };
