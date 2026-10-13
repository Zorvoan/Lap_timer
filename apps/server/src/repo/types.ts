import type { CircuitDto, DeletionDto, SessionDto } from '../schemas.js';

export type Kind = 'circuit' | 'session';

/** Result of writing one record: applied, or rejected because the server holds a newer version. */
export type WriteResult = 'applied' | 'stale';

export interface ChangeSet {
  circuits: CircuitDto[];
  sessions: SessionDto[];
  deletions: DeletionDto[];
  /** Highest change sequence included; pass back as the next cursor. */
  cursor: bigint;
}

export interface NearbyCircuit {
  id: string;
  name: string;
  distanceM: number;
}

/**
 * Storage for synced records, scoped by owner (device). Conflict rule: last writer wins by
 * the client-side `updatedAt`; a write older than the stored version is rejected as stale.
 */
export interface SyncRepository {
  createDevice(tokenHash: string): Promise<string>;
  findDeviceByTokenHash(tokenHash: string): Promise<string | null>;
  putCircuit(ownerId: string, c: CircuitDto): Promise<WriteResult>;
  putSession(ownerId: string, s: SessionDto): Promise<WriteResult>;
  deleteRecord(ownerId: string, d: DeletionDto): Promise<WriteResult>;
  getCircuit(ownerId: string, id: string): Promise<CircuitDto | null>;
  getSession(ownerId: string, id: string): Promise<SessionDto | null>;
  changesSince(ownerId: string, cursor: bigint): Promise<ChangeSet>;
  circuitsNear(ownerId: string, lat: number, lon: number, radiusM: number): Promise<NearbyCircuit[]>;
  ping(): Promise<boolean>;
  close(): Promise<void>;
}
