import type { Session } from '@laptimer/core';
import { drivingStyle } from './drivingStyle';

/**
 * A driver's rating from their own laps, 0–100: how hard they brake, how fast they carry speed
 * through corners, how hard they accelerate, how consistent their times are on a road and, where
 * leaderboards are known, how close their best times are to the record.
 */
export interface DriverRating {
  overall: number;
  /** How much the latest drive moved the rating; null with a single drive. */
  change: number | null;
  skills: Record<SkillKey, Skill | null>;
  /** Closeness to the record on leaderboard roads, 0–100; null when none is known. */
  pace: number | null;
  /** Average leaderboard position as a share of the field (0.2 = top 20%); null when unknown. */
  topShare: number | null;
  /** One point per drive, oldest first: the overall rating right after that drive. */
  history: { t: number; score: number }[];
  /** How much faster the best times are than the first drive's, % averaged over roads; null if no road was driven twice. */
  progressPct: number | null;
  /** The last 7 days, oldest first, ending today: whether a lap was driven that day. */
  days: { date: Date; drove: boolean }[];
}

export type SkillKey = 'braking' | 'corners' | 'accel' | 'consistency';

export interface Skill {
  score: number;
  /** The measured value behind the score: g for braking and acceleration, m/s for corners, % spread for consistency. */
  value: number;
}

/** A road's leaderboard as far as the rating needs it: everyone's best times. */
export interface BoardTimes {
  circuitId: string;
  /** Best time of each driver, the user's own excluded. */
  othersMs: number[];
}

const G = 9.81;
/** Laps the skills are read from: the most recent ones. */
const RECENT_LAPS = 15;
/** Drives shown in the rating's history. */
const HISTORY = 12;

/** 0 at `lo`, 100 at `hi`, straight in between (either direction). */
const scale = (v: number, lo: number, hi: number) => Math.max(0, Math.min(100, ((v - lo) / (hi - lo)) * 100));
const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// Scales for road driving on a phone's GPS: a gentle drive sits near the bottom, a committed one
// on a twisty road near the top.
const brakingScore = (g: number) => scale(g, 0.08, 0.45);
const accelScore = (g: number) => scale(g, 0.05, 0.3);
const cornerScore = (ms: number) => scale(ms * 3.6, 25, 90);
/** Spread of lap times on one road (standard deviation over mean): 1% is very consistent, 10% is not. */
const consistencyScore = (spread: number) => scale(spread, 0.1, 0.01);
/** Best time over the record: at the record 100, 20% slower 0. */
const paceScore = (ratio: number) => scale(ratio, 0.8, 1);

export function ratingLabel(score: number): string {
  return score >= 85 ? 'Elite' : score >= 70 ? 'Strong' : score >= 50 ? 'Solid' : score >= 30 ? 'Rookie' : 'Learning';
}

/** The rating from these drives (real ones, oldest first). */
function score(real: readonly Session[], boards: readonly BoardTimes[]) {
  const laps = real.flatMap((s) => s.laps.filter((l) => l.valid).map((lap) => ({ s, lap })));
  if (!laps.length) return null;

  const recent = laps.slice(-RECENT_LAPS);
  const styles = recent.map((x) => drivingStyle(x.lap)).filter((x): x is NonNullable<typeof x> => !!x);
  const skill = (vals: number[], score: (v: number) => number): Skill | null => (vals.length ? { value: median(vals), score: score(median(vals)) } : null);

  // Consistency: on each road with three or more laps, how far the times spread.
  const byRoad = new Map<string, number[]>();
  for (const { s, lap } of laps) byRoad.set(s.circuitId, [...(byRoad.get(s.circuitId) ?? []), lap.timeMs]);
  const spreads = [...byRoad.values()]
    .filter((ts) => ts.length >= 3)
    .map((ts) => {
      const m = mean(ts);
      return Math.sqrt(mean(ts.map((t) => (t - m) ** 2))) / m;
    });

  const skills: DriverRating['skills'] = {
    braking: skill(styles.map((s) => s.braking / G), brakingScore),
    corners: skill(styles.map((s) => s.cornerSpeed), cornerScore),
    accel: skill(styles.map((s) => s.accel / G), accelScore),
    consistency: spreads.length ? { value: mean(spreads) * 100, score: consistencyScore(mean(spreads)) } : null,
  };

  // Pace and position on the roads with a leaderboard.
  const best = new Map<string, number>();
  for (const [id, ts] of byRoad) best.set(id, Math.min(...ts));
  const paces: number[] = [];
  const shares: number[] = [];
  for (const b of boards) {
    const mine = best.get(b.circuitId);
    if (mine === undefined) continue;
    const record = Math.min(mine, ...b.othersMs);
    paces.push(paceScore(record / mine));
    if (b.othersMs.length) shares.push((1 + b.othersMs.filter((t) => t < mine).length) / (b.othersMs.length + 1));
  }
  const pace = paces.length ? mean(paces) : null;

  const parts = [skills.braking, skills.corners, skills.accel, skills.consistency].filter((x): x is Skill => !!x).map((x) => x.score);
  const style = parts.length ? mean(parts) : null;
  const overall = style === null ? (pace ?? 0) : pace === null ? style : (style + pace) / 2;
  return { overall, skills, pace, topShare: shares.length ? mean(shares) : null, best };
}

export function driverRating(sessions: readonly Session[], boards: readonly BoardTimes[] = [], now = Date.now()): DriverRating | null {
  // Real drives only: simulated runs say nothing about the driver.
  const real = sessions.filter((s) => s.source !== 'simulated' && s.laps.some((l) => l.valid)).sort((a, b) => a.startedAt - b.startedAt);
  const current = score(real, boards);
  if (!current) return null;
  const { overall, skills, pace, topShare, best } = current;

  // The rating as it stood after each of the last drives, so the latest point is today's rating.
  const history: { t: number; score: number }[] = [];
  for (let i = Math.max(0, real.length - HISTORY); i < real.length; i++) {
    const r = i === real.length - 1 ? current : score(real.slice(0, i + 1), boards);
    if (r) history.push({ t: real[i].startedAt, score: r.overall });
  }
  const change = history.length >= 2 ? history[history.length - 1].score - history[history.length - 2].score : null;

  // Progress: per road driven on more than one day, the first drive's best against the best since.
  const firstBest = new Map<string, number>();
  const drives = new Map<string, number>();
  for (const s of real) {
    const ts = s.laps.filter((l) => l.valid).map((l) => l.timeMs);
    if (!ts.length) continue;
    drives.set(s.circuitId, (drives.get(s.circuitId) ?? 0) + 1);
    if (!firstBest.has(s.circuitId)) firstBest.set(s.circuitId, Math.min(...ts));
  }
  const gains = [...firstBest].filter(([id]) => (drives.get(id) ?? 0) > 1).map(([id, first]) => ((first - best.get(id)!) / first) * 100);

  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const days = Array.from({ length: 7 }, (_, i) => {
    const date = new Date(today);
    date.setDate(today.getDate() - 6 + i);
    const end = new Date(date);
    end.setDate(date.getDate() + 1);
    return { date, drove: real.some((s) => s.laps.length > 0 && s.startedAt >= date.getTime() && s.startedAt < end.getTime()) };
  });

  return {
    overall,
    change,
    skills,
    pace,
    topShare,
    history,
    progressPct: gains.length ? mean(gains) : null,
    days,
  };
}
