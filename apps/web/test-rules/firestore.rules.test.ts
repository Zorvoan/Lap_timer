import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { deleteDoc, doc, setDoc, writeBatch } from 'firebase/firestore';

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

describe('public roads', () => {
  const road = (id: string, extra: Record<string, unknown> = {}) => ({ id, name: 'My road', lengthM: 2000, ownerUid: 'alice', ownerNickname: 'Alice', publishedAt: 1, ...extra });
  const alice = () => env.authenticatedContext('alice').firestore();
  async function publish(id: string, ids: string[], extra: Record<string, unknown> = {}) {
    const db = alice();
    const b = writeBatch(db);
    b.set(doc(db, 'publicSlots', 'alice'), { ids });
    b.set(doc(db, 'public', id), road(id, extra));
    await b.commit();
  }

  it('lets a driver publish up to five roads, not a sixth', async () => {
    const ids: string[] = [];
    for (let i = 1; i <= 5; i++) {
      ids.push(`r${i}`);
      await assertSucceeds(publish(`r${i}`, [...ids]));
    }
    await assertFails(publish('r6', [...ids, 'r6']));
    // Dropping a slot without unpublishing its road does not free it.
    await assertFails(setDoc(doc(alice(), 'publicSlots', 'alice'), { ids: ids.slice(1) }));
  });

  it('frees a slot when the road is unpublished in the same write', async () => {
    await publish('r1', ['r1']);
    const db = alice();
    const b = writeBatch(db);
    b.delete(doc(db, 'public', 'r1'));
    b.set(doc(db, 'publicSlots', 'alice'), { ids: [] });
    await assertSucceeds(b.commit());
  });

  it('deletes the list of public roads only once it is empty, and only its owner', async () => {
    await publish('r1', ['r1']);
    await assertFails(deleteDoc(doc(alice(), 'publicSlots', 'alice')));
    const db = alice();
    const b = writeBatch(db);
    b.delete(doc(db, 'public', 'r1'));
    b.set(doc(db, 'publicSlots', 'alice'), { ids: [] });
    await b.commit();
    await assertFails(deleteDoc(doc(env.authenticatedContext('bob').firestore(), 'publicSlots', 'alice')));
    await assertSucceeds(deleteDoc(doc(alice(), 'publicSlots', 'alice')));
  });

  it('needs a slot, the own uid and nickname, and a sane road; never edits', async () => {
    const db = alice();
    await assertFails(setDoc(doc(db, 'public', 'r1'), road('r1')));
    await assertFails(publish('r1', ['r1'], { ownerUid: 'bob' }));
    await assertFails(publish('r1', ['r1'], { ownerNickname: 'Someone else' }));
    await assertFails(publish('r1', ['r1'], { lengthM: 100 }));
    await assertFails(publish(TRACK, [TRACK]));
    await assertSucceeds(publish('r1', ['r1']));
    await assertFails(setDoc(doc(db, 'public', 'r1'), road('r1', { name: 'Renamed' })));
    const bob = env.authenticatedContext('bob').firestore();
    await assertFails(deleteDoc(doc(bob, 'public', 'r1')));
  });

  it('has a leaderboard the owner can clear', async () => {
    await publish('r1', ['r1']);
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, 'users', 'bob'), { nickname: 'Bob', nicknameLower: 'bob', car: 'Fabia', updatedAt: 1 });
    });
    const bob = env.authenticatedContext('bob').firestore();
    const bobEntry = { ...entry(60_000), uid: 'bob', nickname: 'Bob', car: 'Fabia' };
    await assertSucceeds(setDoc(doc(bob, 'leaderboards', 'r1', 'entries', 'bob'), bobEntry));
    await assertFails(setDoc(doc(bob, 'leaderboards', 'r1', 'entries', 'bob'), { ...bobEntry, timeMs: 20_000 }));
    // Another driver cannot remove Bob's time; the road's owner can.
    const carol = env.authenticatedContext('carol').firestore();
    await assertFails(deleteDoc(doc(carol, 'leaderboards', 'r1', 'entries', 'bob')));
    await assertSucceeds(deleteDoc(doc(alice(), 'leaderboards', 'r1', 'entries', 'bob')));
  });
});
