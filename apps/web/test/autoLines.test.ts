import { describe, expect, it } from 'vitest';
import { LocalFrame, SessionEngine, TrackModel, lineAlong, type LonLat } from '@laptimer/core';
import { autoLines } from '../src/lib/autoLines';

const frame = new LocalFrame({ lat: 49.17, lon: 17.48 });
const coords = (pts: [number, number][]): LonLat[] => pts.map(([x, y]) => {
  const p = frame.toLatLon({ x, y });
  return [p.lon, p.lat];
});

describe('autoLines', () => {
  // A 1 km sprint east, then the router's hook: 30 m on, a U-turn, 30 m back to the tapped end.
  const geometry = coords([[0, 0], [250, 0], [500, 0], [750, 0], [1000, 0], [1030, 0], [1030, 6], [1000, 6]]);
  const track = TrackModel.fromCoordinates(geometry, false);
  const waypoints = coords([[0, 0], [1000, 6]]);

  it('puts the sprint finish where the last point was tapped, not on the router hook', () => {
    const { start, finish } = autoLines(track, 'sprint', waypoints);
    const s = lineAlong(track, start)!;
    const f = lineAlong(track, finish!)!;
    expect(s).toBeCloseTo(10, 0); // first waypoint is the geometry start: kept 10 m in
    expect(f).toBeGreaterThan(1050); // on the return leg of the hook, at the tapped point
    const engine = new SessionEngine({ kind: 'sprint', geometry, startLine: start, finishLine: finish, sectors: [] });
    expect(engine.lapLengthM).toBeGreaterThan(1000);
  });

  it('starts a loop near its first point and has no finish line', () => {
    const loop = coords([[0, 0], [400, 0], [400, 300], [0, 300], [0, 0]]);
    const t = TrackModel.fromCoordinates(loop, true);
    const { start, finish } = autoLines(t, 'closed', coords([[0, 0], [400, 300]]));
    expect(finish).toBeNull();
    expect(lineAlong(t, start)).toBeCloseTo(20, 0);
  });

  it('places lines 20 m in from the ends of a recorded route', () => {
    const { start, finish } = autoLines(track, 'sprint', []);
    expect(lineAlong(track, start)).toBeCloseTo(20, 0);
    expect(lineAlong(track, finish!)).toBeCloseTo(track.length - 20, 0);
  });
});
