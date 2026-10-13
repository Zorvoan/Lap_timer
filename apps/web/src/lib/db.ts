import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
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

export function getDb(): Promise<DB> {
  if (!dbPromise) {
    dbPromise = openDB<LapTimerDB>(DB_NAME, DB_VERSION, {
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
    });
  }
  return dbPromise;
}

/** For tests: forget the cached connection. */
export async function closeDbForTests(): Promise<void> {
  if (dbPromise) (await dbPromise).close();
  dbPromise = null;
}
