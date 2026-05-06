import { useCallback, useEffect, useRef, useState } from "react";
import "./App.css";
import { startDetection } from "./detection";

const MODEL_URL = `${import.meta.env.BASE_URL}models/yolo26n.onnx`;

type Phase = "idle" | "preparing" | "running" | "error";

function App() {
	const videoRef = useRef<HTMLVideoElement>(null);
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const streamRef = useRef<MediaStream | null>(null);
	const abortRef = useRef<AbortController | null>(null);

	const [phase, setPhase] = useState<Phase>("idle");
	const [status, setStatus] = useState(
		"Place your YOLO ONNX model at public/models/yolo26n.onnx (see README), then press Start.",
	);

	const stop = useCallback(() => {
		abortRef.current?.abort();
		abortRef.current = null;
		if (streamRef.current) {
			for (const track of streamRef.current.getTracks()) {
				track.stop();
			}
			streamRef.current = null;
		}
		if (videoRef.current) {
			videoRef.current.srcObject = null;
		}
	}, []);

	useEffect(() => stop, [stop]);

	const handleStart = useCallback(async () => {
		if (!videoRef.current || !canvasRef.current) {
			return;
		}
		setPhase("preparing");
		setStatus("Fetching model…");

		const video = videoRef.current;
		const canvas = canvasRef.current;
		const controller = new AbortController();
		abortRef.current = controller;

		try {
			const response = await fetch(MODEL_URL);
			if (!response.ok) {
				throw new Error(
					`Failed to fetch ${MODEL_URL}: ${response.status} ${response.statusText}`,
				);
			}
			const buffer = await response.arrayBuffer();

			setStatus("Requesting camera…");
			const stream = await navigator.mediaDevices.getUserMedia({
				video: { width: { ideal: 1280 }, height: { ideal: 720 } },
				audio: false,
			});
			streamRef.current = stream;
			video.srcObject = stream;
			await video.play();

			setPhase("running");

			await startDetection({
				modelBuffer: buffer,
				video,
				canvas,
				signal: controller.signal,
				onStatus: setStatus,
			});
		} catch (err) {
			if (controller.signal.aborted) {
				return;
			}
			setPhase("error");
			setStatus(`Error: ${(err as Error).message}`);
			console.error(err);
		} finally {
			if (controller.signal.aborted) {
				setPhase("idle");
				setStatus("Stopped.");
			}
		}
	}, []);

	const handleStop = useCallback(() => {
		stop();
		setPhase("idle");
		setStatus("Stopped.");
	}, [stop]);

	const running = phase === "running" || phase === "preparing";

	return (
		<div className="app">
			<header>
				<h1>YOLO Webcam Detection</h1>
				<p className="subtitle">
					Minimal example of <code>web-crowd-detection-utils</code> running YOLO
					person detection on a webcam stream. Supports YOLO v8 / v11 / v26
					(output format auto-detected).
				</p>
			</header>

			<div className="controls">
				{running ? (
					<button type="button" onClick={handleStop}>
						Stop
					</button>
				) : (
					<button type="button" onClick={handleStart}>
						Start
					</button>
				)}
				<code className="model-path">{MODEL_URL}</code>
			</div>

			<p className="status" data-phase={phase}>
				{status}
			</p>

			<div className="stage">
				<video ref={videoRef} playsInline muted />
				<canvas ref={canvasRef} />
			</div>
		</div>
	);
}

export default App;
