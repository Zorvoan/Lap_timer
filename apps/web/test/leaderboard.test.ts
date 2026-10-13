import { describe, expect, it } from 'vitest';
import { ReferenceLap, type LapRecord, type Session } from '@laptimer/core';
import { MAX_TRACE_POINTS, bestEligibleLap, parsePublishedTrace, traceForPublishing, validateCar, validateNickname } from '../src/lib/cloud/leaderboard';

function lap(n: number, timeMs: number, extra: Partial<LapRecord> = {}): LapRecord {
  const trace = Array.from({ length: 5001 }, (_, i) => ({ t: (timeMs * i) / 5000, d: (1000 * i) / 5000, v: 20, lat: 50, lon: 14, accuracy: 3 }));
  return {
    lap: n, startT: 1_000_000 + n, endT: 1_000_000 + n + timeMs, timeMs, sectorTimesMs: [], distanceM: 1000, avgSpeedMs: 20, maxSpeedMs: 25,
    valid: true, flags: [], gps: { samples: 1, poorSamples: 0, meanAccuracyM: 3, maxGapMs: 200, meanRateHz: 5 }, trace, ...extra,
  };
}

function session(id: string, source: Session['source'], laps: LapRecord[], circuitId = 'c1'): Session {
  return { id, circuitId, circuitName: 'C', source, startedAt: 1, endedAt: 2, laps, marks: [], reference: null, updatedAt: 0 };
}

describe('leaderboard eligibility', () => {
  it('takes the fastest valid real-GPS lap and never a simulated one', () => {
    const sessions = [
      session('sim', 'simulated', [lap(1, 40_000)]),
      session('a', 'gps', [lap(1, 52_000), lap(2, 50_500)]),
      session('b', 'gps', [lap(1, 49_000, { valid: false })]),
      session('c', 'gps', [lap(1, 49_500, { flags: ['tracking_lost'] })]),
      session('other', 'gps', [lap(1, 30_000)], 'c2'),
    ];
    const best = bestEligibleLap(sessions, 'c1');
    expect(best?.session.id).toBe('a');
    expect(best?.lap.timeMs).toBe(50_500);
  });

  it('ignores sessions still being recorded', () => {
    expect(bestEligibleLap([{ ...session('live', 'gps', [lap(1, 45_000)]), endedAt: null }], 'c1')).toBeNull();
  });
});

describe('published traces', () => {
  it('downsamples but keeps the lap ends, and works as a delta reference', () => {
    const l = lap(1, 50_000);
    const t = traceForPublishing(l, 1000);
    const pts = parsePublishedTrace(t);
    expect(pts.length).toBeLessThanOrEqual(MAX_TRACE_POINTS + 1);
    expect(pts[0]).toEqual({ t: 0, d: 0, v: 20 });
    expect(pts.at(-1)?.t).toBe(50_000);
    const ref = ReferenceLap.fromTrace(pts, t.timeMs, t.lengthM);
    expect(ref.timeAt(500)).toBeCloseTo(25_000, 3);
  });
});

describe('profile validation', () => {
  it('accepts sensible nicknames and cars', () => {
    expect(validateNickname('Zdeněk_77')).toBeNull();
    expect(validateNickname('Mr. Sideways')).toBeNull();
    expect(validateNickname('ab')).not.toBeNull();
    expect(validateNickname(' spaced ')).toBeNull(); // trimmed
    expect(validateNickname('bad<html>')).not.toBeNull();
    expect(validateCar('Škoda Octavia RS')).toBeNull();
    expect(validateCar('x')).not.toBeNull();
  });
});
