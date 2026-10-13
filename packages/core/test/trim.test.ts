import { describe, expect, it } from 'vitest';
import { SessionEngine, TrackModel, distanceMeters, lineAlong, perpendicularLine, sprintPair, trimSprint, type Circuit, type XY } from '../src';
import { toCoords } from './fixtures';

/** A winding 3 km sprint: east, a bend north, then west. Start line 120 m in. */
function sprint(): Circuit {
  const pts: XY[] = [];
  for (let x = 0; x <= 1500; x += 50) pts.push({ x, y: 0 });
  for (let i = 1; i <= 12; i++) {
    const a = -Math.PI / 2 + (Math.PI * i) / 12;
    pts.push({ x: 1500 + 100 * Math.cos(a), y: 100 + 100 * Math.sin(a) });
  }
  for (let x = 1450; x >= 0; x -= 50) pts.push({ x, y: 200 });
  const geometry = toCoords(pts);
  const track = TrackModel.fromCoordinates(geometry, false);
  return {
    id: 'c', name: 'Hill', kind: 'sprint', origin: 'routed', geometry, waypoints: [geometry[0], geometry.at(-1)!],
    routing: { provider: 'osrm', profile: 'driving', warnings: ['detour'] },
    startLine: perpendicularLine(track, 120), finishLine: perpendicularLine(track, track.length - 30),
    sectors: [perpendicularLine(track, 900), perpendicularLine(track, 2600)],
    lengthM: track.length, elevation: [{ d: 0, elevation: 200 }, { d: 1000, elevation: 300 }, { d: 3000, elevation: 400 }],
    createdAt: 1, updatedAt: 1,
  };
}

describe('trimSprint', () => {
  it('makes the start→finish distance exactly the requested length', () => {
    const c = sprint();
    const t = trimSprint(c, 2000);
    expect(t.lengthM).toBe(2000);
    expect(new SessionEngine(t).lapLengthM).toBeCloseTo(2000, 0);
    // the start line is untouched and still crosses the route, 15 m after it begins
    expect(t.startLine).toEqual(c.startLine);
    expect(lineAlong(TrackModel.fromCoordinates(t.geometry, false), t.startLine)).toBeCloseTo(15, 0);
    // route ends 15 m after the new finish
    expect(TrackModel.fromCoordinates(t.geometry, false).length).toBeCloseTo(2030, 0);
  });

  it('keeps sectors before the new finish, trims the elevation profile and clears editor data', () => {
    const t = trimSprint(sprint(), 2000);
    expect(t.sectors).toHaveLength(1);
    expect(t.elevation?.map((e) => Math.round(e.d))).toEqual([0, 895, 2030]);
    expect(t.elevation?.[0].elevation).toBeCloseTo(210.5, 1);
    expect(t.waypoints).toEqual([]);
    expect(t.routing?.warnings).toEqual([]);
  });

  it('refuses routes too short for the length, and closed circuits', () => {
    expect(() => trimSprint(sprint(), 5000)).toThrow(/only runs/);
    expect(() => trimSprint({ ...sprint(), kind: 'closed' }, 2000)).toThrow(/sprint/);
  });
});

describe('sprintPair', () => {
  it('builds a hill climb and the downhill over the same exact stretch', () => {
    const c = sprint();
    const { up, down } = sprintPair(c.geometry, 300, 2000);
    const def = (s: typeof up) => ({ kind: 'sprint' as const, geometry: s.geometry, startLine: s.startLine, finishLine: s.finishLine, sectors: [] });
    expect(new SessionEngine(def(up)).lapLengthM).toBeCloseTo(2000, 0);
    expect(new SessionEngine(def(down)).lapLengthM).toBeCloseTo(2000, 0);
    // the up finish is where the down run starts, and vice versa
    const mid = (l: typeof up.startLine) => ({ lat: (l.a.lat + l.b.lat) / 2, lon: (l.a.lon + l.b.lon) / 2 });
    expect(distanceMeters(mid(up.finishLine), mid(down.startLine))).toBeLessThan(0.5);
    expect(distanceMeters(mid(up.startLine), mid(down.finishLine))).toBeLessThan(0.5);
    expect(down.geometry[0]).toEqual(up.geometry.at(-1));
  });

  it('says how much road is missing', () => {
    expect(() => sprintPair(sprint().geometry, 1500, 2000)).toThrow(/more beyond the finish/);
  });
});
