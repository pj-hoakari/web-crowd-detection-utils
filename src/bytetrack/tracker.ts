/**
 * ByteTrack multi-object tracker.
 *
 * Reference:
 * FoundationVision/ByteTrack: [ECCV 2022] ByteTrack: Multi-Object Tracking by Associating Every Detection Box
 * https://github.com/FoundationVision/ByteTrack
 */

import {
	iouDistance,
	jointStracks,
	removeDuplicateStracks,
	subStracks,
} from "./association";
import {
	DEFAULT_DUPLICATE_IOU_THRESH,
	DEFAULT_HIGH_THRESH,
	DEFAULT_MATCH_THRESH,
	DEFAULT_NEW_TRACK_THRESH,
	DEFAULT_SECOND_MATCH_THRESH,
	DEFAULT_TRACK_BUFFER,
	DEFAULT_UNCONFIRMED_MATCH_THRESH,
} from "./constants";
import { linearAssignment } from "./hungarian";
import { KalmanFilter } from "./kalman";
import { STrack } from "./strack";
import type { BYTETrackerOptions, Observation, TrackedBox } from "./types";
import { TrackState } from "./types";

/**
 * Detector-agnostic multi-object tracker implementing the ByteTrack 3-stage
 * association cascade with Kalman-filtered state.
 *
 * Each frame's detections are partitioned by score, then matched against
 * existing tracks in three stages (high-conf × all, low-conf × remaining,
 * high-conf × unconfirmed). Lost tracks are retained for {@link BYTETrackerOptions.trackBuffer}
 * frames to allow re-identification across short occlusions.
 *
 * The tracker is stateful: each {@link BYTETracker.update} call mutates the
 * internal track lists. Use {@link BYTETracker.reset} to start over.
 *
 * @example
 * ```ts
 * const tracker = new BYTETracker();
 * for (const frame of frames) {
 *   const detections = await detector.detect(frame); // Detection[] from yolo
 *   const tracked = tracker.update(detections);
 *   for (const t of tracked) {
 *     console.log(t.trackId, t.x1, t.y1, t.x2, t.y2, t.classId);
 *     //                                                ^^^^^^^ preserved from Detection
 *   }
 * }
 * ```
 */
export class BYTETracker {
	private trackedStracks: STrack[] = [];
	private lostStracks: STrack[] = [];
	private removedStracks: STrack[] = [];
	private frameId = 0;
	private kf = new KalmanFilter();
	private nextId = 1;

	/** Score threshold separating high vs. low confidence observations. */
	highThresh: number;
	/** Stage 1 IoU-distance threshold (high-conf det × tracked + lost tracks). */
	matchThresh: number;
	/** Stage 2 IoU-distance threshold (low-conf det × remaining tracked tracks). */
	secondMatchThresh: number;
	/** Stage 3 IoU-distance threshold (remaining high-conf det × unconfirmed tracks). */
	unconfirmedMatchThresh: number;
	/** Minimum score required for an unmatched observation to spawn a new track. */
	newTrackThresh: number;
	/** IoU-distance threshold for duplicate-track suppression. */
	duplicateIouThresh: number;
	/** Number of frames a lost track is kept before removal. */
	trackBuffer: number;

	/**
	 * Total number of unique track IDs assigned over the tracker's lifetime.
	 *
	 * Monotonically increasing across {@link BYTETracker.update} calls and reset
	 * to `0` by {@link BYTETracker.reset}. Useful for crowd-counting workflows.
	 */
	get totalCount(): number {
		return this.nextId - 1;
	}

	/**
	 * @param opts - See {@link BYTETrackerOptions}. Any field omitted falls back
	 *   to its corresponding `DEFAULT_*` constant.
	 */
	constructor(opts?: BYTETrackerOptions) {
		this.highThresh = opts?.highThresh ?? DEFAULT_HIGH_THRESH;
		this.matchThresh = opts?.matchThresh ?? DEFAULT_MATCH_THRESH;
		this.secondMatchThresh =
			opts?.secondMatchThresh ?? DEFAULT_SECOND_MATCH_THRESH;
		this.unconfirmedMatchThresh =
			opts?.unconfirmedMatchThresh ?? DEFAULT_UNCONFIRMED_MATCH_THRESH;
		this.newTrackThresh = opts?.newTrackThresh ?? DEFAULT_NEW_TRACK_THRESH;
		this.duplicateIouThresh =
			opts?.duplicateIouThresh ?? DEFAULT_DUPLICATE_IOU_THRESH;
		this.trackBuffer = opts?.trackBuffer ?? DEFAULT_TRACK_BUFFER;
	}

	/**
	 * Clears all track state and resets the frame counter and ID generator.
	 * After this call, the next {@link BYTETracker.update} starts at frame 1
	 * with `trackId` counting from `1`.
	 */
	reset(): void {
		this.trackedStracks = [];
		this.lostStracks = [];
		this.removedStracks = [];
		this.frameId = 0;
		this.nextId = 1;
	}

	/**
	 * Processes one frame of observations and returns the currently active tracks.
	 *
	 * Mutates the tracker's internal state: this is not a pure function. The
	 * returned array contains only `Tracked + isActivated` entries; lost and
	 * removed tracks are not surfaced.
	 *
	 * @typeParam T - Any subtype of {@link Observation}. Extra fields on `T`
	 *   (e.g. YOLO's `classId`) are shallow-copied from the most recently
	 *   matched observation onto the returned object. The canonical fields
	 *   `x1, y1, x2, y2, score, trackId` are always set by the tracker and
	 *   override any same-named field on `T`.
	 *
	 * @param observations - Detections for the current frame. Empty arrays are
	 *   valid input and advance the frame counter without creating new tracks.
	 * @returns Currently active tracks for this frame, each augmented with the
	 *   pass-through fields from the last matching observation.
	 *
	 * @remarks
	 * Algorithm (3-stage cascade — the "associate every detection" idea):
	 * - **Stage 1:** High-confidence observations × all tracks (tracked ∪ lost),
	 *   matched by IoU distance. Updates stable tracks and re-identifies lost
	 *   tracks in one pass.
	 * - **Stage 2:** Low-confidence observations × tracks left unmatched by
	 *   Stage 1. Recovers occluded or partially visible objects whose score
	 *   dropped this frame — the distinguishing idea of ByteTrack.
	 * - **Stage 3:** High-confidence observations left over from Stage 1 ×
	 *   unconfirmed tracks. Confirms candidates that appeared in the previous frame.
	 *
	 * Postprocessing per frame: spawn new tracks from unmatched detections
	 * whose score clears `newTrackThresh`, age out lost tracks past
	 * `trackBuffer`, and drop duplicate tracks within `duplicateIouThresh`.
	 */
	update<T extends Observation>(
		observations: T[],
	): (TrackedBox & Omit<T, keyof Observation>)[] {
		this.frameId++;

		const activated: STrack[] = [];
		const refound: STrack[] = [];
		const lost: STrack[] = [];
		const removed: STrack[] = [];

		const highDets = observations.filter((d) => d.score >= this.highThresh);
		const lowDets = observations.filter((d) => d.score < this.highThresh);

		const unconfirmed: STrack[] = [];
		const confirmed: STrack[] = [];
		for (const t of this.trackedStracks) {
			if (t.isActivated) confirmed.push(t);
			else unconfirmed.push(t);
		}

		// Include lost tracks in the candidate pool so that Stage 1 can
		// re-identify objects coming back from occlusion.
		const pool = jointStracks([...confirmed], [...this.lostStracks]);

		for (const t of pool) t.predict(this.kf);
		for (const t of unconfirmed) t.predict(this.kf);

		// Stage 1: high-confidence observations × full pool (tracked + lost).
		// Updates stable tracks and re-identifies lost tracks in a single pass.
		const cost1 = iouDistance(pool, highDets);
		const {
			matches: m1,
			unmatchedA: uTracks1,
			unmatchedB: uDets1,
		} = linearAssignment(cost1, this.matchThresh, highDets.length);

		for (const [ti, di] of m1) {
			const track = pool[ti] as STrack;
			const obs = highDets[di] as T;
			if (track.state === TrackState.Tracked) {
				track.update(this.kf, obs, this.frameId);
				activated.push(track);
			} else {
				track.reActivate(this.kf, obs, this.frameId);
				refound.push(track);
			}
		}

		// Stage 2: low-confidence observations × tracked tracks left over from Stage 1.
		// Even a low score is accepted if IoU is tight enough, keeping occluded
		// or partially visible objects on their existing track.
		const remainTracked = uTracks1
			.map((i) => pool[i] as STrack)
			.filter((t) => t.state === TrackState.Tracked);

		const cost2 = iouDistance(remainTracked, lowDets);
		const {
			matches: m2,
			unmatchedA: uTracks2,
			unmatchedB: uLowDets2,
		} = linearAssignment(cost2, this.secondMatchThresh, lowDets.length);

		for (const [ti, di] of m2) {
			const track = remainTracked[ti] as STrack;
			track.update(this.kf, lowDets[di] as T, this.frameId);
			activated.push(track);
		}

		for (const ti of uTracks2) {
			const track = remainTracked[ti] as STrack;
			if (track.state !== TrackState.Lost) {
				track.markLost();
				lost.push(track);
			}
		}

		// Stage 3: high-confidence observations left over from Stage 1 × unconfirmed tracks.
		// Confirms candidates that first appeared in the previous frame.
		const remainDets = uDets1.map((i) => highDets[i] as T);
		const cost3 = iouDistance(unconfirmed, remainDets);
		const {
			matches: m3,
			unmatchedA: uUnconf,
			unmatchedB: uNewDets,
		} = linearAssignment(cost3, this.unconfirmedMatchThresh, remainDets.length);

		for (const [ti, di] of m3) {
			const track = unconfirmed[ti] as STrack;
			track.update(this.kf, remainDets[di] as T, this.frameId);
			activated.push(track);
		}

		for (const ti of uUnconf) {
			const track = unconfirmed[ti] as STrack;
			track.markRemoved();
			removed.push(track);
		}

		// ── Create new tracks from unmatched detections ──
		for (const di of uNewDets) {
			const obs = remainDets[di] as T;
			if (obs.score < this.newTrackThresh) continue;
			const track = new STrack(obs);
			track.activate(this.kf, this.frameId, this.nextId++);
			activated.push(track);
		}

		for (const i of uLowDets2) {
			const obs = lowDets[i] as T;
			if (obs.score < this.newTrackThresh) continue;
			const track = new STrack(obs);
			track.activate(this.kf, this.frameId, this.nextId++);
			activated.push(track);
		}

		// ── Expire lost tracks ──
		for (const t of this.lostStracks) {
			if (this.frameId - t.endFrame > this.trackBuffer) {
				t.markRemoved();
				removed.push(t);
			}
		}

		// ── Update track lists ──
		this.trackedStracks = this.trackedStracks.filter(
			(t) => t.state === TrackState.Tracked,
		);
		this.trackedStracks = jointStracks(this.trackedStracks, activated);
		this.trackedStracks = jointStracks(this.trackedStracks, refound);
		this.lostStracks = subStracks(this.lostStracks, this.trackedStracks);
		this.lostStracks.push(...lost);
		this.lostStracks = subStracks(this.lostStracks, this.removedStracks);
		this.removedStracks.push(...removed);

		const [dedupTracked, dedupLost] = removeDuplicateStracks(
			this.trackedStracks,
			this.lostStracks,
			this.duplicateIouThresh,
		);
		this.trackedStracks = dedupTracked;
		this.lostStracks = dedupLost;

		return this.trackedStracks
			.filter((t) => t.isActivated)
			.map((t) => {
				const [x1, y1, x2, y2] = t.bbox;
				return {
					...(t.lastObs as T),
					x1,
					y1,
					x2,
					y2,
					score: t.score,
					trackId: t.trackId,
				} as TrackedBox & Omit<T, keyof Observation>;
			});
	}
}
