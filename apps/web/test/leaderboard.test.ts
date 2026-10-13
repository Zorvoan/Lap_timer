import { describe, expect, it } from 'vitest';
import { ReferenceLap, TrackModel, compareLaps, distanceMeters, perpendicularLine, type CircuitDefinition, type LapRecord, type LonLat, type Session } from '@laptimer/core';
import {
  MAX_TRACE_POINTS,
  bestEligibleLap,
  entryFromLap,
  isEligible,
  lapFromPublished,
  parsePublishedTrace,
  traceForPublishing,
  validateCar,
  validateNickname,
  type LeaderboardEntry,
} from '../src/lib/cloud/leaderboard';

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

describe('leaderboard plausibility and splits', () => {
  it('rejects laps averaging more than 250 km/h (GPS errors or forged times)', () => {
    const s = session('a', 'gps', []);
    expect(isEligible(s, lap(1, 50_000))).toBe(true); // 1 km in 50 s = 72 km/h
    expect(isEligible(s, lap(1, 14_000))).toBe(false); // 1 km in 14 s = 257 km/h
  });

  it('publishes the lap split into thirds by distance', () => {
    const e = entryFromLap('u', { nickname: 'Me', car: 'Car' }, session('a', 'gps', []), lap(1, 60_000), 1000);
    expect(e.splitTimesMs?.map(Math.round)).toEqual([20_000, 20_000, 20_000]);
  });
});

describe('published laps as telemetry', () => {
  // A straight 1.2 km road heading east; start 100 m in, finish at 1100 m (a 1000 m sprint).
  const geometry: LonLat[] = Array.from({ length: 13 }, (_, i) => [14 + (i * 100) / (111_320 * Math.cos((50 * Math.PI) / 180)), 50]);
  const track = TrackModel.fromCoordinates(geometry, false);
  const circuit: CircuitDefinition = { kind: 'sprint', geometry, startLine: perpendicularLine(track, 100), finishLine: perpendicularLine(track, 1100), sectors: [] };
  const entry: LeaderboardEntry = {
    uid: 'u1', nickname: 'Rival', car: 'Car', timeMs: 50_000, drivenAt: 1_000_000, sessionId: 's', lap: 3, sectorTimesMs: [], avgSpeedMs: 20, maxSpeedMs: 25,
  };

  it('places every point on the circuit at its distance from the start line', () => {
    const published = traceForPublishing(lap(1, 50_000), 1000);
    const l = lapFromPublished(entry, published, circuit, 1000);
    expect(l.timeMs).toBe(50_000);
    expect(l.trace[0].d).toBe(0);
    expect(l.trace.at(-1)?.d).toBeCloseTo(1000, 6);
    const start = track.latLonAt(100);
    const half = l.trace.find((p) => p.d >= 500)!;
    expect(distanceMeters(start, l.trace[0])).toBeLessThan(0.5);
    expect(distanceMeters(start, half)).toBeCloseTo(half.d, 0);
  });

  it('rescales distances when the track length changed since publishing, and compares by distance', () => {
    const published = traceForPublishing(lap(1, 50_000), 980);
    const l = lapFromPublished(entry, published, circuit, 1000);
    expect(l.trace.at(-1)?.d).toBeCloseTo(1000, 6);
    const rows = compareLaps(l, lap(2, 48_000), 1000);
    expect(rows.at(-1)?.deltaMs).toBeCloseTo(2000, 6);
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
