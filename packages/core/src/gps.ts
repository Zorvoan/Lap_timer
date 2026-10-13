import { distanceMeters, isValidLatLon } from './geo';

/** A single position fix. Timestamps and coordinates are kept at full precision. */
export interface GpsSample {
  /** Epoch milliseconds (fractional allowed). */
  t: number;
  lat: number;
  lon: number;
  /** Horizontal accuracy radius in metres as reported by the receiver. */
  accuracy: number;
  /** Receiver-reported ground speed, m/s, or null when not provided. */
  speed: number | null;
  /** Receiver-reported heading, degrees from north, or null. */
  heading: number | null;
  altitude: number | null;
  altitudeAccuracy: number | null;
}

export interface GpsFilterConfig {
  /** Fixes with a worse accuracy radius are recorded but not used for timing, metres. */
  maxAccuracyM: number;
  /** Implied speeds above this are treated as position jumps, m/s. */
  maxSpeedMs: number;
  /** After this many consecutive, mutually consistent "jumped" fixes the filter re-anchors to them. */
  reanchorAfter: number;
}

export const DEFAULT_GPS_FILTER_CONFIG: GpsFilterConfig = {
  maxAccuracyM: 20,
  maxSpeedMs: 100,
  reanchorAfter: 3,
};

export type SampleStatus = 'ok' | 'poor_accuracy' | 'rejected';
export type RejectReason = 'invalid' | 'out_of_order' | 'jump';

export interface FilterResult {
  status: SampleStatus;
  reason?: RejectReason;
  /** Best available speed estimate, m/s. */
  speedMs: number | null;
  speedSource: 'gps' | 'derived' | null;
  /** True when this sample re-anchored the filter after a run of rejected jumps. */
  reanchored: boolean;
}

/**
 * Validates and classifies raw fixes. Receiver speed (Doppler-derived, far less noisy than
 * position differences) is preferred; a smoothed distance-over-time estimate is the fallback.
 */
export class GpsFilter {
  private last: GpsSample | null = null;
  private derivedSpeed: number | null = null;
  private jumpRun: GpsSample[] = [];

  constructor(private readonly cfg: GpsFilterConfig = DEFAULT_GPS_FILTER_CONFIG) {}

  get config(): GpsFilterConfig {
    return this.cfg;
  }

  reset(): void {
    this.last = null;
    this.derivedSpeed = null;
    this.jumpRun = [];
  }

  process(s: GpsSample): FilterResult {
    const none = { speedMs: null, speedSource: null, reanchored: false } as const;
    if (!Number.isFinite(s.t) || !isValidLatLon(s) || !Number.isFinite(s.accuracy) || s.accuracy < 0) {
      return { status: 'rejected', reason: 'invalid', ...none };
    }
    if (this.last && s.t <= this.last.t) return { status: 'rejected', reason: 'out_of_order', ...none };

    let reanchored = false;
    if (this.last) {
      if (this.isJump(this.last, s)) {
        const run = this.jumpRun;
        if (run.length && this.isJump(run[run.length - 1], s)) this.jumpRun = [];
        this.jumpRun.push(s);
        if (this.jumpRun.length < this.cfg.reanchorAfter) return { status: 'rejected', reason: 'jump', ...none };
        reanchored = true;
        this.derivedSpeed = null;
      }
    }
    const prev = reanchored ? this.jumpRun[this.jumpRun.length - 2] ?? null : this.last;
    this.jumpRun = [];

    if (prev) {
      const dt = (s.t - prev.t) / 1000;
      if (dt > 0.05) {
        const v = distanceMeters(prev, s) / dt;
        this.derivedSpeed = this.derivedSpeed === null || dt > 5 ? v : this.derivedSpeed * 0.5 + v * 0.5;
      }
    }
    this.last = s;

    const status: SampleStatus = s.accuracy > this.cfg.maxAccuracyM ? 'poor_accuracy' : 'ok';
    const gpsSpeedValid = s.speed !== null && Number.isFinite(s.speed) && s.speed >= 0 && s.speed <= this.cfg.maxSpeedMs;
    if (gpsSpeedValid) return { status, speedMs: s.speed, speedSource: 'gps', reanchored };
    return {
      status,
      speedMs: this.derivedSpeed,
      speedSource: this.derivedSpeed === null ? null : 'derived',
      reanchored,
    };
  }

  /** Movement that cannot be explained by plausible speed, after allowing for both fixes' error radii. */
  private isJump(a: GpsSample, b: GpsSample): boolean {
    const dt = (b.t - a.t) / 1000;
    if (dt <= 0) return true;
    const d = Math.max(0, distanceMeters(a, b) - a.accuracy - b.accuracy);
    return d / dt > this.cfg.maxSpeedMs;
  }
}
