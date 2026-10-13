import {
  LocalFrame,
  dist,
  isValidLatLon,
  lerp,
  projectOnSegment,
  sub,
  unit,
  type LatLon,
  type LonLat,
  type XY,
} from './geo';

export type GeometryIssueCode =
  | 'too_few_points'
  | 'non_finite'
  | 'out_of_range'
  | 'too_short'
  | 'large_gap';

export interface GeometryIssue {
  code: GeometryIssueCode;
  severity: 'error' | 'warning';
  message: string;
}

export interface GeometryValidationOptions {
  /** Minimum usable circuit length in metres. */
  minLengthM?: number;
  /** Consecutive vertices further apart than this are reported (straight-line substitutes, broken data). */
  maxVertexGapM?: number;
}

export class GeometryError extends Error {
  constructor(readonly issues: GeometryIssue[]) {
    super(issues.map((i) => i.message).join('; '));
    this.name = 'GeometryError';
  }
}

/**
 * Checks that a coordinate list is usable as circuit geometry.
 * Errors make the geometry unusable; warnings should be surfaced to the user.
 */
export function validateGeometry(coords: LonLat[], opts: GeometryValidationOptions = {}): GeometryIssue[] {
  const minLength = opts.minLengthM ?? 100;
  const maxGap = opts.maxVertexGapM ?? 1000;
  const issues: GeometryIssue[] = [];
  if (!Array.isArray(coords) || coords.length < 2) {
    issues.push({ code: 'too_few_points', severity: 'error', message: 'Route geometry needs at least two points.' });
    return issues;
  }
  for (const c of coords) {
    if (!Array.isArray(c) || !Number.isFinite(c[0]) || !Number.isFinite(c[1])) {
      issues.push({ code: 'non_finite', severity: 'error', message: 'Route geometry contains invalid coordinates.' });
      return issues;
    }
    if (!isValidLatLon({ lon: c[0], lat: c[1] })) {
      issues.push({ code: 'out_of_range', severity: 'error', message: 'Route geometry contains coordinates out of range.' });
      return issues;
    }
  }
  const frame = new LocalFrame({ lon: coords[0][0], lat: coords[0][1] });
  let total = 0;
  let worstGap = 0;
  for (let i = 1; i < coords.length; i++) {
    const d = dist(frame.toXY({ lon: coords[i - 1][0], lat: coords[i - 1][1] }), frame.toXY({ lon: coords[i][0], lat: coords[i][1] }));
    total += d;
    worstGap = Math.max(worstGap, d);
  }
  if (total < minLength) {
    issues.push({
      code: 'too_short',
      severity: 'error',
      message: `Route is only ${total.toFixed(0)} m long (minimum ${minLength} m).`,
    });
  }
  if (worstGap > maxGap) {
    issues.push({
      code: 'large_gap',
      severity: 'warning',
      message: `Route contains a ${(worstGap / 1000).toFixed(1)} km segment without intermediate points; it may not follow the road.`,
    });
  }
  return issues;
}

/** Nearest point on one segment of the track. */
export interface Candidate {
  seg: number;
  t: number;
  /** Distance along the track from its first vertex, metres. */
  along: number;
  /** Perpendicular (lateral) distance from the track, metres. */
  lateral: number;
  point: XY;
}

/**
 * Immutable planar model of a circuit centreline with cumulative distances.
 * Distances along the track are measured from the first vertex.
 */
export class TrackModel {
  private constructor(
    readonly frame: LocalFrame,
    readonly coords: LonLat[],
    readonly pts: XY[],
    readonly cum: number[],
    readonly closed: boolean,
  ) {}

  get length(): number {
    return this.cum[this.cum.length - 1];
  }

  get segmentCount(): number {
    return this.pts.length - 1;
  }

  /**
   * Builds a model from GeoJSON coordinates. Consecutive duplicates are removed and closed
   * circuits are closed exactly. Throws {@link GeometryError} for unusable geometry.
   */
  static fromCoordinates(coords: LonLat[], closed: boolean, opts?: GeometryValidationOptions): TrackModel {
    const errors = validateGeometry(coords, opts).filter((i) => i.severity === 'error');
    if (errors.length) throw new GeometryError(errors);

    const frame = new LocalFrame(centroid(coords));
    const cleanCoords: LonLat[] = [];
    const pts: XY[] = [];
    for (const c of coords) {
      const p = frame.toXY({ lon: c[0], lat: c[1] });
      if (pts.length && dist(pts[pts.length - 1], p) < 0.05) continue;
      pts.push(p);
      cleanCoords.push([c[0], c[1]]);
    }
    if (closed) {
      const first = pts[0];
      const last = pts[pts.length - 1];
      if (dist(first, last) < 1) {
        pts[pts.length - 1] = { ...first };
        cleanCoords[cleanCoords.length - 1] = [...cleanCoords[0]] as LonLat;
      } else {
        pts.push({ ...first });
        cleanCoords.push([...cleanCoords[0]] as LonLat);
      }
    }
    if (pts.length < 2) throw new GeometryError([{ code: 'too_few_points', severity: 'error', message: 'Route geometry collapses to a single point.' }]);
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + dist(pts[i - 1], pts[i]));
    return new TrackModel(frame, cleanCoords, pts, cum, closed);
  }

  toXY(p: LatLon): XY {
    return this.frame.toXY(p);
  }

  /** Normalises a distance into [0, length) for closed tracks, clamps for open ones. */
  wrap(along: number): number {
    const L = this.length;
    if (!this.closed) return Math.min(L, Math.max(0, along));
    const r = along % L;
    return r < 0 ? r + L : r;
  }

  /**
   * Shortest signed distance from `from` to `to` along the track.
   * On closed tracks the result lies in (-L/2, L/2], so crossing the seam is handled.
   */
  signedDelta(from: number, to: number): number {
    const d = to - from;
    if (!this.closed) return d;
    const L = this.length;
    let r = d % L;
    if (r > L / 2) r -= L;
    if (r <= -L / 2) r += L;
    return r;
  }

  private segmentAt(along: number): { i: number; t: number } {
    const a = this.wrap(along);
    let lo = 0;
    let hi = this.cum.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (this.cum[mid] <= a) lo = mid;
      else hi = mid;
    }
    const segLen = this.cum[lo + 1] - this.cum[lo];
    return { i: lo, t: segLen > 0 ? (a - this.cum[lo]) / segLen : 0 };
  }

  pointAt(along: number): XY {
    const { i, t } = this.segmentAt(along);
    return lerp(this.pts[i], this.pts[i + 1], t);
  }

  latLonAt(along: number): LatLon {
    return this.frame.toLatLon(this.pointAt(along));
  }

  /** Unit direction of travel at a distance along the track. */
  tangentAt(along: number): XY {
    const { i } = this.segmentAt(along);
    return unit(sub(this.pts[i + 1], this.pts[i]));
  }

  /** Nearest point on every segment whose lateral distance is within `maxLateral`. */
  candidates(p: XY, maxLateral = Infinity): Candidate[] {
    const out: Candidate[] = [];
    for (let i = 0; i < this.pts.length - 1; i++) {
      const pr = projectOnSegment(p, this.pts[i], this.pts[i + 1]);
      if (pr.distance > maxLateral) continue;
      out.push({
        seg: i,
        t: pr.t,
        along: this.cum[i] + pr.t * (this.cum[i + 1] - this.cum[i]),
        lateral: pr.distance,
        point: pr.point,
      });
    }
    return out;
  }

  /** Globally nearest point. Only for initial placement; live tracking uses {@link ProgressTracker}. */
  nearest(p: XY): Candidate {
    let best: Candidate | null = null;
    for (const c of this.candidates(p)) if (!best || c.lateral < best.lateral) best = c;
    return best as Candidate;
  }
}

function centroid(coords: LonLat[]): LatLon {
  let lat = 0;
  let lon = 0;
  for (const c of coords) {
    lon += c[0];
    lat += c[1];
  }
  return { lat: lat / coords.length, lon: lon / coords.length };
}
