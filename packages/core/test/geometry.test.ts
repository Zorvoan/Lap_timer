import { describe, expect, it } from 'vitest';
import { distanceMeters, segmentIntersection, lineLengthMeters } from '../src/geo';
import { GeometryError, TrackModel, validateGeometry } from '../src/track';
import { lineAlong, perpendicularLine, detectCrossing, lineToXY } from '../src/lines';
import { hairpinPoints, ovalPoints, toCoords, closedCircuit } from './fixtures';

describe('geo primitives', () => {
  it('computes haversine distance', () => {
    // One degree of latitude ≈ 111.2 km.
    expect(distanceMeters({ lat: 50, lon: 14 }, { lat: 51, lon: 14 })).toBeCloseTo(111_195, -2);
  });

  it('intersects segments with parameters along both', () => {
    const r = segmentIntersection({ x: 0, y: -1 }, { x: 0, y: 1 }, { x: -1, y: 0 }, { x: 1, y: 0 });
    expect(r?.t).toBeCloseTo(0.5);
    expect(r?.u).toBeCloseTo(0.5);
    expect(segmentIntersection({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 })).toBeNull();
  });
});

describe('geometry validation', () => {
  it('rejects too few points', () => {
    expect(validateGeometry([[14, 50]])[0].code).toBe('too_few_points');
    expect(validateGeometry([])[0].code).toBe('too_few_points');
  });

  it('rejects non-finite and out-of-range coordinates', () => {
    expect(validateGeometry([[14, 50], [Number.NaN, 50]])[0].code).toBe('non_finite');
    expect(validateGeometry([[14, 50], [14, 95]])[0].code).toBe('out_of_range');
  });

  it('rejects geometry that is too short', () => {
    const issues = validateGeometry(toCoords([{ x: 0, y: 0 }, { x: 30, y: 0 }]));
    expect(issues.some((i) => i.code === 'too_short' && i.severity === 'error')).toBe(true);
  });

  it('warns about long straight segments that may not follow a road', () => {
    const issues = validateGeometry(toCoords([{ x: 0, y: 0 }, { x: 3000, y: 0 }]));
    expect(issues).toEqual([expect.objectContaining({ code: 'large_gap', severity: 'warning' })]);
  });

  it('throws GeometryError when building a model from invalid input', () => {
    expect(() => TrackModel.fromCoordinates([[14, 50]], true)).toThrow(GeometryError);
  });
});

describe('TrackModel', () => {
  const coords = toCoords(ovalPoints());
  const track = TrackModel.fromCoordinates(coords, true);

  it('measures length from the full geometry', () => {
    const expected = 800 + 2 * Math.PI * 60;
    expect(track.length).toBeGreaterThan(expected - 3); // polygonal arcs are slightly shorter
    expect(track.length).toBeLessThan(expected + 0.5);
    expect(lineLengthMeters(coords)).toBeCloseTo(track.length, -1);
  });

  it('wraps distances and takes the short way round the seam', () => {
    const L = track.length;
    expect(track.wrap(L + 10)).toBeCloseTo(10);
    expect(track.wrap(-10)).toBeCloseTo(L - 10);
    expect(track.signedDelta(L - 5, 5)).toBeCloseTo(10);
    expect(track.signedDelta(5, L - 5)).toBeCloseTo(-10);
  });

  it('closes an open-ended closed circuit', () => {
    const t = TrackModel.fromCoordinates(toCoords(hairpinPoints()), true);
    expect(t.pts[0]).toEqual(t.pts[t.pts.length - 1]);
  });

  it('projects onto the nearest segment', () => {
    const p = track.toXY(track.latLonAt(100));
    const n = track.nearest({ x: p.x, y: p.y - 3 });
    expect(n.along).toBeCloseTo(100, 0);
    expect(n.lateral).toBeCloseTo(3, 0);
  });
});

describe('timing lines', () => {
  const { track, def } = closedCircuit(ovalPoints(), 50);

  it('places a perpendicular line that crosses the track at the requested distance', () => {
    expect(lineAlong(track, def.startLine)).toBeCloseTo(50, 1);
  });

  it('detects crossing direction', () => {
    const l = lineToXY(track, def.startLine);
    const before = track.pointAt(45);
    const after = track.pointAt(55);
    expect(detectCrossing(before, after, l)?.correctDirection).toBe(true);
    expect(detectCrossing(after, before, l)?.correctDirection).toBe(false);
    expect(detectCrossing(track.pointAt(60), track.pointAt(70), l)).toBeNull();
  });

  it('reports a line that does not touch the route', () => {
    const far = perpendicularLine(track, 0);
    const shifted = { ...far, a: { lat: far.a.lat + 0.01, lon: far.a.lon }, b: { lat: far.b.lat + 0.01, lon: far.b.lon } };
    expect(lineAlong(track, shifted)).toBeNull();
  });
});
