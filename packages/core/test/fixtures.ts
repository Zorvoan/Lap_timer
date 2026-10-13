/** Deterministic test circuits built in metres around a fixed origin. */
import { LocalFrame, type LonLat, type XY } from '../src/geo';
import { perpendicularLine } from '../src/lines';
import type { CircuitDefinition } from '../src/model';
import { TrackModel } from '../src/track';

export const ORIGIN = { lat: 50.08, lon: 14.42 };
export const frame = new LocalFrame(ORIGIN);

export function toCoords(pts: XY[]): LonLat[] {
  return pts.map((p) => {
    const ll = frame.toLatLon(p);
    return [ll.lon, ll.lat];
  });
}

function arc(cx: number, cy: number, r: number, a0: number, a1: number, steps: number): XY[] {
  const out: XY[] = [];
  for (let i = 1; i <= steps; i++) {
    const a = a0 + ((a1 - a0) * i) / steps;
    out.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  }
  return out;
}

/**
 * Counter-clockwise oval: 400 m straights, 60 m radius bends.
 * Starts mid-way along the bottom straight, heading east, so the start line sits on a straight.
 */
export function ovalPoints(): XY[] {
  const pts: XY[] = [{ x: 0, y: 0 }, { x: 200, y: 0 }];
  pts.push(...arc(200, 60, 60, -Math.PI / 2, Math.PI / 2, 24));
  pts.push({ x: -200, y: 120 });
  pts.push(...arc(-200, 60, 60, Math.PI / 2, (3 * Math.PI) / 2, 24));
  pts.push({ x: 0, y: 0 });
  return pts;
}

/**
 * Hairpin circuit: two parallel 500 m straights only 12 m apart, joined by tight bends.
 * Globally-nearest matching would jump between the straights under normal GPS noise.
 */
export function hairpinPoints(): XY[] {
  const pts: XY[] = [{ x: 0, y: 0 }, { x: 500, y: 0 }];
  pts.push(...arc(500, 6, 6, -Math.PI / 2, Math.PI / 2, 12));
  pts.push({ x: 0, y: 12 });
  pts.push(...arc(0, 6, 6, Math.PI / 2, (3 * Math.PI) / 2, 12));
  return pts;
}

export function closedCircuit(pts: XY[], startAlong = 0, sectorsAt: number[] = []): { def: CircuitDefinition; track: TrackModel } {
  const geometry = toCoords(pts);
  const track = TrackModel.fromCoordinates(geometry, true);
  return {
    track,
    def: {
      kind: 'closed',
      geometry,
      startLine: perpendicularLine(track, startAlong),
      finishLine: null,
      sectors: sectorsAt.map((a) => perpendicularLine(track, a)),
    },
  };
}

/** Builds a raw fix at a local position. */
export function fixAt(p: XY, t: number, extra: Partial<{ accuracy: number; speed: number | null; heading: number | null }> = {}) {
  const ll = frame.toLatLon(p);
  return {
    t,
    lat: ll.lat,
    lon: ll.lon,
    accuracy: extra.accuracy ?? 4,
    speed: extra.speed === undefined ? null : extra.speed,
    heading: extra.heading ?? null,
    altitude: null,
    altitudeAccuracy: null,
  };
}
