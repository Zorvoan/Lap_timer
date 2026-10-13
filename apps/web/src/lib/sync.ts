/**
 * Optional synchronisation with the Lap Timer server (apps/server).
 * Local IndexedDB stays the source of truth; sync is last-writer-wins per record using the
 * client-side `updatedAt`, and the server decides which of two concurrent edits is kept.
 * Raw GPS samples are never uploaded.
 */
import type { Circuit, Session } from '@laptimer/core';
import { getCircuit, getKv, getSession, listCircuits, listSessions, listTombstones, saveCircuit, saveSession, setKv } from './repo';
import { getDb } from './db';

interface DeviceCredentials {
  url: string;
  deviceId: string;
  token: string;
}

interface SyncResponse {
  cursor: string;
  circuits: Circuit[];
  sessions: Session[];
  deletions: { id: string; kind: 'circuit' | 'session'; deletedAt: number }[];
  rejected: { id: string; kind: 'circuit' | 'session'; reason: string }[];
}

export interface SyncResult {
  pushed: number;
  pulled: number;
  deleted: number;
  /** Local edits the server already had a newer version of; the server copy was kept. */
  superseded: number;
}

async function request<T>(url: string, init: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, headers: { 'content-type': 'application/json', ...(init.headers ?? {}) } });
  } catch {
    throw new Error('Could not reach the sync server.');
  }
  if (res.status === 401) throw new Error('The sync server rejected this device. Reset sync in Settings.');
  if (!res.ok) throw new Error(`Sync failed (HTTP ${res.status}).`);
  return (await res.json()) as T;
}

async function credentials(url: string): Promise<DeviceCredentials> {
  const existing = await getKv<DeviceCredentials>('syncDevice');
  if (existing && existing.url === url) return existing;
  const r = await request<{ deviceId: string; token: string }>(`${url}/api/devices`, { method: 'POST', body: '{}' });
  const creds = { url, deviceId: r.deviceId, token: r.token };
  await setKv('syncDevice', creds);
  await setKv('syncState', null);
  return creds;
}

export async function resetSync(): Promise<void> {
  await setKv('syncDevice', null);
  await setKv('syncState', null);
}

export async function syncNow(baseUrl: string): Promise<SyncResult> {
  const url = baseUrl.replace(/\/+$/, '');
  if (!/^https?:\/\//.test(url)) throw new Error('Sync URL must start with http:// or https://');
  const creds = await credentials(url);
  const state = (await getKv<{ cursor: string; pushedAt: number }>('syncState')) ?? { cursor: '', pushedAt: 0 };

  const startedAt = Date.now();
  const circuits = (await listCircuits()).filter((c) => c.updatedAt > state.pushedAt);
  const sessions = (await listSessions()).filter((s) => s.updatedAt > state.pushedAt && s.endedAt !== null);
  const deletions = (await listTombstones()).filter((t) => t.deletedAt > state.pushedAt);

  const body = JSON.stringify({ cursor: state.cursor, circuits, sessions, deletions }, (_k, v) =>
    typeof v === 'number' && !Number.isFinite(v) ? null : v,
  );
  const res = await request<SyncResponse>(`${url}/api/sync`, {
    method: 'POST',
    body,
    headers: { authorization: `Bearer ${creds.token}` },
  });

  let pulled = 0;
  for (const c of res.circuits) {
    const local = await getCircuit(c.id);
    if (!local || local.updatedAt < c.updatedAt) {
      await saveCircuit(c, { touch: false });
      pulled++;
    }
  }
  for (const s of res.sessions) {
    const local = await getSession(s.id);
    if (!local || local.updatedAt < s.updatedAt) {
      await saveSession(s, { touch: false });
      pulled++;
    }
  }
  let deleted = 0;
  const db = await getDb();
  for (const d of res.deletions) {
    const store = d.kind === 'circuit' ? 'circuits' : 'sessions';
    const local = await db.get(store, d.id);
    if (local && local.updatedAt <= d.deletedAt) {
      await db.delete(store, d.id);
      deleted++;
    }
  }
  await setKv('syncState', { cursor: res.cursor, pushedAt: startedAt });
  return { pushed: circuits.length + sessions.length + deletions.length, pulled, deleted, superseded: res.rejected.length };
}
