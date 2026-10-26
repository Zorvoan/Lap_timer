import { detectCrossing, distanceToLine, type TimingLineXY } from './lines';
import type { XY } from './geo';

export interface LapTimerConfig {
  /** Laps shorter than this are rejected as spurious crossings, ms. */
  minLapMs: number;
  /** Crossings of the same line within this window after a valid one are ignored, ms. */
  cooldownMs: number;
  /** After a crossing, a line re-arms only once the position is this far from it, metres. */
  rearmDistanceM: number;
}

export const DEFAULT_LAP_TIMER_CONFIG: LapTimerConfig = {
  minLapMs: 20_000,
  cooldownMs: 3_000,
  rearmDistanceM: 20,
};

export interface TimedPoint {
  /** Timestamp, epoch milliseconds (fractional allowed). */
  t: number;
  p: XY;
}

export type TimingEvent =
  | { type: 'lap_start'; t: number; lap: number; gapMs: number }
  | { type: 'lap_complete'; t: number; lap: number; lapTimeMs: number; sectorTimesMs: number[]; gapMs: number }
  | { type: 'sector'; t: number; lap: number; sector: number; splitMs: number; gapMs: number }
  | { type: 'wrong_direction'; t: number; line: LineId }
  | { type: 'short_lap_ignored'; t: number; lap: number; elapsedMs: number };

export type LineId = 'start' | 'finish' | `sector${number}`;

interface LineState {
  id: LineId;
  line: TimingLineXY;
  armed: boolean;
  lastCrossT: number;
}

export type LapPhase = 'waiting' | 'running';

/**
 * Pure lap-timing state machine fed with consecutive positions.
 *
 * Closed circuits use one start/finish line: the first valid crossing starts lap 1 (placing the
 * line never counts as a lap), each further crossing completes a lap and starts the next.
 * Sprint routes use separate start and finish lines.
 * Crossing timestamps are linearly interpolated between the two samples that straddle the line.
 */
export class LapTimer {
  private readonly lines: LineState[];
  private readonly sectorCount: number;
  private readonly sprint: boolean;
  private phase_: LapPhase = 'waiting';
  private lap_ = 0;
  private lapStartT = 0;
  private sectorCrossT: number[] = [];

  constructor(
    start: TimingLineXY,
    sectors: TimingLineXY[],
    finish: TimingLineXY | null,
    private readonly cfg: LapTimerConfig = DEFAULT_LAP_TIMER_CONFIG,
    /**
     * The start line's own crossings don't start a run: the caller decides when it really began
     * (see {@link passLine}). Crossings that end a lap still count as they happen.
     */
    private readonly holdStart = false,
  ) {
    this.sprint = finish !== null;
    this.sectorCount = sectors.length;
    const mk = (id: LineId, line: TimingLineXY): LineState => ({ id, line, armed: true, lastCrossT: -Infinity });
    this.lines = [mk('start', start), ...sectors.map((s, i) => mk(`sector${i}`, s))];
    if (finish) this.lines.push(mk('finish', finish));
  }

  get phase(): LapPhase {
    return this.phase_;
  }

  /** Number of the lap in progress (or last started), 1-based; 0 before the first start. */
  get lap(): number {
    return this.lap_;
  }

  get currentLapStartT(): number | null {
    return this.phase_ === 'running' ? this.lapStartT : null;
  }

  /** Abandons the lap in progress (e.g. session paused); timing resumes at the next start crossing. */
  abortLap(): void {
    this.phase_ = 'waiting';
    this.sectorCrossT = [];
  }

  process(prev: TimedPoint, cur: TimedPoint): TimingEvent[] {
    const events: TimingEvent[] = [];
    const gapMs = cur.t - prev.t;
    if (gapMs <= 0) return events;

    const hits: { st: LineState; t: number; correct: boolean }[] = [];
    for (const st of this.lines) {
      const c = detectCrossing(prev.p, cur.p, st.line);
      if (c) hits.push({ st, t: prev.t + c.fraction * gapMs, correct: c.correctDirection });
    }
    hits.sort((a, b) => a.t - b.t);

    const crossed = new Set<LineState>();
    for (const h of hits) {
      crossed.add(h.st);
      if (this.holdStart && h.st.id === 'start' && this.phase_ === 'waiting') continue;
      if (!h.st.armed) continue;
      if (h.t - h.st.lastCrossT < this.cfg.cooldownMs) continue;
      if (!h.correct) {
        events.push({ type: 'wrong_direction', t: h.t, line: h.st.id });
        continue;
      }
      if (this.handleCrossing(h.st, h.t, gapMs, events)) {
        h.st.armed = false;
        h.st.lastCrossT = h.t;
      }
    }

    for (const st of this.lines) {
      if (!st.armed && !crossed.has(st) && distanceToLine(cur.p, st.line) > this.cfg.rearmDistanceM) st.armed = true;
    }
    return events;
  }

  /**
   * The start or finish passed by distance along the route rather than by the positions crossing
   * the line: a line is only a few metres wide either side of the mapped road, and a run driven
   * beside it (GPS offset, a wide road, joining from a side road at the start) misses it. Counts
   * exactly like a crossing at `t`, and like one it is ignored while the line is disarmed.
   */
  passLine(id: 'start' | 'finish', t: number, gapMs: number): TimingEvent[] {
    const events: TimingEvent[] = [];
    const st = this.lines.find((l) => l.id === id);
    if (!st || !st.armed || t - st.lastCrossT < this.cfg.cooldownMs) return events;
    if (this.handleCrossing(st, t, gapMs, events)) {
      st.armed = false;
      st.lastCrossT = t;
    }
    return events;
  }

  /** Returns true when the crossing was consumed (line should disarm). */
  private handleCrossing(st: LineState, t: number, gapMs: number, events: TimingEvent[]): boolean {
    if (st.id === 'start' && !this.sprint) {
      if (this.phase_ === 'waiting') {
        this.startLap(t, gapMs, events);
        return true;
      }
      return this.completeLap(t, gapMs, events, true);
    }
    if (st.id === 'start') {
      if (this.phase_ === 'running') return false;
      this.startLap(t, gapMs, events);
      return true;
    }
    if (st.id === 'finish') {
      if (this.phase_ !== 'running') return false;
      return this.completeLap(t, gapMs, events, false);
    }
    // Sector line: only counts in order, during a lap.
    const idx = Number(st.id.slice('sector'.length));
    if (this.phase_ !== 'running' || idx !== this.sectorCrossT.length) return false;
    const prevT = idx === 0 ? this.lapStartT : this.sectorCrossT[idx - 1];
    this.sectorCrossT.push(t);
    events.push({ type: 'sector', t, lap: this.lap_, sector: idx, splitMs: t - prevT, gapMs });
    return true;
  }

  private startLap(t: number, gapMs: number, events: TimingEvent[]): void {
    this.phase_ = 'running';
    this.lap_ += 1;
    this.lapStartT = t;
    this.sectorCrossT = [];
    events.push({ type: 'lap_start', t, lap: this.lap_, gapMs });
  }

  private completeLap(t: number, gapMs: number, events: TimingEvent[], restart: boolean): boolean {
    const elapsed = t - this.lapStartT;
    if (elapsed < this.cfg.minLapMs) {
      events.push({ type: 'short_lap_ignored', t, lap: this.lap_, elapsedMs: elapsed });
      return true;
    }
    const sectorTimesMs: number[] = [];
    if (this.sectorCount > 0 && this.sectorCrossT.length === this.sectorCount) {
      let last = this.lapStartT;
      for (const s of this.sectorCrossT) {
        sectorTimesMs.push(s - last);
        last = s;
      }
      sectorTimesMs.push(t - last);
    }
    events.push({ type: 'lap_complete', t, lap: this.lap_, lapTimeMs: elapsed, sectorTimesMs, gapMs });
    if (restart) this.startLap(t, gapMs, events);
    else {
      this.phase_ = 'waiting';
      this.sectorCrossT = [];
    }
    return true;
  }
}
