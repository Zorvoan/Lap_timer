import type { LapRecord, LapTracePoint } from '@laptimer/core';

/** How a lap was driven, from its speed trace. Speeds in m/s, accelerations in m/s². */
export interface DrivingStyle {
  topSpeed: number;
  avgSpeed: number;
  /** Mean of the slowest speeds through the corners (apexes). */
  cornerSpeed: number;
  corners: number;
  /** Mean acceleration while speeding up. */
  accel: number;
  /** Mean deceleration while braking (positive). */
  braking: number;
}

/** A corner: a speed low that dips at least this far below the fastest point around it. */
const CORNER_DIP_MS = 2.5;
/** …and is the slowest point within this distance either side. */
const CORNER_SPAN_M = 120;
/** Only changes of speed beyond this count as accelerating or braking (GPS noise). */
const ACCEL_MIN = 0.3;

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

export function drivingStyle(lap: Pick<LapRecord, 'trace' | 'distanceM' | 'timeMs'>): DrivingStyle | null {
  const pts = lap.trace.filter((p) => p.v !== null && Number.isFinite(p.v));
  if (pts.length < 8 || lap.timeMs <= 0) return null;
  const v = smooth(pts);

  let accSum = 0;
  let accN = 0;
  let brkSum = 0;
  let brkN = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const dt = (pts[i + 1].t - pts[i - 1].t) / 1000;
    // Across a GPS gap the change of speed is not an acceleration anyone measured.
    if (dt <= 0 || dt > 6) continue;
    const a = (v[i + 1] - v[i - 1]) / dt;
    if (a > ACCEL_MIN) {
      accSum += a;
      accN++;
    } else if (a < -ACCEL_MIN) {
      brkSum -= a;
      brkN++;
    }
  }

  const apexes: number[] = [];
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
    if (lowest && around - v[i] >= CORNER_DIP_MS) apexes.push(v[i]);
  }

  return {
    topSpeed: Math.max(...v),
    avgSpeed: lap.distanceM / (lap.timeMs / 1000),
    cornerSpeed: apexes.length ? apexes.reduce((s, x) => s + x, 0) / apexes.length : Math.min(...v),
    corners: apexes.length,
    accel: accN ? accSum / accN : 0,
    braking: brkN ? brkSum / brkN : 0,
  };
}
