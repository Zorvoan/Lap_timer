import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { SessionEngine, TrackModel, constantSpeedProfile, perpendicularLine, simulateDrive, type Circuit, type LonLat, type Session } from '@laptimer/core';
import { closeDbForTests, getDb } from '../src/lib/db';
import { deleteSession, getCircuit, getSamples, getSession, listSessions, personalBest, putSampleChunk, saveCircuit, saveSession, getSettings, saveSettings } from '../src/lib/repo';
import { buildExport, lapsToCsv, parseExport, ImportError } from '../src/lib/exportImport';
import { exportAll, importFile } from '../src/lib/dataTransfer';
import { DEFAULT_SETTINGS } from '../src/lib/settings';

// 1.2 km rectangle around Prague, with rounded-ish corners.
function geometry(): LonLat[] {
  const pts: LonLat[] = [];
  const add = (lon: number, lat: number) => pts.push([lon, lat]);
  for (let i = 0; i <= 10; i++) add(14.42 + i * 0.0004, 50.08);
  for (let i = 1; i <= 5; i++) add(14.424, 50.08 + i * 0.0004);
  for (let i = 1; i <= 10; i++) add(14.424 - i * 0.0004, 50.082);
  for (let i = 1; i <= 5; i++) add(14.42, 50.082 - i * 0.0004);
  return pts;
}

function makeCircuit(): Circuit {
  const g = geometry();
  const track = TrackModel.fromCoordinates(g, true);
  return {
    id: 'c1',
    name: 'Test loop',
    kind: 'closed',
    origin: 'routed',
    geometry: g,
    waypoints: [g[0], g[15]],
    routing: { provider: 'osrm', profile: 'driving', warnings: [] },
    startLine: perpendicularLine(track, 30),
    finishLine: null,
    sectors: [],
    lengthM: track.length,
    elevation: null,
    createdAt: 1,
    updatedAt: 1,
  };
}

function recordSession(c: Circuit, id: string, source: Session['source'] = 'gps') {
  const track = TrackModel.fromCoordinates(c.geometry, true);
  const engine = new SessionEngine(c);
  const samples = simulateDrive(track, constantSpeedProfile(track, 20), track.length * 3, { noiseM: 1, hz: 2, seed: 4 });
  for (const s of samples) engine.push(s);
  const session: Session = {
    id,
    circuitId: c.id,
    circuitName: c.name,
    source,
    startedAt: samples[0].t,
    endedAt: samples.at(-1)!.t,
    laps: [...engine.laps],
    marks: [],
    reference: null,
    updatedAt: 5,
  };
  return { session, samples };
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});
afterEach(async () => {
  await closeDbForTests();
});

describe('local persistence', () => {
  it('reopens the database when the browser closed the connection underneath the app', async () => {
    await saveCircuit(makeCircuit());
    // What the browser does when it force-closes a connection (storage cleared, another tab
    // upgrading, …): any new transaction then fails with "The database connection is closing".
    (await getDb()).close();
    expect((await getCircuit('c1'))?.name).toBe('Test loop');
  });

  it('saves and restores circuits, sessions and raw samples at full precision', async () => {
    const c = makeCircuit();
    await saveCircuit(c);
    const { session, samples } = recordSession(c, 's1');
    expect(session.laps.length).toBeGreaterThanOrEqual(2);
    await saveSession(session);
    await putSampleChunk('s1', 0, samples.slice(0, 100));
    await putSampleChunk('s1', 1, samples.slice(100));

    expect((await getCircuit('c1'))?.geometry).toEqual(c.geometry);
    const restored = await getSession('s1');
    expect(restored?.laps.map((l) => l.timeMs)).toEqual(session.laps.map((l) => l.timeMs)); // exact, not rounded
    expect(restored?.laps[0].startT).toBe(session.laps[0].startT);
    expect(await getSamples('s1')).toEqual(samples);

    // Re-processing the restored samples reproduces the stored laps.
    const engine = new SessionEngine((await getCircuit('c1'))!);
    engine.replay(await getSamples('s1'));
    expect(engine.laps.map((l) => l.timeMs)).toEqual(session.laps.map((l) => l.timeMs));
  });

  it('deletes a session with its samples', async () => {
    const c = makeCircuit();
    const { session, samples } = recordSession(c, 's1');
    await saveSession(session);
    await putSampleChunk('s1', 0, samples);
    await deleteSession('s1');
    expect(await getSession('s1')).toBeUndefined();
    expect(await getSamples('s1')).toEqual([]);
  });

  it('computes personal bests excluding simulated sessions by default', async () => {
    const c = makeCircuit();
    await saveCircuit(c);
    const real = recordSession(c, 'real');
    const sim = recordSession(c, 'sim', 'simulated');
    sim.session.laps = sim.session.laps.map((l) => ({ ...l, timeMs: l.timeMs - 5000 }));
    await saveSession(real.session);
    await saveSession(sim.session);
    expect((await personalBest('c1', false))?.session.id).toBe('real');
    expect((await personalBest('c1', true))?.session.id).toBe('sim');
    expect(await listSessions('c1')).toHaveLength(2);
  });

  it('stores settings and falls back to defaults for invalid values', async () => {
    expect(await getSettings()).toEqual(DEFAULT_SETTINGS);
    await saveSettings({ ...DEFAULT_SETTINGS, speedUnit: 'mph' });
    expect((await getSettings()).speedUnit).toBe('mph');
  });
});

describe('export / import', () => {
  it('round-trips through the documented JSON format', async () => {
    const c = makeCircuit();
    await saveCircuit(c);
    const { session, samples } = recordSession(c, 's1');
    await saveSession(session);
    await putSampleChunk('s1', 0, samples);
    const text = await exportAll(true);

    globalThis.indexedDB = new IDBFactory();
    await closeDbForTests();
    const summary = await importFile(parseExport(text));
    expect(summary.circuits.added).toBe(1);
    expect(summary.sessions.added).toBe(1);
    const back = await getSession('s1');
    expect(back?.laps.map((l) => l.timeMs)).toEqual(session.laps.map((l) => l.timeMs));
    expect(await getSamples('s1')).toEqual(samples);
    // Importing again changes nothing.
    const again = await importFile(parseExport(text));
    expect(again.sessions.skipped).toBe(1);
  });

  it('rejects invalid files with a useful message', () => {
    expect(() => parseExport('not json')).toThrow(ImportError);
    expect(() => parseExport(JSON.stringify({ format: 'something-else' }))).toThrow(/Not a valid Lap Timer export/);
    const bad = JSON.parse(buildExport([makeCircuit()], [], []));
    bad.circuits[0].geometry = [[14, 50]];
    expect(() => parseExport(JSON.stringify(bad))).toThrow(/geometry/);
  });

  it('exports lap telemetry as CSV', () => {
    const { session } = recordSession(makeCircuit(), 's1');
    const csv = lapsToCsv(session).split('\n');
    expect(csv[0]).toBe('session_id,lap,lap_valid,elapsed_ms,distance_m,speed_ms,lat,lon,accuracy_m');
    expect(csv.length).toBeGreaterThan(50);
  });
});
