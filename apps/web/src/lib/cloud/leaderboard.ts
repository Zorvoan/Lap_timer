/** Pure leaderboard logic: which laps qualify, and how a lap is published. */
import type { LapRecord, Session } from '@laptimer/core';

export interface Profile {
  nickname: string;
  car: string;
}

export interface LeaderboardEntry {
  uid: string;
  nickname: string;
  car: string;
  timeMs: number;
  /** Epoch ms when the lap started. */
  drivenAt: number;
  sessionId: string;
  lap: number;
  sectorTimesMs: number[];
  avgSpeedMs: number;
  maxSpeedMs: number | null;
}

/** Compact trace for racing against a published lap: [elapsedMs, distanceM, speedMs|null][]. */
export interface PublishedTrace {
  timeMs: number;
  lengthM: number;
  /** JSON string of [t, d, v][] (Firestore has no nested arrays). */
  points: string;
}

export const NICKNAME_RE = /^[\p{L}\p{N}][\p{L}\p{N} _.-]{1,18}[\p{L}\p{N}_]$/u;
export const MAX_TRACE_POINTS = 2000;

export function validateNickname(raw: string): string | null {
  const n = raw.trim();
  if (n.length < 3 || n.length > 20) return 'Nickname must be 3–20 characters.';
  if (!NICKNAME_RE.test(n)) return 'Use letters, numbers, spaces, dot, dash or underscore (no leading/trailing space).';
  return null;
}

export function validateCar(raw: string): string | null {
  const c = raw.trim();
  if (c.length < 2 || c.length > 60) return 'Car must be 2–60 characters (e.g. "Škoda Octavia RS").';
  return null;
}

/**
 * A lap counts for the leaderboard when it was timed with real GPS (never the simulator),
 * passed the distance check, and the position stayed matched to the track.
 */
export function isEligible(session: Session, lap: LapRecord): boolean {
  return session.source === 'gps' && lap.valid && !lap.flags.includes('tracking_lost') && !lap.flags.includes('simulated');
}

export function bestEligibleLap(sessions: readonly Session[], circuitId: string): { session: Session; lap: LapRecord } | null {
  let best: { session: Session; lap: LapRecord } | null = null;
  for (const s of sessions) {
    if (s.circuitId !== circuitId || s.endedAt === null) continue;
    for (const l of s.laps) if (isEligible(s, l) && (!best || l.timeMs < best.lap.timeMs)) best = { session: s, lap: l };
  }
  return best;
}

export function entryFromLap(uid: string, profile: Profile, session: Session, lap: LapRecord): LeaderboardEntry {
  return {
    uid,
    nickname: profile.nickname,
    car: profile.car,
    timeMs: lap.timeMs,
    drivenAt: lap.startT,
    sessionId: session.id,
    lap: lap.lap,
    sectorTimesMs: lap.sectorTimesMs,
    avgSpeedMs: lap.avgSpeedMs,
    maxSpeedMs: lap.maxSpeedMs,
  };
}

/** Downsamples a lap trace (keeping both ends) for publishing. */
export function traceForPublishing(lap: LapRecord, lengthM: number): PublishedTrace {
  const tr = lap.trace;
  const step = Math.max(1, Math.ceil(tr.length / MAX_TRACE_POINTS));
  const pts: [number, number, number | null][] = [];
  for (let i = 0; i < tr.length; i += step) pts.push([tr[i].t, tr[i].d, tr[i].v]);
  const last = tr[tr.length - 1];
  if (last && pts[pts.length - 1]?.[0] !== last.t) pts.push([last.t, last.d, last.v]);
  return { timeMs: lap.timeMs, lengthM, points: JSON.stringify(pts) };
}

export function parsePublishedTrace(t: PublishedTrace): { t: number; d: number; v: number | null }[] {
  const pts = JSON.parse(t.points) as [number, number, number | null][];
  return pts.map(([time, d, v]) => ({ t: time, d, v }));
}
