/**
 * Firestore access for profiles, official tracks and leaderboards. Loaded lazily with the
 * Firebase SDK. Leaderboards and official tracks are public; writes are checked by
 * firestore.rules (own entry only, must match the profile, times can only improve).
 */
import { collection, doc, getDoc, getDocs, limit, orderBy, query, runTransaction, serverTimestamp, writeBatch } from 'firebase/firestore';
import type { Circuit } from '@laptimer/core';
import { db } from './firebase';
import { decodeCircuit, type CircuitDoc } from './codec';
import type { LeaderboardEntry, Profile, PublishedTrace } from './leaderboard';

export class NicknameTakenError extends Error {
  constructor() {
    super('That nickname is already taken. Choose another one.');
  }
}

export interface FeaturedCircuit extends Circuit {
  featuredOrder: number;
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

export async function getPublishedTrace(circuitId: string, uid: string): Promise<PublishedTrace | null> {
  const snap = await getDoc(doc(db, 'leaderboards', circuitId, 'traces', uid));
  return snap.exists() ? (snap.data() as PublishedTrace) : null;
}

/** Removes the user's entries from all leaderboards (used before deleting an account). */
export async function withdrawEntries(uid: string, featuredIds: readonly string[]): Promise<void> {
  const b = writeBatch(db);
  for (const id of featuredIds) {
    b.delete(doc(db, 'leaderboards', id, 'entries', uid));
    b.delete(doc(db, 'leaderboards', id, 'traces', uid));
  }
  await b.commit();
}
