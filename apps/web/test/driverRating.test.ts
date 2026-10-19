import { describe, expect, it } from 'vitest';
import type { LapRecord, LapTracePoint, Session } from '@laptimer/core';
import { driverRating, ratingLabel } from '../src/lib/driverRating';

const DAY = 86_400_000;
const NOW = new Date(2026, 9, 19, 18).getTime();

/** A lap sampled once a second: straights at 30 m/s, two corners at `apex` m/s. */
function lap(n: number, timeMs: number, apex = 14): LapRecord {
  const speeds = [...Array(8).fill(30), 26, 22, 18, apex, apex, 18, 22, 26, ...Array(8).fill(30), 26, 22, apex, apex, 22, 26, ...Array(6).fill(30)];
  const trace: LapTracePoint[] = [];
  let d = 0;
  speeds.forEach((v, i) => {
    trace.push({ t: i * 1000, d, v, lat: 0, lon: 0, accuracy: 3 });
    d += v;
  });
  return { lap: n, timeMs, distanceM: d, valid: true, flags: [], trace, sectorTimesMs: [], avgSpeedMs: d / (timeMs / 1000), maxSpeedMs: 30, startT: 0 } as unknown as LapRecord;
}

function session(id: string, circuitId: string, daysAgo: number, laps: LapRecord[], source = 'gps'): Session {
  return { id, circuitId, circuitName: circuitId, source, startedAt: NOW - daysAgo * DAY, endedAt: null, laps, marks: [], reference: null, updatedAt: 0 } as unknown as Session;
}

describe('driver rating', () => {
  it('needs at least one real valid lap', () => {
    expect(driverRating([], [], NOW)).toBeNull();
    expect(driverRating([session('s', 'r', 0, [lap(1, 60_000)], 'simulated')], [], NOW)).toBeNull();
  });

  const sessions = [
    session('a', 'road', 5, [lap(1, 62_000, 12), lap(2, 61_000, 12)]),
    session('b', 'road', 2, [lap(1, 60_500, 15)]),
    session('c', 'road', 0, [lap(1, 60_000, 16)]),
  ];
  const r = driverRating(sessions, [{ circuitId: 'road', othersMs: [57_000, 63_000, 66_000] }], NOW)!;

  it('scores skills from the laps and stays within 0–100', () => {
    for (const k of ['braking', 'corners', 'accel', 'consistency'] as const) {
      expect(r.skills[k]).not.toBeNull();
      expect(r.skills[k]!.score).toBeGreaterThanOrEqual(0);
      expect(r.skills[k]!.score).toBeLessThanOrEqual(100);
    }
    expect(r.overall).toBeGreaterThan(0);
    expect(r.overall).toBeLessThanOrEqual(100);
  });

  it('reads pace and position from the leaderboard', () => {
    // 57.0 s record vs a 60.0 s best: 95% of the record's pace.
    expect(r.pace).toBeCloseTo(75, 0);
    // Second of four.
    expect(r.topShare).toBeCloseTo(0.5, 5);
  });

  it('tracks progress, the latest change and the days driven', () => {
    expect(r.progressPct).toBeCloseTo(((61_000 - 60_000) / 61_000) * 100, 5);
    expect(r.history).toHaveLength(3);
    expect(r.change).toBeCloseTo(r.history[2].score - r.history[1].score, 9);
    expect(r.days.map((d) => d.drove)).toEqual([false, true, false, false, true, false, true]);
  });

  it('names the rating', () => {
    expect(ratingLabel(90)).toBe('Elite');
    expect(ratingLabel(72)).toBe('Strong');
    expect(ratingLabel(10)).toBe('Learning');
  });
});
