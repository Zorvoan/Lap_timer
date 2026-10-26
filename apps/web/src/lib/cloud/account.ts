/**
 * Account state (sign-in) and automatic cloud sync. Subscribe from React with useAccount().
 * Sync runs after sign-in, shortly after local changes, when the device comes back online,
 * and every few minutes while the app is open (to pick up laps driven on another device).
 */
import { config } from '../config';
import { savedDevice } from '../pushState';
import { log } from '../log';
import { clearAllData, dataEvents, getCircuit, getKv, listSessions, saveCircuit, setKv } from '../repo';
import { lapLength } from '../references';
import type { AccountUser, FirebaseApi, SocialProvider } from './firebase';
import type { Circuit } from '@laptimer/core';
import type { FeaturedCircuit } from './community';
import { bestEligibleLap, entryFromLap, traceForPublishing, validateCar, validateNickname, type Profile } from './leaderboard';
import { resetSyncState, runSync, type SyncReport } from './syncEngine';

export type AccountStatus = 'disabled' | 'loading' | 'signed_out' | 'signed_in';
export type SyncStatus = 'idle' | 'syncing' | 'error' | 'offline';

export interface AccountState {
  status: AccountStatus;
  user: AccountUser | null;
  sync: SyncStatus;
  lastSyncAt: number | null;
  lastReport: SyncReport | null;
  syncError: string | null;
  /** Why the last Google / Apple sign-in failed (shown on the sign-in screen). */
  authError: string | null;
  /** Sign-in providers switched on in the Firebase project, besides e-mail. */
  providers: SocialProvider[];
  /** undefined = not loaded yet; null = signed in but no nickname/car set. */
  profile: Profile | null | undefined;
  /** Official leaderboard tracks (cached for offline use). */
  featured: FeaturedCircuit[];
  /** Roads drivers made public; they have leaderboards too (cached for offline use). */
  community: FeaturedCircuit[];
  /** Laps published to leaderboards by the most recent sync that published any. */
  submissions: LeaderboardSubmission[];
  /** Official tracks where someone else has pushed the driver down since the last check. */
  overtakes: Overtake[];
}

/** "Someone beat you": the driver's place on an official track got worse. */
export interface Overtake {
  circuitId: string;
  circuitName: string;
  from: number;
  to: number;
  /** Nickname of the driver who most recently went faster, when known. */
  by: string | null;
  at: number;
}

/** A lap just published to an official track's leaderboard. */
export interface LeaderboardSubmission {
  circuitId: string;
  circuitName: string;
  timeMs: number;
  /** Place on the leaderboard right after publishing (1 = record). */
  position: number;
  /** The driver's previous published time there, if any. */
  previousMs: number | null;
  at: number;
}

export const cloudEnabled = Boolean(config.firebase.apiKey && config.firebase.projectId);

const PROVIDERS_KEY = 'lt-sign-in-providers';
const SOCIAL: { id: SocialProvider; firebaseId: string }[] = [
  { id: 'apple', firebaseId: 'apple.com' },
  { id: 'google', firebaseId: 'google.com' },
];

function cachedProviders(): SocialProvider[] {
  try {
    const v = JSON.parse(localStorage.getItem(PROVIDERS_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is SocialProvider => x === 'google' || x === 'apple') : [];
  } catch {
    return [];
  }
}

let state: AccountState = {
  status: cloudEnabled ? 'loading' : 'disabled',
  user: null,
  sync: 'idle',
  lastSyncAt: null,
  lastReport: null,
  syncError: null,
  authError: null,
  providers: cloudEnabled ? cachedProviders() : [],
  profile: undefined,
  featured: [],
  community: [],
  submissions: [],
  overtakes: [],
};
const listeners = new Set<() => void>();
let api: FirebaseApi | null = null;
let apiPromise: Promise<FirebaseApi> | null = null;
let syncing: Promise<void> | null = null;
let again = false;
let timer: ReturnType<typeof setTimeout> | null = null;
let applying = false;

function set(patch: Partial<AccountState>) {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

export const account = {
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  getState: () => state,
};

const community = () => import('./community');

function loadApi(): Promise<FirebaseApi> {
  apiPromise ??= import('./firebase').then((m) => (api = m.firebaseApi));
  return apiPromise;
}

/** Starts listening for the signed-in user. Call once at app start. */
export function initAccount(): void {
  if (!cloudEnabled) return;
  void refreshProviders();
  void loadApi()
    .then((a) => {
      a.onUser((user) => {
        set({ user, status: user ? 'signed_in' : 'signed_out', syncError: null, profile: user ? undefined : null });
        if (user) {
          void loadProfile(user.uid);
          scheduleSync(0);
          if (savedDevice()?.uid === user.uid) void import('./push').then((m) => m.refreshPush(user.uid)).catch(() => undefined);
        }
      });
      void refreshFeatured();
      a.finishRedirect().catch((e) => {
        const m = describeError(e);
        if (m) set({ authError: m });
      });
    })
    .catch((e) => {
      log.error('firebase failed to load', e);
      set({ status: 'signed_out', syncError: 'Could not load the sign-in service. Check your connection.' });
    });

  dataEvents.addEventListener('change', () => {
    if (state.status !== 'signed_in') return;
    // Changes made while a sync is applying remote data are covered by a follow-up sync.
    if (applying) again = true;
    else scheduleSync(4000);
  });
  window.addEventListener('online', () => state.status === 'signed_in' && scheduleSync(0));
  window.addEventListener('offline', () => set({ sync: 'offline' }));
  setInterval(() => {
    if (state.status === 'signed_in' && document.visibilityState === 'visible') scheduleSync(0);
  }, 3 * 60_000);
}

export function scheduleSync(delayMs: number): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void syncNow(), delayMs);
}

/** Runs a sync now (or once more after the one in progress). */
export async function syncNow(): Promise<void> {
  if (deleting) return;
  if (syncing) {
    again = true;
    return syncing;
  }
  const user = state.user;
  if (!api || !user) return;
  if (navigator.onLine === false) {
    set({ sync: 'offline' });
    return;
  }
  set({ sync: 'syncing', syncError: null });
  syncing = (async () => {
    try {
      applying = true;
      const report = await runSync(api!.store(user.uid), user.uid);
      const submitted = await submitBestLaps(user.uid).catch((e) => {
        log.warn('leaderboard submission failed', { error: String(e) });
        return [];
      });
      if (submitted.length) set({ submissions: submitted });
      const overtakes = await checkPositions(user.uid).catch((e) => {
        log.warn('leaderboard position check failed', { error: String(e) });
        return [];
      });
      if (overtakes.length) set({ overtakes });
      // Keep showing the last sync that changed something; follow-up syncs are usually empty.
      const changed = report.uploaded + report.downloaded + report.deleted > 0;
      set({ sync: 'idle', lastSyncAt: Date.now(), lastReport: changed || !state.lastReport ? report : state.lastReport });
    } catch (e) {
      log.error('cloud sync failed', e);
      set({ sync: navigator.onLine === false ? 'offline' : 'error', syncError: describeError(e) });
    } finally {
      applying = false;
      syncing = null;
      if (again) {
        again = false;
        scheduleSync(1000);
      }
    }
  })();
  return syncing;
}

/**
 * Which of Google / Apple the Firebase project has switched on. Asked of the sign-in service
 * directly, so a provider enabled in the Firebase console shows up without a new app version.
 */
async function refreshProviders(): Promise<void> {
  // The Auth emulator signs in with any provider (fake accounts) but cannot answer this question.
  if (config.firebase.emulators) return set({ providers: SOCIAL.map((x) => x.id) });
  const on = await Promise.all(
    SOCIAL.map(async ({ id, firebaseId }) => {
      try {
        const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:createAuthUri?key=${encodeURIComponent(config.firebase.apiKey)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ providerId: firebaseId, continueUri: location.origin }),
        });
        return r.ok ? id : null;
      } catch {
        return undefined; // offline: keep what we knew
      }
    }),
  );
  if (on.includes(undefined)) return;
  const providers = on.filter((x): x is SocialProvider => x !== null && x !== undefined);
  try {
    localStorage.setItem(PROVIDERS_KEY, JSON.stringify(providers));
  } catch {
    // not remembered; asked again next time
  }
  set({ providers });
}

/** Signs in (or creates an account) with Google or Apple. A new account then asks for a profile. */
export async function signInWith(p: SocialProvider): Promise<void> {
  set({ authError: null });
  try {
    await (await loadApi()).signInWith(p);
  } catch (e) {
    const m = describeError(e);
    if (m) set({ authError: m });
  }
}

/** True while a new account is being created, before its profile is saved. */
let registering = false;
/** Bumped whenever the profile is set here, so a load that started earlier cannot overwrite it. */
let profileVersion = 0;

/** Creates an account with its public profile (nickname must be unique). */
export async function register(email: string, password: string, nickname: string, car: string): Promise<void> {
  const problem = validateNickname(nickname) ?? validateCar(car);
  if (problem) throw new Error(problem);
  const a = await loadApi();
  const c = await community();
  if (!(await c.isNicknameAvailable(nickname))) throw new c.NicknameTakenError();
  registering = true;
  try {
    await a.register(email.trim(), password);
    const uid = state.user?.uid ?? (await waitForUser());
    await c.saveProfile(uid, { nickname, car }, leaderboardTracks().map((f) => f.id));
    profileVersion++;
    set({ profile: { nickname: nickname.trim(), car: car.trim() } });
  } finally {
    registering = false;
  }
}

function waitForUser(): Promise<string> {
  return new Promise((resolve) => {
    const off = account.subscribe(() => {
      if (state.user) {
        off();
        resolve(state.user.uid);
      }
    });
  });
}

async function loadProfile(uid: string) {
  const version = profileVersion;
  try {
    const p = await (await community()).getProfile(uid);
    // A brand-new account has no profile until register() saves it; "none" then is not news. A
    // load that began before register() saved the profile answers "none" too, and must not win.
    if (state.user?.uid === uid && version === profileVersion && !(p === null && registering)) set({ profile: p });
  } catch (e) {
    log.warn('profile could not be loaded', { error: String(e) });
  }
}

/** Sets or changes nickname and car; also updates the user's leaderboard entries. */
export async function updateProfile(next: Profile): Promise<void> {
  const problem = validateNickname(next.nickname) ?? validateCar(next.car);
  if (problem) throw new Error(problem);
  const uid = state.user?.uid;
  if (!uid) throw new Error('Sign in first.');
  await (await community()).saveProfile(uid, next, leaderboardTracks().map((f) => f.id));
  profileVersion++;
  set({ profile: { nickname: next.nickname.trim(), car: next.car.trim() } });
  scheduleSync(0); // publishes laps if this was the first profile
}

// ---------- official tracks & leaderboards ----------

/** Loads the official tracks (public), caches them, and refreshes local copies of them. */
export async function refreshFeatured(): Promise<FeaturedCircuit[]> {
  if (!cloudEnabled) return [];
  if (!state.featured.length) {
    const cached = await getKv<FeaturedCircuit[]>('featured');
    if (cached?.length) set({ featured: cached });
  }
  try {
    const list = await (await community()).listFeatured();
    await setKv('featured', list);
    set({ featured: list });
    // Every user gets the official tracks in their circuits; they are authoritative, so older
    // local copies are replaced (they are never edited locally).
    for (const f of list) await ensureLocalCircuit(f);
    return list;
  } catch (e) {
    log.warn('official tracks could not be loaded', { error: String(e) });
    return state.featured;
  } finally {
    void refreshCommunity();
  }
}

/** Loads the roads drivers made public. Copied to this device only when driven. */
export async function refreshCommunity(): Promise<FeaturedCircuit[]> {
  if (!cloudEnabled) return [];
  if (!state.community.length) {
    const cached = await getKv<FeaturedCircuit[]>('community');
    if (cached?.length) set({ community: cached });
  }
  try {
    const list = await (await community()).listPublic();
    await setKv('community', list);
    set({ community: list });
    return list;
  } catch (e) {
    log.warn('public roads could not be loaded', { error: String(e) });
    return state.community;
  }
}

/** Every track with a leaderboard: the official ones, then the public roads. */
export function leaderboardTracks(s: Pick<AccountState, 'featured' | 'community'> = state): FeaturedCircuit[] {
  const official = new Set(s.featured.map((f) => f.id));
  return [...s.featured, ...s.community.filter((c) => !official.has(c.id))];
}

/** Makes one of this driver's circuits public. */
export async function publishRoad(circuit: Circuit): Promise<void> {
  const uid = state.user?.uid;
  if (!uid || !state.profile) throw new Error('Sign in and add a nickname first.');
  if (circuit.name.trim().length > 60) throw new Error('Shorten the name to 60 characters or less first (Edit track).');
  if (circuit.lengthM < 300) throw new Error('This road is too short to make public (at least 300 m).');
  await (await community()).publishRoad(uid, state.profile.nickname, circuit);
  await refreshCommunity();
  scheduleSync(0); // publishes the owner's laps already driven on it
}

/** Takes one of this driver's public roads down, with its leaderboard. */
export async function unpublishRoad(circuitId: string): Promise<void> {
  const uid = state.user?.uid;
  if (!uid) throw new Error('Sign in first.');
  await (await community()).unpublishRoad(uid, circuitId);
  set({ community: state.community.filter((c) => c.id !== circuitId) });
  await refreshCommunity();
}

function stripFeatured(f: FeaturedCircuit) {
  const { featuredOrder: _order, owner: _owner, ...circuit } = f;
  return circuit;
}

/** Adds an official track to this device's circuits (so it can be driven), if missing. */
export async function ensureLocalCircuit(f: FeaturedCircuit): Promise<void> {
  const local = await getCircuit(f.id);
  if (!local || local.updatedAt < f.updatedAt) await saveCircuit(stripFeatured(f), { touch: false });
}

export function isFeatured(circuitId: string): boolean {
  return leaderboardTracks().some((f) => f.id === circuitId);
}

/** Publishes the best real-GPS lap on each official track when it beats the published one. */
async function submitBestLaps(uid: string): Promise<LeaderboardSubmission[]> {
  const profile = state.profile;
  const tracks = leaderboardTracks();
  if (!profile || !tracks.length) return [];
  const c = await community();
  const sessions = await listSessions();
  // v2: entries published before sector splits existed are checked (and completed) once.
  const cacheKey = `lbSubmitted2:${uid}`;
  const cache = (await getKv<Record<string, number>>(cacheKey)) ?? {};
  const submitted: LeaderboardSubmission[] = [];
  for (const f of tracks) {
    const best = bestEligibleLap(sessions, f.id);
    if (!best) continue;
    if (cache[f.id] !== undefined && best.lap.timeMs >= cache[f.id]) continue;
    const remote = await c.getEntry(f.id, uid);
    // Re-publish the same time once when the entry predates sector splits, so it gets them.
    const addSplits = remote !== null && remote.timeMs === best.lap.timeMs && !remote.splitTimesMs?.length;
    if (remote && remote.timeMs <= best.lap.timeMs && !addSplits) {
      cache[f.id] = remote.timeMs;
      continue;
    }
    const lengthM = lapLength(f);
    const entry = entryFromLap(uid, profile, best.session, best.lap, lengthM);
    const trace = traceForPublishing(best.lap, lengthM);
    try {
      await c.submitEntry(f.id, entry, trace);
    } catch (e) {
      // Rules older than sector splits reject the extra field: publish the time without them.
      if (addSplits) continue;
      const { splitTimesMs: _splits, ...plain } = entry;
      await c.submitEntry(f.id, plain, trace);
      log.warn('leaderboard entry published without splits', { error: String(e) });
    }
    cache[f.id] = best.lap.timeMs;
    if (addSplits) continue; // same time as before: nothing to announce
    const position = await c.getPosition(f.id, best.lap.timeMs).catch(() => 0);
    submitted.push({ circuitId: f.id, circuitName: f.name, timeMs: best.lap.timeMs, position, previousMs: remote?.timeMs ?? null, at: Date.now() });
  }
  await setKv(cacheKey, cache);
  return submitted;
}

const POSITION_CHECK_MS = 10 * 60_000;

/**
 * Compares the driver's place on each official track with the place seen last time and reports
 * the tracks where it got worse (somebody else went faster). Runs at most every 10 minutes:
 * two small reads per track (own entry, a count of faster entries).
 */
async function checkPositions(uid: string): Promise<Overtake[]> {
  const key = `lbPositions:${uid}`;
  const saved = (await getKv<{ checkedAt: number; positions: Record<string, number> }>(key)) ?? { checkedAt: 0, positions: {} };
  if (Date.now() - saved.checkedAt < POSITION_CHECK_MS) return [];
  const c = await community();
  const positions: Record<string, number> = {};
  const out: Overtake[] = [];
  for (const f of leaderboardTracks()) {
    const mine = await c.getEntry(f.id, uid);
    if (!mine) continue;
    const now = await c.getPosition(f.id, mine.timeMs);
    positions[f.id] = now;
    const before = saved.positions[f.id];
    if (before !== undefined && now > before) {
      const ahead = await c.getDriversAhead(f.id, mine.timeMs).catch(() => []);
      const newest = ahead.filter((e) => e.uid !== uid).sort((a, b) => b.submittedAtMs - a.submittedAtMs)[0];
      out.push({ circuitId: f.id, circuitName: f.name, from: before, to: now, by: newest?.nickname ?? null, at: Date.now() });
    }
  }
  await setKv(key, { checkedAt: Date.now(), positions });
  return out;
}

export async function login(email: string, password: string): Promise<void> {
  const a = await loadApi();
  await a.login(email.trim(), password);
}

export async function resetPassword(email: string): Promise<void> {
  const a = await loadApi();
  await a.resetPassword(email.trim());
}

/**
 * Signs out. With `removeLocalData`, circuits and sessions are also removed from this device
 * (they stay in the account); use it on shared computers.
 */
export async function logout(removeLocalData: boolean): Promise<void> {
  const a = await loadApi();
  const uid = state.user?.uid;
  if (syncing) await syncing.catch(() => undefined);
  // This device stops getting the account's notifications.
  if (savedDevice()) await (await import('./push')).disablePush().catch(() => undefined);
  await a.logout();
  if (removeLocalData) {
    await clearAllData();
    if (uid) await resetSyncState(uid);
  }
  set({ lastSyncAt: null, lastReport: null, sync: 'idle', syncError: null, profile: null, submissions: [], overtakes: [] });
}

let deleting = false;

/** Whether the account signs in with a password (asked for again before deleting it). */
export async function usesPassword(): Promise<boolean> {
  return (await loadApi()).usesPassword();
}

/**
 * Deletes the account and everything in it: the driver's public roads (with their leaderboards),
 * their times on every leaderboard, circuits, sessions, profile and nickname, then the sign-in
 * itself and this device's copy. Asks the owner to sign in again first, so a wrong password
 * deletes nothing.
 */
export async function deleteAccount(password: string | null): Promise<void> {
  const a = await loadApi();
  const uid = state.user?.uid;
  if (!uid) throw new Error('Sign in first.');
  await a.reauthenticate(password);
  deleting = true;
  try {
    if (timer) clearTimeout(timer);
    if (syncing) await syncing.catch(() => undefined);
    if (savedDevice()) await (await import('./push')).disablePush().catch(() => undefined);
    const c = await community();
    for (const id of await c.publicRoadIds(uid)) await c.unpublishRoad(uid, id);
    await c.withdrawEntries(uid, leaderboardTracks(state).map((f) => f.id));
    await c.deleteUserData(uid, state.profile?.nickname ?? null);
    await a.deleteUser();
    await clearAllData();
    await resetSyncState(uid);
    set({ lastSyncAt: null, lastReport: null, sync: 'idle', syncError: null, profile: null, submissions: [], overtakes: [] });
  } finally {
    deleting = false;
  }
}

/** Human-readable message for Firebase Auth / Firestore errors. */
export function describeError(e: unknown): string {
  const code = typeof e === 'object' && e && 'code' in e ? String((e as { code: unknown }).code) : '';
  switch (code) {
    case 'auth/invalid-email':
      return 'That e-mail address is not valid.';
    case 'auth/missing-password':
      return 'Enter your password.';
    case 'auth/weak-password':
      return 'The password is too weak: use at least 6 characters.';
    case 'auth/email-already-in-use':
      return 'An account with this e-mail already exists. Sign in instead.';
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'Wrong e-mail or password.';
    case 'auth/too-many-requests':
      return 'Too many attempts. Wait a moment and try again.';
    case 'auth/requires-recent-login':
      return 'For your security, sign out and sign in again, then delete the account.';
    case 'auth/user-mismatch':
      return 'That is a different account. Use the one you are signed in with.';
    case 'auth/network-request-failed':
    case 'unavailable':
      return 'No connection to the server. Check your internet connection.';
    case 'auth/operation-not-allowed':
      return 'This way of signing in is not switched on for this app.';
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
    case 'auth/user-cancelled':
      return ''; // the user closed the Google / Apple window: nothing to report
    case 'auth/account-exists-with-different-credential':
      return 'This e-mail already has an account with another way of signing in. Use that one.';
    case 'auth/unauthorized-domain':
      return 'Signing in from this address is not allowed. Open the app at its usual address.';
    case 'permission-denied':
      return 'The server refused access to your data. Sign out and in again.';
    case 'resource-exhausted':
      return 'The cloud storage quota is exhausted for today. Your data is safe on this device; sync will resume later.';
    default:
      return e instanceof Error ? e.message : 'Something went wrong.';
  }
}
