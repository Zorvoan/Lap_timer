import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { SessionEngine, TrackModel, constantSpeedProfile, perpendicularLine, simulateDrive, type Circuit, type LonLat, type Session } from '@laptimer/core';
import { closeDbForTests } from '../src/lib/db';
import { deleteSession, getCircuit, getSession, listSessions, saveCircuit, saveSession, setActiveSession } from '../src/lib/repo';
import { decodeCircuit, decodeSession, encodeCircuit, encodeSession, TRACE_CHUNK_POINTS, type CircuitDoc, type SessionDoc, type TraceChunkDoc } from '../src/lib/cloud/codec';
import { runSync } from '../src/lib/cloud/syncEngine';
import type { CloudStore, RemoteChanges, RemoteTombstone } from '../src/lib/cloud/store';

/** In-memory stand-in for Firestore with a monotonically increasing server clock. */
class MemoryCloud implements CloudStore {
  clock = 1000;
  circuits = new Map<string, { doc: CircuitDoc; ts: number }>();
  sessions = new Map<string, { doc: SessionDoc; ts: number }>();
  chunks = new Map<string, TraceChunkDoc[]>();
  tombstones = new Map<string, { t: RemoteTombstone; ts: number }>();

  async getUpdatedAt(kind: 'circuit' | 'session', id: string) {
    const r = kind === 'circuit' ? this.circuits.get(id) : this.sessions.get(id);
    return r ? r.doc.updatedAt : null;
  }
  async putCircuit(doc: CircuitDoc) {
    this.circuits.set(doc.id, { doc: structuredClone(doc), ts: ++this.clock });
    this.tombstones.delete(doc.id);
  }
  async putSession(doc: SessionDoc, chunks: TraceChunkDoc[]) {
    this.chunks.set(doc.id, structuredClone(chunks));
    this.sessions.set(doc.id, { doc: structuredClone(doc), ts: ++this.clock });
    this.tombstones.delete(doc.id);
  }
  async deleteRecord(t: RemoteTombstone) {
    (t.kind === 'circuit' ? this.circuits : this.sessions).delete(t.id);
    this.chunks.delete(t.id);
    this.tombstones.set(t.id, { t, ts: ++this.clock });
  }
  async changesSince(cursor: number): Promise<RemoteChanges> {
    let max = cursor;
    const pick = <T,>(m: Map<string, { ts: number } & T>) => [...m.values()].filter((r) => r.ts > cursor).map((r) => ((max = Math.max(max, r.ts)), r));
    return {
      circuits: pick(this.circuits).map((r) => structuredClone(r.doc)),
      sessions: pick(this.sessions).map((r) => ({ doc: structuredClone(r.doc), chunks: structuredClone(this.chunks.get(r.doc.id) ?? []) })),
      tombstones: pick(this.tombstones).map((r) => r.t),
      cursor: max,
    };
  }
}

function makeCircuit(): Circuit {
  const g: LonLat[] = [];
  for (let i = 0; i <= 10; i++) g.push([14.42 + i * 0.0004, 50.08]);
  for (let i = 1; i <= 5; i++) g.push([14.424, 50.08 + i * 0.0004]);
  for (let i = 1; i <= 10; i++) g.push([14.424 - i * 0.0004, 50.082]);
  for (let i = 1; i <= 5; i++) g.push([14.42, 50.082 - i * 0.0004]);
  const track = TrackModel.fromCoordinates(g, true);
  return {
    id: 'c1', name: 'Loop', kind: 'closed', origin: 'routed', geometry: g, waypoints: [g[0], g[15]],
    routing: { provider: 'osrm', profile: 'driving', warnings: [] }, startLine: perpendicularLine(track, 30), finishLine: null,
    sectors: [perpendicularLine(track, 600)], lengthM: track.length, elevation: [{ d: 0, elevation: 230.5 }], createdAt: 1, updatedAt: 10,
  };
}

function makeSession(c: Circuit, id: string, hz = 2): Session {
  const track = TrackModel.fromCoordinates(c.geometry, true);
  const engine = new SessionEngine(c);
  const samples = simulateDrive(track, constantSpeedProfile(track, 20), track.length * 3, { noiseM: 1, hz, seed: 4 });
  for (const s of samples) engine.push(s);
  return { id, circuitId: c.id, circuitName: c.name, source: 'gps', startedAt: samples[0].t, endedAt: samples.at(-1)!.t, laps: [...engine.laps], marks: [], reference: null, updatedAt: 20 };
}

/** Switches to another "device": a fresh, empty IndexedDB. */
async function newDevice() {
  await closeDbForTests();
  globalThis.indexedDB = new IDBFactory();
}

beforeEach(newDevice);
afterEach(closeDbForTests);

describe('cloud codec', () => {
  it('round-trips circuits and sessions exactly (no rounding)', () => {
    const c = makeCircuit();
    expect(decodeCircuit(encodeCircuit(c))).toEqual(c);
    const s = makeSession(c, 's1');
    const { doc, chunks } = encodeSession(s);
    const back = decodeSession(doc, chunks);
    expect(back.laps.map((l) => l.timeMs)).toEqual(s.laps.map((l) => l.timeMs));
    expect(back.laps[0].trace[5]).toEqual(s.laps[0].trace[5]);
    expect(back.laps[0].trace.length).toBe(s.laps[0].trace.length);
  });

  it('splits long traces into chunks under the document size limit', () => {
    const c = makeCircuit();
    const s = makeSession(c, 's1', 50); // dense trace
    const longest = Math.max(...s.laps.map((l) => l.trace.length));
    const { doc, chunks } = encodeSession(s);
    expect(longest).toBeGreaterThan(TRACE_CHUNK_POINTS / 2);
    for (const ch of chunks) expect(ch.data.length).toBeLessThan(900_000);
    expect(decodeSession(doc, chunks).laps.map((l) => l.trace.length)).toEqual(s.laps.map((l) => l.trace.length));
  });

  it('refuses a session whose trace chunks are from another upload', () => {
    const s = makeSession(makeCircuit(), 's1');
    const { doc, chunks } = encodeSession(s);
    expect(() => decodeSession({ ...doc, traceVersion: 999 }, chunks)).toThrow(/trace chunks/);
  });
});

describe('cloud sync between devices', () => {
  it('laps recorded on the phone appear on the computer', async () => {
    const cloud = new MemoryCloud();
    const c = makeCircuit();
    const s = makeSession(c, 's1');
    // phone
    await saveCircuit(c, { touch: false });
    await saveSession(s, { touch: false });
    expect((await runSync(cloud, 'u1')).uploaded).toBe(2);
    // computer
    await newDevice();
    const r = await runSync(cloud, 'u1');
    expect(r.downloaded).toBe(2);
    expect((await getCircuit('c1'))?.name).toBe('Loop');
    const got = await getSession('s1');
    expect(got?.laps.map((l) => l.timeMs)).toEqual(s.laps.map((l) => l.timeMs));
    expect(got?.laps[1].trace).toEqual(s.laps[1].trace);
    // Nothing more to do on a second sync.
    expect(await runSync(cloud, 'u1')).toEqual({ uploaded: 0, downloaded: 0, deleted: 0, skipped: 0 });
  });

  it('does not upload a session that is still being recorded', async () => {
    const cloud = new MemoryCloud();
    const c = makeCircuit();
    await saveCircuit(c);
    await saveSession({ ...makeSession(c, 'live'), endedAt: null });
    await setActiveSession({ sessionId: 'live', circuitId: c.id, source: 'gps', startedAt: 1, marks: [], reference: null, updatedAt: 1 });
    await runSync(cloud, 'u1');
    expect(cloud.sessions.has('live')).toBe(false);
  });

  it('propagates deletions without bouncing them back', async () => {
    const cloud = new MemoryCloud();
    const c = makeCircuit();
    await saveCircuit(c);
    await saveSession(makeSession(c, 's1'));
    await runSync(cloud, 'u1');
    // computer gets it, then deletes it
    await newDevice();
    await runSync(cloud, 'u1');
    await deleteSession('s1');
    await runSync(cloud, 'u1');
    expect(cloud.sessions.has('s1')).toBe(false);
    // phone (fresh copy of its data for the test) learns about the deletion
    await newDevice();
    await saveCircuit(c);
    await saveSession({ ...makeSession(c, 's1'), updatedAt: 20 }, { touch: false });
    const r = await runSync(cloud, 'u1');
    expect(r.deleted).toBe(1);
    expect(await getSession('s1')).toBeUndefined();
    const tsBefore = cloud.tombstones.get('s1')?.ts;
    await runSync(cloud, 'u1');
    expect(cloud.tombstones.get('s1')?.ts).toBe(tsBefore); // not re-uploaded
  });

  it('keeps the newer version when both devices changed a circuit', async () => {
    const cloud = new MemoryCloud();
    await saveCircuit({ ...makeCircuit(), name: 'Old', updatedAt: 100 }, { touch: false });
    await runSync(cloud, 'u1');
    await cloud.putCircuit(encodeCircuit({ ...makeCircuit(), name: 'Renamed on PC', updatedAt: 200 }));
    await saveCircuit({ ...makeCircuit(), name: 'Renamed on phone earlier', updatedAt: 150 }, { touch: false });
    await runSync(cloud, 'u1');
    expect((await getCircuit('c1'))?.name).toBe('Renamed on PC');
    expect(decodeCircuit(cloud.circuits.get('c1')!.doc).name).toBe('Renamed on PC');
  });

  it('keeps accounts apart', async () => {
    const cloud = new MemoryCloud();
    await saveCircuit(makeCircuit());
    await runSync(cloud, 'u1');
    // Sync state is per user: a second account on the same device starts from scratch.
    const other = new MemoryCloud();
    const r = await runSync(other, 'u2');
    expect(r.uploaded).toBe(1);
    expect(await listSessions()).toHaveLength(0);
  });
});
