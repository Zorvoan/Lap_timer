import { ReferenceLap, SessionEngine, type Circuit, type CircuitDefinition } from '@laptimer/core';
import { referenceFromLap, type ActiveReference } from './liveController';
import { findLap, listSessions, personalBest, type LapRef } from './repo';
import { circuitLapNumbers, lapKey } from './lapNumbers';
import { formatLapTime } from '@laptimer/core';

export type ReferenceChoice =
  | { kind: 'personal_best' }
  | { kind: 'session_best' }
  | { kind: 'none' }
  | { kind: 'lap'; sessionId: string; lap: number }
  | { kind: 'leaderboard'; uid: string };

/** Distance from start to finish line: the coordinate system every lap of a circuit shares. */
export function lapLength(def: CircuitDefinition): number {
  return new SessionEngine(def).lapLengthM;
}

function toActive(c: Circuit, r: LapRef, label: string, policy: ActiveReference['policy']): ActiveReference {
  return {
    ref: referenceFromLap(r.lap, lapLength(c)),
    selection: { sessionId: r.session.id, lap: r.lap.lap },
    label: `${label} · ${formatLapTime(r.lap.timeMs)}`,
    policy,
  };
}

export async function resolveReference(circuit: Circuit, choice: ReferenceChoice, includeSimulated: boolean): Promise<ActiveReference | null> {
  switch (choice.kind) {
    case 'none':
      return null;
    case 'session_best':
      return null; // becomes the best lap of this session once one is set
    case 'personal_best': {
      const pb = await personalBest(circuit.id, includeSimulated);
      return pb ? toActive(circuit, pb, 'Personal best', 'best') : null;
    }
    case 'leaderboard': {
      const c = await import('./cloud/community');
      const { parsePublishedTrace } = await import('./cloud/leaderboard');
      const [entry, trace] = await Promise.all([c.getEntry(circuit.id, choice.uid), c.getPublishedTrace(circuit.id, choice.uid)]);
      if (!entry || !trace) return null;
      return {
        ref: ReferenceLap.fromTrace(parsePublishedTrace(trace), trace.timeMs, trace.lengthM),
        selection: { sessionId: `lb:${choice.uid}`, lap: entry.lap },
        label: `${entry.nickname} (leaderboard) · ${formatLapTime(entry.timeMs)}`,
        policy: 'fixed',
      };
    }
    case 'lap': {
      const r = await findLap(choice.sessionId, choice.lap);
      if (!r || r.session.circuitId !== circuit.id) return null;
      const n = circuitLapNumbers(await listSessions(circuit.id)).get(lapKey(r.session.id, r.lap.lap)) ?? r.lap.lap;
      return toActive(circuit, r, `Lap ${n}, ${new Date(r.session.startedAt).toLocaleDateString()}`, 'fixed');
    }
  }
}
