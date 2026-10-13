import { describe, expect, it } from 'vitest';
import { LiveSectors, ReferenceLap } from '../src';

// 900 m lap: thirds end at 300 m and 600 m.
const ref = ReferenceLap.fromTrace([{ t: 30_000, d: 300 }, { t: 50_000, d: 600 }], 60_000, 900);

describe('LiveSectors', () => {
  it('reports each third as it is passed, interpolating between fixes', () => {
    const s = new LiveSectors(900, ref, []);
    s.reset();
    expect(s.update(10_000, 100)).toEqual([]);
    // 300 m is passed between 100 m (10 s) and 400 m (40 s): at 30 s.
    const [s1] = s.update(40_000, 400);
    expect(s1.sector).toBe(0);
    expect(s1.timeMs).toBeCloseTo(30_000, 6);
    expect(s1.refDeltaMs).toBeCloseTo(0, 6);
    expect(s1.personalBest).toBe(true); // nothing to beat yet
    const [s2] = s.update(52_000, 640);
    expect(s2.sector).toBe(1);
    expect(s2.timeMs).toBeCloseTo(52_000 - (640 - 600) * (12_000 / 240) - 30_000, 6);
    const s3 = s.finish(61_000)!;
    expect(s3.sector).toBe(2);
    expect(s3.timeMs + s2.timeMs + s1.timeMs).toBeCloseTo(61_000, 6);
  });

  it('marks a sector purple only when it beats the best so far', () => {
    const s = new LiveSectors(900, null, [29_000, 21_000, 10_000]);
    s.reset();
    const [a] = s.update(30_000, 300);
    expect(a.personalBest).toBe(false);
    expect(a.refDeltaMs).toBeNull();
    const [b] = s.update(50_000, 600); // 20 s < 21 s
    expect(b.personalBest).toBe(true);
    expect(s.bestSectorsMs[1]).toBe(20_000);
  });

  it('returns no last sector when a split was missed, and starts over on reset', () => {
    const s = new LiveSectors(900, null, []);
    s.reset();
    s.update(30_000, 300);
    expect(s.finish(60_000)).toBeNull();
    s.reset();
    expect(s.update(5_000, 50)).toEqual([]);
  });

  it('reports two sectors at once when a gap in fixes skips past both ends', () => {
    const s = new LiveSectors(900, null, []);
    s.reset();
    s.update(10_000, 100);
    expect(s.update(70_000, 700).map((x) => x.sector)).toEqual([0, 1]);
  });
});
