import { describe, expect, it } from 'vitest';
import { SessionEngine, distanceMeters, lapDistanceToPosition } from '../src';
import { closedCircuit, fixAt, frame, ovalPoints } from './fixtures';

describe('positions on the road', () => {
  it('places the live position on the circuit even when GPS drifts 8 m off it', () => {
    const { def } = closedCircuit(ovalPoints(), 50);
    const engine = new SessionEngine(def);
    // Driving east along the bottom straight (y = 0), but every fix is 8 m to the side.
    for (let i = 0; i < 10; i++) engine.push(fixAt({ x: 20 + i * 15, y: -8 }, 1_000_000 + i * 1000, { speed: 20 }));
    const snap = engine.snapshot();
    expect(snap.position && distanceMeters(snap.position, frame.toLatLon({ x: 155, y: 0 }))).toBeGreaterThan(7);
    expect(snap.trackPosition && distanceMeters(snap.trackPosition, frame.toLatLon({ x: 155, y: 0 }))).toBeLessThan(1);
  });

  it('maps lap distance to the centreline from the start line', () => {
    const { def } = closedCircuit(ovalPoints(), 50);
    const at = lapDistanceToPosition(def)!;
    expect(distanceMeters(at(100), frame.toLatLon({ x: 150, y: 0 }))).toBeLessThan(0.5);
  });
});
