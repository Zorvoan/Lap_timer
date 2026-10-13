import { simplify } from '@turf/simplify';
import { lineString } from '@turf/helpers';
import { LocalFrame, dist, type LonLat } from './geo';
import { GpsFilter, type GpsSample } from './gps';

export interface CleanupOptions {
  /** Drop fixes with a worse accuracy radius, metres. */
  maxAccuracyM: number;
  /** Douglas–Peucker tolerance, metres (0 disables simplification). */
  simplifyToleranceM: number;
  /** Moving-average window (odd number of points, 1 disables smoothing). */
  smoothingWindow: number;
  /** Trim the path to the first return near its starting point (one closed lap). */
  extractLoop: boolean;
  /** Index range of raw samples to keep. */
  trimStart: number;
  trimEnd: number;
}

export const DEFAULT_CLEANUP: CleanupOptions = {
  maxAccuracyM: 20,
  simplifyToleranceM: 1,
  smoothingWindow: 3,
  extractLoop: true,
  trimStart: 0,
  trimEnd: Number.POSITIVE_INFINITY,
};

export interface CleanupResult {
  coords: LonLat[];
  rawCount: number;
  droppedAccuracy: number;
  droppedJumps: number;
  loopClosed: boolean;
  /** Distance between the loop's end and its start, metres (closed loops only). */
  closureGapM: number | null;
}

/**
 * Turns a recorded drive into circuit geometry: removes bad fixes and jumps, lightly smooths,
 * optionally cuts out one loop, and simplifies without discarding the driven shape.
 */
export function cleanRecordedPath(samples: readonly GpsSample[], options: Partial<CleanupOptions> = {}): CleanupResult {
  const o = { ...DEFAULT_CLEANUP, ...options };
  const slice = samples.slice(Math.max(0, o.trimStart), Math.min(samples.length, o.trimEnd));
  const filter = new GpsFilter({ maxAccuracyM: o.maxAccuracyM, maxSpeedMs: 100, reanchorAfter: 3 });
  let droppedAccuracy = 0;
  let droppedJumps = 0;
  const kept: GpsSample[] = [];
  for (const s of slice) {
    const r = filter.process(s);
    if (r.status === 'rejected') droppedJumps++;
    else if (r.status === 'poor_accuracy') droppedAccuracy++;
    else kept.push(s);
  }
  if (kept.length < 2) {
    return { coords: kept.map((s) => [s.lon, s.lat]), rawCount: samples.length, droppedAccuracy, droppedJumps, loopClosed: false, closureGapM: null };
  }

  const frame = new LocalFrame({ lat: kept[0].lat, lon: kept[0].lon });
  let pts = kept.map((s) => frame.toXY(s));
  const w = Math.max(1, Math.floor(o.smoothingWindow / 2));
  if (o.smoothingWindow > 1) {
    pts = pts.map((_, i) => {
      if (i === 0 || i === pts.length - 1) return pts[i];
      let x = 0;
      let y = 0;
      let n = 0;
      for (let k = Math.max(0, i - w); k <= Math.min(pts.length - 1, i + w); k++) {
        x += pts[k].x;
        y += pts[k].y;
        n++;
      }
      return { x: x / n, y: y / n };
    });
  }

  let loopClosed = false;
  let closureGapM: number | null = null;
  if (o.extractLoop) {
    let travelled = 0;
    let bestIdx = -1;
    let bestD = Infinity;
    for (let i = 1; i < pts.length; i++) {
      travelled += dist(pts[i - 1], pts[i]);
      if (travelled < 300) continue;
      const d = dist(pts[i], pts[0]);
      if (d < 40 && d < bestD) {
        bestD = d;
        bestIdx = i;
      } else if (bestIdx >= 0 && d > 80) break;
    }
    if (bestIdx > 0) {
      pts = pts.slice(0, bestIdx + 1);
      loopClosed = true;
      closureGapM = bestD;
    }
  }

  let coords: LonLat[] = pts.map((p) => {
    const ll = frame.toLatLon(p);
    return [ll.lon, ll.lat];
  });
  if (o.simplifyToleranceM > 0 && coords.length > 2) {
    const tolDeg = o.simplifyToleranceM / 111_320;
    coords = simplify(lineString(coords), { tolerance: tolDeg, highQuality: true }).geometry.coordinates as LonLat[];
  }
  return { coords, rawCount: samples.length, droppedAccuracy, droppedJumps, loopClosed, closureGapM };
}
