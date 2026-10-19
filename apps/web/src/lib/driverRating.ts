import { compareLaps, gainLoss, type LapRecord, type Session } from '@laptimer/core';
import { drivingStyle, fieldCorners } from './drivingStyle';

/**
 * A driver's rating, measured against the other drivers on the same roads rather than on fixed
 * scales, so it rewards being quick:
 *
 * - the rating is how close the driver's best times are to the record on the leaderboard roads
 *   they drive;
 * - top speed and the speed through fast and slow corners compare their best lap with the other
 *   drivers' laps of the same road, corner by corner: only the same corner is ever compared;
 * - consistency is the spread of their last laps on a road;
 * - "where you lose time" lists the stretches that cost the most against that fastest lap.
 */
export interface DriverRating {
  /** 0–100; null until the driver has a time on a road with other drivers on it. */
  overall: number | null;
  /** Few laps behind the rating yet. */
  provisional: boolean;
  /** How much the latest drive moved the rating; null with a single rated drive. */
  change: number | null;
  /** Average leaderboard position as a share of the field (0.2 = top 20%), from fields of 5 or more; else null. */
  topShare: number | null;
  skills: Record<SkillKey, Skill | null>;
  /** The rating as it stood after each of the last drives, oldest first. */
  history: { t: number; score: number }[];
  /** How much faster the best times are than the first drive's, % averaged over roads; null if no road was driven twice. */
  progressPct: number | null;
  /** The stretches losing the most time against the fastest driver, worst first. */
  losses: Loss[];
  totals: { laps: number; km: number; roads: number };
}

export type SkillKey = 'topSpeed' | 'fastCorners' | 'slowCorners' | 'consistency';

export interface Skill {
  /** Speeds: the share of other drivers beaten (on each corner, then averaged), 0–100; consistency: from the spread. */
  score: number;
  /** Speeds: m/s against the other drivers' median (negative = slower); consistency: % spread of the last laps. */
  value: number;
  /** Corners (or roads, for top speed) the score is read from. */
  count?: number;
}

/** A leaderboard road the driver has driven: the other drivers' times and their laps. */
export interface RoadBoard {
  circuitId: string;
  name: string;
  lengthM: number;
  /** Best time of each other driver. */
  othersMs: number[];
  /** Other drivers' best laps whose telemetry is published, fastest first. */
  rivals: { uid: string; nickname: string; lap: LapRecord }[];
}

export interface Loss {
  circuitId: string;
  name: string;
  fromD: number;
  toD: number;
  lossMs: number;
  refUid: string;
  refName: string;
  /** The driver's lap the loss was measured on. */
  sessionId: string;
  lap: number;
}

/** Below this many laps on leaderboard roads the rating is marked provisional. */
const PROVISIONAL_LAPS = 5;
/** Fields smaller than this say little about position. */
const MIN_FIELD = 5;
/** Laps per road the consistency is read from: the most recent ones. */
const CONSISTENCY_LAPS = 5;
const HISTORY = 12;

/** 0 at `lo`, 100 at `hi`, straight in between (either direction). */
const scale = (v: number, lo: number, hi: number) => Math.max(0, Math.min(100, ((v - lo) / (hi - lo)) * 100));
const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Best time over the record: at the record 100, 20% slower 0. */
const paceScore = (ratio: number) => scale(ratio, 0.8, 1);
/** Spread of lap times (standard deviation over mean): 1% is very consistent, 10% is not. */
const consistencyScore = (spread: number) => scale(spread, 0.1, 0.01);

export function ratingLabel(score: number): string {
  return score >= 85 ? 'Elite' : score >= 70 ? 'Strong' : score >= 50 ? 'Solid' : score >= 30 ? 'Rookie' : 'Learning';
}

type Owned = { s: Session; lap: LapRecord };

function bestLaps(real: readonly Session[]): Map<string, Owned> {
  const best = new Map<string, Owned>();
  for (const s of real) for (const lap of s.laps) if (lap.valid && lap.timeMs < (best.get(s.circuitId)?.lap.timeMs ?? Infinity)) best.set(s.circuitId, { s, lap });
  return best;
}

/** The pace rating from these drives: mean over leaderboard roads of best time against the record. */
function paceRating(real: readonly Session[], boards: readonly RoadBoard[]): number | null {
  const best = bestLaps(real);
  const paces = boards
    .filter((b) => b.othersMs.length && best.has(b.circuitId))
    .map((b) => {
      const mine = best.get(b.circuitId)!.lap.timeMs;
      return paceScore(Math.min(mine, ...b.othersMs) / mine);
    });
  return paces.length ? mean(paces) : null;
}

export function driverRating(sessions: readonly Session[], boards: readonly RoadBoard[] = []): DriverRating | null {
  // Real drives only: simulated runs say nothing about the driver.
  const all = sessions.filter((s) => s.source !== 'simulated').sort((a, b) => a.startedAt - b.startedAt);
  const real = all.filter((s) => s.laps.some((l) => l.valid));
  if (!real.length) return null;
  const best = bestLaps(real);
  const rated = boards.filter((b) => b.othersMs.length && best.has(b.circuitId));
  const ratedIds = new Set(rated.map((b) => b.circuitId));

  const overall = paceRating(real, rated);
  const ratedLaps = real.filter((s) => ratedIds.has(s.circuitId)).reduce((n, s) => n + s.laps.filter((l) => l.valid).length, 0);

  // Position, from fields big enough to mean something.
  const shares = rated
    .filter((b) => b.othersMs.length + 1 >= MIN_FIELD)
    .map((b) => {
      const mine = best.get(b.circuitId)!.lap.timeMs;
      return (1 + b.othersMs.filter((t) => t < mine).length) / (b.othersMs.length + 1);
    });

  // Skills: the best lap against the other drivers' laps of the same road. Each comparison is one
  // speed of the driver's against the same speed of every other driver (the same corner, or top
  // speed): its score is the share of them the driver beats.
  type Duel = { mine: number; others: number[] };
  const duels = { topSpeed: [] as Duel[], fast: [] as Duel[], slow: [] as Duel[] };
  for (const b of rated) {
    const mine = drivingStyle(best.get(b.circuitId)!.lap);
    const others = b.rivals.map((r) => drivingStyle(r.lap)).filter((x): x is NonNullable<typeof x> => !!x);
    if (!mine || !others.length) continue;
    duels.topSpeed.push({ mine: mine.topSpeed, others: others.map((o) => o.topSpeed) });
    for (const c of fieldCorners(mine, others)) (c.fast ? duels.fast : duels.slow).push({ mine: c.mine, others: c.others });
  }
  const versus = (list: Duel[]): Skill | null =>
    list.length
      ? {
          score: mean(list.map((x) => (x.others.filter((o) => o < x.mine).length + 0.5 * x.others.filter((o) => o === x.mine).length) / x.others.length)) * 100,
          value: mean(list.map((x) => x.mine - median(x.others))),
          count: list.length,
        }
      : null;

  // Consistency: the last laps on each road driven three or more times.
  const recentByRoad = new Map<string, number[]>();
  for (const s of real) for (const l of s.laps) if (l.valid) recentByRoad.set(s.circuitId, [...(recentByRoad.get(s.circuitId) ?? []), l.timeMs].slice(-CONSISTENCY_LAPS));
  const spreads = [...recentByRoad.values()]
    .filter((ts) => ts.length >= 3)
    .map((ts) => {
      const m = mean(ts);
      return Math.sqrt(mean(ts.map((t) => (t - m) ** 2))) / m;
    });

  const skills: DriverRating['skills'] = {
    topSpeed: versus(duels.topSpeed),
    fastCorners: versus(duels.fast),
    slowCorners: versus(duels.slow),
    consistency: spreads.length ? { score: consistencyScore(mean(spreads)), value: mean(spreads) * 100 } : null,
  };

  // The rating after each of the last drives on leaderboard roads.
  const history: { t: number; score: number }[] = [];
  const ratedDrives = real.map((s, i) => ({ s, i })).filter((x) => ratedIds.has(x.s.circuitId));
  for (const { s, i } of ratedDrives.slice(-HISTORY)) {
    const r = paceRating(real.slice(0, i + 1), rated);
    if (r !== null) history.push({ t: s.startedAt, score: r });
  }
  const change = history.length >= 2 ? history[history.length - 1].score - history[history.length - 2].score : null;

  // Progress: per road driven more than once, the first drive's best against the best since.
  const firstBest = new Map<string, number>();
  const drives = new Map<string, number>();
  for (const s of real) {
    const ts = s.laps.filter((l) => l.valid).map((l) => l.timeMs);
    drives.set(s.circuitId, (drives.get(s.circuitId) ?? 0) + 1);
    if (!firstBest.has(s.circuitId)) firstBest.set(s.circuitId, Math.min(...ts));
  }
  const gains = [...firstBest].filter(([id]) => (drives.get(id) ?? 0) > 1).map(([id, first]) => ((first - best.get(id)!.lap.timeMs) / first) * 100);

  // Where the best lap loses the most against the fastest driver.
  const losses: Loss[] = rated
    .filter((b) => b.rivals.length && b.lengthM > 0)
    .flatMap((b) => {
      const own = best.get(b.circuitId)!;
      const ref = b.rivals[0];
      let rows;
      try {
        rows = compareLaps(own.lap, ref.lap, b.lengthM, Math.max(2, b.lengthM / 600));
      } catch {
        return [];
      }
      return gainLoss(rows, Math.max(150, b.lengthM / 20))
        .filter((g) => g.changeMs > 100)
        .map((g) => ({ circuitId: b.circuitId, name: b.name, fromD: g.fromD, toD: g.toD, lossMs: g.changeMs, refUid: ref.uid, refName: ref.nickname, sessionId: own.s.id, lap: own.lap.lap }));
    })
    .sort((x, y) => y.lossMs - x.lossMs)
    .slice(0, 3);

  return {
    overall,
    provisional: overall !== null && ratedLaps < PROVISIONAL_LAPS,
    change,
    topShare: shares.length ? mean(shares) : null,
    skills,
    history,
    progressPct: gains.length ? mean(gains) : null,
    losses,
    totals: {
      laps: all.reduce((n, s) => n + s.laps.length, 0),
      km: all.reduce((m, s) => m + s.laps.reduce((x, l) => x + l.distanceM, 0), 0) / 1000,
      roads: new Set(all.filter((s) => s.laps.length).map((s) => s.circuitId)).size,
    },
  };
}
