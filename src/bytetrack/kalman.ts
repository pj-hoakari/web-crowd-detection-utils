/**
 * 8-dimensional Kalman filter used internally by {@link BYTETracker} to
 * smooth bounding boxes across frames and predict track positions during
 * brief detection misses.
 *
 * - State vector: `[cx, cy, aspect_ratio, height, vx, vy, va, vh]`
 *   (position + velocity for each measured dimension).
 * - Measurement vector: `[cx, cy, aspect_ratio, height]`.
 * - Noise standard deviations are proportional to box height, matching the
 *   reference ByteTrack implementation.
 *
 * Not part of the public API; constructed once per `BYTETracker` instance.
 *
 * @internal
 */

type Mat = number[][];

function zeros(rows: number, cols: number): Mat {
	return Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
}

function eye(n: number): Mat {
	const m = zeros(n, n);
	for (let i = 0; i < n; i++) (m[i] as number[])[i] = 1;
	return m;
}

function mul(a: Mat, b: Mat): Mat {
	const rows = a.length;
	const inner = b.length;
	const cols = (b[0] as number[]).length;
	const r = zeros(rows, cols);
	for (let i = 0; i < rows; i++) {
		const ai = a[i] as number[];
		const ri = r[i] as number[];
		for (let k = 0; k < inner; k++) {
			const aik = ai[k] as number;
			const bk = b[k] as number[];
			for (let j = 0; j < cols; j++)
				ri[j] = (ri[j] as number) + aik * (bk[j] as number);
		}
	}
	return r;
}

function mulVec(m: Mat, v: number[]): number[] {
	return m.map((row) =>
		row.reduce((s, val, j) => s + val * (v[j] as number), 0),
	);
}

function transpose(m: Mat): Mat {
	const rows = m.length;
	const cols = (m[0] as number[]).length;
	const r = zeros(cols, rows);
	for (let i = 0; i < rows; i++) {
		const mi = m[i] as number[];
		for (let j = 0; j < cols; j++) (r[j] as number[])[i] = mi[j] as number;
	}
	return r;
}

function add(a: Mat, b: Mat): Mat {
	return a.map((row, i) =>
		row.map((v, j) => v + ((b[i] as number[])[j] as number)),
	);
}

function sub(a: Mat, b: Mat): Mat {
	return a.map((row, i) =>
		row.map((v, j) => v - ((b[i] as number[])[j] as number)),
	);
}

function inverse(m: Mat): Mat {
	const n = m.length;
	const aug = m.map((row, i) => {
		const r = [...row];
		for (let j = 0; j < n; j++) r.push(i === j ? 1 : 0);
		return r;
	});

	for (let col = 0; col < n; col++) {
		let maxRow = col;
		let maxVal = Math.abs((aug[col] as number[])[col] as number);
		for (let row = col + 1; row < n; row++) {
			const v = Math.abs((aug[row] as number[])[col] as number);
			if (v > maxVal) {
				maxVal = v;
				maxRow = row;
			}
		}
		if (maxRow !== col) {
			const tmp = aug[col] as number[];
			aug[col] = aug[maxRow] as number[];
			aug[maxRow] = tmp;
		}

		const pivotRow = aug[col] as number[];
		const pivot = pivotRow[col] as number;
		const width = 2 * n;
		for (let j = 0; j < width; j++)
			pivotRow[j] = (pivotRow[j] as number) / pivot;

		for (let row = 0; row < n; row++) {
			if (row === col) continue;
			const targetRow = aug[row] as number[];
			const factor = targetRow[col] as number;
			for (let j = 0; j < width; j++) {
				targetRow[j] =
					(targetRow[j] as number) - factor * (pivotRow[j] as number);
			}
		}
	}

	return aug.map((row) => row.slice(n));
}

const STD_WEIGHT_POSITION = 1 / 20;
const STD_WEIGHT_VELOCITY = 1 / 160;

/**
 * Kalman filter instance. One per {@link BYTETracker}.
 *
 * @internal
 */
export class KalmanFilter {
	private F: Mat;
	private H: Mat;

	constructor() {
		this.F = eye(8);
		for (let i = 0; i < 4; i++) (this.F[i] as number[])[i + 4] = 1;

		this.H = zeros(4, 8);
		for (let i = 0; i < 4; i++) (this.H[i] as number[])[i] = 1;
	}

	initiate(measurement: number[]): { mean: number[]; covariance: Mat } {
		const h = measurement[3] as number;
		const mean = [...measurement, 0, 0, 0, 0];

		const std = [
			2 * STD_WEIGHT_POSITION * h,
			2 * STD_WEIGHT_POSITION * h,
			1e-2,
			2 * STD_WEIGHT_POSITION * h,
			10 * STD_WEIGHT_VELOCITY * h,
			10 * STD_WEIGHT_VELOCITY * h,
			1e-5,
			10 * STD_WEIGHT_VELOCITY * h,
		];

		const covariance = zeros(8, 8);
		for (let i = 0; i < 8; i++) {
			(covariance[i] as number[])[i] = (std[i] as number) ** 2;
		}

		return { mean, covariance };
	}

	predict(
		mean: number[],
		covariance: Mat,
	): { mean: number[]; covariance: Mat } {
		const h = mean[3] as number;
		const std = [
			STD_WEIGHT_POSITION * h,
			STD_WEIGHT_POSITION * h,
			1e-2,
			STD_WEIGHT_POSITION * h,
			STD_WEIGHT_VELOCITY * h,
			STD_WEIGHT_VELOCITY * h,
			1e-5,
			STD_WEIGHT_VELOCITY * h,
		];

		const Q = zeros(8, 8);
		for (let i = 0; i < 8; i++) {
			(Q[i] as number[])[i] = (std[i] as number) ** 2;
		}

		const newMean = mulVec(this.F, mean);
		const newCov = add(mul(mul(this.F, covariance), transpose(this.F)), Q);

		return { mean: newMean, covariance: newCov };
	}

	update(
		mean: number[],
		covariance: Mat,
		measurement: number[],
	): { mean: number[]; covariance: Mat } {
		const h = mean[3] as number;
		const std = [
			STD_WEIGHT_POSITION * h,
			STD_WEIGHT_POSITION * h,
			1e-2,
			STD_WEIGHT_POSITION * h,
		];

		const R = zeros(4, 4);
		for (let i = 0; i < 4; i++) {
			(R[i] as number[])[i] = (std[i] as number) ** 2;
		}

		const HT = transpose(this.H);
		const S = add(mul(mul(this.H, covariance), HT), R);
		const K = mul(mul(covariance, HT), inverse(S));

		const projMean = mulVec(this.H, mean);
		const innovation = measurement.map((v, i) => v - (projMean[i] as number));
		const correction = mulVec(K, innovation);

		const newMean = mean.map((v, i) => v + (correction[i] as number));
		const newCov = mul(sub(eye(8), mul(K, this.H)), covariance);

		return { mean: newMean, covariance: newCov };
	}
}
