import { computeDelta, type ReferenceLap } from './delta';
import { cross, dot, headingToVector, norm, sub, unit, type LatLon, type XY } from './geo';
import { DEFAULT_GPS_FILTER_CONFIG, GpsFilter, type GpsFilterConfig, type GpsSample, type SampleStatus } from './gps';
import { detectCrossing, distanceToLine, lineAlong, lineToXY, type TimingLineXY } from './lines';
import type { CircuitDefinition, LapFlag, LapRecord, LapTracePoint, SessionMark } from './model';
import { DEFAULT_PROGRESS_CONFIG, ProgressTracker, type ProgressConfidence, type ProgressConfig } from './progress';
import { DEFAULT_LAP_TIMER_CONFIG, LapTimer, type LapTimerConfig, type TimingEvent } from './timing';
import { GeometryError, TrackModel } from './track';

export interface EngineConfig {
  gps: GpsFilterConfig;
  timing: LapTimerConfig;
  progress: ProgressConfig;
  /** How long "Lap completed" stays as the displayed state, ms. */
  lapCompletedHoldMs: number;
  /** No fix for this long means the signal is considered lost, ms. */
  signalLostMs: number;
  /** A gap between usable fixes longer than this flags the lap, ms. */
  gapFlagMs: number;
}

export const DEFAULT_ENGINE_CONFIG: EngineConfig = {
  gps: DEFAULT_GPS_FILTER_CONFIG,
  timing: DEFAULT_LAP_TIMER_CONFIG,
  progress: DEFAULT_PROGRESS_CONFIG,
  lapCompletedHoldMs: 4000,
  signalLostMs: 4000,
  gapFlagMs: 3000,
};

export type LapState = 'waiting_start' | 'in_lap' | 'lap_completed' | 'paused';
export type GpsState = 'no_fix' | 'good' | 'weak' | 'lost';

export interface LiveDelta {
  deltaMs: number;
  referenceElapsedMs: number;
  projectedLapMs: number;
  /** False when position on the circuit is uncertain; the UI must not present it as precise. */
  reliable: boolean;
}

export interface LiveSnapshot {
  lapState: LapState;
  gpsState: GpsState;
  trackConfidence: ProgressConfidence | null;
  /** Lap in progress (1-based), or 0 before the first start crossing. */
  lap: number;
  lapStartT: number | null;
  lastSampleT: number | null;
  /** Distance into the current lap, m. */
  lapDistanceM: number | null;
  lapLengthM: number;
  speedMs: number | null;
  speedSource: 'gps' | 'derived' | null;
  accuracyM: number | null;
  /** Raw GPS position of the last fix. */
  position: LatLon | null;
  /** The last fix placed on the circuit centreline (null while it cannot be matched to the track). */
  trackPosition: LatLon | null;
  delta: LiveDelta | null;
  lastLap: LapRecord | null;
  bestLap: LapRecord | null;
  completedLaps: number;
}

export interface RecordedSample extends GpsSample {
  status: SampleStatus;
}

interface LapInProgress {
  lap: number;
  startT: number;
  u0: number;
  trace: LapTracePoint[];
  flags: Set<LapFlag>;
  maxSpeed: number | null;
  samples: number;
  poorSamples: number;
  accuracySum: number;
  maxGapMs: number;
  lastGoodT: number;
}

interface GoodPoint {
  t: number;
  p: XY;
  unwrapped: number;
  /** Position along the track, [0, length]. */
  along: number;
  confidence: ProgressConfidence;
}

/** A start or finish passed by distance along the route counts only this close to the road, m… */
const PASS_LATERAL_M = 40;
/** …while moving along it at least this far between the two fixes, m… */
const PASS_MIN_STEP_M = 3;
/** …and is looked for this close to the line, so a line passed while the GPS was out still counts, m… */
const PASS_NEAR_M = 300;
/** …as long as the road between the two fixes could be driven in the time between them, m/s. */
const PASS_MAX_SPEED_MS = 90;
/** Another stretch of road (this far along from the nearest point, m)… */
const PASS_OTHER_STRETCH_M = 50;
/** …this much further away than the nearest may be where the fix is instead (a road driven both ways), m. */
const PASS_SAME_ROAD_M = 15;
/** A run has begun once it is this far past the start line, so GPS wander while standing at it doesn't, m. */
const START_CONFIRM_M = 25;
/** Leaving from a fix this far past the start line still starts there (joined from the side, parked on it), m. */
const START_BEHIND_M = 5;
/** A fix at exactly the previous position while moving faster than this is a frozen receiver, m/s. */
const FROZEN_SPEED_MS = 1;
/** A start line crossed at this speed or more is the car driving off, not GPS wander, m/s. */
const START_MOVING_MS = 2;
/** …unless the car is still near the line this long after it, having stopped again, ms. */
const START_RESTART_MS = 5000;

/** The moment a run seems to have started, held until the car is clearly on its way. */
interface PendingStart {
  t: number;
  gapMs: number;
  prev: GoodPoint;
  cur: GoodPoint;
  /** Crossed while driving: GPS wander in the next moments doesn't replace it. */
  moving: boolean;
}

/**
 * Turns a stream of raw GPS fixes into laps, live delta and display state.
 * Deterministic and free of I/O: the same samples always produce the same laps, which is
 * what makes session recovery (replaying stored samples) and fixture tests possible.
 */
export class SessionEngine {
  readonly track: TrackModel;
  readonly lapLengthM: number;
  private readonly startAlong: number;
  private readonly finishAlong: number | null = null;
  private readonly cfg: EngineConfig;
  private readonly filter: GpsFilter;
  private readonly tracker: ProgressTracker;
  private readonly timer: LapTimer;
  private reference: ReferenceLap | null;

  private readonly laps_: LapRecord[] = [];
  private readonly samples_: RecordedSample[] = [];
  private readonly marks_: SessionMark[] = [];
  private current: LapInProgress | null = null;
  private lastGood: GoodPoint | null = null;
  private lastFix: { sample: GpsSample; speedMs: number | null; speedSource: 'gps' | 'derived' | null; status: SampleStatus } | null = null;
  private lastConfidence: ProgressConfidence | null = null;
  private lastDelta: LiveDelta | null = null;
  private lapDistance: number | null = null;
  private paused_ = false;
  private readonly startLine: TimingLineXY;
  private pendingStart: PendingStart | null = null;
  /** Whether the previous step crossed the start line, so the next one doesn't start again from behind it. */
  private startedLastStep = false;
  private lastRaw: GpsSample | null = null;

  constructor(circuit: CircuitDefinition, config: Partial<EngineConfig> = {}, reference: ReferenceLap | null = null) {
    this.cfg = { ...DEFAULT_ENGINE_CONFIG, ...config };
    this.track = TrackModel.fromCoordinates(circuit.geometry, circuit.kind === 'closed');
    const startAlong = lineAlong(this.track, circuit.startLine);
    if (startAlong === null) {
      throw new GeometryError([{ code: 'too_few_points', severity: 'error', message: 'The start/finish line does not cross the circuit.' }]);
    }
    this.startAlong = startAlong;
    let finish = null;
    if (circuit.kind === 'sprint') {
      if (!circuit.finishLine) throw new Error('A sprint route needs a finish line.');
      const finishAlong = lineAlong(this.track, circuit.finishLine);
      if (finishAlong === null || finishAlong <= startAlong) {
        throw new GeometryError([{ code: 'too_short', severity: 'error', message: 'The finish line must cross the route after the start line.' }]);
      }
      this.lapLengthM = finishAlong - startAlong;
      this.finishAlong = finishAlong;
      finish = lineToXY(this.track, circuit.finishLine);
    } else {
      this.lapLengthM = this.track.length;
    }
    this.filter = new GpsFilter(this.cfg.gps);
    this.tracker = new ProgressTracker(this.track, this.cfg.progress);
    this.startLine = lineToXY(this.track, circuit.startLine);
    this.timer = new LapTimer(this.startLine, circuit.sectors.map((s) => lineToXY(this.track, s)), finish, this.cfg.timing, true);
    this.reference = reference;
  }

  get laps(): readonly LapRecord[] {
    return this.laps_;
  }

  get samples(): readonly RecordedSample[] {
    return this.samples_;
  }

  get marks(): readonly SessionMark[] {
    return this.marks_;
  }

  get paused(): boolean {
    return this.paused_;
  }

  setReference(ref: ReferenceLap | null): void {
    this.reference = ref;
    this.lastDelta = null;
  }

  /** Stops timing: the lap in progress is discarded and the next start crossing begins a new one. */
  pause(t: number): void {
    if (this.paused_) return;
    this.paused_ = true;
    this.marks_.push({ type: 'pause', t });
    this.timer.abortLap();
    this.pendingStart = null;
    this.current = null;
    this.lastGood = null;
    this.lastDelta = null;
    this.lapDistance = null;
  }

  resume(t: number): void {
    if (!this.paused_) return;
    this.paused_ = false;
    this.marks_.push({ type: 'resume', t });
    this.filter.reset();
    this.tracker.reset();
  }

  /** Feeds one raw fix. Returns timing events produced by it (lap starts, completions, ...). */
  push(raw: GpsSample): TimingEvent[] {
    if (this.paused_) return [];
    // A receiver that stops updating repeats its last position with new timestamps; timing on it
    // would place the car where it was seconds ago. Treated as no fix, so the gap is bridged.
    const last = this.lastRaw;
    this.lastRaw = raw;
    if (last && raw.lat === last.lat && raw.lon === last.lon && (raw.speed ?? 0) > FROZEN_SPEED_MS) {
      this.samples_.push({ ...raw, status: 'rejected' });
      return [];
    }
    const f = this.filter.process(raw);
    this.samples_.push({ ...raw, status: f.status });
    if (f.status === 'rejected') return [];

    this.lastFix = { sample: raw, speedMs: f.speedMs, speedSource: f.speedSource, status: f.status };
    const cur = this.current;
    if (cur) {
      cur.samples++;
      cur.accuracySum += raw.accuracy;
    }
    if (f.status === 'poor_accuracy') {
      if (cur) {
        cur.poorSamples++;
        cur.flags.add('poor_gps');
      }
      if (this.lastDelta) this.lastDelta = { ...this.lastDelta, reliable: false };
      this.lastConfidence = 'lost';
      return [];
    }
    if (f.reanchored) this.lastGood = null;

    const p = this.track.toXY(raw);
    let motion: XY | null = null;
    if (this.lastGood && norm(sub(p, this.lastGood.p)) > 2) motion = sub(p, this.lastGood.p);
    else if (raw.heading !== null && Number.isFinite(raw.heading) && (f.speedMs ?? 0) > 2) motion = headingToVector(raw.heading);

    const prog = this.tracker.update(p, raw.t, f.speedMs, raw.accuracy, motion);
    this.lastConfidence = prog.confidence;
    const good: GoodPoint = { t: raw.t, p, unwrapped: prog.unwrapped, along: prog.along, confidence: prog.confidence };

    const events: TimingEvent[] = [];
    if (this.lastGood) {
      const prev = this.lastGood;
      for (const ev of this.timer.process(prev, good)) {
        events.push(ev);
        this.applyEvent(ev, prev, good);
      }
      if (this.timer.phase === 'waiting') this.trackStart(prev, good, f.speedMs, events);
      else {
        this.pendingStart = null;
        // The end of a lap passed beside the line, by distance along the road: counts at once.
        const end: ['start' | 'finish', number] = this.finishAlong !== null ? ['finish', this.finishAlong] : ['start', this.startAlong];
        const frac = this.passedAt(prev, good, end[1]);
        if (frac !== null) {
          for (const ev of this.timer.passLine(end[0], prev.t + frac * (good.t - prev.t), good.t - prev.t)) {
            events.push(ev);
            this.applyEvent(ev, prev, good);
          }
        }
      }
    }

    const lap = this.current;
    if (lap) {
      const gap = raw.t - lap.lastGoodT;
      lap.maxGapMs = Math.max(lap.maxGapMs, gap);
      if (gap > this.cfg.gapFlagMs) lap.flags.add('signal_gap');
      lap.lastGoodT = raw.t;
      if (f.speedMs !== null) lap.maxSpeed = Math.max(lap.maxSpeed ?? 0, f.speedMs);
      if (prog.confidence === 'lost') {
        lap.flags.add('tracking_lost');
        this.lapDistance = null;
        if (this.lastDelta) this.lastDelta = { ...this.lastDelta, reliable: false };
      } else {
        const d = Math.max(0, prog.unwrapped - lap.u0);
        this.lapDistance = d;
        const elapsed = raw.t - lap.startT;
        lap.trace.push({ t: elapsed, d, v: f.speedMs, lat: raw.lat, lon: raw.lon, accuracy: raw.accuracy });
        if (this.reference) {
          const dRef = (d * this.reference.lengthM) / this.lapLengthM;
          const r = computeDelta(this.reference, elapsed, dRef);
          this.lastDelta = { ...r, reliable: prog.confidence === 'good' && d <= this.lapLengthM * 1.02 };
        }
      }
    }
    this.lastGood = good;
    return events;
  }

  /**
   * Where between two fixes the run passed `lineAlong` on the route, as a fraction of the step, or
   * null when it did not: both fixes near the road and moving forward along it. Placed on the road
   * by plain projection rather than by the tracker, which may not have picked up the road yet when
   * it is joined right at the start.
   */
  private passedAt(prev: GoodPoint, cur: GoodPoint, lineAlong: number, behindM = 0): number | null {
    const mid = this.track.pointAt(lineAlong);
    if (norm(sub(prev.p, mid)) > PASS_NEAR_M && norm(sub(cur.p, mid)) > PASS_NEAR_M) return null;
    const a = this.alongNear(prev.p, lineAlong);
    const b = this.alongNear(cur.p, lineAlong);
    if (a === null || b === null) return null;
    const step = this.track.signedDelta(a, b);
    if (step < PASS_MIN_STEP_M || step > ((cur.t - prev.t) / 1000) * PASS_MAX_SPEED_MS) return null;
    const toLine = this.track.signedDelta(a, lineAlong);
    // Half-open, so a fix right on the line counts once, for the step that leaves it; leaving from a
    // little past it (`behindM`) counts as leaving from it.
    if (toLine < -behindM || toLine >= step) return null;
    return Math.max(0, toLine) / step;
  }

  /**
   * Before a run: the start line crossed (or passed beside it, by distance along the road) is only
   * noted, and each later crossing replaces it; the run starts at the last one once the car is
   * {@link START_CONFIRM_M} past the line. Standing at the start, GPS wander crosses the line back
   * and forth; the crossing that counts is the one the car drove away from. A crossing made while
   * driving is kept, so wander as the car drives through doesn't move the start later.
   */
  private trackStart(prev: GoodPoint, cur: GoodPoint, speedMs: number | null, events: TimingEvent[]): void {
    const dt = cur.t - prev.t;
    const c = detectCrossing(prev.p, cur.p, this.startLine);
    const frac = c?.correctDirection ? c.fraction : this.passedAt(prev, cur, this.startAlong, this.startedLastStep ? 0 : START_BEHIND_M);
    this.startedLastStep = frac !== null;
    const held = this.pendingStart;
    if (frac !== null && (!held || !held.moving || cur.t - held.cur.t > START_RESTART_MS)) {
      this.pendingStart = { t: prev.t + frac * dt, gapMs: dt, prev, cur, moving: (speedMs ?? 0) >= START_MOVING_MS };
    }
    const pend = this.pendingStart;
    if (!pend) return;
    const at = this.alongNear(cur.p, this.startAlong);
    // Beside the road beyond matching it, how far past the line the raw position is.
    const ahead = Math.sign(cross(sub(this.startLine.b, this.startLine.a), sub(cur.p, this.startLine.a))) === this.startLine.direction;
    const past = at !== null ? this.track.signedDelta(this.startAlong, at) : ahead ? distanceToLine(cur.p, this.startLine) : -distanceToLine(cur.p, this.startLine);
    if (past < -START_CONFIRM_M) this.pendingStart = null;
    else if (past >= START_CONFIRM_M) {
      this.pendingStart = null;
      for (const ev of this.timer.passLine('start', pend.t, pend.gapMs)) {
        events.push(ev);
        this.applyEvent(ev, pend.prev, pend.cur);
      }
    }
  }

  /**
   * Where `p` lies on the road: its nearest point, or where another stretch of road (driven both
   * ways) passes about as close, the one nearest `lineAlong`. Null when the road is far. Beyond the
   * ends of a route the road is taken to carry straight on ({@link beyondEnd}), so a line near an
   * end is still passed at the right moment.
   */
  private alongNear(p: XY, lineAlong: number): number | null {
    const cands = this.track.candidates(p, PASS_LATERAL_M);
    if (!cands.length) return this.beyondEnd(p, lineAlong);
    const nearest = cands.reduce((a, c) => (c.lateral < a.lateral ? c : a));
    const toLine = (along: number) => Math.abs(this.track.signedDelta(along, lineAlong));
    let best = nearest;
    for (const c of cands) {
      const otherStretch = Math.abs(this.track.signedDelta(c.along, nearest.along)) > PASS_OTHER_STRETCH_M;
      if (otherStretch && c.lateral <= nearest.lateral + PASS_SAME_ROAD_M && toLine(c.along) < toLine(best.along)) best = c;
    }
    const atEnd = (best.seg === 0 && best.t <= 0) || (best.seg === this.track.segmentCount - 1 && best.t >= 1);
    return (atEnd ? this.beyondEnd(p, lineAlong) : null) ?? best.along;
  }

  /**
   * A position before the start or past the end of a route, along the road carried straight on
   * (where the GPS comes back after a line, or a driver parks after the finish): its distance
   * along (negative before the start), or null. Where both ends are near (a road that comes back
   * to where it began), the end nearer `lineAlong`.
   */
  private beyondEnd(p: XY, lineAlong: number): number | null {
    if (this.track.closed) return null;
    const { pts } = this.track;
    const n = pts.length;
    let best: number | null = null;
    for (const [end, from, sign, base] of [[pts[n - 1], pts[n - 2], 1, this.track.length], [pts[0], pts[1], -1, 0]] as const) {
      const dir = unit(sub(end, from));
      const out = dot(sub(p, end), dir);
      const side = Math.abs(dir.x * (p.y - end.y) - dir.y * (p.x - end.x));
      const along = base + sign * out;
      if (out > 0 && side <= PASS_LATERAL_M && (best === null || Math.abs(along - lineAlong) < Math.abs(best - lineAlong))) best = along;
    }
    return best;
  }

  private applyEvent(ev: TimingEvent, prev: GoodPoint, cur: GoodPoint): void {
    const frac = (ev.t - prev.t) / (cur.t - prev.t);
    const uAtCross = prev.unwrapped + frac * (cur.unwrapped - prev.unwrapped);
    switch (ev.type) {
      case 'lap_start': {
        // Anchor lap distance exactly at the line so every lap shares one distance coordinate.
        // Track position is interpolated directly: on open routes `unwrapped` and position drift
        // apart after re-acquisition (e.g. returning to the start of a sprint).
        const alongAtCross = this.track.wrap(prev.along + frac * this.track.signedDelta(prev.along, cur.along));
        const u0 = uAtCross + this.track.signedDelta(alongAtCross, this.startAlong);
        const pos = this.track.frame.toLatLon({ x: prev.p.x + frac * (cur.p.x - prev.p.x), y: prev.p.y + frac * (cur.p.y - prev.p.y) });
        const flags = new Set<LapFlag>();
        if (ev.gapMs > this.cfg.gapFlagMs) flags.add('crossing_interpolated_over_gap');
        this.current = {
          lap: ev.lap,
          startT: ev.t,
          u0,
          trace: [{ t: 0, d: 0, v: null, lat: pos.lat, lon: pos.lon, accuracy: NaN }],
          flags,
          maxSpeed: null,
          samples: 0,
          poorSamples: 0,
          accuracySum: 0,
          maxGapMs: 0,
          lastGoodT: ev.t,
        };
        this.lastDelta = null;
        this.lapDistance = 0;
        break;
      }
      case 'lap_complete': {
        const lap = this.current;
        if (!lap) break;
        const distanceM = Math.max(0, uAtCross - lap.u0);
        const pos = this.track.frame.toLatLon({ x: prev.p.x + frac * (cur.p.x - prev.p.x), y: prev.p.y + frac * (cur.p.y - prev.p.y) });
        // Keep the trace strictly before the crossing, then close it at the exact lap time.
        const trace = lap.trace.filter((pt) => pt.t < ev.lapTimeMs);
        trace.push({ t: ev.lapTimeMs, d: this.lapLengthM, v: null, lat: pos.lat, lon: pos.lon, accuracy: NaN });
        const flags = new Set(lap.flags);
        if (ev.gapMs > this.cfg.gapFlagMs) flags.add('crossing_interpolated_over_gap');
        const ratio = distanceM / this.lapLengthM;
        if (ratio < 0.85 || ratio > 1.2) flags.add('distance_mismatch');
        // Lap time comes from line crossings alone; a distance far from the lap length means a
        // crossing was missed (or spurious), so the time cannot be trusted.
        const valid = !flags.has('distance_mismatch');
        const durationS = ev.lapTimeMs / 1000;
        const record: LapRecord = {
          lap: lap.lap,
          startT: lap.startT,
          endT: ev.t,
          timeMs: ev.lapTimeMs,
          sectorTimesMs: ev.sectorTimesMs,
          distanceM,
          avgSpeedMs: distanceM / durationS,
          maxSpeedMs: lap.maxSpeed,
          valid,
          flags: [...flags],
          gps: {
            samples: lap.samples,
            poorSamples: lap.poorSamples,
            meanAccuracyM: lap.samples ? lap.accuracySum / lap.samples : NaN,
            maxGapMs: Math.max(lap.maxGapMs, ev.t - lap.lastGoodT),
            meanRateHz: lap.samples / durationS,
          },
          trace,
        };
        this.laps_.push(record);
        this.current = null;
        this.lapDistance = null;
        break;
      }
      default:
        break;
    }
  }

  /** Display state. `nowT` (same clock as sample timestamps) lets it detect signal loss. */
  snapshot(nowT?: number): LiveSnapshot {
    const lastT = this.lastFix?.sample.t ?? null;
    let gpsState: GpsState = 'no_fix';
    if (this.lastFix) {
      if (nowT !== undefined && lastT !== null && nowT - lastT > this.cfg.signalLostMs) gpsState = 'lost';
      else if (this.lastFix.status === 'poor_accuracy' || this.lastConfidence === 'lost') gpsState = 'weak';
      else gpsState = 'good';
    }
    const lastLap = this.laps_.length ? this.laps_[this.laps_.length - 1] : null;
    let lapState: LapState = 'waiting_start';
    if (this.paused_) lapState = 'paused';
    else if (lastLap && lastT !== null && (nowT ?? lastT) - lastLap.endT < this.cfg.lapCompletedHoldMs) lapState = 'lap_completed';
    else if (this.current) lapState = 'in_lap';
    const lost = gpsState === 'lost';
    return {
      lapState,
      gpsState,
      trackConfidence: this.lastConfidence,
      lap: this.current?.lap ?? 0,
      lapStartT: this.current?.startT ?? null,
      lastSampleT: lastT,
      lapDistanceM: this.lapDistance,
      lapLengthM: this.lapLengthM,
      speedMs: lost ? null : this.lastFix?.speedMs ?? null,
      speedSource: this.lastFix?.speedSource ?? null,
      accuracyM: this.lastFix?.sample.accuracy ?? null,
      position: this.lastFix ? { lat: this.lastFix.sample.lat, lon: this.lastFix.sample.lon } : null,
      trackPosition: this.lastGood && this.lastConfidence !== 'lost' && !lost ? this.track.latLonAt(this.lastGood.along) : null,
      delta: this.current && this.lastDelta ? { ...this.lastDelta, reliable: this.lastDelta.reliable && !lost } : null,
      lastLap,
      bestLap: bestLap(this.laps_),
      completedLaps: this.laps_.length,
    };
  }

  /** Rebuilds engine state from stored samples and pause/resume marks (session recovery). */
  replay(samples: readonly GpsSample[], marks: readonly SessionMark[] = []): void {
    const ms = [...marks].sort((a, b) => a.t - b.t);
    let mi = 0;
    for (const s of samples) {
      while (mi < ms.length && ms[mi].t <= s.t) {
        const m = ms[mi++];
        if (m.type === 'pause') this.pause(m.t);
        else this.resume(m.t);
      }
      this.push(stripStatus(s));
    }
    while (mi < ms.length) {
      const m = ms[mi++];
      if (m.type === 'pause') this.pause(m.t);
      else this.resume(m.t);
    }
  }
}

function stripStatus(s: GpsSample | RecordedSample): GpsSample {
  return {
    t: s.t,
    lat: s.lat,
    lon: s.lon,
    accuracy: s.accuracy,
    speed: s.speed,
    heading: s.heading,
    altitude: s.altitude,
    altitudeAccuracy: s.altitudeAccuracy,
  };
}

/** Fastest valid lap. */
export function bestLap(laps: readonly LapRecord[]): LapRecord | null {
  let best: LapRecord | null = null;
  for (const l of laps) if (l.valid && (!best || l.timeMs < best.timeMs)) best = l;
  return best;
}
