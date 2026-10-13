/**
 * Admin tool for official leaderboard tracks (Firestore `featured/{id}`), run by GitHub Actions
 * (`.github/workflows/official-tracks.yml`) with the FIREBASE_SERVICE_ACCOUNT secret, or locally:
 *
 *   FIREBASE_SERVICE_ACCOUNT="$(cat key.json)" npx tsx scripts/official-tracks.ts inspect halenkovice
 *
 * Commands (also read from scripts/official-tracks.job.json when no arguments are given):
 *   inspect <text>     Circuits of any user whose name contains <text>: lengths, lines, overlap.
 *   publish <spec>     Publishes circuits as official tracks; see {@link PublishSpec}.
 *
 * The service account needs the "Cloud Datastore User" role. It bypasses the security rules,
 * so the output never prints more than the matched circuits' own summary.
 */
import { createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { TrackModel, lineAlong, type Circuit } from '../packages/core/src/index';
import { trimSprint } from '../packages/core/src/trim';

const PROJECT = process.env.FIREBASE_PROJECT ?? 'laptimer-okwph';
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;

// ---------------------------------------------------------------- auth

async function accessToken(): Promise<string> {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT is not set.');
  const key = JSON.parse(raw) as { client_email: string; private_key: string; token_uri?: string };
  const tokenUri = key.token_uri ?? 'https://oauth2.googleapis.com/token';
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ iss: key.client_email, scope: 'https://www.googleapis.com/auth/datastore', aud: tokenUri, iat: now, exp: now + 3600 })}`;
  const signature = createSign('RSA-SHA256').update(unsigned).sign(key.private_key).toString('base64url');
  const res = await fetch(tokenUri, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${signature}` }),
  });
  if (!res.ok) throw new Error(`Token request failed: HTTP ${res.status} ${await res.text()}`);
  return ((await res.json()) as { access_token: string }).access_token;
}

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
      if (d.data.id) out.push({ uid: u.id, circuit: d.data as unknown as Circuit });
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
  for (let i = 0; i < matches.length; i++)
    for (let j = 0; j < matches.length; j++)
      if (i !== j) console.log(`overlap: ${(overlap(matches[i].circuit, matches[j].circuit) * 100).toFixed(0)}% of "${matches[j].circuit.name}" lies on "${matches[i].circuit.name}"`);
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
      ...shaped,
      name: t.name,
      origin: 'imported',
      updatedAt: now,
      featuredOrder: existing ? Number(existing.data.featuredOrder) : order++,
      featuredBy: uid,
    };
    delete doc.serverUpdatedAt;
    await api(token, 'PATCH', `${BASE}/featured/${circuit.id}`, { fields: toFields(doc) });
    console.log(`\nPublished "${t.name}" (featured/${circuit.id}, order ${doc.featuredOrder})`);
    for (const line of describe(shaped)) console.log(line);
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
  else throw new Error(`Unknown command "${command}".`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
