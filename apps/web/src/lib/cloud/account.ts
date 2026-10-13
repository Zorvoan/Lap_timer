/**
 * Account state (sign-in) and automatic cloud sync. Subscribe from React with useAccount().
 * Sync runs after sign-in, shortly after local changes, when the device comes back online,
 * and every few minutes while the app is open (to pick up laps driven on another device).
 */
import { config } from '../config';
import { log } from '../log';
import { clearAllData, dataEvents, getCircuit, getKv, listSessions, saveCircuit, setKv } from '../repo';
import { lapLength } from '../references';
import type { AccountUser, FirebaseApi } from './firebase';
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
  /** undefined = not loaded yet; null = signed in but no nickname/car set. */
  profile: Profile | null | undefined;
  /** Official leaderboard tracks (cached for offline use). */
  featured: FeaturedCircuit[];
  /** Laps published to leaderboards in the last sync. */
  lastSubmitted: number;
}

export const cloudEnabled = Boolean(config.firebase.apiKey && config.firebase.projectId);

let state: AccountState = {
  status: cloudEnabled ? 'loading' : 'disabled',
  user: null,
  sync: 'idle',
  lastSyncAt: null,
  lastReport: null,
  syncError: null,
  profile: undefined,
  featured: [],
  lastSubmitted: 0,
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
  void loadApi()
    .then((a) => {
      a.onUser((user) => {
        set({ user, status: user ? 'signed_in' : 'signed_out', syncError: null, profile: user ? undefined : null });
        if (user) {
          void loadProfile(user.uid);
          scheduleSync(0);
        }
      });
      void refreshFeatured();
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
        return 0;
      });
      if (submitted) set({ lastSubmitted: submitted });
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

/** Creates an account with its public profile (nickname must be unique). */
export async function register(email: string, password: string, nickname: string, car: string): Promise<void> {
  const problem = validateNickname(nickname) ?? validateCar(car);
  if (problem) throw new Error(problem);
  const a = await loadApi();
  const c = await community();
  if (!(await c.isNicknameAvailable(nickname))) throw new c.NicknameTakenError();
  await a.register(email.trim(), password);
  const uid = state.user?.uid ?? (await waitForUser());
  await c.saveProfile(uid, { nickname, car }, state.featured.map((f) => f.id));
  set({ profile: { nickname: nickname.trim(), car: car.trim() } });
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
  try {
    const p = await (await community()).getProfile(uid);
    if (state.user?.uid === uid) set({ profile: p });
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
  await (await community()).saveProfile(uid, next, state.featured.map((f) => f.id));
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
    // Official tracks are authoritative: replace older local copies (never edit them locally).
    for (const f of list) {
      const local = await getCircuit(f.id);
      if (local && local.updatedAt < f.updatedAt) await saveCircuit(stripFeatured(f), { touch: false });
    }
    return list;
  } catch (e) {
    log.warn('official tracks could not be loaded', { error: String(e) });
    return state.featured;
  }
}

function stripFeatured(f: FeaturedCircuit) {
  const { featuredOrder: _order, ...circuit } = f;
  return circuit;
}

/** Adds an official track to this device's circuits (so it can be driven), if missing. */
export async function ensureLocalCircuit(f: FeaturedCircuit): Promise<void> {
  const local = await getCircuit(f.id);
  if (!local || local.updatedAt < f.updatedAt) await saveCircuit(stripFeatured(f), { touch: false });
}

export function isFeatured(circuitId: string): boolean {
  return state.featured.some((f) => f.id === circuitId);
}

/** Publishes the best real-GPS lap on each official track when it beats the published one. */
async function submitBestLaps(uid: string): Promise<number> {
  const profile = state.profile;
  if (!profile || !state.featured.length) return 0;
  const c = await community();
  const sessions = await listSessions();
  const cacheKey = `lbSubmitted:${uid}`;
  const cache = (await getKv<Record<string, number>>(cacheKey)) ?? {};
  let submitted = 0;
  for (const f of state.featured) {
    const best = bestEligibleLap(sessions, f.id);
    if (!best) continue;
    if (cache[f.id] !== undefined && best.lap.timeMs >= cache[f.id]) continue;
    const remote = await c.getEntry(f.id, uid);
    if (remote && remote.timeMs <= best.lap.timeMs) {
      cache[f.id] = remote.timeMs;
      continue;
    }
    await c.submitEntry(f.id, entryFromLap(uid, profile, best.session, best.lap), traceForPublishing(best.lap, lapLength(f)));
    cache[f.id] = best.lap.timeMs;
    submitted++;
  }
  await setKv(cacheKey, cache);
  return submitted;
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
  await a.logout();
  if (removeLocalData) {
    await clearAllData();
    if (uid) await resetSyncState(uid);
  }
  set({ lastSyncAt: null, lastReport: null, sync: 'idle', syncError: null, profile: null });
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
    case 'auth/network-request-failed':
    case 'unavailable':
      return 'No connection to the server. Check your internet connection.';
    case 'auth/operation-not-allowed':
      return 'E-mail sign-in is not enabled for this app.';
    case 'permission-denied':
      return 'The server refused access to your data. Sign out and in again.';
    case 'resource-exhausted':
      return 'The cloud storage quota is exhausted for today. Your data is safe on this device; sync will resume later.';
    default:
      return e instanceof Error ? e.message : 'Something went wrong.';
  }
}
