import { describe, expect, it } from 'vitest';
import type { LapTracePoint } from '@laptimer/core';
import { drivingStyle, pairedCorners } from '../src/lib/drivingStyle';

/** A lap sampled once a second from a speed profile (m/s by second). */
function lapFrom(speeds: number[]) {
  const trace: LapTracePoint[] = [];
  let d = 0;
  speeds.forEach((v, i) => {
    trace.push({ t: i * 1000, d, v, lat: 0, lon: 0, accuracy: 3 });
    d += v;
  });
  return { trace, distanceM: d, timeMs: (speeds.length - 1) * 1000 };
}

describe('driving style', () => {
  // Straight at 30 m/s, a hairpin at 10 m/s (36 km/h), then a fast bend at 25 m/s (90 km/h).
  const profile = [
    ...Array(8).fill(30), 27, 24, 21, 18, 15, 12, 10, 10, 12, 15, 18, 21, 24, 27, 30,
    ...Array(8).fill(30), 29, 28, 27, 25, 25, 27, 28, 29, 30, ...Array(6).fill(30),
  ];
  const s = drivingStyle(lapFrom(profile))!;

  it('splits the corners into slow and fast ones', () => {
    expect(s.slowCorners).toBe(1);
    expect(s.fastCorners).toBe(1);
    expect(s.slowCornerSpeed!).toBeLessThan(80 / 3.6);
    expect(s.fastCornerSpeed!).toBeGreaterThanOrEqual(80 / 3.6);
    expect(s.fastCornerSpeed!).toBeLessThan(27);
  });

  it('measures top and average speed', () => {
    expect(s.topSpeed).toBeCloseTo(30, 0);
    expect(s.avgSpeed).toBeGreaterThan(20);
    expect(s.avgSpeed).toBeLessThan(30);
  });

  it('has no corners of a kind it never met', () => {
    const fastOnly = drivingStyle(lapFrom([...Array(8).fill(30), 29, 28, 27, 25, 25, 27, 28, 29, ...Array(8).fill(30)]))!;
    expect(fastOnly.slowCornerSpeed).toBeNull();
    expect(fastOnly.fastCorners).toBe(1);
  });

  it('compares two laps on the same corners, whichever side of 80 km/h each takes them', () => {
    const corner = (apex: number) => [...Array(8).fill(30), 26, 22, apex + 2, apex, apex, apex + 2, 22, 26, ...Array(8).fill(30)];
    const a = drivingStyle(lapFrom(corner(20.5)))!;
    const b = drivingStyle(lapFrom(corner(24)))!;
    const p = pairedCorners(a, b);
    expect(p.slow === null || p.fast === null).toBe(true);
    const c = (p.slow ?? p.fast)!;
    expect(c.count).toBe(1);
    expect(c.b - c.a).toBeGreaterThan(2);
  });

  it('needs a trace with speeds', () => {
    expect(drivingStyle({ trace: [], distanceM: 0, timeMs: 0 })).toBeNull();
  });
});
