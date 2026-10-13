import type { Circuit, GpsSample, LapRecord, Session } from '@laptimer/core';
import { getDb, type ActiveSessionInfo, type Tombstone } from './db';
import { DEFAULT_SETTINGS, normalizeSettings, type Settings } from './settings';

/** Fired after any local data change so views can refresh. */
export const dataEvents = new EventTarget();
function changed(kind: string) {
  dataEvents.dispatchEvent(new CustomEvent('change', { detail: kind }));
}

// ---------- circuits ----------

export async function listCircuits(): Promise<Circuit[]> {
  const db = await getDb();
  const all = await db.getAll('circuits');
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getCircuit(id: string): Promise<Circuit | undefined> {
  return (await getDb()).get('circuits', id);
}

export async function saveCircuit(c: Circuit, opts: { touch?: boolean } = {}): Promise<Circuit> {
  const record = opts.touch === false ? c : { ...c, updatedAt: Date.now() };
  await (await getDb()).put('circuits', record);
  changed('circuits');
  return record;
}

/** Deletes a circuit. Its sessions are kept (they carry the circuit name). */
export async function deleteCircuit(id: string, opts: { tombstone?: boolean } = {}): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(['circuits', 'tombstones'], 'readwrite');
  await tx.objectStore('circuits').delete(id);
  if (opts.tombstone !== false) await tx.objectStore('tombstones').put({ id, kind: 'circuit', deletedAt: Date.now() });
  await tx.done;
  changed('circuits');
}

// ---------- sessions ----------

export async function listSessions(circuitId?: string): Promise<Session[]> {
  const db = await getDb();
  const all = circuitId ? await db.getAllFromIndex('sessions', 'circuitId', circuitId) : await db.getAll('sessions');
  return all.sort((a, b) => b.startedAt - a.startedAt);
}

export async function getSession(id: string): Promise<Session | undefined> {
  return (await getDb()).get('sessions', id);
}

export async function saveSession(s: Session, opts: { touch?: boolean } = {}): Promise<Session> {
  const record = opts.touch === false ? s : { ...s, updatedAt: Date.now() };
  await (await getDb()).put('sessions', record);
  changed('sessions');
  return record;
}

/** `tombstone: false` when applying a deletion that came from sync (prevents echoing it back). */
export async function deleteSession(id: string, opts: { tombstone?: boolean } = {}): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(['sessions', 'samples', 'tombstones'], 'readwrite');
  await tx.objectStore('sessions').delete(id);
  const keys = await tx.objectStore('samples').index('sessionId').getAllKeys(id);
  for (const k of keys) await tx.objectStore('samples').delete(k);
  if (opts.tombstone !== false) await tx.objectStore('tombstones').put({ id, kind: 'session', deletedAt: Date.now() });
  await tx.done;
  changed('sessions');
}

// ---------- raw samples ----------

export async function putSampleChunk(sessionId: string, chunk: number, samples: GpsSample[]): Promise<void> {
  await (await getDb()).put('samples', { sessionId, chunk, samples });
}

export async function getSamples(sessionId: string): Promise<GpsSample[]> {
  const chunks = await (await getDb()).getAllFromIndex('samples', 'sessionId', sessionId);
  return chunks.sort((a, b) => a.chunk - b.chunk).flatMap((c) => c.samples);
}

export async function deleteSamples(sessionId: string): Promise<void> {
  const db = await getDb();
  const tx = db.transaction('samples', 'readwrite');
  for (const k of await tx.store.index('sessionId').getAllKeys(sessionId)) await tx.store.delete(k);
  await tx.done;
}

// ---------- settings & active session ----------

export async function getSettings(): Promise<Settings> {
  const raw = await (await getDb()).get('kv', 'settings');
  return raw ? normalizeSettings(raw) : DEFAULT_SETTINGS;
}

export async function saveSettings(s: Settings): Promise<void> {
  await (await getDb()).put('kv', s, 'settings');
  changed('settings');
}

export async function getActiveSession(): Promise<ActiveSessionInfo | null> {
  return ((await (await getDb()).get('kv', 'activeSession')) as ActiveSessionInfo | undefined) ?? null;
}

export async function setActiveSession(info: ActiveSessionInfo | null): Promise<void> {
  const db = await getDb();
  if (info) await db.put('kv', info, 'activeSession');
  else await db.delete('kv', 'activeSession');
}

export async function getKv<T>(key: string): Promise<T | undefined> {
  return (await (await getDb()).get('kv', key)) as T | undefined;
}

export async function setKv(key: string, value: unknown): Promise<void> {
  await (await getDb()).put('kv', value, key);
}

export async function listTombstones(): Promise<Tombstone[]> {
  return (await getDb()).getAll('tombstones');
}

/** Removes every circuit, session, sample and setting stored on this device. */
export async function clearAllData(): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(['circuits', 'sessions', 'samples', 'tombstones', 'kv'], 'readwrite');
  await Promise.all([
    tx.objectStore('circuits').clear(),
    tx.objectStore('sessions').clear(),
    tx.objectStore('samples').clear(),
    tx.objectStore('tombstones').clear(),
    tx.objectStore('kv').clear(),
  ]);
  await tx.done;
  changed('all');
}

// ---------- derived queries ----------

export interface LapRef {
  session: Session;
  lap: LapRecord;
}

/** Fastest valid lap ever recorded on a circuit. */
export async function personalBest(circuitId: string, includeSimulated: boolean): Promise<LapRef | null> {
  let best: LapRef | null = null;
  for (const session of await listSessions(circuitId)) {
    if (session.source === 'simulated' && !includeSimulated) continue;
    for (const lap of session.laps) {
      if (lap.valid && (!best || lap.timeMs < best.lap.timeMs)) best = { session, lap };
    }
  }
  return best;
}

export async function findLap(sessionId: string, lapNo: number): Promise<LapRef | null> {
  const session = await getSession(sessionId);
  const lap = session?.laps.find((l) => l.lap === lapNo);
  return session && lap ? { session, lap } : null;
}
