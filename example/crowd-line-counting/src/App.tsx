import type { Line } from "@pj-hoakari/web-crowd-detection-utils/line-crossing";
import { useCallback, useEffect, useRef, useState } from "react";
import "./App.css";
import {
	type Draft,
	LINE_ID,
	type PipelineConfig,
	type PipelineControls,
	type PipelineStats,
	startDetection,
} from "./detection";
import {
	BACKWARD_COLOR,
	clearCanvas,
	clientToCanvas,
	drawDraft,
	drawLine,
	FORWARD_COLOR,
} from "./overlay";

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
	const abortRef = useRef<AbortController | null>(null);
	const controlsRef = useRef<PipelineControls | null>(null);

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

	// Latest-value refs so the long-lived detection loop reads current UI state.
	const lineRef = useRef<Line | null>(line);
	lineRef.current = line;
	const draftRef = useRef<Draft | null>(draft);
	draftRef.current = draft;
	const configRef = useRef<PipelineConfig>({ suppressStatic, crossingAssist });
	configRef.current = { suppressStatic, crossingAssist };

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

	const stop = useCallback(() => {
		abortRef.current?.abort();
		abortRef.current = null;
		videoRef.current?.pause();
	}, []);

	useEffect(() => stop, [stop]);

	// While idle, the loop is not drawing — paint the committed line + draft here
	// so the overlay still reflects the line the user is setting up.
	useEffect(() => {
		if (running) {
			return;
		}
		const canvas = canvasRef.current;
		if (!canvas) {
			return;
		}
		const video = videoRef.current;
		if (video && video.videoWidth > 0) {
			canvas.width = video.videoWidth;
			canvas.height = video.videoHeight;
		}
		const ctx = canvas.getContext("2d");
		if (!ctx) {
			return;
		}
		clearCanvas(ctx, canvas);
		if (line) {
			drawLine(ctx, canvas, line, {
				forward: stats.forward,
				backward: stats.backward,
			});
		}
		if (draft) {
			drawDraft(ctx, canvas, draft.p1, draft.p2);
		}
	}, [running, line, draft, stats.forward, stats.backward]);

	const handleLoadedMetadata = useCallback(() => {
		const video = videoRef.current;
		if (!video) {
			return;
		}
		const w = video.videoWidth;
		const h = video.videoHeight;
		// Seed a default vertical line at the horizontal center so the example
		// counts out of the box; the user can redraw it.
		if (w > 0 && h > 0) {
			setLine({
				id: LINE_ID,
				p1: { x: Math.round(w / 2), y: 0 },
				p2: { x: Math.round(w / 2), y: h },
			});
		}
	}, []);

	const handleFileChange = useCallback(
		(e: React.ChangeEvent<HTMLInputElement>) => {
			const file = e.target.files?.[0] ?? null;
			stop();
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
		[stop],
	);

	const commitLine = useCallback((p1: Draft["p1"], p2: Draft["p2"]) => {
		// Ignore a degenerate (zero-length) line from a double-click in place.
		if (p1.x === p2.x && p1.y === p2.y) {
			return;
		}
		setLine({ id: LINE_ID, p1, p2 });
		setDraft(null);
		setDrawMode(false);
		// A redrawn line is a fresh measurement: zero the tally (live + display).
		controlsRef.current?.resetCounts();
		setStats((s) => ({ ...s, forward: 0, backward: 0 }));
	}, []);

	const handlePointerDown = useCallback(
		(e: React.PointerEvent<HTMLCanvasElement>) => {
			if (!drawMode) {
				return;
			}
			const canvas = canvasRef.current;
			if (!canvas) {
				return;
			}
			const p = clientToCanvas(canvas, e.clientX, e.clientY);
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
			if (!canvas) {
				return;
			}
			const p = clientToCanvas(canvas, e.clientX, e.clientY);
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
		controlsRef.current?.resetCounts();
		setStats((s) => ({ ...s, forward: 0, backward: 0 }));
	}, []);

	const handleClearLine = useCallback(() => {
		setLine(null);
		setDraft(null);
		setDrawMode(false);
		controlsRef.current?.clearPositions();
		setStats((s) => ({ ...s, forward: 0, backward: 0 }));
	}, []);

	const handleStart = useCallback(async () => {
		if (!videoRef.current || !canvasRef.current) {
			return;
		}
		if (!videoFile) {
			setPhase("error");
			setStatus("Error: choose a video file first.");
			return;
		}
		setPhase("preparing");
		setStatus("Fetching model…");
		setStats(ZERO_STATS);

		const video = videoRef.current;
		const canvas = canvasRef.current;
		const controller = new AbortController();
		abortRef.current = controller;

		const handleEnded = () => {
			controller.abort();
		};
		video.addEventListener("ended", handleEnded);

		try {
			const response = await fetch(MODEL_URL);
			if (!response.ok) {
				throw new Error(
					`Failed to fetch ${MODEL_URL}: ${response.status} ${response.statusText}`,
				);
			}
			const buffer = await response.arrayBuffer();

			setStatus("Starting playback…");
			video.currentTime = 0;
			await video.play();

			setPhase("running");

			await startDetection({
				modelBuffer: buffer,
				video,
				canvas,
				signal: controller.signal,
				getLine: () => lineRef.current,
				getDraft: () => draftRef.current,
				getConfig: () => configRef.current,
				onControls: (c) => {
					controlsRef.current = c;
				},
				onStatus: setStatus,
				onStats: setStats,
			});
		} catch (err) {
			if (controller.signal.aborted) {
				return;
			}
			setPhase("error");
			setStatus(`Error: ${(err as Error).message}`);
			console.error(err);
		} finally {
			video.removeEventListener("ended", handleEnded);
			if (controller.signal.aborted) {
				if (video.ended) {
					setPhase("finished");
					setStatus("Finished.");
				} else {
					setPhase("idle");
					setStatus("Stopped.");
				}
			}
		}
	}, [videoFile]);

	const handleStop = useCallback(() => {
		stop();
		setPhase("idle");
		setStatus("Stopped.");
	}, [stop]);

	const canStart = !running && videoFile !== null;
	const net = stats.forward - stats.backward;

	return (
		<div className="app">
			<header>
				<h1>Crowd Line Counting</h1>
				<p className="subtitle">
					The full pipeline on a <strong>video file</strong>: <code>yolo</code>{" "}
					+ <code>onnx</code> detection, <code>background</code>{" "}
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
