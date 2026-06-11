import type { TrackedBox } from "@pj-hoakari/web-crowd-detection-utils/bytetrack";
import type {
	Line,
	LineCount,
	Point,
} from "@pj-hoakari/web-crowd-detection-utils/line-crossing";

/**
 * Shared canvas-drawing helpers for the overlay.
 *
 * `LineCrossingCounter` itself does no drawing (rendering is out of scope for
 * the package), so this example owns every pixel: tracked boxes, the counting
 * line, the foot anchor points the counter actually tests, and the per-line
 * tally. Both the running detection loop (`detection.ts`) and the idle preview
 * (`App.tsx`) draw through these helpers so the overlay looks identical whether
 * or not inference is running.
 */

/** Crossings toward the line's positive side (`p1`→`p2`); rendered green. */
export const FORWARD_COLOR = "#00ff88";
/** Crossings toward the line's negative side; rendered orange. */
export const BACKWARD_COLOR = "#ffb020";
const LINE_COLOR = "#39d0ff";
const TRACK_COLOR = "#00ff88";

/**
 * Maps a pointer's client coordinates to the canvas's internal pixel space.
 *
 * The overlay canvas is sized to the source video (`videoWidth × videoHeight`)
 * but displayed scaled by CSS, so a click's `clientX/clientY` must be divided
 * by that CSS scale to land in the same space the counting line and tracked
 * boxes live in.
 */
export function clientToCanvas(
	canvas: HTMLCanvasElement,
	clientX: number,
	clientY: number,
): Point {
	const rect = canvas.getBoundingClientRect();
	const scaleX = canvas.width / rect.width;
	const scaleY = canvas.height / rect.height;
	return {
		x: (clientX - rect.left) * scaleX,
		y: (clientY - rect.top) * scaleY,
	};
}

/** Clears the whole overlay. */
export function clearCanvas(
	ctx: CanvasRenderingContext2D,
	canvas: HTMLCanvasElement,
): void {
	ctx.clearRect(0, 0, canvas.width, canvas.height);
}

/**
 * Draws each tracked box with its stable id and the foot anchor point that is
 * fed to {@link LineCrossingCounter} (bottom-center), so the crossing geometry
 * is visible on screen.
 */
export function drawTracks(
	ctx: CanvasRenderingContext2D,
	canvas: HTMLCanvasElement,
	tracks: readonly TrackedBox[],
): void {
	const fontSize = Math.max(12, Math.round(canvas.width / 60));
	const lineWidth = Math.max(2, Math.round(canvas.width / 320));

	ctx.lineWidth = lineWidth;
	ctx.strokeStyle = TRACK_COLOR;
	ctx.font = `${fontSize}px sans-serif`;
	ctx.textBaseline = "top";

	for (const t of tracks) {
		ctx.strokeStyle = TRACK_COLOR;
		ctx.strokeRect(t.x1, t.y1, t.x2 - t.x1, t.y2 - t.y1);

		// Foot anchor (bottom-center): the exact point the counter tracks.
		const footX = (t.x1 + t.x2) / 2;
		const footY = t.y2;
		ctx.fillStyle = TRACK_COLOR;
		ctx.beginPath();
		ctx.arc(footX, footY, Math.max(3, lineWidth * 1.5), 0, Math.PI * 2);
		ctx.fill();

		const label = `#${t.trackId}  ${Math.round(t.score * 100)}%`;
		const labelH = fontSize + 4;
		const labelW = ctx.measureText(label).width + 8;
		ctx.fillStyle = TRACK_COLOR;
		ctx.fillRect(t.x1, t.y1 - labelH, labelW, labelH);
		ctx.fillStyle = "#000";
		ctx.fillText(label, t.x1 + 4, t.y1 - labelH + 2);
	}
}

/**
 * Draws the committed counting line: the segment, its two endpoints, a normal
 * arrow pointing toward the "forward" side, and the per-direction tally.
 */
export function drawLine(
	ctx: CanvasRenderingContext2D,
	canvas: HTMLCanvasElement,
	line: Line,
	count: LineCount,
): void {
	const lineWidth = Math.max(2, Math.round(canvas.width / 360));
	const dotR = Math.max(4, lineWidth * 2);

	ctx.save();
	ctx.lineWidth = lineWidth;
	ctx.strokeStyle = LINE_COLOR;
	ctx.fillStyle = LINE_COLOR;

	// The segment.
	ctx.beginPath();
	ctx.moveTo(line.p1.x, line.p1.y);
	ctx.lineTo(line.p2.x, line.p2.y);
	ctx.stroke();

	// Endpoints.
	for (const p of [line.p1, line.p2]) {
		ctx.beginPath();
		ctx.arc(p.x, p.y, dotR, 0, Math.PI * 2);
		ctx.fill();
	}

	// Forward-normal arrow at the midpoint. Forward = negative→positive side of
	// the directed line p1→p2; that side lies along the normal n = (-dy, dx).
	const dx = line.p2.x - line.p1.x;
	const dy = line.p2.y - line.p1.y;
	const len = Math.hypot(dx, dy) || 1;
	const nx = -dy / len;
	const ny = dx / len;
	const midX = (line.p1.x + line.p2.x) / 2;
	const midY = (line.p1.y + line.p2.y) / 2;
	const arrow = Math.max(24, canvas.width / 18);
	drawArrow(ctx, midX, midY, midX + nx * arrow, midY + ny * arrow, lineWidth);

	// Count label near the midpoint, offset to the forward side.
	const fontSize = Math.max(13, Math.round(canvas.width / 52));
	ctx.font = `${fontSize}px sans-serif`;
	ctx.textBaseline = "top";
	const labelX = midX + nx * (arrow + 8);
	const labelY = midY + ny * (arrow + 8);
	drawCountBadge(ctx, labelX, labelY, count, fontSize);

	ctx.restore();
}

/** Draws the in-progress (not yet committed) line as a dashed segment. */
export function drawDraft(
	ctx: CanvasRenderingContext2D,
	canvas: HTMLCanvasElement,
	p1: Point,
	p2: Point,
): void {
	const lineWidth = Math.max(2, Math.round(canvas.width / 360));
	const dotR = Math.max(4, lineWidth * 2);

	ctx.save();
	ctx.lineWidth = lineWidth;
	ctx.strokeStyle = LINE_COLOR;
	ctx.fillStyle = LINE_COLOR;
	ctx.setLineDash([lineWidth * 4, lineWidth * 4]);

	ctx.beginPath();
	ctx.moveTo(p1.x, p1.y);
	ctx.lineTo(p2.x, p2.y);
	ctx.stroke();

	ctx.setLineDash([]);
	ctx.beginPath();
	ctx.arc(p1.x, p1.y, dotR, 0, Math.PI * 2);
	ctx.fill();
	ctx.restore();
}

/** @internal */
function drawArrow(
	ctx: CanvasRenderingContext2D,
	x1: number,
	y1: number,
	x2: number,
	y2: number,
	lineWidth: number,
): void {
	const head = Math.max(8, lineWidth * 4);
	const angle = Math.atan2(y2 - y1, x2 - x1);

	ctx.save();
	ctx.strokeStyle = FORWARD_COLOR;
	ctx.fillStyle = FORWARD_COLOR;
	ctx.lineWidth = lineWidth;

	ctx.beginPath();
	ctx.moveTo(x1, y1);
	ctx.lineTo(x2, y2);
	ctx.stroke();

	ctx.beginPath();
	ctx.moveTo(x2, y2);
	ctx.lineTo(
		x2 - head * Math.cos(angle - Math.PI / 6),
		y2 - head * Math.sin(angle - Math.PI / 6),
	);
	ctx.lineTo(
		x2 - head * Math.cos(angle + Math.PI / 6),
		y2 - head * Math.sin(angle + Math.PI / 6),
	);
	ctx.closePath();
	ctx.fill();
	ctx.restore();
}

/** @internal */
function drawCountBadge(
	ctx: CanvasRenderingContext2D,
	x: number,
	y: number,
	count: LineCount,
	fontSize: number,
): void {
	const text = `▲ ${count.forward}   ▼ ${count.backward}`;
	const padX = Math.round(fontSize * 0.5);
	const padY = Math.round(fontSize * 0.3);
	const w = ctx.measureText(text).width + padX * 2;
	const h = fontSize + padY * 2;
	const left = Math.max(0, x - w / 2);
	const top = Math.max(0, y);

	ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
	ctx.fillRect(left, top, w, h);

	ctx.fillStyle = FORWARD_COLOR;
	ctx.fillText(`▲ ${count.forward}`, left + padX, top + padY);
	const fwdW = ctx.measureText(`▲ ${count.forward}   `).width;
	ctx.fillStyle = BACKWARD_COLOR;
	ctx.fillText(`▼ ${count.backward}`, left + padX + fwdW, top + padY);
}
