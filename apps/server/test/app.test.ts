import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { MemoryRepository } from '../src/repo/memory.js';

const line = { a: { lat: 50, lon: 14 }, b: { lat: 50.0002, lon: 14 }, direction: 1 as const };

function circuit(id: string, updatedAt: number, name = 'Loop') {
  return {
    id,
    name,
    kind: 'closed',
    origin: 'routed',
    geometry: [
      [14, 50],
      [14.01, 50],
      [14.01, 50.01],
      [14, 50],
    ],
    waypoints: [],
    routing: null,
    startLine: line,
    finishLine: null,
    sectors: [],
    lengthM: 3000,
    elevation: null,
    createdAt: 1,
    updatedAt,
  };
}

function session(id: string, updatedAt: number) {
  return {
    id,
    circuitId: 'c1',
    circuitName: 'Loop',
    source: 'gps',
    startedAt: 1000.25,
    endedAt: 99999.5,
    laps: [
      {
        lap: 1,
        startT: 1234.5678,
        endT: 61234.9876,
        timeMs: 60000.4198,
        sectorTimesMs: [],
        distanceM: 3000,
        avgSpeedMs: 50,
        maxSpeedMs: 60,
        valid: true,
        flags: [],
        gps: { samples: 300, poorSamples: 0, meanAccuracyM: 4, maxGapMs: 250, meanRateHz: 5 },
        trace: [{ t: 0, d: 0, v: null, lat: 50, lon: 14, accuracy: null }],
      },
    ],
    marks: [],
    reference: null,
    updatedAt,
  };
}

describe('sync API', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildApp({ repo: new MemoryRepository(), corsOrigins: [], bodyLimit: 5_000_000 });
  });
  afterEach(async () => app.close());

  async function device() {
    const r = await app.inject({ method: 'POST', url: '/api/devices', payload: {} });
    expect(r.statusCode).toBe(201);
    return r.json() as { deviceId: string; token: string };
  }

  async function sync(token: string, body: object) {
    return app.inject({ method: 'POST', url: '/api/sync', headers: { authorization: `Bearer ${token}` }, payload: { cursor: '', circuits: [], sessions: [], deletions: [], ...body } });
  }

  it('reports health', async () => {
    const r = await app.inject({ method: 'GET', url: '/health' });
    expect(r.json()).toEqual({ ok: true, db: 'up' });
  });

  it('requires a valid device token', async () => {
    expect((await sync('nope-not-a-real-token-at-all', {})).statusCode).toBe(401);
    const r = await app.inject({ method: 'POST', url: '/api/sync', payload: {} });
    expect(r.statusCode).toBe(401);
  });

  it('rejects malformed payloads', async () => {
    const { token } = await device();
    const r = await sync(token, { circuits: [{ id: 'x', geometry: 'not-a-line' }] });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toBe('invalid_body');
  });

  it('pushes and pulls records without losing timestamp precision', async () => {
    const { token } = await device();
    const r1 = await sync(token, { circuits: [circuit('c1', 10)], sessions: [session('s1', 10)] });
    expect(r1.statusCode).toBe(200);
    const body = r1.json();
    expect(body.rejected).toEqual([]);
    expect(body.sessions[0].laps[0].timeMs).toBe(60000.4198);
    expect(body.sessions[0].laps[0].startT).toBe(1234.5678);
    // Incremental: nothing new after the returned cursor.
    const r2 = await sync(token, { cursor: body.cursor });
    expect(r2.json().circuits).toEqual([]);
  });

  it('keeps the newer version on conflict and returns it to the client', async () => {
    const { token } = await device();
    await sync(token, { circuits: [circuit('c1', 20, 'Newer')] });
    const r = await sync(token, { circuits: [circuit('c1', 10, 'Older')] });
    const body = r.json();
    expect(body.rejected).toEqual([{ id: 'c1', kind: 'circuit', reason: 'newer_version_on_server' }]);
    expect(body.circuits.find((c: { id: string }) => c.id === 'c1').name).toBe('Newer');
  });

  it('isolates devices from each other', async () => {
    const a = await device();
    const b = await device();
    await sync(a.token, { circuits: [circuit('c1', 10)] });
    expect((await sync(b.token, {})).json().circuits).toEqual([]);
    // b cannot overwrite a's record by reusing its id
    const r = await sync(b.token, { circuits: [circuit('c1', 99, 'Hijack')] });
    expect(r.json().rejected).toHaveLength(1);
    expect((await sync(a.token, {})).json().circuits[0].name).toBe('Loop');
  });

  it('propagates deletions, but not over newer edits', async () => {
    const { token } = await device();
    const first = (await sync(token, { circuits: [circuit('c1', 10)], sessions: [session('s1', 10)] })).json();
    const del = (await sync(token, { cursor: first.cursor, deletions: [{ id: 's1', kind: 'session', deletedAt: 20 }, { id: 'c1', kind: 'circuit', deletedAt: 5 }] })).json();
    expect(del.deletions).toEqual([{ id: 's1', kind: 'session', deletedAt: 20 }]);
    expect(del.rejected).toEqual([{ id: 'c1', kind: 'circuit', reason: 'modified_after_delete' }]);
  });

  it('finds own circuits near a position', async () => {
    const { token } = await device();
    await sync(token, { circuits: [circuit('c1', 10)] });
    const near = await app.inject({ method: 'GET', url: '/api/circuits/near?lat=50.001&lon=14.005&radius=1000', headers: { authorization: `Bearer ${token}` } });
    expect(near.json().circuits.map((c: { id: string }) => c.id)).toEqual(['c1']);
    const far = await app.inject({ method: 'GET', url: '/api/circuits/near?lat=51&lon=15&radius=1000', headers: { authorization: `Bearer ${token}` } });
    expect(far.json().circuits).toEqual([]);
  });
});
