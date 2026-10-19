import type { LapRecord, LapTracePoint } from '@laptimer/core';

/** How a lap was driven, from its speed trace. Speeds in m/s. */
export interface DrivingStyle {
  topSpeed: number;
  avgSpeed: number;
  /** Mean apex speed of the slow corners (taken below {@link FAST_CORNER_MS}); null if there were none. */
  slowCornerSpeed: number | null;
  /** Mean apex speed of the fast corners; null if there were none. */
  fastCornerSpeed: number | null;
  slowCorners: number;
  fastCorners: number;
  /** Every corner: where it is along the lap (m) and the apex speed. */
  apexes: { d: number; v: number }[];
}

/** A corner: a speed low that dips at least this far below the fastest point around it. */
const CORNER_DIP_MS = 2.5;
/** …and is the slowest point within this distance either side. */
const CORNER_SPAN_M = 120;
/** Corners taken at 80 km/h or more count as fast, slower ones as slow. */
export const FAST_CORNER_MS = 80 / 3.6;

function smooth(pts: LapTracePoint[]): number[] {
  return pts.map((_, i) => {
    let sum = 0;
    let n = 0;
    for (let k = Math.max(0, i - 2); k <= Math.min(pts.length - 1, i + 2); k++) {
      sum += pts[k].v as number;
      n++;
    }
    return sum / n;
  });
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);

export function drivingStyle(lap: Pick<LapRecord, 'trace' | 'distanceM' | 'timeMs'>): DrivingStyle | null {
  const pts = lap.trace.filter((p) => p.v !== null && Number.isFinite(p.v));
  if (pts.length < 8 || lap.timeMs <= 0) return null;
  const v = smooth(pts);

  const apexes: { d: number; v: number }[] = [];
  for (let i = 1; i < pts.length - 1; i++) {
    let lowest = true;
    let around = v[i];
    for (let k = i - 1; k >= 0 && pts[i].d - pts[k].d <= CORNER_SPAN_M * 2; k--) {
      if (pts[i].d - pts[k].d <= CORNER_SPAN_M && v[k] < v[i]) lowest = false;
      around = Math.max(around, v[k]);
    }
    for (let k = i + 1; k < pts.length && pts[k].d - pts[i].d <= CORNER_SPAN_M * 2; k++) {
      if (pts[k].d - pts[i].d <= CORNER_SPAN_M && v[k] <= v[i]) lowest = false;
      around = Math.max(around, v[k]);
    }
    if (lowest && around - v[i] >= CORNER_DIP_MS) apexes.push({ d: pts[i].d, v: v[i] });
  }
  const slow = apexes.filter((a) => a.v < FAST_CORNER_MS).map((a) => a.v);
  const fast = apexes.filter((a) => a.v >= FAST_CORNER_MS).map((a) => a.v);

  return {
    topSpeed: Math.max(...v),
    avgSpeed: lap.distanceM / (lap.timeMs / 1000),
    slowCornerSpeed: mean(slow),
    fastCornerSpeed: mean(fast),
    slowCorners: slow.length,
    fastCorners: fast.length,
    apexes,
  };
}

/** Corners of two laps on the same road this close together (m) are the same corner. */
const SAME_CORNER_M = 80;

/**
 * Apex speeds of two laps on the same road, corner by corner: each corner found on both laps is
 * classed as slow or fast by the two speeds' average, so both laps are measured on the same
 * corners even when one takes a corner a little above the line and the other below it.
 */
export function pairedCorners(a: DrivingStyle, b: DrivingStyle): Record<'slow' | 'fast', { a: number; b: number; count: number } | null> {
  const acc = { slow: { a: 0, b: 0, count: 0 }, fast: { a: 0, b: 0, count: 0 } };
  const used = new Set<number>();
  for (const ca of a.apexes) {
    let best = -1;
    for (let j = 0; j < b.apexes.length; j++) {
      if (used.has(j) || Math.abs(b.apexes[j].d - ca.d) > SAME_CORNER_M) continue;
      if (best < 0 || Math.abs(b.apexes[j].d - ca.d) < Math.abs(b.apexes[best].d - ca.d)) best = j;
    }
    if (best < 0) continue;
    used.add(best);
    const cb = b.apexes[best];
    const kind = (ca.v + cb.v) / 2 >= FAST_CORNER_MS ? acc.fast : acc.slow;
    kind.a += ca.v;
    kind.b += cb.v;
    kind.count++;
  }
  const out = (k: { a: number; b: number; count: number }) => (k.count ? { a: k.a / k.count, b: k.b / k.count, count: k.count } : null);
  return { slow: out(acc.slow), fast: out(acc.fast) };
}

/** One corner of a road as the driver and the others took it. */
export interface FieldCorner {
  /** Where it is along the driver's lap (m). */
  d: number;
  /** The driver's apex speed. */
  mine: number;
  /** Apex speeds of the other drivers who took the same corner. */
  others: number[];
  /** Fast corner by the average apex speed of everyone who took it. */
  fast: boolean;
}

/**
 * The driver's corners matched with the same corners on other drivers' laps of the same road
 * (by position, within {@link SAME_CORNER_M}). Corners nobody else's lap shows are left out, so
 * speeds are only ever compared on the same corner.
 */
export function fieldCorners(mine: DrivingStyle, others: readonly DrivingStyle[]): FieldCorner[] {
  const used = others.map(() => new Set<number>());
  const out: FieldCorner[] = [];
  for (const c of mine.apexes) {
    const speeds: number[] = [];
    others.forEach((o, k) => {
      let best = -1;
      for (let j = 0; j < o.apexes.length; j++) {
        if (used[k].has(j) || Math.abs(o.apexes[j].d - c.d) > SAME_CORNER_M) continue;
        if (best < 0 || Math.abs(o.apexes[j].d - c.d) < Math.abs(o.apexes[best].d - c.d)) best = j;
      }
      if (best >= 0) {
        used[k].add(best);
        speeds.push(o.apexes[best].v);
      }
    });
    if (!speeds.length) continue;
    const avg = (c.v + speeds.reduce((s, x) => s + x, 0)) / (speeds.length + 1);
    out.push({ d: c.d, mine: c.v, others: speeds, fast: avg >= FAST_CORNER_MS });
  }
  return out;
}
