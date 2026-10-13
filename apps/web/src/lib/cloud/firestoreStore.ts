import {
  Timestamp,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  where,
  writeBatch,
  type Firestore,
} from 'firebase/firestore';
import type { CircuitDoc, SessionDoc, TraceChunkDoc } from './codec';
import type { CloudStore, RemoteChanges, RemoteTombstone } from './store';

/** Chunk documents per write batch (each ≤ ~300 KB; a batch must stay under 10 MiB). */
const CHUNKS_PER_BATCH = 12;
/**
 * Pulls re-read this much before the cursor: a write that commits while a pull is running can
 * carry a server timestamp slightly older than newer writes already seen. Re-applying is harmless.
 */
const CURSOR_OVERLAP_MS = 120_000;

const tsMillis = (v: unknown): number => (v instanceof Timestamp ? v.toMillis() : 0);

/**
 * Layout (all under users/{uid}, readable and writable only by that user — see firestore.rules):
 *   circuits/{id}                 CircuitDoc
 *   sessions/{id}                 SessionDoc
 *   sessions/{id}/traces/{chunk}  TraceChunkDoc
 *   tombstones/{id}               RemoteTombstone
 * Every write sets `serverUpdatedAt` (server clock), which incremental pulls query on.
 */
export class FirestoreStore implements CloudStore {
  constructor(
    private readonly db: Firestore,
    private readonly uid: string,
  ) {}

  private col(name: 'circuits' | 'sessions' | 'tombstones') {
    return collection(this.db, 'users', this.uid, name);
  }

  private traces(sessionId: string) {
    return collection(this.db, 'users', this.uid, 'sessions', sessionId, 'traces');
  }

  async getUpdatedAt(kind: 'circuit' | 'session', id: string): Promise<number | null> {
    const snap = await getDoc(doc(this.col(kind === 'circuit' ? 'circuits' : 'sessions'), id));
    return snap.exists() ? Number(snap.get('updatedAt')) : null;
  }

  async putCircuit(d: CircuitDoc): Promise<void> {
    const b = writeBatch(this.db);
    b.set(doc(this.col('circuits'), d.id), { ...d, serverUpdatedAt: serverTimestamp() });
    b.delete(doc(this.col('tombstones'), d.id));
    await b.commit();
  }

  async putSession(d: SessionDoc, chunks: TraceChunkDoc[]): Promise<void> {
    const existing = await getDocs(this.traces(d.id));
    for (let i = 0; i < chunks.length; i += CHUNKS_PER_BATCH) {
      const b = writeBatch(this.db);
      for (const c of chunks.slice(i, i + CHUNKS_PER_BATCH)) b.set(doc(this.traces(d.id), c.id), c);
      await b.commit();
    }
    // The session document goes last: readers only trust chunks matching its traceVersion.
    const b = writeBatch(this.db);
    b.set(doc(this.col('sessions'), d.id), { ...d, serverUpdatedAt: serverTimestamp() });
    b.delete(doc(this.col('tombstones'), d.id));
    await b.commit();
    const keep = new Set(chunks.map((c) => c.id));
    await Promise.all(existing.docs.filter((x) => !keep.has(x.id)).map((x) => deleteDoc(x.ref)));
  }

  async deleteRecord(t: RemoteTombstone): Promise<void> {
    if (t.kind === 'session') {
      const chunks = await getDocs(this.traces(t.id));
      await Promise.all(chunks.docs.map((x) => deleteDoc(x.ref)));
    }
    const b = writeBatch(this.db);
    b.delete(doc(this.col(t.kind === 'circuit' ? 'circuits' : 'sessions'), t.id));
    b.set(doc(this.col('tombstones'), t.id), { ...t, serverUpdatedAt: serverTimestamp() });
    await b.commit();
  }

  async changesSince(cursor: number): Promise<RemoteChanges> {
    const after = where('serverUpdatedAt', '>', Timestamp.fromMillis(Math.max(0, cursor - CURSOR_OVERLAP_MS)));
    const [circuits, sessions, tombstones] = await Promise.all([
      getDocs(query(this.col('circuits'), after)),
      getDocs(query(this.col('sessions'), after)),
      getDocs(query(this.col('tombstones'), after)),
    ]);
    let max = cursor;
    const note = (v: unknown) => (max = Math.max(max, tsMillis(v)));
    const out: RemoteChanges = { circuits: [], sessions: [], tombstones: [], cursor };
    for (const s of circuits.docs) {
      note(s.get('serverUpdatedAt'));
      out.circuits.push(s.data() as CircuitDoc);
    }
    for (const s of sessions.docs) {
      note(s.get('serverUpdatedAt'));
      const d = s.data() as SessionDoc;
      const chunks = await getDocs(this.traces(d.id));
      out.sessions.push({ doc: d, chunks: chunks.docs.map((c) => c.data() as TraceChunkDoc) });
    }
    for (const s of tombstones.docs) {
      note(s.get('serverUpdatedAt'));
      out.tombstones.push(s.data() as RemoteTombstone);
    }
    out.cursor = max;
    return out;
  }
}
