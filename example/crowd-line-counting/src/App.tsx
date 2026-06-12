import type {
	Line,
	Point,
} from "@pj-hoakari/web-crowd-detection-utils/line-crossing";
import { useCallback, useEffect, useRef, useState } from "react";
import "./App.css";
import { BACKWARD_COLOR, clientToCanvas, FORWARD_COLOR } from "./overlay";
import {
	type Draft,
	LINE_ID,
	type MainToWorker,
	type PipelineStats,
	type WorkerToMain,
} from "./protocol";

const MODEL_URL = `${import.meta.env.BASE_URL}models/yolo26n.onnx`;

type Phase = "idle" | "preparing" | "running" | "finished" | "error";

const ZERO_STATS: PipelineStats = {
	current: 0,
	unique: 0,
	forward: 0,
	backward: 0,
};

function App() {
	const videoRef = useRef<HTMLVideoElement>(null);
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const workerRef = useRef<Worker | null>(null);
	const rafIdRef = useRef<number | null>(null);
	// Frame-loop is active; worker is busy with a frame; ended-listener handle.
	const loopActiveRef = useRef(false);
	const pendingRef = useRef(false);
	const endedRef = useRef<(() => void) | null>(null);
	// Model is loaded once (the worker is long-lived) + pending load promise.
	const modelLoadedRef = useRef(false);
	const modelReadyRef = useRef<{
		resolve: () => void;
		reject: (e: Error) => void;
	} | null>(null);

	const [videoFile, setVideoFile] = useState<File | null>(null);
	const [videoUrl, setVideoUrl] = useState<string | null>(null);
	const [phase, setPhase] = useState<Phase>("idle");
	const [status, setStatus] = useState(
		"Place your YOLO ONNX model at public/models/yolo26n.onnx, choose a video file, then press Start.",
	);
	const [stats, setStats] = useState<PipelineStats>(ZERO_STATS);

	const [line, setLine] = useState<Line | null>(null);
	const [draft, setDraft] = useState<Draft | null>(null);
	const [drawMode, setDrawMode] = useState(false);
	const [suppressStatic, setSuppressStatic] = useState(true);
	const [crossingAssist, setCrossingAssist] = useState(true);

	const running = phase === "running" || phase === "preparing";

	const post = useCallback(
		(msg: MainToWorker, transfer: Transferable[] = []) => {
			workerRef.current?.postMessage(msg, transfer);
		},
		[],
	);

	// Create the worker once and hand it control of the overlay canvas. The
	// canvas can only be transferred once for its lifetime, so this is guarded
	// against React StrictMode's deliberate double-invoke. The worker lives for
	// the page (App is the root component), so it is intentionally not terminated.
	useEffect(() => {
		if (workerRef.current) {
			return;
		}
		const canvas = canvasRef.current;
		if (!canvas) {
			return;
		}
		const worker = new Worker(new URL("./worker.ts", import.meta.url), {
			type: "module",
		});
		workerRef.current = worker;
		worker.onmessage = (ev: MessageEvent<WorkerToMain>) => {
			const msg = ev.data;
			switch (msg.type) {
				case "status":
					setStatus(msg.message);
					break;
				case "ready":
					modelReadyRef.current?.resolve();
					modelReadyRef.current = null;
					setStatus(`Running (backend: ${msg.backend})`);
					break;
				case "stats":
					pendingRef.current = false;
					setStats(msg.stats);
					break;
				case "error":
					pendingRef.current = false;
					if (modelReadyRef.current) {
						// Failure during model load: reject so handleStart's catch reports it.
						modelReadyRef.current.reject(new Error(msg.message));
						modelReadyRef.current = null;
					} else {
						// Failure mid-run: halt the frame loop (refs only, no stale deps).
						loopActiveRef.current = false;
						if (rafIdRef.current !== null) {
							cancelAnimationFrame(rafIdRef.current);
							rafIdRef.current = null;
						}
						setPhase("error");
						setStatus(`Error: ${msg.message}`);
					}
					break;
			}
		};
		const offscreen = canvas.transferControlToOffscreen();
		worker.postMessage(
			{ type: "init", canvas: offscreen } satisfies MainToWorker,
			[offscreen],
		);
	}, []);

	useEffect(() => {
		if (!videoFile) {
			setVideoUrl(null);
			return;
		}
		const url = URL.createObjectURL(videoFile);
		setVideoUrl(url);
		return () => {
			URL.revokeObjectURL(url);
		};
	}, [videoFile]);

	// Forward UI state to the worker. While idle the worker repaints on each of
	// these so the overlay tracks the line/draft the user is setting up.
	useEffect(() => {
		post({ type: "setLine", line });
	}, [line, post]);
	useEffect(() => {
		post({ type: "setDraft", draft });
	}, [draft, post]);
	useEffect(() => {
		post({ type: "setConfig", config: { suppressStatic, crossingAssist } });
	}, [suppressStatic, crossingAssist, post]);

	const stopFrameLoop = useCallback(() => {
		loopActiveRef.current = false;
		if (rafIdRef.current !== null) {
			cancelAnimationFrame(rafIdRef.current);
			rafIdRef.current = null;
		}
		pendingRef.current = false;
	}, []);

	const detachEnded = useCallback(() => {
		const video = videoRef.current;
		if (video && endedRef.current) {
			video.removeEventListener("ended", endedRef.current);
		}
		endedRef.current = null;
	}, []);

	const stopRun = useCallback(() => {
		stopFrameLoop();
		detachEnded();
		post({ type: "stop" });
		videoRef.current?.pause();
	}, [stopFrameLoop, detachEnded, post]);

	// Stop the loop on unmount (the worker itself is left running, see above).
	useEffect(() => stopFrameLoop, [stopFrameLoop]);

	const startFrameLoop = useCallback(() => {
		const worker = workerRef.current;
		if (!worker) {
			return;
		}
		loopActiveRef.current = true;
		pendingRef.current = false;
		const tick = () => {
			if (!loopActiveRef.current) {
				return;
			}
			const video = videoRef.current;
			if (
				video &&
				video.readyState >= video.HAVE_CURRENT_DATA &&
				!pendingRef.current
			) {
				// Grab a transferable snapshot and hand it to the worker. Drop frames
				// while it is busy (pendingRef) so the queue can't grow unbounded.
				pendingRef.current = true;
				createImageBitmap(video)
					.then((bitmap) => {
						if (!loopActiveRef.current) {
							bitmap.close();
							pendingRef.current = false;
							return;
						}
						worker.postMessage(
							{ type: "frame", bitmap } satisfies MainToWorker,
							[bitmap],
						);
					})
					.catch(() => {
						pendingRef.current = false;
					});
			}
			rafIdRef.current = requestAnimationFrame(tick);
		};
		rafIdRef.current = requestAnimationFrame(tick);
	}, []);

	const ensureModel = useCallback(() => {
		if (modelLoadedRef.current) {
			return Promise.resolve();
		}
		return new Promise<void>((resolve, reject) => {
			modelReadyRef.current = { resolve, reject };
			post({
				type: "loadModel",
				modelUrl: new URL(MODEL_URL, window.location.href).href,
			});
		}).then(() => {
			modelLoadedRef.current = true;
		});
	}, [post]);

	const handleLoadedMetadata = useCallback(() => {
		const video = videoRef.current;
		if (!video) {
			return;
		}
		const w = video.videoWidth;
		const h = video.videoHeight;
		// Size the offscreen overlay to the source, then seed a default vertical
		// line at the horizontal center so the example counts out of the box.
		if (w > 0 && h > 0) {
			post({ type: "resize", width: w, height: h });
			setLine({
				id: LINE_ID,
				p1: { x: Math.round(w / 2), y: 0 },
				p2: { x: Math.round(w / 2), y: h },
			});
		}
	}, [post]);

	const handleFileChange = useCallback(
		(e: React.ChangeEvent<HTMLInputElement>) => {
			const file = e.target.files?.[0] ?? null;
			stopRun();
			setVideoFile(file);
			setPhase("idle");
			setStats(ZERO_STATS);
			setLine(null);
			setDraft(null);
			setDrawMode(false);
			setStatus(
				file
					? `Selected: ${file.name}. Draw a line (or use the default), then press Start.`
					: "No file selected.",
			);
		},
		[stopRun],
	);

	const commitLine = useCallback(
		(p1: Point, p2: Point) => {
			// Ignore a degenerate (zero-length) line from a double-click in place.
			if (p1.x === p2.x && p1.y === p2.y) {
				return;
			}
			setLine({ id: LINE_ID, p1, p2 });
			setDraft(null);
			setDrawMode(false);
			// A redrawn line is a fresh measurement: zero the tally (live + display).
			post({ type: "resetCounts" });
			setStats((s) => ({ ...s, forward: 0, backward: 0 }));
		},
		[post],
	);

	const handlePointerDown = useCallback(
		(e: React.PointerEvent<HTMLCanvasElement>) => {
			if (!drawMode) {
				return;
			}
			const canvas = canvasRef.current;
			const video = videoRef.current;
			if (!canvas || !video || video.videoWidth === 0) {
				return;
			}
			const p = clientToCanvas(
				canvas,
				e.clientX,
				e.clientY,
				video.videoWidth,
				video.videoHeight,
			);
			if (!draft) {
				setDraft({ p1: p, p2: p });
			} else {
				commitLine(draft.p1, p);
			}
		},
		[drawMode, draft, commitLine],
	);

	const handlePointerMove = useCallback(
		(e: React.PointerEvent<HTMLCanvasElement>) => {
			if (!drawMode || !draft) {
				return;
			}
			const canvas = canvasRef.current;
			const video = videoRef.current;
			if (!canvas || !video || video.videoWidth === 0) {
				return;
			}
			const p = clientToCanvas(
				canvas,
				e.clientX,
				e.clientY,
				video.videoWidth,
				video.videoHeight,
			);
			setDraft((d) => (d ? { p1: d.p1, p2: p } : d));
		},
		[drawMode, draft],
	);

	const handleToggleDraw = useCallback(() => {
		setDrawMode((on) => {
			if (on) {
				setDraft(null);
				return false;
			}
			return true;
		});
	}, []);

	const handleResetCounts = useCallback(() => {
		post({ type: "resetCounts" });
		setStats((s) => ({ ...s, forward: 0, backward: 0 }));
	}, [post]);

	const handleClearLine = useCallback(() => {
		setLine(null);
		setDraft(null);
		setDrawMode(false);
		post({ type: "clearPositions" });
		setStats((s) => ({ ...s, forward: 0, backward: 0 }));
	}, [post]);

	const handleStart = useCallback(async () => {
		const video = videoRef.current;
		if (!video || !workerRef.current) {
			return;
		}
		if (!videoFile) {
			setPhase("error");
			setStatus("Error: choose a video file first.");
			return;
		}
		setPhase("preparing");
		setStatus("Loading model…");
		setStats(ZERO_STATS);

		const onEnded = () => {
			stopFrameLoop();
			detachEnded();
			post({ type: "stop" });
			setPhase("finished");
			setStatus("Finished.");
		};
		endedRef.current = onEnded;
		video.addEventListener("ended", onEnded);

		try {
			await ensureModel();

			setStatus("Starting playback…");
			video.currentTime = 0;
			await video.play();

			post({ type: "start" });
			setPhase("running");
			startFrameLoop();
		} catch (err) {
			detachEnded();
			setPhase("error");
			setStatus(`Error: ${(err as Error).message}`);
			console.error(err);
		}
	}, [
		videoFile,
		ensureModel,
		post,
		startFrameLoop,
		stopFrameLoop,
		detachEnded,
	]);

	const handleStop = useCallback(() => {
		stopRun();
		setPhase("idle");
		setStatus("Stopped.");
	}, [stopRun]);

	const canStart = !running && videoFile !== null;
	const net = stats.forward - stats.backward;

	return (
		<div className="app">
			<header>
				<h1>Crowd Line Counting</h1>
				<p className="subtitle">
					The full pipeline on a <strong>video file</strong>, running entirely
					in a <strong>Web Worker</strong> and rendering to an{" "}
					<strong>OffscreenCanvas</strong>: <code>yolo</code> +{" "}
					<code>onnx</code> detection, <code>background</code>{" "}
					static-suppression, <code>source</code> letterbox capture,{" "}
					<code>bytetrack</code> stable IDs, and <code>line-crossing</code>{" "}
					counting people who cross the line each way.
				</p>
			</header>

			<div className="controls">
				<input
					type="file"
					accept="video/*"
					onChange={handleFileChange}
					disabled={running}
				/>
				{running ? (
					<button type="button" onClick={handleStop}>
						Stop
					</button>
				) : (
					<button type="button" onClick={handleStart} disabled={!canStart}>
						Start
					</button>
				)}
				<button
					type="button"
					onClick={handleToggleDraw}
					data-active={drawMode}
					disabled={!videoFile}
				>
					{drawMode ? "Drawing… (click 2 points)" : "Draw line"}
				</button>
				<button type="button" onClick={handleResetCounts} disabled={!line}>
					Reset counts
				</button>
				<button type="button" onClick={handleClearLine} disabled={!line}>
					Clear line
				</button>
			</div>

			<div className="controls toggles">
				<label>
					<input
						type="checkbox"
						checked={suppressStatic}
						onChange={(e) => setSuppressStatic(e.target.checked)}
					/>
					Background suppression
				</label>
				<label>
					<input
						type="checkbox"
						checked={crossingAssist}
						onChange={(e) => setCrossingAssist(e.target.checked)}
					/>
					Crossing assist (ID-churn rescue / cooldown)
				</label>
				<code className="model-path">{MODEL_URL}</code>
			</div>

			<p className="status" data-phase={phase}>
				{status}
			</p>

			<div className="counts">
				<span className="count">
					<span className="count-label">Current</span>
					<span className="count-value">{stats.current}</span>
				</span>
				<span className="count">
					<span className="count-label">Unique total</span>
					<span className="count-value">{stats.unique}</span>
				</span>
				<span className="count">
					<span className="count-label" style={{ color: FORWARD_COLOR }}>
						▲ Forward
					</span>
					<span className="count-value">{stats.forward}</span>
				</span>
				<span className="count">
					<span className="count-label" style={{ color: BACKWARD_COLOR }}>
						▼ Backward
					</span>
					<span className="count-value">{stats.backward}</span>
				</span>
				<span className="count">
					<span className="count-label">Net (fwd − bwd)</span>
					<span className="count-value">{net}</span>
				</span>
			</div>

			<p className="hint">
				The <strong>green arrow</strong> on the line points to its{" "}
				<em>forward</em> side. Forward / backward follow the line's drawing
				direction (p1→p2), not screen left / right — redraw with the endpoints
				reversed to flip them.
			</p>

			<div className="stage">
				<video
					ref={videoRef}
					src={videoUrl ?? undefined}
					onLoadedMetadata={handleLoadedMetadata}
					playsInline
					muted
					controls
				/>
				<canvas
					ref={canvasRef}
					className={drawMode ? "drawing" : undefined}
					style={{ pointerEvents: drawMode ? "auto" : "none" }}
					onPointerDown={handlePointerDown}
					onPointerMove={handlePointerMove}
				/>
			</div>
		</div>
	);
}

export default App;
