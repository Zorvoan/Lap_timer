import type { CircuitDoc, SessionDoc, TraceChunkDoc } from './codec';

export interface RemoteTombstone {
  id: string;
  kind: 'circuit' | 'session';
  deletedAt: number;
}

export interface RemoteChanges {
  circuits: CircuitDoc[];
  sessions: { doc: SessionDoc; chunks: TraceChunkDoc[] }[];
  tombstones: RemoteTombstone[];
  /** Server time (ms) of the newest change included; pass back as the next cursor. */
  cursor: number;
}

/** One signed-in user's cloud storage. Implemented with Firestore; an in-memory version backs the tests. */
export interface CloudStore {
  /** `updatedAt` of the stored version, or null when absent. */
  getUpdatedAt(kind: 'circuit' | 'session', id: string): Promise<number | null>;
  putCircuit(doc: CircuitDoc): Promise<void>;
  /** Uploads trace chunks first, then the session document, then removes chunks of older versions. */
  putSession(doc: SessionDoc, chunks: TraceChunkDoc[]): Promise<void>;
  /** Deletes the record (and its chunks) and leaves a tombstone so other devices delete it too. */
  deleteRecord(t: RemoteTombstone): Promise<void>;
  /** Everything written after `cursor` (server time, ms). */
  changesSince(cursor: number): Promise<RemoteChanges>;
}
