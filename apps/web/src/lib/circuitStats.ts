import type { Session } from '@laptimer/core';

export interface CircuitStats {
  laps: number;
  bestMs: number | null;
}

/** Lap count and best valid time per circuit, across all sessions. */
export function circuitStats(sessions: Session[], includeSimulated: boolean): Map<string, CircuitStats> {
  const out = new Map<string, CircuitStats>();
  const hasReal = new Set(sessions.filter((s) => s.source === 'gps' && s.laps.length).map((s) => s.circuitId));
  for (const s of sessions) {
    const st = out.get(s.circuitId) ?? { laps: 0, bestMs: null };
    // Simulated laps only count when wanted, or when the circuit has no real laps at all
    // (the same rule the track page uses by default).
    const counts = s.source === 'gps' || includeSimulated || !hasReal.has(s.circuitId);
    if (counts) st.laps += s.laps.length;
    if (counts) for (const l of s.laps) if (l.valid && (st.bestMs === null || l.timeMs < st.bestMs)) st.bestMs = l.timeMs;
    out.set(s.circuitId, st);
  }
  return out;
}

export function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'circuit';
}
