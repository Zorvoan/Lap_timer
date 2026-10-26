import { perpendicularLine, type CircuitKind, type LonLat, type TimingLine, type TrackModel } from '@laptimer/core';

export const LINE_WIDTH_M = 24;
/** The router's turn-around past a tapped end comes back within this of the road it left, m… */
const HOOK_SIDE_M = 10;
/** …after at most this much road, m. */
const HOOK_LENGTH_M = 400;

/**
 * Start and finish lines placed where the driver tapped: the start at the first waypoint and,
 * on a sprint, the finish at the last one (never on the bit of road the router may add past
 * the tapped end to reach it). Without waypoints (recorded routes) they go 20 m in from the ends.
 * Lines keep a few metres from the geometry's ends so they always cross it.
 */
export function autoLines(track: TrackModel, kind: CircuitKind, waypoints: readonly LonLat[]): { start: TimingLine; finish: TimingLine | null } {
  const L = track.length;
  const edge = Math.min(10, L * 0.05);
  /**
   * Where the road is driven through a tapped end point. To reach a point on the far side of the
   * road the router can drive past it and turn round (a hook), so the route passes the point twice
   * in opposite directions a few metres apart; drivers only make the main pass: the first one at
   * the finish, the last one at the start.
   */
  const mainPass = (p: LonLat, end: 'start' | 'finish') => {
    const xy = track.toXY({ lon: p[0], lat: p[1] });
    const near = track.nearest(xy);
    const dir = track.tangentAt(near.along);
    let best = near.along;
    for (const c of track.candidates(xy, near.lateral + HOOK_SIDE_M)) {
      const gap = end === 'finish' ? near.along - c.along : c.along - near.along;
      const t = track.tangentAt(c.along);
      if (gap > 0 && gap <= HOOK_LENGTH_M && t.x * dir.x + t.y * dir.y < -0.5 && (end === 'finish' ? c.along < best : c.along > best)) best = c.along;
    }
    return best;
  };
  const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

  if (kind === 'closed') {
    // A loop starts and ends at the first waypoint, which is where the geometry begins.
    return { start: perpendicularLine(track, clamp(Math.min(20, L * 0.02), edge, L - edge), LINE_WIDTH_M), finish: null };
  }
  const s = clamp(waypoints.length ? mainPass(waypoints[0], 'start') : 20, edge, L * 0.5);
  const minGap = Math.min(50, (L - s) / 2);
  const f = clamp(waypoints.length >= 2 ? mainPass(waypoints[waypoints.length - 1], 'finish') : L - 20, s + minGap, L - edge);
  return { start: perpendicularLine(track, s, LINE_WIDTH_M), finish: perpendicularLine(track, f, LINE_WIDTH_M) };
}
