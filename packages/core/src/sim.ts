/**
 * DEVELOPMENT SIMULATOR — produces synthetic GPS fixes along a circuit for tests and for the
 * clearly labelled simulation mode in the app. Never used as a fallback for real GPS.
 */
import { bearingDeg, type XY } from './geo';
import type { GpsSample } from './gps';
import type { TrackModel } from './track';

/** Small deterministic PRNG (mulberry32). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function gaussian(rng: () => number): number {
  const u = Math.max(rng(), 1e-12);
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export interface SpeedProfileOptions {
  vMaxMs: number;
  /** Lateral acceleration limit, m/s². */
  latAccMs2: number;
  accelMs2: number;
  brakeMs2: number;
  stepM: number;
}

export const DEFAULT_SPEED_PROFILE: SpeedProfileOptions = {
  vMaxMs: 50,
  latAccMs2: 8,
  accelMs2: 3.5,
  brakeMs2: 7,
  stepM: 5,
};

export interface SpeedProfile {
  stepM: number;
  v: Float64Array;
  closed: boolean;
}

/** Physically plausible speed along the track from curvature and accel/brake limits. */
export function buildSpeedProfile(track: TrackModel, opts: Partial<SpeedProfileOptions> = {}): SpeedProfile {
  const o = { ...DEFAULT_SPEED_PROFILE, ...opts };
  const n = Math.max(2, Math.ceil(track.length / o.stepM) + 1);
  const v = new Float64Array(n);
  const win = 12;
  for (let i = 0; i < n; i++) {
    const d = i * o.stepM;
    const t1 = track.tangentAt(track.closed ? d - win : Math.max(0, d - win));
    const t2 = track.tangentAt(track.closed ? d + win : Math.min(track.length - 1e-6, d + win));
    const ang = Math.abs(Math.atan2(t1.x * t2.y - t1.y * t2.x, t1.x * t2.x + t1.y * t2.y));
    const kappa = ang / (2 * win);
    v[i] = kappa > 1e-6 ? Math.min(o.vMaxMs, Math.sqrt(o.latAccMs2 / kappa)) : o.vMaxMs;
  }
  const passes = track.closed ? 2 : 1;
  for (let p = 0; p < passes; p++) {
    for (let i = 1; i < n; i++) v[i] = Math.min(v[i], Math.sqrt(v[i - 1] ** 2 + 2 * o.accelMs2 * o.stepM));
    if (track.closed) v[0] = Math.min(v[0], Math.sqrt(v[n - 1] ** 2 + 2 * o.accelMs2 * o.stepM));
  }
  for (let p = 0; p < passes; p++) {
    for (let i = n - 2; i >= 0; i--) v[i] = Math.min(v[i], Math.sqrt(v[i + 1] ** 2 + 2 * o.brakeMs2 * o.stepM));
    if (track.closed) v[n - 1] = Math.min(v[n - 1], Math.sqrt(v[0] ** 2 + 2 * o.brakeMs2 * o.stepM));
  }
  if (!track.closed) v[0] = Math.max(v[0], 3);
  for (let i = 0; i < n; i++) v[i] = Math.max(v[i], 3);
  return { stepM: o.stepM, v, closed: track.closed };
}

/** Constant-speed profile, handy for fixtures with analytically known lap times. */
export function constantSpeedProfile(track: TrackModel, speedMs: number): SpeedProfile {
  return { stepM: track.length, v: Float64Array.from([speedMs, speedMs]), closed: track.closed };
}

export function profileSpeedAt(profile: SpeedProfile, along: number): number {
  const x = along / profile.stepM;
  const n = profile.v.length;
  const i = Math.floor(x);
  const f = x - i;
  const a = profile.v[((i % n) + n) % n];
  const b = profile.v[(((i + 1) % n) + n) % n];
  return a + f * (b - a);
}

export interface SimulationOptions {
  startTimeMs: number;
  /** Fix rate, Hz. */
  hz: number;
  /** Track distance where the drive begins (place it before the start line for an out-lap). */
  startAlongM: number;
  /** Multiplier on the speed profile per lap (index 0 = first pass over the track). */
  paceFactors: number[];
  /** Position noise σ, metres. */
  noiseM: number;
  /** Reported accuracy radius, metres. */
  accuracyM: number;
  /** Reported speed noise σ, m/s. Set `reportSpeed: false` to omit receiver speed. */
  speedNoiseMs: number;
  reportSpeed: boolean;
  seed: number;
  /** Intervals (ms since start) with no fixes, to simulate signal loss. */
  dropouts: { fromMs: number; toMs: number }[];
  /**
   * Open (sprint) routes only: after passing the end, return to the start and drive again.
   * The return trip is a gap without fixes, as if driving back on other roads.
   */
  repeatSprint: boolean;
}

export const DEFAULT_SIMULATION: SimulationOptions = {
  startTimeMs: Date.UTC(2026, 0, 1, 10, 0, 0),
  hz: 5,
  startAlongM: 0,
  paceFactors: [1],
  noiseM: 1.5,
  accuracyM: 4,
  speedNoiseMs: 0.3,
  reportSpeed: true,
  seed: 1,
  dropouts: [],
  repeatSprint: false,
};

/** Steps a simulated vehicle along the track and emits synthetic fixes. */
export class DriveSimulator {
  private readonly o: SimulationOptions;
  private readonly rng: () => number;
  private travelled = 0;
  private tMs = 0;
  /** Completed sprint runs (repeatSprint) and the distance they covered. */
  private runs = 0;
  private runDistance = 0;

  constructor(
    private readonly track: TrackModel,
    private readonly profile: SpeedProfile,
    opts: Partial<SimulationOptions> = {},
  ) {
    this.o = { ...DEFAULT_SIMULATION, ...opts };
    this.rng = mulberry32(this.o.seed);
  }

  /** Distance driven so far, m. */
  get distance(): number {
    return this.runDistance + this.travelled;
  }

  private along(): number {
    return this.o.startAlongM + this.travelled;
  }

  /** Index = number of times the track's first vertex has been passed (0 = before the first pass). */
  private pace(): number {
    const lapIdx = this.track.closed ? Math.max(0, Math.floor(this.along() / this.track.length)) : this.runs;
    const pf = this.o.paceFactors;
    return pf[Math.min(lapIdx, pf.length - 1)] ?? 1;
  }

  /** Advances one fix interval. Returns the fix, or null inside a dropout window. */
  step(): GpsSample | null {
    const dt = 1 / this.o.hz;
    const sub = 4;
    for (let k = 0; k < sub; k++) {
      const v = profileSpeedAt(this.profile, this.track.wrap(this.along())) * this.pace();
      this.travelled += v * (dt / sub);
    }
    this.tMs += dt * 1000;
    if (!this.track.closed && this.o.repeatSprint && this.along() >= this.track.length + 30) {
      // Back to the start: no fixes during the transfer, which takes as long as driving it at ~20 m/s.
      this.runDistance += this.travelled;
      this.travelled = 0;
      this.runs += 1;
      this.tMs += Math.max(20_000, (this.track.length / 20) * 1000);
    }
    if (this.o.dropouts.some((d) => this.tMs >= d.fromMs && this.tMs < d.toMs)) return null;
    const along = this.track.closed ? this.along() : Math.min(this.along(), this.track.length);
    const truth = this.track.pointAt(along);
    const noisy: XY = { x: truth.x + gaussian(this.rng) * this.o.noiseM, y: truth.y + gaussian(this.rng) * this.o.noiseM };
    const ll = this.track.frame.toLatLon(noisy);
    const tan = this.track.tangentAt(along);
    const ahead = this.track.frame.toLatLon({ x: truth.x + tan.x, y: truth.y + tan.y });
    const v = profileSpeedAt(this.profile, this.track.wrap(along)) * this.pace();
    return {
      t: this.o.startTimeMs + this.tMs,
      lat: ll.lat,
      lon: ll.lon,
      accuracy: this.o.accuracyM,
      speed: this.o.reportSpeed ? Math.max(0, v + gaussian(this.rng) * this.o.speedNoiseMs) : null,
      heading: bearingDeg(this.track.frame.toLatLon(truth), ahead),
      altitude: null,
      altitudeAccuracy: null,
    };
  }
}

/** Collects simulated fixes until `distanceM` has been driven. */
export function simulateDrive(track: TrackModel, profile: SpeedProfile, distanceM: number, opts: Partial<SimulationOptions> = {}): GpsSample[] {
  const sim = new DriveSimulator(track, profile, opts);
  const out: GpsSample[] = [];
  let guard = 0;
  while (sim.distance < distanceM && guard++ < 1_000_000) {
    const s = sim.step();
    if (s) out.push(s);
  }
  return out;
}
