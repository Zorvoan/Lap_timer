import { createHash, randomBytes } from 'node:crypto';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import { z } from 'zod';
import { syncRequestSchema, type CircuitDto, type SessionDto } from './schemas.js';
import type { SyncRepository } from './repo/types.js';

export interface AppOptions {
  repo: SyncRepository;
  corsOrigins: string[];
  bodyLimit: number;
  logger?: boolean;
}

const hashToken = (t: string) => createHash('sha256').update(t).digest('hex');

/**
 * HTTP API:
 *   GET  /health                 liveness + database check
 *   POST /api/devices            register a guest device → { deviceId, token }
 *   POST /api/sync               push changes, pull changes since cursor (bearer token)
 *   GET  /api/circuits/near      own circuits within a radius (PostGIS)
 */
export async function buildApp(opts: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    bodyLimit: opts.bodyLimit,
    logger: opts.logger
      ? {
          // Request bodies contain location data: never log them, nor auth headers.
          redact: ['req.headers.authorization'],
          serializers: { req: (r: FastifyRequest) => ({ method: r.method, url: r.url.split('?')[0] }) },
        }
      : false,
  });
  await app.register(cors, { origin: opts.corsOrigins.length ? opts.corsOrigins : false });

  const { repo } = opts;

  async function auth(req: FastifyRequest): Promise<string | null> {
    const h = req.headers.authorization;
    if (!h?.startsWith('Bearer ')) return null;
    const token = h.slice(7).trim();
    if (token.length < 20 || token.length > 200) return null;
    return repo.findDeviceByTokenHash(hashToken(token));
  }

  app.get('/health', async (_req, reply) => {
    const db = await repo.ping();
    return reply.code(db ? 200 : 503).send({ ok: db, db: db ? 'up' : 'down' });
  });

  app.post('/api/devices', async (_req, reply) => {
    const token = randomBytes(32).toString('base64url');
    const deviceId = await repo.createDevice(hashToken(token));
    return reply.code(201).send({ deviceId, token });
  });

  app.post('/api/sync', async (req, reply) => {
    const owner = await auth(req);
    if (!owner) return reply.code(401).send({ error: 'unauthorized' });
    const parsed = syncRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_body', issues: parsed.error.issues.slice(0, 5).map((i) => ({ path: i.path.join('.'), message: i.message })) });
    }
    const body = parsed.data;
    let cursor = 0n;
    if (body.cursor) {
      if (!/^\d{1,30}$/.test(body.cursor)) return reply.code(400).send({ error: 'invalid_cursor' });
      cursor = BigInt(body.cursor);
    }

    const rejected: { id: string; kind: 'circuit' | 'session'; reason: string }[] = [];
    const serverCopies: { circuits: CircuitDto[]; sessions: SessionDto[] } = { circuits: [], sessions: [] };
    for (const c of body.circuits) {
      if ((await repo.putCircuit(owner, c)) === 'stale') {
        rejected.push({ id: c.id, kind: 'circuit', reason: 'newer_version_on_server' });
        const copy = await repo.getCircuit(owner, c.id);
        if (copy) serverCopies.circuits.push(copy);
      }
    }
    for (const s of body.sessions) {
      if ((await repo.putSession(owner, s)) === 'stale') {
        rejected.push({ id: s.id, kind: 'session', reason: 'newer_version_on_server' });
        const copy = await repo.getSession(owner, s.id);
        if (copy) serverCopies.sessions.push(copy);
      }
    }
    for (const d of body.deletions) {
      if ((await repo.deleteRecord(owner, d)) === 'stale') rejected.push({ id: d.id, kind: d.kind, reason: 'modified_after_delete' });
    }

    const changes = await repo.changesSince(owner, cursor);
    const merge = <T extends { id: string }>(a: T[], b: T[]) => [...a, ...b.filter((x) => !a.some((y) => y.id === x.id))];
    return reply.send({
      cursor: changes.cursor.toString(),
      circuits: merge(changes.circuits, serverCopies.circuits),
      sessions: merge(changes.sessions, serverCopies.sessions),
      deletions: changes.deletions,
      rejected,
    });
  });

  const nearQuery = z.object({
    lat: z.coerce.number().min(-90).max(90),
    lon: z.coerce.number().min(-180).max(180),
    radius: z.coerce.number().min(1).max(200_000).default(5000),
  });

  app.get('/api/circuits/near', async (req, reply) => {
    const owner = await auth(req);
    if (!owner) return reply.code(401).send({ error: 'unauthorized' });
    const q = nearQuery.safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: 'invalid_query' });
    return reply.send({ circuits: await repo.circuitsNear(owner, q.data.lat, q.data.lon, q.data.radius) });
  });

  app.setErrorHandler((err, req, reply) => {
    if (err.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ error: err.code ?? 'bad_request', message: err.message });
    req.log.error({ err: { message: err.message, code: err.code } }, 'request failed');
    return reply.code(500).send({ error: 'internal_error' });
  });

  return app;
}
