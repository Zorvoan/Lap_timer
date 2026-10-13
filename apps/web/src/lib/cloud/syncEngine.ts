/**
 * Two-way sync between this device (IndexedDB) and the signed-in user's cloud storage.
 *
 * - Local storage stays the source the app reads from, so everything works offline.
 * - Conflicts: last writer wins per record, by `updatedAt`.
 * - Deletions travel as tombstones and never override a newer edit.
 * - A session still being recorded is never uploaded; raw GPS fixes are never uploaded.
 */
import { getActiveSession, getCircuit, getKv, getSession, listCircuits, listSessions, listTombstones, saveCircuit, saveSession, setKv, deleteCircuit, deleteSession } from '../repo';
import { log } from '../log';
import { IncompleteSessionError, decodeCircuit, decodeSession, encodeCircuit, encodeSession } from './codec';
import type { CloudStore } from './store';

export interface SyncReport {
  uploaded: number;
  downloaded: number;
  deleted: number;
  /** Records skipped because the cloud copy was newer or incomplete. */
  skipped: number;
}

interface SyncState {
  /** Server time of the last change pulled. */
  cursor: number;
  /** Local changes up to this time have been uploaded. */
  pushedAt: number;
}

const stateKey = (uid: string) => `cloudSync:${uid}`;

export async function resetSyncState(uid: string): Promise<void> {
  await setKv(stateKey(uid), null);
}

export async function runSync(store: CloudStore, uid: string): Promise<SyncReport> {
  const report: SyncReport = { uploaded: 0, downloaded: 0, deleted: 0, skipped: 0 };
  let incomplete = 0;
  const state = (await getKv<SyncState | null>(stateKey(uid))) ?? { cursor: 0, pushedAt: 0 };
  const startedAt = Date.now();
  const activeId = (await getActiveSession())?.sessionId ?? null;

  // ---- pull first: deletions and newer edits from other devices must win over stale local copies
  const changes = await store.changesSince(state.cursor);
  for (const d of changes.circuits) {
    const local = await getCircuit(d.id);
    if (local && local.updatedAt >= d.updatedAt) continue;
    try {
      await saveCircuit(decodeCircuit(d), { touch: false });
      report.downloaded++;
    } catch (e) {
      report.skipped++;
      log.warn('cloud circuit could not be decoded', { error: String(e) });
    }
  }
  for (const { doc, chunks } of changes.sessions) {
    if (doc.id === activeId) continue;
    const local = await getSession(doc.id);
    if (local && local.updatedAt >= doc.updatedAt) continue;
    try {
      await saveSession(decodeSession(doc, chunks), { touch: false });
      report.downloaded++;
    } catch (e) {
      report.skipped++;
      // Upload still in progress on another device: it is picked up by a later sync.
      if (e instanceof IncompleteSessionError) incomplete++;
      else log.warn('cloud session could not be decoded', { error: String(e) });
    }
  }
  for (const t of changes.tombstones) {
    const local = t.kind === 'circuit' ? await getCircuit(t.id) : await getSession(t.id);
    if (!local || local.updatedAt > t.deletedAt) continue;
    if (t.kind === 'circuit') await deleteCircuit(t.id, { tombstone: false });
    else await deleteSession(t.id, { tombstone: false });
    report.deleted++;
  }

  // ---- then push local changes
  for (const c of await listCircuits()) {
    if (c.updatedAt <= state.pushedAt) continue;
    const remote = await store.getUpdatedAt('circuit', c.id);
    if (remote !== null && remote >= c.updatedAt) continue;
    await store.putCircuit(encodeCircuit(c));
    report.uploaded++;
  }
  for (const s of await listSessions()) {
    if (s.updatedAt <= state.pushedAt || s.endedAt === null || s.id === activeId) continue;
    const remote = await store.getUpdatedAt('session', s.id);
    if (remote !== null && remote >= s.updatedAt) continue;
    const { doc, chunks } = encodeSession(s);
    await store.putSession(doc, chunks);
    report.uploaded++;
  }
  for (const t of await listTombstones()) {
    if (t.deletedAt <= state.pushedAt) continue;
    const remote = await store.getUpdatedAt(t.kind, t.id);
    if (remote !== null && remote > t.deletedAt) continue; // edited elsewhere after this delete
    await store.deleteRecord(t);
    report.uploaded++;
  }

  // Sessions skipped as incomplete must be fetched again next time: keep the cursor back.
  const cursor = incomplete > 0 ? state.cursor : changes.cursor;
  await setKv(stateKey(uid), { cursor, pushedAt: startedAt } satisfies SyncState);
  return report;
}
