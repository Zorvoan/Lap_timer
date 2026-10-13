import { describe, expect, it } from 'vitest';
import { LapTimer, type TimingEvent } from '../src/timing';
import type { TimingLineXY } from '../src/lines';

// Start/finish line along the y axis from (0,-10) to (0,10); valid travel is +x (east).
const LINE: TimingLineXY = { a: { x: 0, y: -10 }, b: { x: 0, y: 10 }, direction: -1 };
// cross((0,20), (1,0)) = 0*0 - 20*1 = -20 → direction -1 for eastward travel.

function run(timer: LapTimer, path: [number, number, number][]): TimingEvent[] {
  const events: TimingEvent[] = [];
  for (let i = 1; i < path.length; i++) {
    const [x0, y0, t0] = path[i - 1];
    const [x1, y1, t1] = path[i];
    events.push(...timer.process({ t: t0, p: { x: x0, y: y0 } }, { t: t1, p: { x: x1, y: y1 } }));
  }
  return events;
}

/** A loop that crosses the line eastward at x=0 once per `lapMs`. */
function laps(n: number, lapMs: number, startT = 0): [number, number, number][] {
  const path: [number, number, number][] = [[-50, 0, startT]];
  for (let k = 0; k < n; k++) {
    const t0 = startT + k * lapMs;
    path.push([50, 0, t0 + 0.2 * lapMs]); // crosses x=0 at t0 + 0.1·lapMs
    path.push([50, 200, t0 + 0.5 * lapMs]);
    path.push([-50, 200, t0 + 0.7 * lapMs]);
    path.push([-50, 0, t0 + lapMs]);
  }
  return path;
}

describe('LapTimer', () => {
  it('starts on the first valid crossing and interpolates its time', () => {
    const timer = new LapTimer(LINE, [], null);
    const ev = run(timer, [[-10, 0, 1000], [30, 0, 2000]]);
    expect(ev).toEqual([{ type: 'lap_start', t: 1250, lap: 1, gapMs: 1000 }]);
    expect(timer.phase).toBe('running');
  });

  it('does not count placing the line (or being near it) as a lap', () => {
    const timer = new LapTimer(LINE, [], null);
    // Approaching and stopping just before the line, never crossing.
    const ev = run(timer, [[-40, 0, 0], [-20, 0, 1000], [-5, 0, 2000], [-1, 0, 3000]]);
    expect(ev).toEqual([]);
    expect(timer.lap).toBe(0);
  });

  it('completes laps with precise interpolated lap times', () => {
    const timer = new LapTimer(LINE, [], null);
    const ev = run(timer, laps(3, 60_000));
    const completes = ev.filter((e) => e.type === 'lap_complete');
    expect(completes).toHaveLength(2);
    for (const c of completes) if (c.type === 'lap_complete') expect(c.lapTimeMs).toBeCloseTo(60_000, 6);
    expect(ev.filter((e) => e.type === 'lap_start')).toHaveLength(3);
  });

  it('ignores crossings in the wrong direction', () => {
    const timer = new LapTimer(LINE, [], null);
    const ev = run(timer, [[30, 0, 0], [-30, 0, 1000]]);
    expect(ev).toEqual([{ type: 'wrong_direction', t: 500, line: 'start' }]);
    expect(timer.phase).toBe('waiting');
  });

  it('prevents duplicate laps from GPS jitter across the line', () => {
    const timer = new LapTimer(LINE, [], null);
    const ev = run(timer, [
      [-5, 0, 0],
      [2, 0, 1000], // start
      [-1, 1, 2000], // jitter back
      [3, -1, 3000], // and forward again
      [-2, 0, 4000],
      [4, 0, 5000],
      [40, 0, 6000],
    ]);
    expect(ev.filter((e) => e.type === 'lap_start')).toHaveLength(1);
    expect(ev.filter((e) => e.type === 'lap_complete')).toHaveLength(0);
  });

  it('enforces a minimum lap duration', () => {
    const timer = new LapTimer(LINE, [], null, { minLapMs: 30_000, cooldownMs: 1000, rearmDistanceM: 20 });
    const ev = run(timer, laps(2, 10_000));
    expect(ev.filter((e) => e.type === 'lap_complete')).toHaveLength(0);
    expect(ev.some((e) => e.type === 'short_lap_ignored')).toBe(true);
    expect(timer.lap).toBe(1);
  });

  it('records sector splits in order and sector times that sum to the lap time', () => {
    const sector: TimingLineXY = { a: { x: 40, y: 190 }, b: { x: 60, y: 190 }, direction: 1 };
    const timer = new LapTimer(LINE, [sector], null);
    const ev = run(timer, laps(2, 40_000));
    const lap = ev.find((e) => e.type === 'lap_complete');
    expect(lap && lap.type === 'lap_complete' && lap.sectorTimesMs.length).toBe(2);
    if (lap?.type === 'lap_complete') {
      expect(lap.sectorTimesMs.reduce((a, b) => a + b, 0)).toBeCloseTo(lap.lapTimeMs, 6);
    }
  });

  it('abortLap returns to waiting so the next crossing starts a new lap', () => {
    const timer = new LapTimer(LINE, [], null);
    run(timer, [[-10, 0, 0], [10, 0, 1000]]);
    timer.abortLap();
    expect(timer.phase).toBe('waiting');
    const ev = run(timer, [[10, 0, 1000], [100, 100, 20_000], [-30, 0, 40_000], [30, 0, 41_000]]);
    expect(ev.map((e) => e.type)).toEqual(['lap_start']);
    expect(timer.lap).toBe(2);
  });

  it('supports sprint routes with separate finish lines', () => {
    const finish: TimingLineXY = { a: { x: 500, y: -10 }, b: { x: 500, y: 10 }, direction: -1 };
    const timer = new LapTimer(LINE, [], finish, { minLapMs: 1000, cooldownMs: 1000, rearmDistanceM: 20 });
    const ev = run(timer, [[-10, 0, 0], [10, 0, 1000], [490, 0, 25_000], [510, 0, 26_000]]);
    expect(ev.map((e) => e.type)).toEqual(['lap_start', 'lap_complete']);
    const done = ev[1];
    if (done.type === 'lap_complete') expect(done.lapTimeMs).toBeCloseTo(25_000, 6);
    expect(timer.phase).toBe('waiting');
  });
});
