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
  it('measures top and average speed', () => {
    const s = drivingStyle(lapFrom([...Array(8).fill(30), 27, 24, 21, 18, 15, 12, 10, 10, 12, 15, 18, 21, 24, 27, ...Array(8).fill(30)]))!;
    expect(s.topSpeed).toBeCloseTo(30, 0);
    expect(s.avgSpeed).toBeGreaterThan(20);
    expect(s.avgSpeed).toBeLessThan(30);
  });

  it('does not take a single GPS spike as the top speed', () => {
    const s = drivingStyle(lapFrom([...Array(10).fill(20), 60, ...Array(10).fill(20)]))!;
    expect(s.topSpeed).toBeLessThan(30);
  });

  it('needs a trace with speeds', () => {
    expect(drivingStyle({ trace: [], distanceM: 0, timeMs: 0 })).toBeNull();
  });
});
