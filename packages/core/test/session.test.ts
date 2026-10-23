import { describe, expect, it } from 'vitest';
import { SessionEngine } from '../src/session';
import { ReferenceLap } from '../src/delta';
import { constantSpeedProfile, simulateDrive, buildSpeedProfile } from '../src/sim';
import { compareLaps, gainLoss, summarizeSession } from '../src/analysis';
import { perpendicularLine } from '../src/lines';
import { TrackModel } from '../src/track';
import { cleanRecordedPath } from '../src/recording';
import { closedCircuit, fixAt, hairpinPoints, ovalPoints, toCoords } from './fixtures';
import type { GpsSample } from '../src/gps';
import type { LapRecord } from '../src/model';

const V = 30; // m/s

function drive(engine: SessionEngine, samples: GpsSample[]) {
  const events = [];
  for (const s of samples) events.push(...engine.push(s));
  return events;
}

describe('SessionEngine — full timing flow with deterministic fixtures', () => {
  const { def, track } = closedCircuit(ovalPoints(), 0);
  const L = track.length;

  it('times laps from line crossings with sub-sample precision', () => {
    const engine = new SessionEngine(def);
    const samples = simulateDrive(track, constantSpeedProfile(track, V), 3 * L + 200, {
      startAlongM: L - 100,
      noiseM: 0,
      hz: 1,
    });
    drive(engine, samples);
    expect(engine.laps).toHaveLength(3);
    for (const lap of engine.laps) {
      // 1 Hz fixes, but crossing time is interpolated: exact on a straight at constant speed.
      expect(lap.timeMs).toBeCloseTo((L / V) * 1000, 0);
      expect(lap.valid).toBe(true);
      expect(lap.distanceM / L).toBeCloseTo(1, 2);
    }
  });

  it('stays accurate with realistic GPS noise', () => {
    const engine = new SessionEngine(def);
    const samples = simulateDrive(track, constantSpeedProfile(track, V), 3 * L + 200, {
      startAlongM: L - 100,
      noiseM: 2,
      hz: 5,
      seed: 42,
    });
    drive(engine, samples);
    expect(engine.laps).toHaveLength(3);
    for (const lap of engine.laps) expect(Math.abs(lap.timeMs - (L / V) * 1000)).toBeLessThan(250);
  });

  it('does not produce a lap before the line is crossed twice', () => {
    const engine = new SessionEngine(def);
    drive(engine, simulateDrive(track, constantSpeedProfile(track, V), L * 0.9, { startAlongM: L - 100, noiseM: 0 }));
    expect(engine.laps).toHaveLength(0);
    expect(engine.snapshot().lapState).toBe('in_lap');
    expect(engine.snapshot().lap).toBe(1);
  });

  it('computes live delta at matching distance: faster and slower laps', () => {
    // pace index 1 = first timed lap, 2 = second, ...
    const samples = simulateDrive(track, constantSpeedProfile(track, V), 3 * L + 200, {
      startAlongM: L - 100,
      paceFactors: [1, 1, 1.05, 0.95],
      noiseM: 0,
      hz: 2,
    });
    // Build the reference from lap 1 of a first pass.
    const first = new SessionEngine(def);
    drive(first, samples);
    const [lap1, lap2, lap3] = first.laps;
    expect(lap2.timeMs).toBeLessThan(lap1.timeMs);
    expect(lap3.timeMs).toBeGreaterThan(lap1.timeMs);

    const ref = ReferenceLap.fromTrace(lap1.trace, lap1.timeMs, L);
    const engine = new SessionEngine(def, {}, ref);
    const deltas: { lap: number; d: number; delta: number }[] = [];
    for (const s of samples) {
      engine.push(s);
      const snap = engine.snapshot();
      if (snap.delta && snap.lapDistanceM !== null) deltas.push({ lap: snap.lap, d: snap.lapDistanceM, delta: snap.delta.deltaMs });
    }
    // Lap 1 against itself: delta ≈ 0 everywhere.
    for (const x of deltas.filter((x) => x.lap === 1)) expect(Math.abs(x.delta)).toBeLessThan(5);
    // Lap 2 is 5% faster: at distance d the expected delta is −d/V·(1 − 1/1.05).
    const l2 = deltas.filter((x) => x.lap === 2 && x.d > 100);
    expect(l2.length).toBeGreaterThan(10);
    for (const x of l2) {
      const expected = -(x.d / V) * (1 - 1 / 1.05) * 1000;
      // Tolerance covers the simulator's integration step at the pace change (~4 m).
      expect(Math.abs(x.delta - expected)).toBeLessThan(15);
      expect(x.delta).toBeLessThan(0);
    }
    // Lap 3 is slower: positive delta growing with distance.
    const l3 = deltas.filter((x) => x.lap === 3 && x.d > 100);
    for (const x of l3) expect(x.delta).toBeGreaterThan(0);
    expect(l3[l3.length - 1].delta).toBeGreaterThan(l3[0].delta);
  });

  it('handles missing samples (signal loss) and flags the lap', () => {
    const engine = new SessionEngine(def);
    const samples = simulateDrive(track, constantSpeedProfile(track, V), 2 * L + 200, {
      startAlongM: L - 100,
      noiseM: 0,
      hz: 2,
      dropouts: [{ fromMs: 20_000, toMs: 27_000 }],
    });
    drive(engine, samples);
    expect(engine.laps).toHaveLength(2);
    expect(engine.laps[0].flags).toContain('signal_gap');
    expect(engine.laps[0].timeMs).toBeCloseTo((L / V) * 1000, 0);
    expect(engine.snapshot(samples[samples.length - 1].t + 10_000).gpsState).toBe('lost');
  });

  it('rejects GPS jumps without corrupting timing', () => {
    const engine = new SessionEngine(def);
    const samples = simulateDrive(track, constantSpeedProfile(track, V), 2 * L + 200, { startAlongM: L - 100, noiseM: 0, hz: 2 });
    const corrupted = samples.map((s, i) => (i % 25 === 10 ? { ...s, lat: s.lat + 0.02 } : s));
    drive(engine, corrupted);
    expect(engine.samples.filter((s) => s.status === 'rejected').length).toBeGreaterThan(3);
    expect(engine.laps).toHaveLength(2);
    for (const lap of engine.laps) expect(lap.timeMs).toBeCloseTo((L / V) * 1000, 0);
  });

  it('ignores poor-accuracy fixes for timing', () => {
    const engine = new SessionEngine(def);
    const samples = simulateDrive(track, constantSpeedProfile(track, V), L + 200, { startAlongM: L - 100, noiseM: 0, hz: 2 });
    drive(engine, samples.map((s, i) => (i % 7 === 3 ? { ...s, accuracy: 80 } : s)));
    expect(engine.laps).toHaveLength(1);
    expect(engine.laps[0].flags).toContain('poor_gps');
    expect(engine.laps[0].gps.poorSamples).toBeGreaterThan(0);
  });

  it('pausing discards the lap in progress', () => {
    const engine = new SessionEngine(def);
    const samples = simulateDrive(track, constantSpeedProfile(track, V), 2 * L + 200, { startAlongM: L - 100, noiseM: 0, hz: 2 });
    const half = Math.floor(samples.length / 3);
    drive(engine, samples.slice(0, half));
    engine.pause(samples[half].t);
    expect(engine.snapshot().lapState).toBe('paused');
    drive(engine, samples.slice(half, half + 10)); // ignored while paused
    engine.resume(samples[half + 10].t);
    drive(engine, samples.slice(half + 10));
    // Lap 1 was aborted; lap 2 starts at the next crossing and completes nothing more.
    expect(engine.laps.every((l) => l.lap >= 2)).toBe(true);
  });

  it('replays stored samples and marks to the identical result (session recovery)', () => {
    const samples = simulateDrive(track, buildSpeedProfile(track), 3 * L, { startAlongM: L - 100, noiseM: 1.5, hz: 5, seed: 3 });
    const a = new SessionEngine(def);
    drive(a, samples);
    const b = new SessionEngine(def);
    b.replay(samples, []);
    expect(b.laps.map((l) => l.timeMs)).toEqual(a.laps.map((l) => l.timeMs));
  });

  it('times a circuit with close parallel sections correctly', () => {
    const hp = closedCircuit(hairpinPoints(), 250);
    const HL = hp.track.length;
    const engine = new SessionEngine(hp.def);
    const samples = simulateDrive(hp.track, constantSpeedProfile(hp.track, 15), 3 * HL + 300, {
      startAlongM: 150,
      noiseM: 3,
      hz: 5,
      seed: 9,
    });
    drive(engine, samples);
    expect(engine.laps.length).toBeGreaterThanOrEqual(2);
    for (const lap of engine.laps) {
      expect(lap.valid).toBe(true);
      expect(Math.abs(lap.timeMs - (HL / 15) * 1000)).toBeLessThan(400);
      expect(lap.flags).not.toContain('tracking_lost');
    }
  });

  it('times sprint routes from start to finish line', () => {
    const coords = toCoords([{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 500 }]);
    const t = TrackModel.fromCoordinates(coords, false);
    const engine = new SessionEngine({
      kind: 'sprint',
      geometry: coords,
      startLine: perpendicularLine(t, 100),
      finishLine: perpendicularLine(t, 1300),
      sectors: [],
    });
    expect(engine.lapLengthM).toBeCloseTo(1200, 3);
    drive(engine, simulateDrive(t, constantSpeedProfile(t, 20), 1450, { noiseM: 0, hz: 2 }));
    expect(engine.laps).toHaveLength(1);
    expect(engine.laps[0].timeMs).toBeCloseTo(60_000, 0);
  });

  it('times repeated sprint runs (simulator returns to the start between runs)', () => {
    const coords = toCoords([{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 500 }]);
    const t = TrackModel.fromCoordinates(coords, false);
    const engine = new SessionEngine({
      kind: 'sprint',
      geometry: coords,
      startLine: perpendicularLine(t, 100),
      finishLine: perpendicularLine(t, 1300),
      sectors: [],
    });
    drive(engine, simulateDrive(t, constantSpeedProfile(t, 20), 1530 * 2 + 1400, { noiseM: 0, hz: 2, repeatSprint: true, paceFactors: [1, 1.2, 1] }));
    expect(engine.laps.map((l) => Math.round(l.timeMs / 100) / 10)).toEqual([60, 50, 60]);
    expect(engine.laps.every((l) => l.valid)).toBe(true);
  });

  it('rejects a start line that does not cross the circuit', () => {
    const bad = { ...def, startLine: { ...def.startLine, a: { lat: 0, lon: 0 }, b: { lat: 0, lon: 0.0001 } } };
    expect(() => new SessionEngine(bad)).toThrow(/does not cross/);
  });
});

describe('lap analysis', () => {
  const { def, track } = closedCircuit(ovalPoints(), 0);
  const L = track.length;

  function laps(): LapRecord[] {
    const e = new SessionEngine(def);
    for (const s of simulateDrive(track, constantSpeedProfile(track, V), 3 * L + 200, {
      startAlongM: L - 100,
      paceFactors: [1, 1, 1.1, 1],
      noiseM: 0,
      hz: 2,
    }))
      e.push(s);
    return [...e.laps];
  }

  it('aligns laps by distance and attributes time gained', () => {
    const [a, b] = laps();
    const rows = compareLaps(b, a, L, 10);
    expect(rows[0].deltaMs).toBe(0);
    expect(rows[rows.length - 1].deltaMs).toBeCloseTo(b.timeMs - a.timeMs, 0);
    const segs = gainLoss(rows, 100);
    expect(segs.every((s) => s.changeMs < 0)).toBe(true); // faster lap gains everywhere
    expect(segs.reduce((s, x) => s + x.changeMs, 0)).toBeCloseTo(b.timeMs - a.timeMs, 0);
  });

  it('summarizes a session', () => {
    const ls = laps();
    const s = summarizeSession(ls);
    expect(s.laps).toBe(3);
    expect(s.bestLap?.lap).toBe(2);
  });
});

describe('recorded circuit cleanup', () => {
  it('extracts one loop from a noisy drive and drops bad fixes', () => {
    const track = TrackModel.fromCoordinates(toCoords(ovalPoints()), true);
    const samples = simulateDrive(track, constantSpeedProfile(track, 20), track.length * 1.3, { noiseM: 1, hz: 2, seed: 5 });
    samples[20] = { ...samples[20], accuracy: 90 };
    samples[30] = { ...samples[30], lat: samples[30].lat + 0.05 };
    const r = cleanRecordedPath(samples, { simplifyToleranceM: 0.5 });
    expect(r.droppedAccuracy).toBe(1);
    expect(r.droppedJumps).toBe(1);
    expect(r.loopClosed).toBe(true);
    const rebuilt = TrackModel.fromCoordinates(r.coords, true);
    expect(rebuilt.length / track.length).toBeGreaterThan(0.95);
    expect(rebuilt.length / track.length).toBeLessThan(1.05);
    expect(r.coords.length).toBeGreaterThan(20); // follows the curves, not a few straight segments
  });
});

describe('SessionEngine — start and finish where the GPS track misses the short line', () => {
  // A straight 1.5 km sprint heading east: start 100 m in, finish at 1300 m. Lines are 24 m wide.
  const coords = toCoords([{ x: 0, y: 0 }, { x: 1500, y: 0 }]);
  const t = TrackModel.fromCoordinates(coords, false);
  const circuit = { kind: 'sprint' as const, geometry: coords, startLine: perpendicularLine(t, 100), finishLine: perpendicularLine(t, 1300), sectors: [] };
  /** 1 Hz fixes at 15 m/s through the given points (straight segments between them). */
  function path(pts: { x: number; y: number }[], t0 = 1_000_000): GpsSample[] {
    const out: GpsSample[] = [];
    let time = t0;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      for (let d = 0; d < len; d += 15) {
        out.push(fixAt({ x: a.x + ((b.x - a.x) * d) / len, y: a.y + ((b.y - a.y) * d) / len }, time, { speed: 15 }));
        time += 1000;
      }
    }
    return out;
  }

  it('times a run driven 16 m beside the mapped road, outside both lines', () => {
    const engine = new SessionEngine(circuit);
    drive(engine, path([{ x: -200, y: 16 }, { x: 1500, y: 16 }]));
    expect(engine.laps).toHaveLength(1);
    // Exact at constant speed: the start and finish are where the run passes 100 m and 1300 m.
    expect(engine.laps[0].timeMs).toBeCloseTo(80_000, -1);
    expect(engine.laps[0].valid).toBe(true);
  });

  it('starts when the road is joined from a side road right at the start', () => {
    const engine = new SessionEngine(circuit);
    // Arrives from the south along the line itself and turns east onto the road: it never crosses it.
    drive(engine, path([{ x: 100, y: -300 }, { x: 100, y: 0 }, { x: 1500, y: 0 }]));
    expect(engine.laps).toHaveLength(1);
  });

  it('does not start while standing next to the start', () => {
    const engine = new SessionEngine(circuit);
    const fixes: GpsSample[] = [];
    for (let i = 0; i < 60; i++) fixes.push(fixAt({ x: 100 + Math.sin(i * 1.7) * 2.5, y: 20 + Math.cos(i * 2.3) * 2.5 }, 1_000_000 + i * 1000, { speed: 0 }));
    drive(engine, fixes);
    expect(engine.snapshot().lapState).toBe('waiting_start');
  });

  it('does not start when driving the road the wrong way', () => {
    const engine = new SessionEngine(circuit);
    drive(engine, path([{ x: 1500, y: 16 }, { x: -200, y: 16 }]));
    expect(engine.snapshot().lapState).toBe('waiting_start');
    expect(engine.laps).toHaveLength(0);
  });
});
