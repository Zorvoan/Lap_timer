import { distance as turfDistance } from '@turf/distance';
import { length as turfLength } from '@turf/length';
import { lineString, point } from '@turf/helpers';

/** Geographic coordinate in WGS84 degrees. */
export interface LatLon {
  lat: number;
  lon: number;
}

/** GeoJSON ordering: [longitude, latitude]. */
export type LonLat = [number, number];

/** Planar coordinate in metres within a {@link LocalFrame}. */
export interface XY {
  x: number;
  y: number;
}

const EARTH_RADIUS_M = 6371008.8;
const DEG = Math.PI / 180;

export function isValidLatLon(p: { lat: number; lon: number }): boolean {
  return (
    Number.isFinite(p.lat) &&
    Number.isFinite(p.lon) &&
    p.lat >= -90 &&
    p.lat <= 90 &&
    p.lon >= -180 &&
    p.lon <= 180
  );
}

/** Great-circle distance in metres (Turf haversine). */
export function distanceMeters(a: LatLon, b: LatLon): number {
  return turfDistance(point([a.lon, a.lat]), point([b.lon, b.lat]), { units: 'meters' });
}

/** Length of a GeoJSON coordinate list in metres (Turf). */
export function lineLengthMeters(coords: LonLat[]): number {
  if (coords.length < 2) return 0;
  return turfLength(lineString(coords), { units: 'meters' });
}

/**
 * Local tangent-plane approximation (equirectangular around an origin).
 * Error is well below GPS noise for circuits up to a few tens of kilometres,
 * and it lets the hot path (projection, line crossing) use plain vector maths.
 */
export class LocalFrame {
  private readonly kx: number;
  private readonly ky: number;

  constructor(readonly origin: LatLon) {
    this.ky = EARTH_RADIUS_M * DEG;
    this.kx = EARTH_RADIUS_M * DEG * Math.cos(origin.lat * DEG);
  }

  toXY(p: LatLon): XY {
    return { x: (p.lon - this.origin.lon) * this.kx, y: (p.lat - this.origin.lat) * this.ky };
  }

  toLatLon(p: XY): LatLon {
    return { lat: this.origin.lat + p.y / this.ky, lon: this.origin.lon + p.x / this.kx };
  }
}

export const sub = (a: XY, b: XY): XY => ({ x: a.x - b.x, y: a.y - b.y });
export const add = (a: XY, b: XY): XY => ({ x: a.x + b.x, y: a.y + b.y });
export const scale = (a: XY, k: number): XY => ({ x: a.x * k, y: a.y * k });
export const dot = (a: XY, b: XY): number => a.x * b.x + a.y * b.y;
export const cross = (a: XY, b: XY): number => a.x * b.y - a.y * b.x;
export const norm = (a: XY): number => Math.hypot(a.x, a.y);
export const dist = (a: XY, b: XY): number => Math.hypot(a.x - b.x, a.y - b.y);
export const lerp = (a: XY, b: XY, t: number): XY => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

export function unit(a: XY): XY {
  const n = norm(a);
  return n === 0 ? { x: 0, y: 0 } : { x: a.x / n, y: a.y / n };
}

/**
 * Intersection of segments p→p2 and q→q2.
 * Returns parameters t (along p) and u (along q), or null when parallel.
 * The caller decides which parameter ranges count as a hit.
 */
export function segmentIntersection(p: XY, p2: XY, q: XY, q2: XY): { t: number; u: number } | null {
  const r = sub(p2, p);
  const s = sub(q2, q);
  const denom = cross(r, s);
  if (Math.abs(denom) < 1e-12) return null;
  const qp = sub(q, p);
  return { t: cross(qp, s) / denom, u: cross(qp, r) / denom };
}

/** Closest point on segment a→b to p. `t` is clamped to [0, 1]. */
export function projectOnSegment(p: XY, a: XY, b: XY): { t: number; point: XY; distance: number } {
  const ab = sub(b, a);
  const len2 = dot(ab, ab);
  const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, dot(sub(p, a), ab) / len2));
  const q = lerp(a, b, t);
  return { t, point: q, distance: dist(p, q) };
}

/** Initial bearing a→b in degrees clockwise from north. */
export function bearingDeg(a: LatLon, b: LatLon): number {
  const f1 = a.lat * DEG;
  const f2 = b.lat * DEG;
  const dl = (b.lon - a.lon) * DEG;
  const y = Math.sin(dl) * Math.cos(f2);
  const x = Math.cos(f1) * Math.sin(f2) - Math.sin(f1) * Math.cos(f2) * Math.cos(dl);
  return ((Math.atan2(y, x) / DEG) + 360) % 360;
}

/** Unit vector (east, north) for a compass heading in degrees. */
export function headingToVector(headingDeg: number): XY {
  const h = headingDeg * DEG;
  return { x: Math.sin(h), y: Math.cos(h) };
}
