import { describe, expect, it } from 'vitest';
import type { LapRecord, LapTracePoint, Session } from '@laptimer/core';
import { driverRating, ratingLabel, type RoadBoard } from '../src/lib/driverRating';

const DAY = 86_400_000;
const NOW = new Date(2026, 9, 19, 18).getTime();

/** A lap sampled once a second: straights at 30 m/s, two corners at `apex` m/s. */
function lap(n: number, apex = 14): LapRecord {
  const speeds = [...Array(8).fill(30), 26, 22, 18, apex, apex, 18, 22, 26, ...Array(8).fill(30), 26, 22, apex, apex, 22, 26, ...Array(6).fill(30)];
  const trace: LapTracePoint[] = [];
  let d = 0;
  speeds.forEach((v, i) => {
    trace.push({ t: i * 1000, d, v, lat: 0, lon: 0, accuracy: 3 });
    d += v;
  });
  const timeMs = (speeds.length - 1) * 1000;
  return { lap: n, timeMs, distanceM: d, valid: true, flags: [], trace, sectorTimesMs: [], avgSpeedMs: d / (timeMs / 1000), maxSpeedMs: 30, startT: 0 } as unknown as LapRecord;
}

/** The same lap with its time set (the trace stays; only the clock differs). */
const timed = (l: LapRecord, timeMs: number) => ({ ...l, timeMs }) as LapRecord;

function session(id: string, circuitId: string, daysAgo: number, laps: LapRecord[], source = 'gps'): Session {
  return { id, circuitId, circuitName: circuitId, source, startedAt: NOW - daysAgo * DAY, endedAt: NOW, laps, marks: [], reference: null, updatedAt: 0 } as unknown as Session;
}

describe('driver rating', () => {
  it('needs at least one real valid lap', () => {
    expect(driverRating([], [])).toBeNull();
    expect(driverRating([session('s', 'r', 0, [lap(1)], 'simulated')], [])).toBeNull();
  });

  it('has no rating without other drivers, but still the rest', () => {
    const r = driverRating([session('a', 'road', 1, [lap(1)]), session('b', 'road', 0, [lap(1)])], [])!;
    expect(r.overall).toBeNull();
    expect(r.totals.laps).toBe(2);
    expect(r.totals.roads).toBe(1);
  });

  const base = lap(1, 14);
  const sessions = [
    session('a', 'road', 5, [timed(base, 62_000), timed(base, 61_000)]),
    session('b', 'road', 2, [timed(base, 60_500)]),
    session('c', 'road', 0, [timed(base, 60_000)]),
  ];
  const ref = timed(lap(1, 18), 57_000);
  const board: RoadBoard = { circuitId: 'road', name: 'Road', lengthM: base.distanceM, othersMs: [57_000, 63_000, 66_000, 70_000], ref: { uid: 'p1', nickname: 'Fast', lap: ref } };
  const r = driverRating(sessions, [board])!;

  it('rates pace against the record and position in the field', () => {
    // 57.0 s record vs a 60.0 s best: 95% of the record's pace.
    expect(r.overall).toBeCloseTo(75, 0);
    // Second of five.
    expect(r.topShare).toBeCloseTo(0.4, 5);
    expect(r.provisional).toBe(true);
  });

  it('compares skills with the fastest driver', () => {
    // The fastest driver carries 4 m/s more through the corners.
    expect(r.skills.corners!.value).toBeLessThan(0);
    expect(r.skills.corners!.score).toBeLessThan(100);
    expect(r.skills.consistency).not.toBeNull();
    expect(r.losses.length).toBeGreaterThan(0);
    expect(r.losses[0].refName).toBe('Fast');
  });

  it('tracks progress and the rating drive by drive', () => {
    expect(r.progressPct).toBeCloseTo(((61_000 - 60_000) / 61_000) * 100, 5);
    expect(r.history).toHaveLength(3);
    expect(r.history[2].score).toBeCloseTo(r.overall!, 9);
    expect(r.change).toBeGreaterThan(0);
  });

  it('names the rating', () => {
    expect(ratingLabel(90)).toBe('Elite');
    expect(ratingLabel(72)).toBe('Strong');
    expect(ratingLabel(10)).toBe('Learning');
  });
});
