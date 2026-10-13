import { describe, expect, it } from 'vitest';
import type { LapRecord, Session } from '@laptimer/core';
import { circuitLapNumbers, lapKey, lapsDrivenBefore } from '../src/lib/lapNumbers';

function lap(n: number, startT: number): LapRecord {
  return {
    lap: n,
    startT,
    endT: startT + 60_000,
    timeMs: 60_000,
    sectorTimesMs: [],
    distanceM: 1000,
    avgSpeedMs: 16,
    maxSpeedMs: 20,
    valid: true,
    flags: [],
    gps: { samples: 1, poorSamples: 0, meanAccuracyM: 3, maxGapMs: 200, meanRateHz: 1 },
    trace: [],
  };
}

function session(id: string, source: Session['source'], startedAt: number, laps: LapRecord[]): Session {
  return { id, circuitId: 'c', circuitName: 'C', source, startedAt, endedAt: startedAt + 1, laps, marks: [], reference: null, updatedAt: 0 };
}

describe('circuit-wide lap numbers', () => {
  // Listed newest first, as the repository returns them.
  const sessions = [
    session('third', 'gps', 3_000_000, [lap(1, 3_000_000)]),
    session('sim', 'simulated', 2_500_000, [lap(1, 2_500_000), lap(2, 2_560_000)]),
    session('second', 'gps', 2_000_000, [lap(1, 2_000_000)]),
    session('first', 'gps', 1_000_000, [lap(1, 1_000_000), lap(2, 1_060_000)]),
  ];

  it('numbers laps in the order driven across sessions', () => {
    const n = circuitLapNumbers(sessions);
    expect(n.get(lapKey('first', 1))).toBe(1);
    expect(n.get(lapKey('first', 2))).toBe(2);
    expect(n.get(lapKey('second', 1))).toBe(3);
    expect(n.get(lapKey('third', 1))).toBe(4);
  });

  it('numbers simulated laps separately from real ones', () => {
    const n = circuitLapNumbers(sessions);
    expect(n.get(lapKey('sim', 1))).toBe(1);
    expect(n.get(lapKey('sim', 2))).toBe(2);
  });

  it('gives the offset for a new session', () => {
    expect(lapsDrivenBefore(sessions, 'gps')).toBe(4);
    expect(lapsDrivenBefore(sessions, 'gps', 'third')).toBe(3);
    expect(lapsDrivenBefore(sessions, 'simulated')).toBe(2);
  });
});
