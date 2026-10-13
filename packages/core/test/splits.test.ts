import { describe, expect, it } from 'vitest';
import { idealLap, splitTimes } from '../src';

describe('splitTimes', () => {
  it('splits a lap into equal-distance parts that add up to the lap time', () => {
    // 900 m: first third at 10 m/s, second at 15 m/s, last at 30 m/s → 30 s, 20 s, 10 s
    const trace = [
      { t: 0, d: 0 },
      { t: 30_000, d: 300 },
      { t: 50_000, d: 600 },
      { t: 60_000, d: 900 },
    ];
    const s = splitTimes(trace, 60_000, 900, 3);
    expect(s.map((x) => Math.round(x))).toEqual([30_000, 20_000, 10_000]);
    expect(s.reduce((a, b) => a + b, 0)).toBeCloseTo(60_000, 6);
  });
});

describe('idealLap', () => {
  it('combines the best sector of each lap and says which lap it came from', () => {
    const r = idealLap([
      [30_000, 21_000, 10_500],
      [31_000, 19_500, 10_200],
      [29_800, 22_000, 11_000],
    ]);
    expect(r?.sectorsMs).toEqual([29_800, 19_500, 10_200]);
    expect(r?.timeMs).toBe(59_500);
    expect(r?.from).toEqual([2, 1, 1]);
  });

  it('ignores laps without splits', () => {
    expect(idealLap([])).toBeNull();
    expect(idealLap([[], [1, 2]])?.timeMs).toBe(3);
  });
});
