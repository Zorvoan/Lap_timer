/**
 * Firestore access for profiles, official tracks and leaderboards. Loaded lazily with the
 * Firebase SDK. Leaderboards and official tracks are public; writes are checked by
 * firestore.rules (own entry only, must match the profile, times can only improve).
 */
import { collection, doc, getCountFromServer, getDoc, getDocs, limit, orderBy, query, runTransaction, serverTimestamp, where, writeBatch, type DocumentReference } from 'firebase/firestore';
import type { Circuit } from '@laptimer/core';
import { db } from './firebase';
import { decodeCircuit, encodeCircuit, type CircuitDoc } from './codec';
import { PUBLIC_ROAD_LIMIT, type LeaderboardEntry, type Profile, type PublishedTrace } from './leaderboard';

export class NicknameTakenError extends Error {
  constructor() {
    super('That nickname is already taken. Choose another one.');
  }
}

export interface FeaturedCircuit extends Circuit {
  featuredOrder: number;
  /** Set on public roads (made public by a driver); absent on official tracks. */
  owner?: { uid: string; nickname: string };
}


export async function getProfile(uid: string): Promise<Profile | null> {
  const snap = await getDoc(doc(db, 'users', uid));
  if (!snap.exists() || typeof snap.get('nickname') !== 'string') return null;
  return { nickname: snap.get('nickname'), car: snap.get('car') ?? '' };
}

export async function isNicknameAvailable(nickname: string, uid?: string): Promise<boolean> {
  const snap = await getDoc(doc(db, 'nicknames', nickname.trim().toLowerCase()));
  return !snap.exists() || (uid !== undefined && snap.get('uid') === uid);
}

/**
 * Creates or changes the profile. The nickname is reserved atomically (unique, case-insensitive)
 * and existing leaderboard entries are updated to show the new nickname/car.
 */
export async function saveProfile(uid: string, next: Profile, featuredIds: readonly string[]): Promise<void> {
  const nickname = next.nickname.trim();
  const lower = nickname.toLowerCase();
  const car = next.car.trim();
  await runTransaction(db, async (tx) => {
    const userRef = doc(db, 'users', uid);
    const current = await tx.get(userRef);
    const nameRef = doc(db, 'nicknames', lower);
    const taken = await tx.get(nameRef);
    if (taken.exists() && taken.get('uid') !== uid) throw new NicknameTakenError();
    const entryRefs = featuredIds.map((id) => doc(db, 'leaderboards', id, 'entries', uid));
    const entries = await Promise.all(entryRefs.map((r) => tx.get(r)));

    const oldLower = current.exists() ? (current.get('nicknameLower') as string | undefined) : undefined;
    if (oldLower && oldLower !== lower) tx.delete(doc(db, 'nicknames', oldLower));
    if (!taken.exists()) tx.set(nameRef, { uid });
    tx.set(userRef, { nickname, nicknameLower: lower, car, updatedAt: Date.now() });
    entries.forEach((e, i) => {
      if (e.exists()) tx.update(entryRefs[i], { nickname, car });
    });
  });
}

export async function listFeatured(): Promise<FeaturedCircuit[]> {
  const snaps = await getDocs(collection(db, 'featured'));
  const out: FeaturedCircuit[] = [];
  for (const s of snaps.docs) {
    const data = s.data() as CircuitDoc & { featuredOrder?: number };
    try {
      out.push({ ...decodeCircuit(data), featuredOrder: data.featuredOrder ?? 999 });
    } catch {
      /* skip malformed */
    }
  }
  return out.sort((a, b) => a.featuredOrder - b.featuredOrder);
}

/** Roads drivers made public, newest first. Listed after the official tracks. */
export async function listPublic(): Promise<FeaturedCircuit[]> {
  const snaps = await getDocs(collection(db, 'public'));
  const out: (FeaturedCircuit & { publishedAt: number })[] = [];
  for (const s of snaps.docs) {
    const data = s.data() as CircuitDoc & { ownerUid?: string; ownerNickname?: string; publishedAt?: number };
    try {
      out.push({ ...decodeCircuit(data), featuredOrder: 1000, owner: { uid: data.ownerUid ?? '', nickname: data.ownerNickname ?? '' }, publishedAt: data.publishedAt ?? 0 });
    } catch {
      /* skip malformed */
    }
  }
  return out.sort((a, b) => b.publishedAt - a.publishedAt).map(({ publishedAt: _at, ...road }) => road);
}

async function slots(uid: string): Promise<{ exists: boolean; ids: string[] }> {
  const snap = await getDoc(doc(db, 'publicSlots', uid));
  return { exists: snap.exists(), ids: snap.exists() ? ((snap.get('ids') as string[]) ?? []) : [] };
}

/** Makes one of the driver's circuits public (a copy everyone can race; never edited). */
export async function publishRoad(uid: string, nickname: string, circuit: Circuit): Promise<void> {
  const s = await slots(uid);
  if (s.ids.length >= PUBLIC_ROAD_LIMIT && !s.ids.includes(circuit.id)) throw new Error(`You already have ${PUBLIC_ROAD_LIMIT} public roads. Unpublish one first.`);
  const b = writeBatch(db);
  b.set(doc(db, 'publicSlots', uid), { ids: s.ids.includes(circuit.id) ? s.ids : [...s.ids, circuit.id] });
  b.set(doc(db, 'public', circuit.id), { ...encodeCircuit(circuit), ownerUid: uid, ownerNickname: nickname, publishedAt: Date.now() });
  await b.commit();
}

/** Takes a public road down: its leaderboard (everyone's times and traces) goes with it. */
export async function unpublishRoad(uid: string, circuitId: string): Promise<void> {
  for (const sub of ['entries', 'traces']) {
    const snaps = await getDocs(collection(db, 'leaderboards', circuitId, sub));
    for (let i = 0; i < snaps.docs.length; i += 400) {
      const b = writeBatch(db);
      snaps.docs.slice(i, i + 400).forEach((d) => b.delete(d.ref));
      await b.commit();
    }
  }
  const s = await slots(uid);
  const b = writeBatch(db);
  b.delete(doc(db, 'public', circuitId));
  if (s.exists) b.set(doc(db, 'publicSlots', uid), { ids: s.ids.filter((id) => id !== circuitId) });
  await b.commit();
}

export async function getLeaderboard(circuitId: string, max = 200): Promise<LeaderboardEntry[]> {
  const snaps = await getDocs(query(collection(db, 'leaderboards', circuitId, 'entries'), orderBy('timeMs'), limit(max)));
  return snaps.docs.map((d) => d.data() as LeaderboardEntry);
}

export async function getEntry(circuitId: string, uid: string): Promise<LeaderboardEntry | null> {
  const snap = await getDoc(doc(db, 'leaderboards', circuitId, 'entries', uid));
  return snap.exists() ? (snap.data() as LeaderboardEntry) : null;
}

export async function submitEntry(circuitId: string, entry: LeaderboardEntry, trace: PublishedTrace): Promise<void> {
  const b = writeBatch(db);
  b.set(doc(db, 'leaderboards', circuitId, 'traces', entry.uid), trace);
  b.set(doc(db, 'leaderboards', circuitId, 'entries', entry.uid), { ...entry, submittedAt: serverTimestamp() });
  await b.commit();
}

/** Drivers just ahead of a time (fastest first is not guaranteed: nearest first), with when they submitted. */
export async function getDriversAhead(circuitId: string, timeMs: number, max = 10): Promise<(LeaderboardEntry & { submittedAtMs: number })[]> {
  const snaps = await getDocs(query(collection(db, 'leaderboards', circuitId, 'entries'), where('timeMs', '<', timeMs), orderBy('timeMs', 'desc'), limit(max)));
  return snaps.docs.map((d) => {
    const data = d.data() as LeaderboardEntry & { submittedAt?: { toMillis(): number } };
    return { ...data, submittedAtMs: data.submittedAt?.toMillis?.() ?? 0 };
  });
}

/** Leaderboard place a time holds: 1 + the number of strictly faster entries. */
export async function getPosition(circuitId: string, timeMs: number): Promise<number> {
  const snap = await getCountFromServer(query(collection(db, 'leaderboards', circuitId, 'entries'), where('timeMs', '<', timeMs)));
  return snap.data().count + 1;
}

export async function getPublishedTrace(circuitId: string, uid: string): Promise<PublishedTrace | null> {
  const snap = await getDoc(doc(db, 'leaderboards', circuitId, 'traces', uid));
  return snap.exists() ? (snap.data() as PublishedTrace) : null;
}

/** Removes the user's entries from all leaderboards (used before deleting an account). */
export async function withdrawEntries(uid: string, featuredIds: readonly string[]): Promise<void> {
  for (let i = 0; i < featuredIds.length; i += 200) {
    const b = writeBatch(db);
    for (const id of featuredIds.slice(i, i + 200)) {
      b.delete(doc(db, 'leaderboards', id, 'entries', uid));
      b.delete(doc(db, 'leaderboards', id, 'traces', uid));
    }
    await b.commit();
  }
}

/** The ids of the roads this driver has made public. */
export async function publicRoadIds(uid: string): Promise<string[]> {
  return (await slots(uid)).ids;
}

async function deleteAll(refs: DocumentReference[]): Promise<void> {
  for (let i = 0; i < refs.length; i += 400) {
    const b = writeBatch(db);
    refs.slice(i, i + 400).forEach((r) => b.delete(r));
    await b.commit();
  }
}

/**
 * Deletes everything stored under the account: circuits, sessions with their traces, deletion
 * records, notification devices, the profile, the nickname and the (by then empty) list of public
 * roads. Public roads and leaderboard entries are taken down before this.
 */
export async function deleteUserData(uid: string, nickname: string | null): Promise<void> {
  const refs: DocumentReference[] = [];
  for (const name of ['circuits', 'tombstones', 'push']) refs.push(...(await getDocs(collection(db, 'users', uid, name))).docs.map((d) => d.ref));
  for (const session of (await getDocs(collection(db, 'users', uid, 'sessions'))).docs) {
    refs.push(...(await getDocs(collection(session.ref, 'traces'))).docs.map((d) => d.ref), session.ref);
  }
  await deleteAll(refs);
  const s = await slots(uid);
  const b = writeBatch(db);
  if (nickname) b.delete(doc(db, 'nicknames', nickname.toLowerCase()));
  if (s.exists && !s.ids.length) b.delete(doc(db, 'publicSlots', uid));
  b.delete(doc(db, 'users', uid));
  await b.commit();
}
