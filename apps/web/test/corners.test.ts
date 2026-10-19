import { describe, expect, it } from 'vitest';
import { TrackModel, perpendicularLine, type CircuitDefinition, type LonLat } from '@laptimer/core';
import { apexSpeed, cornerDuels, roadCorners, type RoadCorner } from '../src/lib/corners';

const LAT = 49.2;
const KX = 111_320 * Math.cos((LAT * Math.PI) / 180);
const KY = 110_540;
/** A road from local metres (x east, y north). */
const road = (pts: [number, number][]): LonLat[] => pts.map(([x, y]) => [17.5 + x / KX, LAT + y / KY]);

/** 400 m east, a 90° left-hander (radius 40 m), 400 m north, a gentle 10° kink, 300 m on. */
function testRoad(): CircuitDefinition {
  const pts: [number, number][] = [];
  for (let x = 0; x <= 400; x += 10) pts.push([x, 0]);
  for (let a = 5; a <= 90; a += 5) pts.push([400 + 40 * Math.sin((a * Math.PI) / 180), 40 - 40 * Math.cos((a * Math.PI) / 180)]);
  for (let y = 50; y <= 440; y += 10) pts.push([440, y]);
  const k = (10 * Math.PI) / 180;
  for (let s = 10; s <= 300; s += 10) pts.push([440 - s * Math.sin(k), 440 + s * Math.cos(k)]);
  const geometry = road(pts);
  const track = TrackModel.fromCoordinates(geometry, false);
  return { kind: 'sprint', geometry, startLine: perpendicularLine(track, 5), finishLine: perpendicularLine(track, track.length - 5), sectors: [] };
}

describe('road corners', () => {
  const circuit = testRoad();
  const len = TrackModel.fromCoordinates(circuit.geometry, false).length - 10;
  const corners = roadCorners(circuit, len);

  it('finds the bend in the shape of the road, not the kink', () => {
    expect(corners).toHaveLength(1);
    expect(corners[0].dir).toBe(1);
    expect(corners[0].angle).toBeGreaterThan(70);
    expect(corners[0].angle).toBeLessThan(110);
    // The bend runs from about 395 m to 458 m along the road.
    expect(corners[0].from).toBeGreaterThan(330);
    expect(corners[0].to).toBeLessThan(530);
  });

  it('leaves out a corner right after the start line', () => {
    // The same road started 30 m before the bend.
    const geometry = circuit.geometry.slice(37);
    const track = TrackModel.fromCoordinates(geometry, false);
    const near: CircuitDefinition = { ...circuit, geometry, startLine: perpendicularLine(track, 5), finishLine: perpendicularLine(track, track.length - 5) };
    expect(roadCorners(near, track.length - 10)).toHaveLength(0);
  });

  it('reads the slowest speed through a corner, or interpolates it when no fix fell inside', () => {
    const c: RoadCorner = { from: 100, to: 140, angle: 90, dir: 1 };
    const trace = (pts: [number, number][]) => ({ trace: pts.map(([d, v], i) => ({ t: i * 1000, d, v, lat: 0, lon: 0, accuracy: 3 })) });
    expect(apexSpeed(trace([[80, 20], [110, 14], [130, 12], [160, 20]]), c)).toBe(12);
    expect(apexSpeed(trace([[90, 20], [150, 10]]), c)).toBeCloseTo(15, 5);
    expect(apexSpeed(trace([[0, 20], [500, 20]]), c)).toBeNull();
  });

  it('compares the same corners only, classed by everyone’s average', () => {
    const trace = (v: number) => ({ trace: [0, 100, 120, 140, 300].map((d, i) => ({ t: i * 1000, d, v: d >= 100 && d <= 140 ? v : 30, lat: 0, lon: 0, accuracy: 3 })) });
    const cs: RoadCorner[] = [{ from: 100, to: 140, angle: 90, dir: 1 }, { from: 400, to: 450, angle: 60, dir: -1 }];
    const duels = cornerDuels(trace(20), [trace(25)], cs);
    // The second corner is past the end of every trace: left out.
    expect(duels).toHaveLength(1);
    expect(duels[0].mine).toBe(20);
    expect(duels[0].others).toEqual([25]);
    // 22.5 m/s average = 81 km/h: a fast corner for both, though the driver took it at 72.
    expect(duels[0].fast).toBe(true);
  });
});
