import { openDB, unwrap, type DBSchema, type IDBPDatabase } from 'idb';
import type { Circuit, GpsSample, Session, SessionMark, SessionSource, ReferenceSelection } from '@laptimer/core';

export interface SampleChunk {
  sessionId: string;
  chunk: number;
  samples: GpsSample[];
}

/** Pointer to a session that was being recorded; used to recover after the app is killed. */
export interface ActiveSessionInfo {
  sessionId: string;
  circuitId: string;
  source: SessionSource;
  startedAt: number;
  marks: SessionMark[];
  reference: ReferenceSelection | null;
  updatedAt: number;
}

export interface Tombstone {
  id: string;
  kind: 'circuit' | 'session';
  deletedAt: number;
}

interface LapTimerDB extends DBSchema {
  circuits: { key: string; value: Circuit; indexes: { updatedAt: number } };
  sessions: { key: string; value: Session; indexes: { circuitId: string; startedAt: number } };
  samples: { key: [string, number]; value: SampleChunk; indexes: { sessionId: string } };
  tombstones: { key: string; value: Tombstone };
  kv: { key: string; value: unknown };
}

export type DB = IDBPDatabase<LapTimerDB>;

const DB_NAME = 'laptimer';
const DB_VERSION = 1;

let dbPromise: Promise<DB> | null = null;

function open(): Promise<DB> {
  const p = openDB<LapTimerDB>(DB_NAME, DB_VERSION, {
    upgrade(db, oldVersion) {
      if (oldVersion < 1) {
        const circuits = db.createObjectStore('circuits', { keyPath: 'id' });
        circuits.createIndex('updatedAt', 'updatedAt');
        const sessions = db.createObjectStore('sessions', { keyPath: 'id' });
        sessions.createIndex('circuitId', 'circuitId');
        sessions.createIndex('startedAt', 'startedAt');
        const samples = db.createObjectStore('samples', { keyPath: ['sessionId', 'chunk'] });
        samples.createIndex('sessionId', 'sessionId');
        db.createObjectStore('tombstones', { keyPath: 'id' });
        db.createObjectStore('kv');
      }
    },
    blocked() {
      console.warn('[laptimer] database upgrade blocked by another open tab');
    },
    // Another tab needs a newer version: step aside; this tab reopens on its next access.
    blocking() {
      void p.then((db) => db.close());
      if (dbPromise === p) dbPromise = null;
    },
    // The browser closed the connection (site data cleared, storage pressure, …).
    terminated() {
      if (dbPromise === p) dbPromise = null;
    },
  });
  p.catch(() => {
    if (dbPromise === p) dbPromise = null;
  });
  return p;
}

/** True when the connection can still start transactions (it is not closed or closing). */
function usable(db: DB): boolean {
  try {
    // A plain IDB transaction with no requests: it just commits. (The idb wrapper would add a
    // completion promise that rejects when nobody awaits it.)
    unwrap(db).transaction('kv');
    return true;
  } catch {
    return false;
  }
}

/**
 * The shared database connection. Browsers can close a connection underneath the page; every
 * call checks it is still usable and reopens it otherwise, so a closed connection never
 * surfaces as "The database connection is closing".
 */
export async function getDb(): Promise<DB> {
  if (!dbPromise) dbPromise = open();
  const p = dbPromise;
  const db = await p;
  if (usable(db)) return db;
  if (dbPromise === p) dbPromise = open();
  return dbPromise;
}

/** For tests: forget the cached connection. */
export async function closeDbForTests(): Promise<void> {
  if (dbPromise) (await dbPromise).close();
  dbPromise = null;
}
