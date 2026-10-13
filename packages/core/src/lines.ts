import { cross, dist, scale, segmentIntersection, sub, unit, add, projectOnSegment, type LatLon, type XY } from './geo';
import type { TrackModel } from './track';

/**
 * A timing line defined by two geographic points.
 * `direction` is the sign of cross(b − a, travel) for a valid crossing:
 * +1 means travel goes from the right side of a→b to its left side.
 */
export interface TimingLine {
  a: LatLon;
  b: LatLon;
  direction: 1 | -1;
}

export interface TimingLineXY {
  a: XY;
  b: XY;
  direction: 1 | -1;
}

export function lineToXY(track: TrackModel, line: TimingLine): TimingLineXY {
  return { a: track.toXY(line.a), b: track.toXY(line.b), direction: line.direction };
}

export interface LineCrossing {
  /** Fraction along the movement segment where the line was crossed, (0, 1]. */
  fraction: number;
  /** Fraction along the line a→b where it was crossed, [0, 1]. */
  linePos: number;
  /** Whether the movement matched the line's expected direction. */
  correctDirection: boolean;
}

/**
 * Detects whether movement p→q crosses the line. A point exactly on the line counts for the
 * segment that ends on it (fraction 1) and not for the one starting on it, so a single
 * crossing is never reported twice.
 */
export function detectCrossing(p: XY, q: XY, line: TimingLineXY): LineCrossing | null {
  const si = segmentIntersection(p, q, line.a, line.b);
  if (!si) return null;
  if (si.t <= 1e-9 || si.t > 1 + 1e-9) return null;
  if (si.u < -1e-9 || si.u > 1 + 1e-9) return null;
  const s = Math.sign(cross(sub(line.b, line.a), sub(q, p)));
  return { fraction: Math.min(1, si.t), linePos: Math.min(1, Math.max(0, si.u)), correctDirection: s === line.direction };
}

export function distanceToLine(p: XY, line: TimingLineXY): number {
  return projectOnSegment(p, line.a, line.b).distance;
}

/**
 * Creates a line perpendicular to the track at `along`, `widthM` wide, oriented so that
 * driving in the track's direction is the valid crossing direction.
 */
export function perpendicularLine(track: TrackModel, along: number, widthM = 24): TimingLine {
  const c = track.pointAt(along);
  const t = track.tangentAt(along);
  const n = unit({ x: -t.y, y: t.x }); // left normal
  const a = add(c, scale(n, -widthM / 2));
  const b = add(c, scale(n, widthM / 2));
  return {
    a: track.frame.toLatLon(a),
    b: track.frame.toLatLon(b),
    direction: directionFor({ a, b }, t),
  };
}

/** Direction sign that makes `travel` a valid crossing of a→b. */
export function directionFor(line: { a: XY; b: XY }, travel: XY): 1 | -1 {
  return cross(sub(line.b, line.a), travel) >= 0 ? 1 : -1;
}

/** Where the line meets the track centreline (distance along), or null when it does not. */
export function lineAlong(track: TrackModel, line: TimingLine): number | null {
  const l = lineToXY(track, line);
  // Where a road is driven both ways (out-and-back), the line crosses it twice: prefer the
  // crossing travelled in the line's valid direction, then the one nearest the line's middle.
  let best: { along: number; d: number } | null = null;
  const mid = { x: (l.a.x + l.b.x) / 2, y: (l.a.y + l.b.y) / 2 };
  for (let i = 0; i < track.segmentCount; i++) {
    const si = segmentIntersection(track.pts[i], track.pts[i + 1], l.a, l.b);
    if (!si || si.t < 0 || si.t > 1 || si.u < 0 || si.u > 1) continue;
    const along = track.cum[i] + si.t * (track.cum[i + 1] - track.cum[i]);
    const wrongWay = directionFor(l, sub(track.pts[i + 1], track.pts[i])) !== l.direction;
    const d = dist(track.pointAt(along), mid) + (wrongWay ? 1e6 : 0);
    if (!best || d < best.d) best = { along, d };
  }
  return best ? best.along : null;
}
