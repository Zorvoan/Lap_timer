import { describe, expect, it } from 'vitest';
import type { LapTracePoint } from '@laptimer/core';
import { drivingStyle } from '../src/lib/drivingStyle';

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
  // Straight at 30 m/s, brake to a 12 m/s corner, accelerate out, second corner at 16 m/s.
  const profile = [
    ...Array(8).fill(30), 27, 24, 21, 18, 15, 12, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30,
    ...Array(8).fill(30), 27, 24, 21, 18, 16, 16, 18, 20, 22, 24, 26, 28, 30, ...Array(6).fill(30),
  ];
  const s = drivingStyle(lapFrom(profile))!;

  it('finds both corners and their apex speeds', () => {
    expect(s.corners).toBe(2);
    expect(s.cornerSpeed).toBeGreaterThan(12);
    expect(s.cornerSpeed).toBeLessThan(18);
  });

  it('measures top and average speed', () => {
    expect(s.topSpeed).toBeCloseTo(30, 0);
    expect(s.avgSpeed).toBeGreaterThan(20);
    expect(s.avgSpeed).toBeLessThan(30);
  });

  it('measures braking and acceleration from the speed changes', () => {
    expect(s.braking).toBeGreaterThan(1.5);
    expect(s.braking).toBeLessThan(3.5);
    expect(s.accel).toBeGreaterThan(1);
    expect(s.accel).toBeLessThan(2.5);
  });

  it('needs a trace with speeds', () => {
    expect(drivingStyle({ trace: [], distanceM: 0, timeMs: 0 })).toBeNull();
  });
});
