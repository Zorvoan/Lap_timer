#!/usr/bin/env node
/**
 * Admin tool: publishes circuits as official leaderboard tracks (Firestore `featured/{id}`).
 *
 * Uses the Google account you are logged into with `firebase login` (project owner), so it
 * bypasses the security rules — run it only on your own machine.
 *
 *   node scripts/feature-circuits.mjs --list
 *       Lists every user's circuits (id, owner uid, name, length). Read-only.
 *   node scripts/feature-circuits.mjs "Komárov" "Troják" ...
 *       Copies the circuits with these names (case/diacritics-insensitive) to featured/{id},
 *       in the given order. The names given here become the official display names.
 *   node scripts/feature-circuits.mjs --remove <circuitId>
 *       Removes an official track (its leaderboard entries stay but are no longer shown).
 */
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const PROJECT = process.env.FIREBASE_PROJECT ?? 'laptimer-okwph';
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;

async function accessToken() {
  const globalRoot = execSync('npm root -g').toString().trim();
  const require = createRequire(pathToFileURL(path.join(globalRoot, 'firebase-tools', 'package.json')));
  const auth = require('./lib/auth.js');
  const account = auth.getGlobalDefaultAccount();
  if (!account?.tokens?.refresh_token) throw new Error('Not logged in: run `firebase login` first.');
  const t = await auth.getAccessToken(account.tokens.refresh_token, []);
  return t.access_token;
}

/** Firestore REST value ↔ plain JS. */
function fromValue(v) {
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('timestampValue' in v) return v.timestampValue;
  if ('arrayValue' in v) return (v.arrayValue.values ?? []).map(fromValue);
  if ('mapValue' in v) return fromFields(v.mapValue.fields ?? {});
  throw new Error(`Unsupported value ${JSON.stringify(v)}`);
}
const fromFields = (f) => Object.fromEntries(Object.entries(f).map(([k, v]) => [k, fromValue(v)]));
function toValue(x) {
  if (x === null || x === undefined) return { nullValue: null };
  if (typeof x === 'string') return { stringValue: x };
  if (typeof x === 'boolean') return { booleanValue: x };
  if (typeof x === 'number') return Number.isInteger(x) && Math.abs(x) < 2 ** 53 ? { integerValue: String(x) } : { doubleValue: x };
  if (Array.isArray(x)) return { arrayValue: { values: x.map(toValue) } };
  return { mapValue: { fields: toFields(x) } };
}
const toFields = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, toValue(v)]));

async function api(token, method, url, body) {
  const res = await fetch(url, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${url} → HTTP ${res.status}: ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

const norm = (s) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();

async function allCircuits(token) {
  const users = await api(token, 'GET', `${BASE}/users?showMissing=true&pageSize=300`);
  const out = [];
  for (const u of users.documents ?? []) {
    const uid = u.name.split('/').pop();
    let pageToken = '';
    do {
      const page = await api(token, 'GET', `${BASE}/users/${uid}/circuits?pageSize=300${pageToken ? `&pageToken=${pageToken}` : ''}`);
      for (const d of page.documents ?? []) out.push({ uid, data: fromFields(d.fields) });
      pageToken = page.nextPageToken ?? '';
    } while (pageToken);
  }
  return out;
}

async function main() {
  const args = process.argv.slice(2);
  const token = await accessToken();
  if (args[0] === '--remove') {
    await api(token, 'DELETE', `${BASE}/featured/${args[1]}`);
    console.log(`Removed featured/${args[1]}`);
    return;
  }
  const circuits = await allCircuits(token);
  if (args[0] === '--list' || args.length === 0) {
    for (const c of circuits) console.log(`${c.data.id}\t${c.uid}\t${(c.data.lengthM / 1000).toFixed(2)} km\t${c.data.kind}\t${c.data.name}`);
    console.log(`${circuits.length} circuit(s).`);
    return;
  }
  const now = Date.now();
  for (const [order, wanted] of args.entries()) {
    const matches = circuits.filter((c) => norm(c.data.name) === norm(wanted));
    if (matches.length !== 1) {
      console.error(`"${wanted}": ${matches.length === 0 ? 'not found' : `${matches.length} circuits with this name — rename duplicates first`}`);
      process.exitCode = 1;
      continue;
    }
    const c = matches[0].data;
    // Official copy: the given name becomes the display name; updatedAt is bumped so every
    // app (including the creator's) replaces its local copy with this version.
    const featured = { ...c, name: wanted, origin: 'imported', updatedAt: now, featuredOrder: order, featuredBy: matches[0].uid };
    delete featured.serverUpdatedAt;
    await api(token, 'PATCH', `${BASE}/featured/${c.id}`, { fields: toFields(featured) });
    console.log(`Featured ${c.id}  "${wanted}"  ${(c.lengthM / 1000).toFixed(2)} km`);
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
