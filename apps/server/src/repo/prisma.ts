import { Prisma, PrismaClient } from '@prisma/client';
import type { CircuitDto, DeletionDto, SessionDto } from '../schemas.js';
import type { ChangeSet, NearbyCircuit, SyncRepository, WriteResult } from './types.js';

type Tx = Prisma.TransactionClient;

async function nextSeq(tx: Tx): Promise<bigint> {
  const rows = await tx.$queryRaw<{ nextval: bigint }[]>`SELECT nextval('sync_seq') AS nextval`;
  return BigInt(rows[0].nextval);
}

const json = (v: unknown) => (v === null || v === undefined ? Prisma.JsonNull : (v as Prisma.InputJsonValue));

/** PostgreSQL/PostGIS repository. Writes are transactional and lock the target row. */
export class PrismaRepository implements SyncRepository {
  constructor(private readonly prisma: PrismaClient = new PrismaClient()) {}

  async createDevice(tokenHash: string): Promise<string> {
    const d = await this.prisma.device.create({ data: { tokenHash } });
    return d.id;
  }

  async findDeviceByTokenHash(tokenHash: string): Promise<string | null> {
    const d = await this.prisma.device.findUnique({ where: { tokenHash }, select: { id: true } });
    return d?.id ?? null;
  }

  async putCircuit(ownerId: string, c: CircuitDto): Promise<WriteResult> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM "Circuit" WHERE id = ${c.id} FOR UPDATE`;
      const cur = await tx.circuit.findUnique({ where: { id: c.id }, select: { ownerId: true, updatedAt: true, deletedAt: true } });
      if (cur && (cur.ownerId !== ownerId || cur.updatedAt > c.updatedAt || (cur.deletedAt !== null && cur.deletedAt >= c.updatedAt))) return 'stale';
      const seq = await nextSeq(tx);
      const data = {
        ownerId,
        name: c.name,
        kind: c.kind,
        origin: c.origin,
        lengthM: c.lengthM,
        geometry: c.geometry,
        waypoints: c.waypoints,
        routing: json(c.routing),
        elevation: json(c.elevation),
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
        deletedAt: null,
        seq,
      };
      await tx.circuit.upsert({ where: { id: c.id }, create: { id: c.id, ...data }, update: data });
      await tx.timingLine.deleteMany({ where: { circuitId: c.id } });
      const lines = [
        { kind: 'start', idx: 0, l: c.startLine },
        ...(c.finishLine ? [{ kind: 'finish', idx: 0, l: c.finishLine }] : []),
        ...c.sectors.map((l, idx) => ({ kind: 'sector', idx, l })),
      ];
      await tx.timingLine.createMany({
        data: lines.map(({ kind, idx, l }) => ({ circuitId: c.id, kind, idx, aLat: l.a.lat, aLon: l.a.lon, bLat: l.b.lat, bLon: l.b.lon, direction: l.direction })),
      });
      const geojson = JSON.stringify({ type: 'LineString', coordinates: c.geometry });
      await tx.$executeRaw`UPDATE "Circuit" SET geom = ST_SetSRID(ST_GeomFromGeoJSON(${geojson}), 4326)::geography WHERE id = ${c.id}`;
      return 'applied' as const;
    });
  }

  async putSession(ownerId: string, s: SessionDto): Promise<WriteResult> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM "Session" WHERE id = ${s.id} FOR UPDATE`;
      const cur = await tx.session.findUnique({ where: { id: s.id }, select: { ownerId: true, updatedAt: true, deletedAt: true } });
      if (cur && (cur.ownerId !== ownerId || cur.updatedAt > s.updatedAt || (cur.deletedAt !== null && cur.deletedAt >= s.updatedAt))) return 'stale';
      const seq = await nextSeq(tx);
      const data = {
        ownerId,
        circuitId: s.circuitId,
        circuitName: s.circuitName,
        source: s.source,
        startedAt: s.startedAt,
        endedAt: s.endedAt,
        marks: s.marks,
        referenceSessionId: s.reference?.sessionId ?? null,
        referenceLap: s.reference?.lap ?? null,
        updatedAt: s.updatedAt,
        deletedAt: null,
        seq,
      };
      await tx.session.upsert({ where: { id: s.id }, create: { id: s.id, ...data }, update: data });
      await tx.lap.deleteMany({ where: { sessionId: s.id } });
      if (s.laps.length) {
        await tx.lap.createMany({
          data: s.laps.map((l) => ({
            sessionId: s.id,
            lap: l.lap,
            startT: l.startT,
            endT: l.endT,
            timeMs: l.timeMs,
            sectorTimesMs: l.sectorTimesMs,
            distanceM: l.distanceM,
            avgSpeedMs: l.avgSpeedMs,
            maxSpeedMs: l.maxSpeedMs,
            valid: l.valid,
            flags: l.flags,
            gps: l.gps,
            trace: l.trace,
          })),
        });
      }
      return 'applied' as const;
    });
  }

  async deleteRecord(ownerId: string, d: DeletionDto): Promise<WriteResult> {
    return this.prisma.$transaction(async (tx) => {
      const table = d.kind === 'circuit' ? Prisma.sql`"Circuit"` : Prisma.sql`"Session"`;
      const rows = await tx.$queryRaw<{ ownerId: string; updatedAt: number }[]>`SELECT "ownerId"::text AS "ownerId", "updatedAt" FROM ${table} WHERE id = ${d.id} FOR UPDATE`;
      const cur = rows[0];
      if (!cur) return 'applied' as const; // never synced: nothing to propagate
      if (cur.ownerId !== ownerId || cur.updatedAt > d.deletedAt) return 'stale' as const;
      const seq = await nextSeq(tx);
      if (d.kind === 'circuit') await tx.circuit.update({ where: { id: d.id }, data: { deletedAt: d.deletedAt, seq } });
      else {
        await tx.session.update({ where: { id: d.id }, data: { deletedAt: d.deletedAt, seq } });
        await tx.lap.deleteMany({ where: { sessionId: d.id } });
        await tx.gpsSample.deleteMany({ where: { sessionId: d.id } });
      }
      return 'applied' as const;
    });
  }

  async getCircuit(ownerId: string, id: string): Promise<CircuitDto | null> {
    const row = await this.prisma.circuit.findFirst({ where: { id, ownerId, deletedAt: null }, include: { timingLines: true } });
    return row ? toCircuit(row) : null;
  }

  async getSession(ownerId: string, id: string): Promise<SessionDto | null> {
    const row = await this.prisma.session.findFirst({ where: { id, ownerId, deletedAt: null }, include: { laps: { orderBy: { lap: 'asc' } } } });
    return row ? toSession(row) : null;
  }

  async changesSince(ownerId: string, cursor: bigint): Promise<ChangeSet> {
    const [circuits, sessions] = await Promise.all([
      this.prisma.circuit.findMany({ where: { ownerId, seq: { gt: cursor } }, include: { timingLines: true }, orderBy: { seq: 'asc' } }),
      this.prisma.session.findMany({ where: { ownerId, seq: { gt: cursor } }, include: { laps: { orderBy: { lap: 'asc' } } }, orderBy: { seq: 'asc' } }),
    ]);
    const out: ChangeSet = { circuits: [], sessions: [], deletions: [], cursor };
    for (const c of circuits) {
      if (c.seq > out.cursor) out.cursor = c.seq;
      if (c.deletedAt !== null) out.deletions.push({ id: c.id, kind: 'circuit', deletedAt: c.deletedAt });
      else out.circuits.push(toCircuit(c));
    }
    for (const s of sessions) {
      if (s.seq > out.cursor) out.cursor = s.seq;
      if (s.deletedAt !== null) out.deletions.push({ id: s.id, kind: 'session', deletedAt: s.deletedAt });
      else out.sessions.push(toSession(s));
    }
    return out;
  }

  async circuitsNear(ownerId: string, lat: number, lon: number, radiusM: number): Promise<NearbyCircuit[]> {
    const rows = await this.prisma.$queryRaw<{ id: string; name: string; d: number }[]>`
      SELECT id, name, ST_Distance(geom, ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326)::geography) AS d
      FROM "Circuit"
      WHERE "ownerId" = ${ownerId}::uuid AND "deletedAt" IS NULL
        AND ST_DWithin(geom, ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326)::geography, ${radiusM})
      ORDER BY d LIMIT 50`;
    return rows.map((r) => ({ id: r.id, name: r.name, distanceM: Number(r.d) }));
  }

  async ping(): Promise<boolean> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    await this.prisma.$disconnect();
  }
}

type CircuitRow = Prisma.CircuitGetPayload<{ include: { timingLines: true } }>;
type SessionRow = Prisma.SessionGetPayload<{ include: { laps: true } }>;

function toLine(l: CircuitRow['timingLines'][number]) {
  return { a: { lat: l.aLat, lon: l.aLon }, b: { lat: l.bLat, lon: l.bLon }, direction: (l.direction === -1 ? -1 : 1) as 1 | -1 };
}

function toCircuit(c: CircuitRow): CircuitDto {
  const start = c.timingLines.find((l) => l.kind === 'start');
  const finish = c.timingLines.find((l) => l.kind === 'finish');
  return {
    id: c.id,
    name: c.name,
    kind: c.kind as CircuitDto['kind'],
    origin: c.origin as CircuitDto['origin'],
    geometry: c.geometry as CircuitDto['geometry'],
    waypoints: c.waypoints as CircuitDto['waypoints'],
    routing: (c.routing ?? null) as CircuitDto['routing'],
    startLine: start ? toLine(start) : { a: { lat: 0, lon: 0 }, b: { lat: 0, lon: 0 }, direction: 1 },
    finishLine: finish ? toLine(finish) : null,
    sectors: c.timingLines.filter((l) => l.kind === 'sector').sort((a, b) => a.idx - b.idx).map(toLine),
    lengthM: c.lengthM,
    elevation: (c.elevation ?? null) as CircuitDto['elevation'],
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}

function toSession(s: SessionRow): SessionDto {
  return {
    id: s.id,
    circuitId: s.circuitId,
    circuitName: s.circuitName,
    source: s.source as SessionDto['source'],
    startedAt: s.startedAt,
    endedAt: s.endedAt,
    marks: s.marks as SessionDto['marks'],
    reference: s.referenceSessionId && s.referenceLap !== null ? { sessionId: s.referenceSessionId, lap: s.referenceLap } : null,
    updatedAt: s.updatedAt,
    laps: s.laps.map((l) => ({
      lap: l.lap,
      startT: l.startT,
      endT: l.endT,
      timeMs: l.timeMs,
      sectorTimesMs: l.sectorTimesMs,
      distanceM: l.distanceM,
      avgSpeedMs: l.avgSpeedMs,
      maxSpeedMs: l.maxSpeedMs,
      valid: l.valid,
      flags: l.flags,
      gps: l.gps as SessionDto['laps'][number]['gps'],
      trace: l.trace as SessionDto['laps'][number]['trace'],
    })),
  };
}
