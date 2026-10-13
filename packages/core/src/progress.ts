import { dot, type XY } from './geo';
import type { Candidate, TrackModel } from './track';

export interface ProgressConfig {
  /** Samples further than this from the centreline (plus GPS accuracy) are not matched while tracking. */
  maxLateralM: number;
  /** Stricter lateral limit used to (re)acquire a position without history. */
  acquireLateralM: number;
  /** Lateral distance below which (plus half the accuracy) a match is considered good. */
  goodLateralM: number;
  /** Backward movement tolerated as GPS jitter, metres (plus accuracy). */
  backwardToleranceM: number;
  /** Fixed slack added to the maximum plausible forward advance, metres. */
  forwardMarginM: number;
  /** Upper speed bound used when the current speed is unknown, m/s. */
  maxSpeedMs: number;
  /** After this long without a match the tracker drops its lock and re-acquires, ms. */
  lostAfterMs: number;
}

export const DEFAULT_PROGRESS_CONFIG: ProgressConfig = {
  maxLateralM: 30,
  acquireLateralM: 25,
  goodLateralM: 12,
  backwardToleranceM: 15,
  forwardMarginM: 25,
  maxSpeedMs: 95,
  lostAfterMs: 6000,
};

export type ProgressConfidence = 'good' | 'uncertain' | 'lost';

export interface ProgressResult {
  /**
   * Monotonic distance travelled along the circuit since acquisition, metres.
   * On closed circuits it keeps increasing across laps (it is not wrapped).
   */
  unwrapped: number;
  /** Position along the track in [0, length]. */
  along: number;
  lateral: number;
  confidence: ProgressConfidence;
  /** True when this sample (re)acquired the lock without continuous history. */
  acquired: boolean;
}

/**
 * Map-matches GPS positions onto a track while enforcing forward progress.
 *
 * Instead of taking the globally nearest point (which jumps between adjacent sections on
 * hairpins and parallel straights), each update only considers track positions reachable from
 * the previous match given elapsed time and speed. Small backward motion is treated as jitter
 * and does not move progress backwards.
 */
export class ProgressTracker {
  private locked = false;
  private lastAlong = 0;
  private lastUnwrapped = 0;
  private lastMatchT = 0;
  private lastT = 0;
  private hasHistory = false;
  private lastSpeed: number | null = null;

  constructor(
    private readonly track: TrackModel,
    private readonly cfg: ProgressConfig = DEFAULT_PROGRESS_CONFIG,
  ) {}

  get isLocked(): boolean {
    return this.locked;
  }

  reset(): void {
    this.locked = false;
    this.hasHistory = false;
    this.lastAlong = 0;
    this.lastUnwrapped = 0;
    this.lastSpeed = null;
  }

  /**
   * @param p position in the track's local frame
   * @param tMs sample timestamp
   * @param speedMs current speed if known
   * @param accuracyM horizontal accuracy (1σ-ish radius) reported by the receiver
   * @param motion direction of travel (any length) if known, used to disambiguate acquisition
   */
  update(p: XY, tMs: number, speedMs: number | null, accuracyM: number, motion: XY | null = null): ProgressResult {
    const acc = Number.isFinite(accuracyM) ? Math.max(0, accuracyM) : 0;
    if (speedMs !== null && Number.isFinite(speedMs)) this.lastSpeed = speedMs;

    if (this.locked && tMs - this.lastMatchT > this.cfg.lostAfterMs) this.locked = false;
    const result = this.locked ? this.track_(p, tMs, acc) : this.acquire(p, tMs, acc, motion);
    this.lastT = tMs;
    return result;
  }

  private track_(p: XY, tMs: number, acc: number): ProgressResult {
    const dt = Math.max(0, (tMs - this.lastT) / 1000);
    const v = this.lastSpeed;
    const vMax = v === null ? this.cfg.maxSpeedMs : Math.min(this.cfg.maxSpeedMs, Math.max(v * 1.5, v + 10));
    const maxAdvance = vMax * dt + this.cfg.forwardMarginM + acc;
    const minAdvance = -(this.cfg.backwardToleranceM + acc);
    const expected = (v ?? 0) * dt;
    const lateralLimit = this.cfg.maxLateralM + acc;

    let best: { c: Candidate; fwd: number; score: number } | null = null;
    for (const c of this.track.candidates(p, lateralLimit)) {
      const fwd = this.track.signedDelta(this.lastAlong, c.along);
      if (fwd < minAdvance || fwd > maxAdvance) continue;
      const score = c.lateral + 0.3 * Math.abs(fwd - expected);
      if (!best || score < best.score) best = { c, fwd, score };
    }

    if (!best) {
      return { unwrapped: this.lastUnwrapped, along: this.lastAlong, lateral: NaN, confidence: 'lost', acquired: false };
    }

    this.lastMatchT = tMs;
    if (best.fwd > 0) {
      this.lastUnwrapped += best.fwd;
      this.lastAlong = best.c.along;
    }
    const good = best.c.lateral <= this.cfg.goodLateralM + acc * 0.5;
    return {
      unwrapped: this.lastUnwrapped,
      along: this.lastAlong,
      lateral: best.c.lateral,
      confidence: good ? 'good' : 'uncertain',
      acquired: false,
    };
  }

  private acquire(p: XY, tMs: number, acc: number, motion: XY | null): ProgressResult {
    let cands = this.track.candidates(p, this.cfg.acquireLateralM + acc);
    if (motion && (motion.x !== 0 || motion.y !== 0)) {
      const aligned = cands.filter((c) => dot(this.track.tangentAt(c.along), motion) > 0.2 * Math.hypot(motion.x, motion.y));
      cands = aligned;
    }
    if (!cands.length) {
      return { unwrapped: this.lastUnwrapped, along: this.lastAlong, lateral: NaN, confidence: 'lost', acquired: false };
    }
    cands.sort((a, b) => a.lateral - b.lateral);
    const best = cands[0];
    // Another, distinct part of the track almost as close: we can't be sure which one we are on.
    const ambiguous = cands.some(
      (c) => Math.abs(this.track.signedDelta(best.along, c.along)) > 50 && c.lateral - best.lateral < 5,
    );

    if (this.hasHistory) {
      // Re-acquisition after signal loss: assume the vehicle kept moving forward.
      const fwd = this.track.closed
        ? this.track.wrap(best.along - this.lastAlong)
        : Math.max(0, best.along - this.lastAlong);
      this.lastUnwrapped += fwd;
    } else {
      this.lastUnwrapped = best.along;
    }
    this.lastAlong = best.along;
    this.hasHistory = true;
    this.locked = true;
    this.lastMatchT = tMs;
    return {
      unwrapped: this.lastUnwrapped,
      along: best.along,
      lateral: best.lateral,
      confidence: ambiguous ? 'lost' : 'uncertain',
      acquired: true,
    };
  }
}
