import { randomUUID } from 'node:crypto';
import type { CircuitDto, DeletionDto, SessionDto } from '../schemas.js';
import type { ChangeSet, NearbyCircuit, SyncRepository, WriteResult } from './types.js';

interface Row<T> {
  ownerId: string;
  data: T | null;
  updatedAt: number;
  deletedAt: number | null;
  seq: bigint;
}

/** In-process repository for tests and database-less development. Not durable. */
export class MemoryRepository implements SyncRepository {
  private devices = new Map<string, string>();
  private circuits = new Map<string, Row<CircuitDto>>();
  private sessions = new Map<string, Row<SessionDto>>();
  private seq = 0n;

  async createDevice(tokenHash: string): Promise<string> {
    const id = randomUUID();
    this.devices.set(tokenHash, id);
    return id;
  }

  async findDeviceByTokenHash(tokenHash: string): Promise<string | null> {
    return this.devices.get(tokenHash) ?? null;
  }

  private put<T extends { id: string; updatedAt: number }>(table: Map<string, Row<T>>, ownerId: string, rec: T): WriteResult {
    const cur = table.get(rec.id);
    if (cur && cur.ownerId !== ownerId) return 'stale'; // ids are client-generated UUIDs; never overwrite another owner's record
    if (cur && (cur.updatedAt > rec.updatedAt || (cur.deletedAt !== null && cur.deletedAt >= rec.updatedAt))) return 'stale';
    table.set(rec.id, { ownerId, data: structuredClone(rec), updatedAt: rec.updatedAt, deletedAt: null, seq: ++this.seq });
    return 'applied';
  }

  async putCircuit(ownerId: string, c: CircuitDto) {
    return this.put(this.circuits, ownerId, c);
  }

  async putSession(ownerId: string, s: SessionDto) {
    return this.put(this.sessions, ownerId, s);
  }

  async deleteRecord(ownerId: string, d: DeletionDto): Promise<WriteResult> {
    const table = d.kind === 'circuit' ? this.circuits : this.sessions;
    const cur = table.get(d.id) as Row<unknown> | undefined;
    if (!cur) return 'applied'; // never synced: nothing to propagate
    if (cur.ownerId !== ownerId || cur.updatedAt > d.deletedAt) return 'stale';
    (table as Map<string, Row<unknown>>).set(d.id, { ownerId, data: null, updatedAt: cur.updatedAt, deletedAt: d.deletedAt, seq: ++this.seq });
    return 'applied';
  }

  async getCircuit(ownerId: string, id: string) {
    const r = this.circuits.get(id);
    return r && r.ownerId === ownerId && r.data ? structuredClone(r.data) : null;
  }

  async getSession(ownerId: string, id: string) {
    const r = this.sessions.get(id);
    return r && r.ownerId === ownerId && r.data ? structuredClone(r.data) : null;
  }

  async changesSince(ownerId: string, cursor: bigint): Promise<ChangeSet> {
    const out: ChangeSet = { circuits: [], sessions: [], deletions: [], cursor };
    const scan = <T>(table: Map<string, Row<T>>, kind: 'circuit' | 'session', push: (t: T) => void) => {
      for (const [id, r] of table) {
        if (r.ownerId !== ownerId || r.seq <= cursor) continue;
        if (r.seq > out.cursor) out.cursor = r.seq;
        if (r.data) push(structuredClone(r.data));
        else out.deletions.push({ id, kind, deletedAt: r.deletedAt ?? 0 });
      }
    };
    scan(this.circuits, 'circuit', (c) => out.circuits.push(c));
    scan(this.sessions, 'session', (s) => out.sessions.push(s));
    return out;
  }

  async circuitsNear(ownerId: string, lat: number, lon: number, radiusM: number): Promise<NearbyCircuit[]> {
    const out: NearbyCircuit[] = [];
    for (const r of this.circuits.values()) {
      if (r.ownerId !== ownerId || !r.data) continue;
      let best = Infinity;
      for (const [x, y] of r.data.geometry) best = Math.min(best, haversine(lat, lon, y, x));
      if (best <= radiusM) out.push({ id: r.data.id, name: r.data.name, distanceM: best });
    }
    return out.sort((a, b) => a.distanceM - b.distanceM);
  }

  async ping() {
    return true;
  }

  async close() {}
}

function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371008.8;
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
