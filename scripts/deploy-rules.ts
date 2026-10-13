/**
 * Publishes firestore.rules to the live project through the Firebase Rules API (creates a
 * ruleset, then points the cloud.firestore release at it). Run by GitHub Actions after the rules
 * tests pass. The service account in FIREBASE_SERVICE_ACCOUNT needs "Firebase Rules Admin".
 */
import { readFileSync } from 'node:fs';
import { accessToken } from './lib/google';

const PROJECT = process.env.FIREBASE_PROJECT ?? 'laptimer-okwph';
const API = `https://firebaserules.googleapis.com/v1/projects/${PROJECT}`;

async function call(token: string, method: string, url: string, body: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(url, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`${method} ${url.replace(API, '')} → HTTP ${res.status}: ${await res.text()}`);
  return (await res.json()) as Record<string, unknown>;
}

async function main() {
  const content = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
  const token = await accessToken('https://www.googleapis.com/auth/firebase');
  const ruleset = await call(token, 'POST', `${API}/rulesets`, { source: { files: [{ name: 'firestore.rules', content }] } });
  const release = `projects/${PROJECT}/releases/cloud.firestore`;
  await call(token, 'PATCH', `${API}/releases/cloud.firestore`, { release: { name: release, rulesetName: ruleset.name } });
  console.log(`Released ${ruleset.name} to ${release}`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
