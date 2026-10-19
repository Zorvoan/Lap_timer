import type { LapRecord, LapTracePoint } from '@laptimer/core';

/** How fast a lap was, from its speed trace. Speeds in m/s. Corners: see `corners.ts`. */
export interface DrivingStyle {
  topSpeed: number;
  avgSpeed: number;
}

/** A few seconds' average, so a single GPS spike is not a top speed. */
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
  return { topSpeed: Math.max(...smooth(pts)), avgSpeed: lap.distanceM / (lap.timeMs / 1000) };
}
