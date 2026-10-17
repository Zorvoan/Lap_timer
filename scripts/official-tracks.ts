/**
 * Admin tool for official leaderboard tracks (Firestore `featured/{id}`), run by GitHub Actions
 * (`.github/workflows/official-tracks.yml`) with the FIREBASE_SERVICE_ACCOUNT secret, or locally:
 *
 *   FIREBASE_SERVICE_ACCOUNT="$(cat key.json)" npx tsx scripts/official-tracks.ts inspect halenkovice
 *
 * Commands (also read from scripts/official-tracks.job.json when no arguments are given):
 *   inspect <text>     Circuits of any user whose name contains <text>: lengths, lines, overlap.
 *   publish <spec>     Publishes circuits as official tracks; see {@link PublishSpec}.
 *   pair <spec>        A hill climb and its downhill over the same exact distance; see {@link PairSpec}.
 *   elevation [all]    Adds an elevation profile to official tracks that have none (or to all).
 *
 * The service account needs the "Cloud Datastore User" role. It bypasses the security rules,
 * so the output never prints more than the matched circuits' own summary.
 */
import { readFileSync } from 'node:fs';
import { TrackModel, bearingDeg, distanceMeters, lineAlong, type Circuit, type ElevationPoint, type LonLat } from '../packages/core/src/index';
import { sprintPair, trimSprint, type SprintShape } from '../packages/core/src/trim';
import { decodeCircuit, decodeSession, encodeCircuit, type CircuitDoc, type SessionDoc, type TraceChunkDoc } from '../apps/web/src/lib/cloud/codec';
import { trackingGaps } from '../apps/web/src/lib/cloud/leaderboard';
import { accessToken } from './lib/google';

const PROJECT = process.env.FIREBASE_PROJECT ?? 'laptimer-okwph';
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;

// ---------------------------------------------------------------- Firestore REST

type Value = Record<string, unknown>;

function fromValue(v: Value): unknown {
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('timestampValue' in v) return v.timestampValue;
  if ('arrayValue' in v) return ((v.arrayValue as { values?: Value[] }).values ?? []).map(fromValue);
  if ('mapValue' in v) return fromFields((v.mapValue as { fields?: Record<string, Value> }).fields ?? {});
  throw new Error(`Unsupported value ${JSON.stringify(v)}`);
}
const fromFields = (f: Record<string, Value>) => Object.fromEntries(Object.entries(f).map(([k, v]) => [k, fromValue(v)]));
function toValue(x: unknown): Value {
  if (x === null || x === undefined) return { nullValue: null };
  if (typeof x === 'string') return { stringValue: x };
  if (typeof x === 'boolean') return { booleanValue: x };
  if (typeof x === 'number') return Number.isInteger(x) && Math.abs(x) < 2 ** 53 ? { integerValue: String(x) } : { doubleValue: x };
  if (Array.isArray(x)) return { arrayValue: { values: x.map(toValue) } };
  return { mapValue: { fields: toFields(x as Record<string, unknown>) } };
}
const toFields = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, toValue(v)]));

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Firestore REST JSON
async function api(token: string, method: string, url: string, body?: unknown): Promise<any> {
  const res = await fetch(url, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${url.replace(BASE, '')} → HTTP ${res.status}: ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

async function listDocs(token: string, path: string): Promise<{ id: string; data: Record<string, unknown> }[]> {
  const out: { id: string; data: Record<string, unknown> }[] = [];
  let pageToken = '';
  do {
    const page = await api(token, 'GET', `${BASE}/${path}?pageSize=300&showMissing=true${pageToken ? `&pageToken=${pageToken}` : ''}`);
    for (const d of page.documents ?? []) out.push({ id: d.name.split('/').pop(), data: d.fields ? fromFields(d.fields) : {} });
    pageToken = page.nextPageToken ?? '';
  } while (pageToken);
  return out;
}

interface Owned {
  uid: string;
  circuit: Circuit;
}

async function allCircuits(token: string): Promise<Owned[]> {
  const out: Owned[] = [];
  for (const u of await listDocs(token, 'users')) {
    for (const d of await listDocs(token, `users/${u.id}/circuits`)) {
      if (!d.data.id) continue;
      try {
        out.push({ uid: u.id, circuit: decodeCircuit(d.data as unknown as CircuitDoc) });
      } catch (e) {
        console.warn(`skipping undecodable circuit ${d.id}: ${e instanceof Error ? e.message : e}`);
      }
    }
  }
  return out;
}

const norm = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
const km = (m: number) => `${(m / 1000).toFixed(3)} km`;
const ll = (p: { lat: number; lon: number }) => `${p.lat.toFixed(5)},${p.lon.toFixed(5)}`;

// ---------------------------------------------------------------- commands

function describe(c: Circuit): string[] {
  const track = TrackModel.fromCoordinates(c.geometry, c.kind === 'closed');
  const s = lineAlong(track, c.startLine);
  const f = c.finishLine ? lineAlong(track, c.finishLine) : null;
  const elev = c.elevation?.length ? `${c.elevation[0].elevation.toFixed(0)} m → ${c.elevation.at(-1)!.elevation.toFixed(0)} m` : 'no profile';
  return [
    `  kind ${c.kind}, origin ${c.origin}, geometry ${km(track.length)}, stored lengthM ${km(c.lengthM)}, ${c.sectors.length} sector line(s)`,
    `  start line at ${s === null ? 'NOT ON ROUTE' : km(s)} (${ll(track.latLonAt(s ?? 0))}), finish line at ${f === null ? '—' : km(f)}${f !== null ? ` (${ll(track.latLonAt(f))})` : ''}`,
    `  start→finish ${s !== null && f !== null ? km(f - s) : '—'}, elevation ${elev}`,
    `  route starts ${ll(track.latLonAt(0))}, ends ${ll(track.latLonAt(track.length))}`,
  ];
}

/** Share of b's vertices lying within `tolM` of a's centreline. */
function overlap(a: Circuit, b: Circuit, tolM = 25): number {
  const ta = TrackModel.fromCoordinates(a.geometry, a.kind === 'closed');
  const near = b.geometry.filter(([lon, lat]) => ta.nearest(ta.toXY({ lat, lon })).lateral <= tolM).length;
  return near / b.geometry.length;
}

async function inspect(token: string, text: string) {
  const all = await allCircuits(token);
  const featured = await listDocs(token, 'featured');
  const matches = all.filter((o) => norm(o.circuit.name).includes(norm(text)));
  console.log(`${matches.length} circuit(s) matching "${text}" (of ${all.length}); ${featured.length} official track(s) now.`);
  for (const o of matches) {
    console.log(`\n"${o.circuit.name}"  id ${o.circuit.id}  owner ${o.uid.slice(0, 6)}…  ${featured.some((f) => f.id === o.circuit.id) ? '(already official)' : ''}`);
    for (const line of describe(o.circuit)) console.log(line);
  }
  // The same owners' other circuits (names only), to spot ones named differently.
  for (const uid of new Set(matches.map((m) => m.uid))) {
    console.log(`\nAll circuits of owner ${uid.slice(0, 6)}…:`);
    for (const o of all.filter((x) => x.uid === uid)) console.log(`  "${o.circuit.name}"  ${o.circuit.kind}  ${km(o.circuit.lengthM)}  updated ${new Date(o.circuit.updatedAt).toISOString()}`);
  }
  for (let i = 0; i < matches.length; i++)
    for (let j = 0; j < matches.length; j++)
      if (i !== j) console.log(`overlap: ${(overlap(matches[i].circuit, matches[j].circuit) * 100).toFixed(0)}% of "${matches[j].circuit.name}" lies on "${matches[i].circuit.name}"`);
}

/**
 * Every synced drive on one track, to see why a time is missing from its leaderboard: per lap the
 * time, validity and flags. Drivers are numbered, never named (this log is public).
 */
async function laps(token: string, trackId: string) {
  const entries = new Set((await listDocs(token, `leaderboards/${trackId}/entries`)).map((e) => e.id));
  let driver = 0;
  for (const u of await listDocs(token, 'users')) {
    const drives = (await listDocs(token, `users/${u.id}/sessions`)).filter((d) => d.data.circuitId === trackId);
    if (!drives.length) continue;
    console.log(`\ndriver ${++driver} (${entries.has(u.id) ? 'on' : 'NOT on'} the leaderboard): ${drives.length} drive(s)`);
    for (const d of drives.sort((a, b) => Number(a.data.startedAt) - Number(b.data.startedAt))) {
      const chunks = (await listDocs(token, `users/${u.id}/sessions/${d.id}/traces`)).map((c) => c.data as unknown as TraceChunkDoc);
      const s = decodeSession(d.data as unknown as SessionDoc, chunks);
      console.log(`  ${new Date(s.startedAt).toISOString()} ${s.source} ${s.endedAt === null ? 'NOT ENDED' : 'ended'}, ${s.laps.length} lap(s)`);
      for (const l of s.laps) {
        const g = trackingGaps(l);
        const speeds = l.trace.map((p) => p.v).filter((v): v is number => v !== null);
        console.log(`    lap ${l.lap}: ${(l.timeMs / 1000).toFixed(3)} s, ${l.valid ? 'valid' : 'INVALID'}, ${km(l.distanceM)}, flags [${l.flags.join(', ')}]`);
        console.log(`      ${l.trace.length} points, ${g.count} gap(s) > 60 m covering ${g.gapM.toFixed(0)} m, worst gap crossed at ${g.worstRatio.toFixed(2)}× the speed around it; avg ${(l.avgSpeedMs * 3.6).toFixed(0)} km/h, max ${speeds.length ? (Math.max(...speeds) * 3.6).toFixed(0) : '?'} km/h`);
      }
    }
  }
}

/**
 * Publishes circuits as official tracks, appended after the existing ones.
 * `lengthM` trims sprint routes so the start→finish distance is exactly that long (the finish
 * line is moved; the start line stays where the creator put it).
 */
interface PublishSpec {
  tracks: { match: string; name: string; lengthM?: number }[];
}

async function publish(token: string, spec: PublishSpec) {
  const all = await allCircuits(token);
  const featured = await listDocs(token, 'featured');
  let order = Math.max(-1, ...featured.map((f) => Number(f.data.featuredOrder ?? -1))) + 1;
  const now = Date.now();
  for (const t of spec.tracks) {
    const matches = all.filter((o) => norm(o.circuit.name) === norm(t.match));
    if (matches.length !== 1) throw new Error(`"${t.match}": ${matches.length ? `${matches.length} circuits with this name` : 'not found'}`);
    const { uid, circuit } = matches[0];
    const shaped = t.lengthM ? trimSprint(circuit, t.lengthM) : circuit;
    const existing = featured.find((f) => f.id === circuit.id);
    const doc: Record<string, unknown> = {
      ...encodeCircuit({ ...shaped, name: t.name, origin: 'imported', updatedAt: now }),
      featuredOrder: existing ? Number(existing.data.featuredOrder) : order++,
      featuredBy: uid,
    };
    await api(token, 'PATCH', `${BASE}/featured/${circuit.id}`, { fields: toFields(doc) });
    console.log(`\nPublished "${t.name}" (featured/${circuit.id}, order ${doc.featuredOrder})`);
    for (const line of describe(shaped)) console.log(line);
  }
}

// ---------------------------------------------------------------- hill climb + downhill pair

const OSRM = 'https://router.project-osrm.org';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const angleDiff = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);

async function osrmRoute(points: LonLat[]): Promise<LonLat[] | null> {
  await sleep(1100); // public demo server: at most 1 request per second
  const coords = points.map(([lon, lat]) => `${lon.toFixed(6)},${lat.toFixed(6)}`).join(';');
  const res = await fetch(`${OSRM}/route/v1/driving/${coords}?overview=full&geometries=geojson&continue_straight=true`);
  if (!res.ok) return null;
  const body = (await res.json()) as { code: string; routes?: { geometry: { coordinates: LonLat[] } }[] };
  return body.code === 'Ok' ? (body.routes?.[0]?.geometry.coordinates ?? null) : null;
}

/** Elevation every ~25 m along a route (Open-Meteo, ~90 m terrain model). */
async function elevationProfile(geometry: LonLat[]): Promise<ElevationPoint[]> {
  const track = TrackModel.fromCoordinates(geometry, false);
  const n = Math.min(100, Math.max(2, Math.ceil(track.length / 25) + 1));
  const ds = Array.from({ length: n }, (_, i) => (track.length * i) / (n - 1));
  const pts = ds.map((d) => track.latLonAt(d));
  const url = `https://api.open-meteo.com/v1/elevation?latitude=${pts.map((p) => p.lat.toFixed(5)).join(',')}&longitude=${pts.map((p) => p.lon.toFixed(5)).join(',')}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Elevation request failed: HTTP ${res.status}`);
  const body = (await res.json()) as { elevation: number[] };
  return ds.map((d, i) => ({ d, elevation: body.elevation[i] }));
}

/**
 * Road continuing beyond one end of a route, at least `needM` long, from the routing service.
 * Tries destinations ahead in the direction of travel (and slightly to either side) and keeps
 * the first route that carries straight on along the road instead of turning back.
 */
async function extendRoad(track: TrackModel, end: 'start' | 'finish', needM: number): Promise<LonLat[] | null> {
  const atEnd = end === 'finish' ? track.length : 0;
  const tip = track.latLonAt(atEnd);
  const inward = track.latLonAt(end === 'finish' ? Math.max(0, track.length - 40) : Math.min(track.length, 40));
  const outBearing = bearingDeg(inward, tip);
  const frame = track.frame;
  for (const dist of [350, 700]) {
    for (const offset of [0, 30, -30, 60, -60]) {
      const b = ((outBearing + offset) * Math.PI) / 180;
      const tipXY = frame.toXY(tip);
      const target = frame.toLatLon({ x: tipXY.x + dist * Math.sin(b), y: tipXY.y + dist * Math.cos(b) });
      const tipLL: LonLat = [tip.lon, tip.lat];
      const targetLL: LonLat = [target.lon, target.lat];
      const raw = await osrmRoute(end === 'finish' ? [tipLL, targetLL] : [targetLL, tipLL]);
      if (!raw || raw.length < 2) continue;
      // Orient away from the route, then check it carries on along the road.
      const away = end === 'finish' ? raw : [...raw].reverse();
      const ext = TrackModel.fromCoordinates(away, false, { minLengthM: 1 });
      if (ext.length < needM) continue;
      const startsAtTip = distanceMeters(ext.latLonAt(0), tip) < 15;
      const heading = bearingDeg(ext.latLonAt(0), ext.latLonAt(Math.min(40, ext.length)));
      const backtracks = [needM * 0.5, needM].some((d) => track.nearest(track.toXY(ext.latLonAt(d))).lateral < 10);
      if (!startsAtTip || angleDiff(heading, outBearing) > 50 || backtracks) continue;
      const cut: LonLat[] = [];
      for (let i = 0; i < ext.coords.length && ext.cum[i] <= needM + 30; i++) cut.push(ext.coords[i]);
      console.log(`  ${end}: road continues on a heading of ${heading.toFixed(0)}° (route heading ${outBearing.toFixed(0)}°), took ${Math.round(Math.min(ext.length, needM + 30))} m`);
      return end === 'finish' ? cut : cut.reverse();
    }
  }
  return null;
}

/**
 * A hill climb (`up`) and its downhill (`down`) published as official tracks over exactly
 * `lengthM` of the same road. The up run's lines are kept where possible; missing road is added
 * at `extendAt` ('finish', 'start' or 'auto' = finish, then start). `publish: false` only reports.
 */
interface PairSpec {
  up: { match: string; name: string };
  down: { match: string; name: string };
  lengthM: number;
  extendAt?: 'finish' | 'start' | 'auto';
  publish?: boolean;
}

async function pair(token: string, spec: PairSpec) {
  const all = await allCircuits(token);
  const find = (match: string) => {
    const m = all.filter((o) => norm(o.circuit.name) === norm(match));
    if (m.length !== 1) throw new Error(`"${match}": ${m.length ? `${m.length} circuits with this name` : 'not found'}`);
    return m[0];
  };
  const up = find(spec.up.match);
  const down = find(spec.down.match);
  const runout = 15;
  let geometry = up.circuit.geometry;
  let track = TrackModel.fromCoordinates(geometry, false);
  const a = lineAlong(track, up.circuit.startLine);
  const b = up.circuit.finishLine ? lineAlong(track, up.circuit.finishLine) : null;
  if (a === null || b === null) throw new Error(`"${up.circuit.name}" needs a start and a finish line on its route.`);
  const missing = spec.lengthM - (b - a);
  console.log(`"${up.circuit.name}": start→finish ${km(b - a)}, ${missing > 0 ? `${Math.round(missing)} m short` : `${Math.round(-missing)} m too long`} of ${km(spec.lengthM)}`);

  let startAlong = a;
  if (missing > 0) {
    const order = spec.extendAt === 'start' ? ['start'] : spec.extendAt === 'finish' ? ['finish'] : ['finish', 'start'];
    let done = false;
    for (const end of order as ('start' | 'finish')[]) {
      const have = end === 'finish' ? track.length - b : a;
      const need = missing + runout - have + 5;
      const ext = need > 0 ? await extendRoad(track, end, need) : [];
      if (!ext) {
        console.log(`  ${end}: no road found that carries straight on`);
        continue;
      }
      if (end === 'finish') geometry = [...geometry, ...ext.slice(1)];
      else {
        geometry = [...ext.slice(0, -1), ...geometry];
        const added = TrackModel.fromCoordinates(geometry, false).length - track.length;
        startAlong = a + added - missing;
      }
      done = true;
      break;
    }
    if (!done) throw new Error('Could not extend the road at either end.');
    track = TrackModel.fromCoordinates(geometry, false);
  }

  const shapes = sprintPair(geometry, startAlong, spec.lengthM, runout);
  const profile = await elevationProfile(shapes.up.geometry);
  const len = TrackModel.fromCoordinates(shapes.up.geometry, false).length;
  const downProfile = [...profile].reverse().map((p) => ({ d: len - p.d, elevation: p.elevation }));
  const at = (d: number) => profile.reduce((best, p) => (Math.abs(p.d - d) < Math.abs(best.d - d) ? p : best)).elevation;
  const midOf = (s: SprintShape, which: 'startLine' | 'finishLine') => ll({ lat: (s[which].a.lat + s[which].b.lat) / 2, lon: (s[which].a.lon + s[which].b.lon) / 2 });
  console.log(`\nUp   "${spec.up.name}": start ${midOf(shapes.up, 'startLine')} (${at(runout).toFixed(0)} m) → finish ${midOf(shapes.up, 'finishLine')} (${at(runout + spec.lengthM).toFixed(0)} m)`);
  console.log(`Down "${spec.down.name}": start ${midOf(shapes.down, 'startLine')} → finish ${midOf(shapes.down, 'finishLine')}`);
  console.log(`Climb ${(at(runout + spec.lengthM) - at(runout)).toFixed(0)} m over ${km(spec.lengthM)}`);

  if (!spec.publish) {
    console.log('\nDry run: nothing published (set "publish": true).');
    return;
  }
  const featured = await listDocs(token, 'featured');
  let order = Math.max(-1, ...featured.map((f) => Number(f.data.featuredOrder ?? -1))) + 1;
  const now = Date.now();
  for (const [o, shape, name, elevation] of [
    [up, shapes.up, spec.up.name, profile],
    [down, shapes.down, spec.down.name, downProfile],
  ] as const) {
    const existing = featured.find((f) => f.id === o.circuit.id);
    const circuit: Circuit = {
      ...o.circuit,
      ...shape,
      name,
      kind: 'sprint',
      origin: 'imported',
      waypoints: [],
      sectors: [],
      elevation: [...elevation],
      routing: o.circuit.routing ? { ...o.circuit.routing, warnings: [] } : null,
      updatedAt: now,
    };
    const doc = { ...encodeCircuit(circuit), featuredOrder: existing ? Number(existing.data.featuredOrder) : order++, featuredBy: o.uid };
    await api(token, 'PATCH', `${BASE}/featured/${circuit.id}`, { fields: toFields(doc) });
    console.log(`\nPublished "${name}" (featured/${circuit.id}, order ${doc.featuredOrder})`);
    for (const line of describe(circuit)) console.log(line);
  }
}

/**
 * Gives official tracks an elevation profile (for "+130 m climb" and the profile chart). Only the
 * elevation and updatedAt fields change, so every app refreshes its copy and nothing else moves.
 */
async function addElevation(token: string, all: boolean) {
  const featured = await listDocs(token, 'featured');
  const now = Date.now();
  for (const f of featured) {
    const circuit = decodeCircuit(f.data as unknown as CircuitDoc);
    if (circuit.elevation?.length && !all) continue;
    const profile = await elevationProfile(circuit.geometry);
    const ys = profile.map((p) => p.elevation);
    const up = ys.slice(1).reduce((s, y, i) => s + Math.max(0, y - ys[i]), 0);
    const down = ys.slice(1).reduce((s, y, i) => s + Math.max(0, ys[i] - y), 0);
    const doc = encodeCircuit({ ...circuit, elevation: profile, updatedAt: now });
    await api(token, 'PATCH', `${BASE}/featured/${f.id}?updateMask.fieldPaths=elevation&updateMask.fieldPaths=updatedAt`, {
      fields: toFields({ elevation: doc.elevation, updatedAt: now }),
    });
    console.log(`"${circuit.name}": ${profile.length} points, ${ys[0].toFixed(0)} m → ${ys.at(-1)!.toFixed(0)} m, up ${up.toFixed(0)} m, down ${down.toFixed(0)} m`);
    await sleep(1100); // the free elevation API: keep it gentle
  }
}

async function main() {
  let [command, ...args] = process.argv.slice(2);
  let spec: unknown = null;
  if (!command) {
    const job = JSON.parse(readFileSync(new URL('./official-tracks.job.json', import.meta.url), 'utf8')) as { command: string; args?: string[]; spec?: unknown };
    command = job.command;
    args = job.args ?? [];
    spec = job.spec ?? null;
  }
  const token = await accessToken();
  if (command === 'inspect') await inspect(token, args.join(' '));
  else if (command === 'publish') await publish(token, (spec ?? JSON.parse(args[0])) as PublishSpec);
  else if (command === 'pair') await pair(token, (spec ?? JSON.parse(args[0])) as PairSpec);
  else if (command === 'laps') await laps(token, args[0]);
  else if (command === 'elevation') await addElevation(token, args[0] === 'all');
  else throw new Error(`Unknown command "${command}".`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
