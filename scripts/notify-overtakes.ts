/**
 * "Someone beat your time" push notifications. Run every few minutes by GitHub Actions
 * (`.github/workflows/overtake-notifications.yml`) with the FIREBASE_SERVICE_ACCOUNT secret:
 *
 *   FIREBASE_SERVICE_ACCOUNT="$(cat key.json)" npx tsx scripts/notify-overtakes.ts
 *
 * Each run compares every official track's leaderboard with the places remembered from the run
 * before (Firestore `pushState/overtakes`). A driver who dropped a place because someone else went
 * faster gets a notification on every device that turned them on (`users/{uid}/push/{id}`).
 * Tracks with no new time since the last run cost one read. The first run only remembers places.
 *
 * The service account needs "Cloud Datastore User" and "Firebase Cloud Messaging API Admin".
 * It bypasses the security rules, so the log only ever prints counts: Actions logs are public.
 */
import { accessToken } from './lib/google';

const PROJECT = process.env.FIREBASE_PROJECT ?? 'laptimer-okwph';
const APP_URL = process.env.APP_URL ?? 'https://laptimer-okwph.web.app';
/** With FIRESTORE_EMULATOR_HOST set (local testing), nothing is sent: notes are only counted. */
const EMULATOR = process.env.FIRESTORE_EMULATOR_HOST;
const ROOT = EMULATOR ? `http://${EMULATOR}/v1` : 'https://firestore.googleapis.com/v1';
const BASE = `${ROOT}/projects/${PROJECT}/databases/(default)/documents`;
const STATE = `${BASE}/pushState/overtakes`;
/** New times are looked for a little before the last run, to allow for clock differences. */
const OVERLAP_MS = 5 * 60_000;

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
  return undefined;
}
const fromFields = (f: Record<string, Value>): Record<string, unknown> => Object.fromEntries(Object.entries(f).map(([k, v]) => [k, fromValue(v)]));
function toValue(x: unknown): Value {
  if (x === null || x === undefined) return { nullValue: null };
  if (typeof x === 'string') return { stringValue: x };
  if (typeof x === 'number') return Number.isInteger(x) ? { integerValue: String(x) } : { doubleValue: x };
  return { mapValue: { fields: Object.fromEntries(Object.entries(x as Record<string, unknown>).map(([k, v]) => [k, toValue(v)])) } };
}

let token = '';
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Google REST JSON
async function api(method: string, url: string, body?: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(url, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}

interface Entry {
  uid: string;
  nickname: string;
  timeMs: number;
  submittedAt: string;
}
interface Track {
  id: string;
  name: string;
  stage: number;
}
type Ranks = Record<string, Record<string, number>>;

async function tracks(): Promise<Track[]> {
  const r = await api('GET', `${BASE}/featured?pageSize=100&mask.fieldPaths=name&mask.fieldPaths=featuredOrder`);
  if (r.status !== 200) throw new Error(`Listing official tracks failed: HTTP ${r.status}`);
  return ((r.json.documents ?? []) as { name: string; fields: Record<string, Value> }[]).map((d) => {
    const f = fromFields(d.fields);
    return { id: d.name.split('/').pop()!, name: String(f.name ?? 'a track'), stage: Number(f.featuredOrder ?? -1) + 1 };
  });
}

async function query(trackId: string, q: Record<string, unknown>): Promise<Entry[]> {
  const r = await api('POST', `${BASE}/leaderboards/${trackId}:runQuery`, { structuredQuery: { from: [{ collectionId: 'entries' }], ...q } });
  if (r.status !== 200) throw new Error(`Reading a leaderboard failed: HTTP ${r.status}`);
  return (r.json as { document?: { name: string; fields: Record<string, Value> } }[])
    .filter((x) => x.document)
    .map((x) => {
      const f = fromFields(x.document!.fields);
      return { uid: x.document!.name.split('/').pop()!, nickname: String(f.nickname ?? 'Someone'), timeMs: Number(f.timeMs), submittedAt: String(f.submittedAt ?? '') };
    });
}

const hasNewTimes = async (trackId: string, since: string) =>
  (
    await query(trackId, {
      where: { fieldFilter: { field: { fieldPath: 'submittedAt' }, op: 'GREATER_THAN', value: { timestampValue: since } } },
      select: { fields: [{ fieldPath: 'timeMs' }] },
      limit: 1,
    })
  ).length > 0;

const board = (trackId: string) =>
  query(trackId, {
    select: { fields: ['nickname', 'timeMs', 'submittedAt'].map((fieldPath) => ({ fieldPath })) },
    orderBy: [{ field: { fieldPath: 'timeMs' }, direction: 'ASCENDING' }],
    limit: 1000,
  });

function lapTime(ms: number): string {
  const s = ms / 1000;
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(2).padStart(5, '0')}`;
}

interface Note {
  uid: string;
  title: string;
  body: string;
  url: string;
  tag: string;
}

/** Drivers who lost places since `before`, each with who went past them. */
export function overtakes(track: Track, before: Record<string, number>, entries: Entry[]): Note[] {
  const notes: Note[] = [];
  entries.forEach((e, i) => {
    const was = before[e.uid];
    const now = i + 1;
    if (!was || now <= was) return;
    // Those now ahead who were behind (or not on the board) before: the newest one passed last.
    const passers = entries.slice(0, i).filter((o) => !before[o.uid] || before[o.uid] > was);
    if (!passers.length) return;
    const by = passers.reduce((a, b) => (b.submittedAt > a.submittedAt ? b : a));
    const where = `${track.stage > 0 ? `SS${track.stage} ` : ''}${track.name}`;
    notes.push({
      uid: e.uid,
      title: `${by.nickname} beat your time`,
      body: `${where}: you're now P${now} (was P${was}). ${lapTime(by.timeMs)} vs your ${lapTime(e.timeMs)}.`,
      url: `/tracks/${track.id}`,
      tag: `overtake-${track.id}`,
    });
  });
  return notes;
}

/** Sends one note to every device of its driver; drops tokens FCM no longer knows. */
async function send(note: Note): Promise<{ sent: number; removed: number }> {
  const r = await api('GET', `${BASE}/users/${note.uid}/push?pageSize=20`);
  if (r.status !== 200) return { sent: 0, removed: 0 };
  let sent = 0;
  let removed = 0;
  for (const d of (r.json.documents ?? []) as { name: string; fields: Record<string, Value> }[]) {
    const deviceToken = fromValue(d.fields.token ?? {});
    if (typeof deviceToken !== 'string') continue;
    if (EMULATOR) {
      sent++;
      continue;
    }
    const res = await api('POST', `https://fcm.googleapis.com/v1/projects/${PROJECT}/messages:send`, {
      message: {
        token: deviceToken,
        data: { title: note.title, body: note.body, url: note.url, tag: note.tag },
        webpush: { headers: { Urgency: 'high', TTL: String(24 * 3600) }, fcm_options: { link: `${APP_URL}${note.url}` } },
      },
    });
    if (res.status === 200) sent++;
    else if (res.status === 404 || (res.status === 400 && JSON.stringify(res.json).includes('registration token'))) {
      await api('DELETE', `${ROOT}/${d.name}`);
      removed++;
    } else if (res.status === 403 || res.status === 401) {
      throw new Error(`Sending notifications is not allowed (HTTP ${res.status}). Give the service account the "Firebase Cloud Messaging API Admin" role.`);
    }
  }
  return { sent, removed };
}

/** Whether the service account may send notifications ("Firebase Cloud Messaging API Admin"). */
async function maySend(): Promise<boolean> {
  const r = await api('POST', `https://cloudresourcemanager.googleapis.com/v1/projects/${PROJECT}:testIamPermissions`, { permissions: ['cloudmessaging.messages.create'] });
  return r.status === 200 && (r.json?.permissions ?? []).includes('cloudmessaging.messages.create');
}

async function main() {
  token = EMULATOR
    ? 'owner'
    : await accessToken('https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/firebase.messaging https://www.googleapis.com/auth/cloud-platform');
  if (!EMULATOR && !(await maySend())) {
    // Places are not updated either, so nothing is lost: once allowed, the next run catches up.
    console.log('::warning::Notifications are not sent yet: give the FIREBASE_SERVICE_ACCOUNT service account the "Firebase Cloud Messaging API Admin" role in Google Cloud IAM.');
    return;
  }
  const startedAt = new Date().toISOString();
  const s = await api('GET', STATE);
  if (s.status !== 200 && s.status !== 404) throw new Error(`Reading the last state failed: HTTP ${s.status}`);
  const state = s.status === 200 ? fromFields(s.json.fields ?? {}) : null;
  const ranks: Ranks = (state?.ranks as Ranks) ?? {};
  const since = state?.checkedAt ? new Date(Date.parse(String(state.checkedAt)) - OVERLAP_MS).toISOString() : null;

  let changed = 0;
  let sent = 0;
  let removed = 0;
  let notes = 0;
  const list = await tracks();
  for (const t of list) {
    const before = ranks[t.id];
    if (before && since && !(await hasNewTimes(t.id, since))) continue;
    const entries = await board(t.id);
    if (before) {
      for (const n of overtakes(t, before, entries)) {
        notes++;
        const r = await send(n);
        sent += r.sent;
        removed += r.removed;
      }
    }
    ranks[t.id] = Object.fromEntries(entries.map((e, i) => [e.uid, i + 1]));
    changed++;
  }
  // Tracks no longer official are forgotten.
  for (const id of Object.keys(ranks)) if (!list.some((t) => t.id === id)) delete ranks[id];

  const w = await api('PATCH', STATE, { fields: { checkedAt: { timestampValue: startedAt }, ranks: toValue(ranks) } });
  if (w.status !== 200) throw new Error(`Saving the state failed: HTTP ${w.status}`);
  console.log(`${list.length} tracks checked, ${changed} with new times; ${notes} drivers overtaken, ${sent} notifications sent, ${removed} old devices removed.${state ? '' : ' (First run: places remembered, nothing sent.)'}`);
}

if (process.argv[1]?.endsWith('notify-overtakes.ts')) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : 'Failed.');
    process.exit(1);
  });
}
