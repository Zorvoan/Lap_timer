import { LocalFrame, dist, type LonLat } from '@laptimer/core';
import type { SnappedWaypoint } from './types';

export interface RouteAnalysisOptions {
  /** A waypoint further than this from the road is reported, metres. */
  maxSnapOffsetM: number;
  /** Route length / waypoint-to-waypoint straight distance above this is reported as a detour. */
  maxDetourRatio: number;
}

export const DEFAULT_ANALYSIS: RouteAnalysisOptions = { maxSnapOffsetM: 40, maxDetourRatio: 2.5 };

/**
 * Finds places where the routed geometry probably differs from the intended circuit:
 * waypoints far from any road, U-turns (a waypoint placed on the wrong side of a dual
 * carriageway, or past a dead end), and large detours between consecutive waypoints.
 */
export function analyzeRoute(
  geometry: LonLat[],
  waypoints: SnappedWaypoint[],
  closed: boolean,
  opts: RouteAnalysisOptions = DEFAULT_ANALYSIS,
): string[] {
  const warnings: string[] = [];
  waypoints.forEach((w, i) => {
    if (w.offsetM > opts.maxSnapOffsetM) {
      warnings.push(`Waypoint ${i + 1} is ${Math.round(w.offsetM)} m from the nearest road and was moved onto it.`);
    }
  });

  if (geometry.length >= 3) {
    const frame = new LocalFrame({ lon: geometry[0][0], lat: geometry[0][1] });
    const pts = geometry.map((c) => frame.toXY({ lon: c[0], lat: c[1] }));
    const uturns = countUTurns(pts);
    if (uturns > 0) {
      warnings.push(
        `The route turns back on itself ${uturns === 1 ? 'once' : `${uturns} times`}. A waypoint may be on the wrong carriageway or past a dead end — move it to follow your intended direction.`,
      );
    }
    let routeLen = 0;
    for (let i = 1; i < pts.length; i++) routeLen += dist(pts[i - 1], pts[i]);
    const wps = waypoints.map((w) => frame.toXY({ lon: w.snapped[0], lat: w.snapped[1] }));
    let straight = 0;
    for (let i = 1; i < wps.length; i++) straight += dist(wps[i - 1], wps[i]);
    if (closed && wps.length > 1) straight += dist(wps[wps.length - 1], wps[0]);
    if (straight > 200 && routeLen / straight > opts.maxDetourRatio) {
      warnings.push(
        `The route is ${(routeLen / straight).toFixed(1)}× longer than the straight distance between waypoints. The router may be avoiding a road you intended — add waypoints along it.`,
      );
    }
  }
  return warnings;
}

/** Counts reversals of direction: heading change > 150° within a short distance. */
function countUTurns(pts: { x: number; y: number }[]): number {
  let count = 0;
  let lastAt = -Infinity;
  let travelled = 0;
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push((travelled += dist(pts[i - 1], pts[i])));
  for (let i = 1; i < pts.length - 1; i++) {
    // Compare the heading ~15 m before and after vertex i.
    const a = back(pts, cum, i, 15);
    const b = fwd(pts, cum, i, 15);
    if (!a || !b) continue;
    const v1 = { x: pts[i].x - a.x, y: pts[i].y - a.y };
    const v2 = { x: b.x - pts[i].x, y: b.y - pts[i].y };
    const n1 = Math.hypot(v1.x, v1.y);
    const n2 = Math.hypot(v2.x, v2.y);
    if (n1 < 5 || n2 < 5) continue;
    const cos = (v1.x * v2.x + v1.y * v2.y) / (n1 * n2);
    if (cos < Math.cos((150 * Math.PI) / 180) && cum[i] - lastAt > 50) {
      count++;
      lastAt = cum[i];
    }
  }
  return count;
}

function back(pts: { x: number; y: number }[], cum: number[], i: number, m: number) {
  for (let k = i - 1; k >= 0; k--) if (cum[i] - cum[k] >= m) return pts[k];
  return i > 0 ? pts[0] : null;
}

function fwd(pts: { x: number; y: number }[], cum: number[], i: number, m: number) {
  for (let k = i + 1; k < pts.length; k++) if (cum[k] - cum[i] >= m) return pts[k];
  return i < pts.length - 1 ? pts[pts.length - 1] : null;
}
