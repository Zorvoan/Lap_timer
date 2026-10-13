import type { Session, SessionSource } from '@laptimer/core';

export const lapKey = (sessionId: string, lap: number) => `${sessionId}#${lap}`;

/**
 * Circuit-wide lap numbers: every lap driven on a circuit is numbered 1, 2, 3… in the order it
 * was driven, across sessions. Real-GPS and simulated laps are numbered separately so testing
 * with the simulator never shifts the numbers of real laps.
 *
 * `sessions` must all belong to the same circuit. Keys are {@link lapKey}.
 */
export function circuitLapNumbers(sessions: readonly Session[]): Map<string, number> {
  const all = sessions.flatMap((s) => s.laps.map((l) => ({ s, l })));
  all.sort((a, b) => a.l.startT - b.l.startT || a.s.startedAt - b.s.startedAt || a.l.lap - b.l.lap);
  const counters: Record<SessionSource, number> = { gps: 0, simulated: 0 };
  const out = new Map<string, number>();
  for (const { s, l } of all) out.set(lapKey(s.id, l.lap), ++counters[s.source]);
  return out;
}

/** How many laps of `source` were driven on the circuit in other sessions (the numbering offset for a new session). */
export function lapsDrivenBefore(sessions: readonly Session[], source: SessionSource, excludeSessionId?: string): number {
  return sessions.filter((s) => s.source === source && s.id !== excludeSessionId).reduce((n, s) => n + s.laps.length, 0);
}
