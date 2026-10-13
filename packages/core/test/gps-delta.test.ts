import { describe, expect, it } from 'vitest';
import { GpsFilter } from '../src/gps';
import { ReferenceLap, computeDelta } from '../src/delta';
import { formatDelta, formatLapTime, formatSpeed } from '../src/format';
import { fixAt } from './fixtures';

describe('GpsFilter', () => {
  it('rejects invalid and out-of-order fixes', () => {
    const f = new GpsFilter();
    expect(f.process({ ...fixAt({ x: 0, y: 0 }, 1000), lat: Number.NaN }).reason).toBe('invalid');
    expect(f.process({ ...fixAt({ x: 0, y: 0 }, 1000), accuracy: -1 }).reason).toBe('invalid');
    expect(f.process(fixAt({ x: 0, y: 0 }, 1000)).status).toBe('ok');
    expect(f.process(fixAt({ x: 1, y: 0 }, 1000)).reason).toBe('out_of_order');
    expect(f.process(fixAt({ x: 1, y: 0 }, 900)).reason).toBe('out_of_order');
  });

  it('flags poor accuracy without rejecting the fix', () => {
    const f = new GpsFilter({ maxAccuracyM: 10, maxSpeedMs: 100, reanchorAfter: 3 });
    expect(f.process(fixAt({ x: 0, y: 0 }, 0, { accuracy: 35 })).status).toBe('poor_accuracy');
  });

  it('rejects position jumps and re-anchors after consistent fixes', () => {
    const f = new GpsFilter();
    f.process(fixAt({ x: 0, y: 0 }, 0));
    f.process(fixAt({ x: 20, y: 0 }, 1000));
    expect(f.process(fixAt({ x: 2000, y: 0 }, 2000)).reason).toBe('jump');
    expect(f.process(fixAt({ x: 60, y: 0 }, 3000)).status).toBe('ok'); // back on the real path
    // A real relocation (e.g. after a tunnel): consistent fixes far away are eventually accepted.
    expect(f.process(fixAt({ x: 5000, y: 0 }, 4000)).reason).toBe('jump');
    expect(f.process(fixAt({ x: 5020, y: 0 }, 5000)).reason).toBe('jump');
    const r = f.process(fixAt({ x: 5040, y: 0 }, 6000));
    expect(r.status).toBe('ok');
    expect(r.reanchored).toBe(true);
  });

  it('prefers receiver speed and falls back to smoothed derived speed', () => {
    const f = new GpsFilter();
    f.process(fixAt({ x: 0, y: 0 }, 0, { speed: 20 }));
    expect(f.process(fixAt({ x: 20, y: 0 }, 1000, { speed: 21 }))).toMatchObject({ speedMs: 21, speedSource: 'gps' });
    const r = f.process(fixAt({ x: 40, y: 0 }, 2000, { speed: null }));
    expect(r.speedSource).toBe('derived');
    expect(r.speedMs).toBeCloseTo(20, 0);
  });
});

describe('ReferenceLap and delta', () => {
  // Reference: 1000 m in 50 s at constant 20 m/s.
  const ref = ReferenceLap.fromTrace(
    Array.from({ length: 49 }, (_, i) => ({ t: (i + 1) * 1000, d: (i + 1) * 20 })),
    50_000,
    1000,
  );

  it('interpolates reference time between samples', () => {
    expect(ref.timeAt(0)).toBe(0);
    expect(ref.timeAt(30)).toBeCloseTo(1500, 6);
    expect(ref.timeAt(1000)).toBe(50_000);
    expect(ref.timeAt(5000)).toBe(50_000);
  });

  it('compares at equal distance, not equal time', () => {
    // At 500 m the reference took 25 s. Being there after 24.658 s is 0.342 s faster.
    const faster = computeDelta(ref, 24_658, 500);
    expect(faster.deltaMs).toBeCloseTo(-342, 6);
    expect(formatDelta(faster.deltaMs)).toBe('-0.342');
    expect(faster.projectedLapMs).toBeCloseTo(49_658, 6);
    const slower = computeDelta(ref, 25_517, 500);
    expect(formatDelta(slower.deltaMs)).toBe('+0.517');
  });

  it('makes a non-monotonic trace monotonic (stops, jitter)', () => {
    const r = ReferenceLap.fromTrace(
      [
        { t: 1000, d: 10 },
        { t: 2000, d: 9 }, // jitter backwards
        { t: 3000, d: 10 }, // stopped
        { t: 4000, d: 40 },
      ],
      10_000,
      100,
    );
    expect(r.timeAt(10)).toBe(1000);
    expect(r.timeAt(25)).toBeCloseTo(2500, 6);
  });

  it('rejects unusable references', () => {
    expect(() => ReferenceLap.fromTrace([], 0, 100)).toThrow();
  });
});

describe('formatting', () => {
  it('formats lap times without rounding up', () => {
    expect(formatLapTime(42_816)).toBe('00:42.816');
    expect(formatLapTime(83_456.9)).toBe('01:23.456');
    expect(formatLapTime(null)).toBe('--:--.---');
  });

  it('formats speeds', () => {
    expect(formatSpeed(10, 'kmh')).toBe('36');
    expect(formatSpeed(10, 'mph', 1)).toBe('22.4');
  });
});
