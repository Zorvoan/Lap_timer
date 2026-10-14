import { describe, expect, it } from 'vitest';
import { speedAt, traceGaps } from '../src/analysis';
import type { LapTracePoint } from '../src/model';

const pt = (t: number, d: number, v: number | null): LapTracePoint => ({ t, d, v, lat: 0, lon: 0, accuracy: 5 });

// 1 Hz fixes at 25 m/s, then 20 s without a fix (500 m), then fixes again.
const trace = [pt(0, 0, null), pt(1000, 25, 25), pt(2000, 50, 26), pt(22_000, 550, 24), pt(23_000, 575, 30), pt(24_000, 600, null)];

describe('signal gaps in a trace', () => {
  it('finds stretches without fixes', () => {
    expect(traceGaps(trace)).toEqual([{ fromT: 2000, toT: 22_000, fromD: 50, toD: 550 }]);
  });

  it('has no speed inside a gap instead of a straight line across it', () => {
    expect(speedAt(trace, 300)).toBeNull();
    expect(speedAt(trace, 37.5)).toBeCloseTo(25.5);
    expect(speedAt(trace, 562.5)).toBeCloseTo(27);
    expect(speedAt(trace, 550)).toBe(24);
  });

  it('can be told to bridge gaps', () => {
    expect(speedAt(trace, 300, Infinity)).toBeCloseTo(25);
  });
});
