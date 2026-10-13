import { perpendicularLine, type CircuitKind, type LonLat, type TimingLine, type TrackModel } from '@laptimer/core';

export const LINE_WIDTH_M = 24;

/**
 * Start and finish lines placed where the driver tapped: the start at the first waypoint and,
 * on a sprint, the finish at the last one (never on the bit of road the router may add past
 * the tapped end to reach it). Without waypoints (recorded routes) they go 20 m in from the ends.
 * Lines keep a few metres from the geometry's ends so they always cross it.
 */
export function autoLines(track: TrackModel, kind: CircuitKind, waypoints: readonly LonLat[]): { start: TimingLine; finish: TimingLine | null } {
  const L = track.length;
  const edge = Math.min(10, L * 0.05);
  const along = (p: LonLat) => track.nearest(track.toXY({ lon: p[0], lat: p[1] })).along;
  const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

  if (kind === 'closed') {
    // A loop starts and ends at the first waypoint, which is where the geometry begins.
    return { start: perpendicularLine(track, clamp(Math.min(20, L * 0.02), edge, L - edge), LINE_WIDTH_M), finish: null };
  }
  const s = clamp(waypoints.length ? along(waypoints[0]) : 20, edge, L * 0.5);
  const minGap = Math.min(50, (L - s) / 2);
  const f = clamp(waypoints.length >= 2 ? along(waypoints[waypoints.length - 1]) : L - 20, s + minGap, L - edge);
  return { start: perpendicularLine(track, s, LINE_WIDTH_M), finish: perpendicularLine(track, f, LINE_WIDTH_M) };
}
