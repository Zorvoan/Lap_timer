import { ReferenceLap } from './delta';
import type { LatLon } from './geo';
import { lineAlong } from './lines';
import type { CircuitDefinition } from './model';
import { TrackModel } from './track';
import type { LapRecord, LapTracePoint } from './model';

export interface AlignedRow {
  /** Distance from the start line, m. */
  d: number;
  tA: number;
  tB: number;
  /** tA − tB, ms. Negative means lap A was ahead at this point. */
  deltaMs: number;
  vA: number | null;
  vB: number | null;
}

/** Trace points further apart than this have no GPS data between them (phones log about once a second), ms. */
export const TRACE_GAP_MS = 3000;

/**
 * Speed at distance d by linear interpolation over trace points with known speed. Null inside a
 * signal gap (known speeds more than `maxGapMs` apart): a straight line across it would be invented.
 */
export function speedAt(trace: readonly LapTracePoint[], d: number, maxGapMs = TRACE_GAP_MS): number | null {
  let prev: LapTracePoint | null = null;
  for (const p of trace) {
    if (p.v === null) continue;
    if (p.d >= d) {
      if (!prev || p.d === d) return p.v;
      if (p.t - prev.t > maxGapMs) return null;
      const span = p.d - prev.d;
      if (span <= 0) return p.v;
      return (prev.v as number) + ((d - prev.d) / span) * (p.v - (prev.v as number));
    }
    prev = p;
  }
  return prev ? prev.v : null;
}

/** A stretch of a lap without GPS fixes. */
export interface TraceGap {
  fromT: number;
  toT: number;
  fromD: number;
  toD: number;
}

/** Where a lap's trace has no fixes for longer than `maxGapMs`. */
export function traceGaps(trace: readonly { t: number; d: number }[], maxGapMs = TRACE_GAP_MS): TraceGap[] {
  const out: TraceGap[] = [];
  for (let i = 1; i < trace.length; i++) {
    const a = trace[i - 1];
    const b = trace[i];
    if (b.t - a.t > maxGapMs) out.push({ fromT: a.t, toT: b.t, fromD: a.d, toD: b.d });
  }
  return out;
}

/**
 * Aligns two laps by distance along the circuit (not elapsed time) on a regular grid.
 * This is what makes "where was time gained or lost" meaningful.
 */
export function compareLaps(a: LapRecord, b: LapRecord, lapLengthM: number, stepM = 5): AlignedRow[] {
  const ra = ReferenceLap.fromTrace(a.trace, a.timeMs, lapLengthM);
  const rb = ReferenceLap.fromTrace(b.trace, b.timeMs, lapLengthM);
  const rows: AlignedRow[] = [];
  const n = Math.max(1, Math.ceil(lapLengthM / stepM));
  for (let i = 0; i <= n; i++) {
    const d = Math.min(lapLengthM, i * stepM);
    const tA = ra.timeAt(d);
    const tB = rb.timeAt(d);
    rows.push({ d, tA, tB, deltaMs: tA - tB, vA: speedAt(a.trace, d), vB: speedAt(b.trace, d) });
  }
  return rows;
}

export interface GainLossSegment {
  fromD: number;
  toD: number;
  /** Time change of A relative to B over the segment, ms. Negative = A gained. */
  changeMs: number;
}

/** Splits an aligned comparison into segments of roughly `segmentM` with the time gained/lost in each. */
export function gainLoss(rows: readonly AlignedRow[], segmentM = 50): GainLossSegment[] {
  const out: GainLossSegment[] = [];
  if (rows.length < 2) return out;
  let start = rows[0];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (r.d - start.d >= segmentM || i === rows.length - 1) {
      out.push({ fromD: start.d, toD: r.d, changeMs: r.deltaMs - start.deltaMs });
      start = r;
    }
  }
  return out;
}

export interface SessionSummary {
  laps: number;
  validLaps: number;
  bestLap: LapRecord | null;
  averageValidLapMs: number | null;
  /** Theoretical best from best individual sectors, when every valid lap has sector times. */
  theoreticalBestMs: number | null;
  totalDistanceM: number;
  maxSpeedMs: number | null;
}

export function summarizeSession(laps: readonly LapRecord[]): SessionSummary {
  const valid = laps.filter((l) => l.valid);
  let best: LapRecord | null = null;
  for (const l of valid) if (!best || l.timeMs < best.timeMs) best = l;
  let theoretical: number | null = null;
  const withSectors = valid.filter((l) => l.sectorTimesMs.length > 0);
  if (withSectors.length && withSectors.every((l) => l.sectorTimesMs.length === withSectors[0].sectorTimesMs.length)) {
    theoretical = 0;
    for (let s = 0; s < withSectors[0].sectorTimesMs.length; s++) {
      theoretical += Math.min(...withSectors.map((l) => l.sectorTimesMs[s]));
    }
  }
  const speeds = laps.map((l) => l.maxSpeedMs).filter((v): v is number => v !== null);
  return {
    laps: laps.length,
    validLaps: valid.length,
    bestLap: best,
    averageValidLapMs: valid.length ? valid.reduce((s, l) => s + l.timeMs, 0) / valid.length : null,
    theoreticalBestMs: theoretical,
    totalDistanceM: laps.reduce((s, l) => s + l.distanceM, 0),
    maxSpeedMs: speeds.length ? Math.max(...speeds) : null,
  };
}

/** Position on the lap at elapsed time t (for map replay), interpolated between trace points. */
export function positionAtTime(trace: readonly LapTracePoint[], t: number): { lat: number; lon: number; d: number; v: number | null } | null {
  if (!trace.length) return null;
  if (t <= trace[0].t) return trace[0];
  for (let i = 1; i < trace.length; i++) {
    const b = trace[i];
    if (b.t >= t) {
      const a = trace[i - 1];
      const f = b.t > a.t ? (t - a.t) / (b.t - a.t) : 0;
      return {
        lat: a.lat + f * (b.lat - a.lat),
        lon: a.lon + f * (b.lon - a.lon),
        d: a.d + f * (b.d - a.d),
        v: a.v !== null && b.v !== null ? a.v + f * (b.v - a.v) : (b.v ?? a.v),
      };
    }
  }
  return trace[trace.length - 1];
}

/**
 * Times through `n` equal-distance parts of a lap, read from its trace. Works for any lap with
 * a trace, including laps on circuits without sector lines and published leaderboard laps, so
 * every lap of a circuit is split at the same points.
 */
export function splitTimes(trace: readonly { t: number; d: number }[], lapTimeMs: number, lengthM: number, n = 3): number[] {
  if (!(lengthM > 0) || !(lapTimeMs > 0) || n < 1) return [];
  const ref = ReferenceLap.fromTrace([...trace], lapTimeMs, lengthM);
  const at = Array.from({ length: n + 1 }, (_, i) => (i === n ? lapTimeMs : ref.timeAt((lengthM * i) / n)));
  return at.slice(1).map((t, i) => t - at[i]);
}

/** Best time of each sector across laps (all with the same number of sectors) and their sum. */
export function idealLap(splits: readonly (readonly number[])[]): { sectorsMs: number[]; timeMs: number; from: number[] } | null {
  const n0 = splits.find((s) => s.length > 0)?.length ?? 0;
  const usable = splits.filter((s) => s.length > 0 && s.length === n0 && s.every(Number.isFinite));
  if (!usable.length) return null;
  const n = usable[0].length;
  const sectorsMs: number[] = [];
  const from: number[] = [];
  for (let i = 0; i < n; i++) {
    let best = 0;
    for (let k = 1; k < usable.length; k++) if (usable[k][i] < usable[best][i]) best = k;
    sectorsMs.push(usable[best][i]);
    from.push(splits.indexOf(usable[best]));
  }
  return { sectorsMs, timeMs: sectorsMs.reduce((a, b) => a + b, 0), from };
}

/**
 * Maps a lap distance (metres from the start line, as in lap traces) to the point on the
 * circuit's centreline. Replays and maps use it to keep the car on the road instead of drawing
 * raw GPS fixes, which can sit several metres off it. Null when the circuit geometry is unusable.
 */
export function lapDistanceToPosition(circuit: CircuitDefinition): ((d: number) => LatLon) | null {
  let track: TrackModel;
  try {
    track = TrackModel.fromCoordinates(circuit.geometry, circuit.kind === 'closed');
  } catch {
    return null;
  }
  const s0 = lineAlong(track, circuit.startLine) ?? 0;
  return (d: number) => track.latLonAt(track.wrap(s0 + Math.max(0, d)));
}
