/**
 * Start and finish under the conditions drivers meet: GPS noise, driving beside the mapped road,
 * GPS dropouts at the lines, joining from a side road, standing at the start, stopping after the
 * finish. Every scenario runs on several road shapes; each run must be timed once, close to the
 * true time (the car keeps a steady pace, so the truth is distance over speed).
 */
import { describe, expect, it } from 'vitest';
import { SessionEngine } from '../src/session';
import { perpendicularLine } from '../src/lines';
import { TrackModel } from '../src/track';
import type { GpsSample } from '../src/gps';
import type { CircuitDefinition } from '../src/model';
import { toCoords } from './fixtures';

interface Road {
  name: string;
  track: TrackModel;
  circuit: CircuitDefinition;
  startAlong: number;
  finishAlong: number;
}

function road(name: string, pts: { x: number; y: number }[], closed = false): Road {
  const geometry = toCoords(pts);
  const track = TrackModel.fromCoordinates(geometry, closed);
  // Like the roads the app makes: start 20 m in, finish 20 m before the end; a loop's line 20 m in.
  const startAlong = 20;
  const finishAlong = closed ? startAlong : track.length - 20;
  const circuit: CircuitDefinition = closed
    ? { kind: 'closed', geometry, startLine: perpendicularLine(track, startAlong), finishLine: null, sectors: [] }
    : { kind: 'sprint', geometry, startLine: perpendicularLine(track, startAlong), finishLine: perpendicularLine(track, finishAlong), sectors: [] };
  return { name, track, circuit, startAlong, finishAlong };
}

const sample = (n: number, f: (i: number) => { x: number; y: number }) => Array.from({ length: n + 1 }, (_, i) => f(i));
const ROADS: Road[] = [
  road('straight', [{ x: 0, y: 0 }, { x: 2000, y: 0 }]),
  road('winding', sample(250, (i) => ({ x: i * 10, y: 60 * Math.sin((i * 10) / 120) }))),
  road('serpentine', (() => {
    // Five 300 m legs 40 m apart, joined by hairpins.
    const pts: { x: number; y: number }[] = [];
    for (let leg = 0; leg < 5; leg++) {
      const y = leg * 40;
      const [a, b] = leg % 2 ? [300, 0] : [0, 300];
      for (let k = 0; k <= 30; k++) pts.push({ x: a + ((b - a) * k) / 30, y });
      if (leg < 4) for (let k = 1; k < 12; k++) {
        const ang = -Math.PI / 2 + (Math.PI * k) / 12;
        pts.push(leg % 2 ? { x: -20 * Math.cos(ang), y: y + 20 + 20 * Math.sin(ang) } : { x: 300 + 20 * Math.cos(ang), y: y + 20 + 20 * Math.sin(ang) });
      }
    }
    return pts;
  })()),
  road('out and back', [{ x: 0, y: 0 }, { x: 800, y: 0 }, ...sample(8, (i) => ({ x: 800 + 6 * Math.sin((Math.PI * i) / 8), y: 6 - 6 * Math.cos((Math.PI * i) / 8) })).slice(1), { x: 0, y: 12 }]),
  road('loop', [{ x: 0, y: 0 }, { x: 200, y: 0 }, ...sample(24, (i) => ({ x: 200 + 60 * Math.sin((Math.PI * i) / 24), y: 60 - 60 * Math.cos((Math.PI * i) / 24) })).slice(1), { x: -200, y: 120 }, ...sample(24, (i) => ({ x: -200 - 60 * Math.sin((Math.PI * i) / 24), y: 60 + 60 * Math.cos((Math.PI * i) / 24) })).slice(1)], true),
];

interface Scenario {
  name: string;
  /** Metres left of the mapped road (negative: right). */
  offset?: number;
  /** GPS noise σ, m. */
  noise?: number;
  hz?: number;
  /** m/s. */
  speed?: number;
  /** No fixes this far either side of the start / finish line, m. */
  gapStart?: number;
  gapFinish?: number;
  /** Arrives from the side, along the start line itself. */
  side?: boolean;
  /** Stands this far before the start line (0: on it) for 30 s with GPS wander of `noise`. */
  standAt?: number;
  /** Stops this far past the finish and stands there 30 s. */
  stopAfter?: number;
  wrongWay?: boolean;
  seed?: number;
  /** Fixes arrive at irregular intervals: 0.4–2.5 s apart. */
  irregular?: boolean;
  /** The GPS freezes for 4 s at the start / finish: the last position repeats, then jumps on. */
  freezeAt?: 'start' | 'finish';
  /** Fixes within 100 m of the lines report this accuracy (worse than the limit, so ignored), m. */
  badAccuracy?: number;
  /** Every position is where the car was this long before (receiver lag), s. */
  lagS?: number;
}

const SCENARIOS: Scenario[] = [
  ...[0, 8, 14, 20, -8, -14, -20].flatMap((offset) => [0, 4].map((noise) => ({ name: `${offset} m beside, noise ${noise} m`, offset, noise }))),
  ...[1, 2, 3].map((seed) => ({ name: `8 m beside, noise 4 m, seed ${seed}`, offset: 8, noise: 4, seed })),
  ...[0, 14].map((offset) => ({ name: `fast (30 m/s), ${offset} m beside`, offset, noise: 4, speed: 30 })),
  ...[0, 14].map((offset) => ({ name: `slow (8 m/s), ${offset} m beside`, offset, noise: 4, speed: 8 })),
  ...[0, 14].map((offset) => ({ name: `5 fixes a second, ${offset} m beside`, offset, noise: 4, hz: 5 })),
  ...[0, 8].map((offset) => ({ name: `poor GPS (noise 8 m), ${offset} m beside`, offset, noise: 8 })),
  ...[100, 250].flatMap((gap) => [0, 14].map((offset) => ({ name: `GPS out ±${gap} m at the start, ${offset} m beside`, offset, noise: 4, gapStart: gap }))),
  ...[100, 250].flatMap((gap) => [0, 14].map((offset) => ({ name: `GPS out ±${gap} m at the finish, ${offset} m beside`, offset, noise: 4, gapFinish: gap }))),
  { name: 'GPS out ±200 m at both, 14 m beside', offset: 14, noise: 4, gapStart: 200, gapFinish: 200 },
  ...[0, 3].map((noise) => ({ name: `joins from a side road, noise ${noise} m`, side: true, noise })),
  ...[10, 5, 0].flatMap((standAt) => [2, 4].map((noise) => ({ name: `stands ${standAt} m before the start, wander ${noise} m`, standAt, noise }))),
  ...[0, 14].map((offset) => ({ name: `stops 10 m after the finish, ${offset} m beside`, offset, noise: 4, stopAfter: 10 })),
  { name: 'drives the road the wrong way', noise: 4, wrongWay: true },
  ...[0, 14].flatMap((offset) => [1, 2].map((seed) => ({ name: `irregular fixes, ${offset} m beside, seed ${seed}`, offset, noise: 4, irregular: true, seed }))),
  ...(['start', 'finish'] as const).flatMap((freezeAt) => [0, 14].map((offset) => ({ name: `GPS frozen 4 s at the ${freezeAt}, ${offset} m beside`, offset, noise: 4, freezeAt }))),
  ...[0, 14].map((offset) => ({ name: `inaccurate fixes (40 m) near both lines, ${offset} m beside`, offset, noise: 4, badAccuracy: 40 })),
  ...[1, 2].map((lagS) => ({ name: `positions ${lagS} s late`, noise: 4, lagS })),
];

/** Fixes for one run, and the true start time and lap time. */
function run(r: Road, s: Scenario): { fixes: GpsSample[]; startT: number | null; lapMs: number } {
  const { track } = r;
  const L = track.length;
  const v = s.speed ?? 15;
  const hz = s.hz ?? 1;
  const offset = s.offset ?? 0;
  const noise = s.noise ?? 0;
  let seed = (s.seed ?? 1) * 7919 + offset * 31 + noise * 17;
  const rnd = () => ((seed = (seed * 16807) % 2147483647), seed / 2147483647);
  const g = () => Math.sqrt(-2 * Math.log(Math.max(rnd(), 1e-9))) * Math.cos(2 * Math.PI * rnd());
  const closed = r.circuit.kind === 'closed';
  const laps = closed ? 3 : 1;
  const lapLen = closed ? L : r.finishAlong - r.startAlong;
  /** Position at distance `d` along the road (straight on beyond its ends), `off` m to the left. */
  const at = (d: number, off: number) => {
    const a = closed ? ((d % L) + L) % L : Math.min(Math.max(d, 0), L - 1e-6);
    const p = track.pointAt(a);
    const t = track.tangentAt(a);
    const ex = closed ? 0 : d < 0 ? d : Math.max(0, d - L);
    return { x: p.x + t.x * ex - t.y * off, y: p.y + t.y * ex + t.x * off };
  };
  const fixes: GpsSample[] = [];
  const t0 = 1_000_000;
  const push = (t: number, p: { x: number; y: number }, speed: number | null, exact = false) => {
    const ll = track.frame.toLatLon(exact ? p : { x: p.x + g() * noise, y: p.y + g() * noise });
    fixes.push({ t, lat: ll.lat, lon: ll.lon, accuracy: Math.max(5, 2 * noise), speed, heading: null, altitude: null, altitudeAccuracy: null });
  };
  const dt = 1000 / hz;
  let t = t0;
  // Before the run: standing at the start, or arriving along the start line from the side.
  let d0 = r.startAlong - 300;
  if (s.standAt !== undefined) {
    d0 = r.startAlong - s.standAt;
    for (let k = 0; k < 30 * hz; k++, t += dt) push(t, at(d0, offset), 0);
  } else if (s.side) {
    const c = at(r.startAlong, 0);
    const n = { x: -track.tangentAt(r.startAlong).y, y: track.tangentAt(r.startAlong).x };
    for (let k = 300; k > 0; k -= v / hz, t += dt) push(t, { x: c.x - n.x * k, y: c.y - n.y * k }, v);
    d0 = r.startAlong;
  }
  const finishD = closed ? r.startAlong + laps * L : r.finishAlong;
  const dEnd = finishD + Math.max(200, (s.gapFinish ?? 0) + 60);
  const tDrive = t;
  let tPrev = t;
  const lag = (s.lagS ?? 0) * v;
  let frozen: { x: number; y: number } | null = null;
  for (let d = d0; d <= dEnd; d += (v * (t - tPrev)) / 1000) {
    tPrev = t;
    t += s.irregular ? 400 + rnd() * 2100 : dt;
    if (s.gapStart && Math.abs(d - r.startAlong) < s.gapStart) continue;
    if (s.gapFinish && Math.abs(d - finishD) < s.gapFinish) continue;
    if (s.stopAfter !== undefined && d > finishD + s.stopAfter) {
      for (let k = 0; k < 30 * hz; k++, t += dt) push(tPrev + k * dt, at(finishD + s.stopAfter, offset), 0);
      break;
    }
    const line = s.freezeAt === 'start' ? r.startAlong : s.freezeAt === 'finish' ? finishD : null;
    if (line !== null && d >= line - 30 && d < line - 30 + 4 * v) {
      // A frozen receiver repeats its last fix exactly, with new timestamps.
      if (!frozen) {
        push(tPrev, at(d, offset), v);
        frozen = { x: 0, y: 0 };
      } else {
        const last = fixes[fixes.length - 1];
        fixes.push({ ...last, t: tPrev });
      }
      continue;
    }
    if (s.badAccuracy && (Math.abs(d - r.startAlong) < 100 || Math.abs(d - finishD) < 100)) {
      push(tPrev, at(d - lag, offset), v);
      fixes[fixes.length - 1].accuracy = s.badAccuracy;
      continue;
    }
    push(tPrev, at(d - lag, offset), v);
  }
  if (s.wrongWay) {
    // The same road driven end to start.
    const rev = fixes.map((f) => ({ lat: f.lat, lon: f.lon })).reverse();
    fixes.forEach((f, i) => Object.assign(f, rev[i]));
    return { fixes, startT: null, lapMs: 0 };
  }
  return { fixes, startT: tDrive + ((r.startAlong - d0) / v + (s.lagS ?? 0)) * 1000, lapMs: (lapLen / v) * 1000 };
}

describe('start and finish', () => {
  for (const r of ROADS) {
    describe(r.name, () => {
      // 20 m beside a serpentine whose legs are 40 m apart is as close to the next leg as to its own:
      // no way to tell which leg the car is on.
      // Driving an out-and-back road "the wrong way" is the same drive out and back.
      const scenarios = SCENARIOS.filter((s) => !(r.name === 'serpentine' && Math.abs(s.offset ?? 0) >= 20) && !(r.name === 'out and back' && s.wrongWay));
      it.each(scenarios.map((s) => [s.name, s] as const))('%s', (_, s) => {
        const { fixes, startT, lapMs } = run(r, s);
        const engine = new SessionEngine(r.circuit);
        const starts: number[] = [];
        for (const f of fixes) for (const ev of engine.push(f)) if (ev.type === 'lap_start') starts.push(ev.t);
        if (s.wrongWay) {
          expect(engine.laps).toHaveLength(0);
          return;
        }
        const expected = r.circuit.kind === 'closed' ? 3 : 1;
        expect(engine.laps.length, 'laps timed').toBe(expected);
        // Within a second of the truth, plus what GPS noise allows at that speed (noise ÷ speed per line).
        const tol = 1000 + (2000 * (s.noise ?? 0)) / (s.speed ?? 15);
        expect(Math.abs(starts[0] - (startT as number)), 'start time off by (ms)').toBeLessThan(tol);
        for (const lap of engine.laps) expect(Math.abs(lap.timeMs - lapMs), `lap ${lap.lap} time off by (ms)`).toBeLessThan(tol);
      });
    });
  }
});
