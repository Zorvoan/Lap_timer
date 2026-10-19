import { lapDistanceToPosition, type CircuitDefinition, type LapRecord } from '@laptimer/core';

/**
 * Corners of a road, found in the shape of the road itself rather than in how anyone drove it,
 * so they are the same corners for every driver: where the road turns by at least
 * {@link TURN_DEG} within {@link WINDOW_M}. Distances are along the lap from the start line.
 */
export interface RoadCorner {
  from: number;
  to: number;
  /** How far the road turns through the corner, degrees. */
  angle: number;
  /** +1 turning left, −1 turning right. */
  dir: 1 | -1;
}

/** A corner: the road's heading changes by at least this much… */
const TURN_DEG = 30;
/** …within this distance. */
const WINDOW_M = 100;
/** Bends of the same direction this close together (m) are one corner. */
const MERGE_M = 30;
/** Smallest total turn of a corner, degrees. */
const MIN_ANGLE_DEG = 20;
/** Corners starting this close to the start line are left out: how fast anyone goes through
 * them says more about how they started (standing or rolling) than about the corner. */
const START_ZONE_M = 100;
/** The road's heading is sampled this often. */
const STEP_M = 5;
/** Corners taken at 80 km/h or more count as fast, slower ones as slow. */
export const FAST_CORNER_MS = 80 / 3.6;

const wrapDeg = (a: number) => ((((a + 180) % 360) + 360) % 360) - 180;

export function roadCorners(circuit: CircuitDefinition, lengthM: number): RoadCorner[] {
  const at = lapDistanceToPosition(circuit);
  if (!at || !(lengthM > WINDOW_M)) return [];
  // Positions in metres on a local flat frame (fine over a few kilometres).
  const o = at(0);
  const kx = 111_320 * Math.cos((o.lat * Math.PI) / 180);
  const xy = (d: number) => {
    const p = at(Math.min(lengthM, Math.max(0, d)));
    return [(p.lon - o.lon) * kx, (p.lat - o.lat) * 110_540] as const;
  };
  const n = Math.floor(lengthM / STEP_M);
  const heading: number[] = [];
  for (let i = 0; i <= n; i++) {
    const [x0, y0] = xy(i * STEP_M - STEP_M);
    const [x1, y1] = xy(i * STEP_M + STEP_M);
    heading.push((Math.atan2(y1 - y0, x1 - x0) * 180) / Math.PI);
  }
  // How much the road turns over the window centred on each sample (left positive).
  const half = Math.round(WINDOW_M / 2 / STEP_M);
  const turn = heading.map((_, i) => (i < half || i > n - half ? 0 : wrapDeg(heading[i + half] - heading[i - half])));

  // Runs of samples turning the same way past the threshold; runs of the same direction close
  // together are one corner whose bend eased off for a moment.
  const runs: { i: number; j: number; dir: 1 | -1 }[] = [];
  for (let i = 0; i <= n; i++) {
    if (Math.abs(turn[i]) < TURN_DEG) continue;
    const dir = turn[i] > 0 ? 1 : -1;
    let j = i;
    while (j + 1 <= n && Math.abs(turn[j + 1]) >= TURN_DEG && Math.sign(turn[j + 1]) === dir) j++;
    const last = runs[runs.length - 1];
    if (last && last.dir === dir && (i - last.j) * STEP_M <= MERGE_M) last.j = j;
    else runs.push({ i, j, dir });
    i = j;
  }
  const corners: RoadCorner[] = [];
  for (const r of runs) {
    // The marked samples are the middle of the bend; the bend reaches a little either side.
    const a = Math.max(0, r.i - half);
    const b = Math.min(n, r.j + half);
    const angle = Math.abs(wrapDeg(heading[b] - heading[a]));
    // A run that nets out to almost nothing is the middle of an S, not a corner of its own.
    if (angle < MIN_ANGLE_DEG) continue;
    corners.push({ from: Math.max(0, r.i * STEP_M - WINDOW_M / 4), to: Math.min(lengthM, r.j * STEP_M + WINDOW_M / 4), angle, dir: r.dir });
  }
  // Neighbouring corners (an S, a run of hairpins) share their boundary instead of overlapping.
  for (let k = 1; k < corners.length; k++) {
    const p = corners[k - 1];
    const c = corners[k];
    if (c.from < p.to) {
      const mid = (c.from + p.to) / 2;
      p.to = mid;
      c.from = mid;
    }
  }
  return corners.filter((c) => c.from >= START_ZONE_M);
}

/**
 * A lap's slowest speed through a corner (m/s): the lowest GPS speed inside it, or the speed
 * interpolated at its middle when no fix fell inside (a short corner at speed). Null when the
 * lap has no speeds around it.
 */
export function apexSpeed(lap: Pick<LapRecord, 'trace'>, c: RoadCorner): number | null {
  const pts = lap.trace.filter((p) => p.v !== null && Number.isFinite(p.v)) as { d: number; v: number }[];
  let min: number | null = null;
  for (const p of pts) if (p.d >= c.from && p.d <= c.to && (min === null || p.v < min)) min = p.v;
  if (min !== null) return min;
  const mid = (c.from + c.to) / 2;
  const after = pts.findIndex((p) => p.d >= mid);
  if (after <= 0) return null;
  const a = pts[after - 1];
  const b = pts[after];
  // Too far apart to say what happened in between (a GPS gap).
  if (b.d - a.d > 200) return null;
  return a.v + ((mid - a.d) / Math.max(1e-6, b.d - a.d)) * (b.v - a.v);
}

/** One corner of a road as the driver and other drivers took it. */
export interface CornerDuel {
  corner: RoadCorner;
  /** The driver's apex speed. */
  mine: number;
  /** Apex speeds of the other laps through the same corner. */
  others: number[];
  /** Fast corner by the average apex speed of everyone through it. */
  fast: boolean;
}

/**
 * Each corner of the road with the driver's apex speed and the other laps' through the very same
 * corner. Corners where the driver's lap or all the others have no speed are left out.
 */
export function cornerDuels(mine: Pick<LapRecord, 'trace'>, others: readonly Pick<LapRecord, 'trace'>[], corners: readonly RoadCorner[]): CornerDuel[] {
  const out: CornerDuel[] = [];
  for (const corner of corners) {
    const m = apexSpeed(mine, corner);
    const o = others.map((l) => apexSpeed(l, corner)).filter((v): v is number => v !== null);
    if (m === null || !o.length) continue;
    const avg = (m + o.reduce((s, x) => s + x, 0)) / (o.length + 1);
    out.push({ corner, mine: m, others: o, fast: avg >= FAST_CORNER_MS });
  }
  return out;
}
