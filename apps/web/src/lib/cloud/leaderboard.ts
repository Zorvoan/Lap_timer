/** Pure leaderboard logic: which laps qualify, and how a lap is published. */
import { TrackModel, lineAlong, splitTimes, type CircuitDefinition, type LapRecord, type Session } from '@laptimer/core';

/** How many roads one driver can make public. Also enforced by firestore.rules. */
export const PUBLIC_ROAD_LIMIT = 5;

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
  /** The lap split into thirds by distance (same points for every driver); absent on old entries. */
  splitTimesMs?: number[];
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
 * A lap counts for the leaderboard when it was timed with real GPS (never the simulator), passed
 * the distance check, averaged a plausible speed and never skipped part of the road: GPS dropouts
 * (common in forests and hairpins) are fine as long as the car crossed them at road speed.
 */
export function isEligible(session: Session, lap: LapRecord): boolean {
  return ineligibleReason(session, lap) === null;
}

/** Why a lap cannot go on the leaderboard, for the driver; null when it can. */
export function ineligibleReason(session: Session, lap: LapRecord): string | null {
  if (session.source !== 'gps' || lap.flags.includes('simulated')) return "Simulated runs don't go on the leaderboard.";
  if (!lap.valid) return 'The lap distance does not match the road (a line crossing was missed), so the time cannot count.';
  if (lap.distanceM / (lap.timeMs / 1000) > MAX_LEADERBOARD_SPEED_MS) return 'The lap averaged over 250 km/h: a GPS error, so it cannot count.';
  if (trackingGaps(lap).worstRatio > MAX_GAP_SPEED_RATIO) return 'Part of the road was skipped faster than possible (GPS jumped or the car left the road), so it cannot count.';
  return null;
}

/** A gap crossed faster than this many times the speed on either side of it is a short cut. */
export const MAX_GAP_SPEED_RATIO = 1.6;

/** A jump along the road between two matched positions longer than this is a gap in tracking. */
const GAP_M = 40;

/**
 * The stretches of a lap where the position was not matched to the road (or GPS was silent): how
 * far they reach along the road in total, and the gap whose crossing needed the highest speed
 * compared with the car's speed on either side of it. A short cut (leaving the road across a
 * hairpin) shows up as a gap crossed impossibly fast; a GPS dropout as one crossed at road speed.
 */
export function trackingGaps(lap: Pick<LapRecord, 'trace' | 'avgSpeedMs' | 'maxSpeedMs'>): { gapM: number; count: number; worstRatio: number } {
  const tr = lap.trace;
  let gapM = 0;
  let count = 0;
  let worstRatio = 0;
  for (let i = 1; i < tr.length; i++) {
    const dd = tr[i].d - tr[i - 1].d;
    const dt = (tr[i].t - tr[i - 1].t) / 1000;
    if (dd <= GAP_M || dt <= 0) continue;
    gapM += dd;
    count++;
    const around = Math.max(tr[i - 1].v ?? 0, tr[i].v ?? 0) || lap.maxSpeedMs || lap.avgSpeedMs;
    worstRatio = Math.max(worstRatio, dd / dt / Math.max(around, 5));
  }
  return { gapM, count, worstRatio };
}

/**
 * Fastest plausible average speed of a leaderboard lap (250 km/h). Faster laps are GPS errors or
 * forged; firestore.rules enforces the same limit against the track length.
 */
export const MAX_LEADERBOARD_SPEED_MS = 250 / 3.6;

export function bestEligibleLap(sessions: readonly Session[], circuitId: string): { session: Session; lap: LapRecord } | null {
  let best: { session: Session; lap: LapRecord } | null = null;
  for (const s of sessions) {
    if (s.circuitId !== circuitId || s.endedAt === null) continue;
    for (const l of s.laps) if (isEligible(s, l) && (!best || l.timeMs < best.lap.timeMs)) best = { session: s, lap: l };
  }
  return best;
}

export function entryFromLap(uid: string, profile: Profile, session: Session, lap: LapRecord, lengthM: number): LeaderboardEntry {
  return {
    uid,
    nickname: profile.nickname,
    car: profile.car,
    timeMs: lap.timeMs,
    drivenAt: lap.startT,
    sessionId: session.id,
    lap: lap.lap,
    sectorTimesMs: lap.sectorTimesMs,
    splitTimesMs: splitTimes(lap.trace, lap.timeMs, lengthM, 3),
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

/**
 * Turns a published lap into a {@link LapRecord} so it can be analysed like the user's own laps.
 * Published traces carry time, distance and speed only; positions are placed on the circuit at
 * each point's distance from the start line. Distances are rescaled when the track's lap length
 * has changed slightly since the lap was published.
 */
export function lapFromPublished(entry: LeaderboardEntry, trace: PublishedTrace, circuit: CircuitDefinition, lengthM: number): LapRecord {
  const track = TrackModel.fromCoordinates(circuit.geometry, circuit.kind === 'closed');
  const s0 = lineAlong(track, circuit.startLine) ?? 0;
  const scale = trace.lengthM > 0 ? lengthM / trace.lengthM : 1;
  const points = parsePublishedTrace(trace);
  const lapTrace = points.map((p) => {
    const d = Math.min(lengthM, Math.max(0, p.d * scale));
    const pos = track.latLonAt(track.wrap(s0 + d));
    return { t: p.t, d, v: p.v, lat: pos.lat, lon: pos.lon, accuracy: NaN };
  });
  const durationS = trace.timeMs / 1000;
  return {
    lap: entry.lap,
    startT: entry.drivenAt,
    endT: entry.drivenAt + trace.timeMs,
    timeMs: trace.timeMs,
    sectorTimesMs: entry.sectorTimesMs ?? [],
    distanceM: lengthM,
    avgSpeedMs: entry.avgSpeedMs ?? lengthM / durationS,
    maxSpeedMs: entry.maxSpeedMs ?? null,
    valid: true,
    flags: [],
    gps: { samples: points.length, poorSamples: 0, meanAccuracyM: NaN, maxGapMs: 0, meanRateHz: points.length / durationS },
    trace: lapTrace,
  };
}
