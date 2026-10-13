import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc } from 'firebase/firestore';

const TRACK = 'track-2km';
let env: RulesTestEnvironment;

beforeAll(async () => {
  const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080').split(':');
  env = await initializeTestEnvironment({
    projectId: 'demo-laptimer',
    firestore: { rules: readFileSync(new URL('../../../firestore.rules', import.meta.url), 'utf8'), host, port: Number(port) },
  });
});
afterAll(() => env.cleanup());

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'featured', TRACK), { name: 'Hill', lengthM: 2000 });
    await setDoc(doc(db, 'users', 'alice'), { nickname: 'Alice', nicknameLower: 'alice', car: 'Golf', updatedAt: 1 });
    await setDoc(doc(db, 'nicknames', 'alice'), { uid: 'alice' });
  });
});

const entry = (timeMs: number, extra: Record<string, unknown> = {}) => ({
  uid: 'alice',
  nickname: 'Alice',
  car: 'Golf',
  timeMs,
  drivenAt: 1,
  sessionId: 's',
  lap: 1,
  sectorTimesMs: [],
  avgSpeedMs: 2000 / (timeMs / 1000),
  maxSpeedMs: 30,
  submittedAt: 1,
  ...extra,
});
const aliceEntry = () => doc(env.authenticatedContext('alice').firestore(), 'leaderboards', TRACK, 'entries', 'alice');

describe('leaderboard entries', () => {
  it('accepts a plausible lap with sector splits', async () => {
    await assertSucceeds(setDoc(aliceEntry(), entry(60_000, { splitTimesMs: [20_000, 20_000, 20_000] })));
  });

  it('rejects a time faster than 250 km/h average over the track', async () => {
    // 2 km in 25 s = 288 km/h
    await assertFails(setDoc(aliceEntry(), entry(25_000)));
    // 2 km in 30 s = 240 km/h is still allowed
    await assertSucceeds(setDoc(aliceEntry(), entry(30_000)));
  });

  it('only lets times improve, and rejects unknown fields or bad splits', async () => {
    await assertSucceeds(setDoc(aliceEntry(), entry(60_000)));
    await assertFails(setDoc(aliceEntry(), entry(61_000)));
    await assertSucceeds(setDoc(aliceEntry(), entry(60_000, { splitTimesMs: [20_000, 20_000, 20_000] })));
    await assertFails(setDoc(aliceEntry(), entry(59_000, { bonus: true })));
    await assertFails(setDoc(aliceEntry(), entry(59_000, { splitTimesMs: 'fast' })));
  });

  it('does not let anyone write another driver’s entry', async () => {
    const bob = env.authenticatedContext('bob').firestore();
    await assertFails(setDoc(doc(bob, 'leaderboards', TRACK, 'entries', 'alice'), entry(60_000)));
  });

  it('only accepts entries on official tracks', async () => {
    const db = env.authenticatedContext('alice').firestore();
    await assertFails(setDoc(doc(db, 'leaderboards', 'not-official', 'entries', 'alice'), entry(60_000)));
  });
});
