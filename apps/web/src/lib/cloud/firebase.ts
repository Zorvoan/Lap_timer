/** Firebase initialisation. Loaded lazily so the SDK is only downloaded when accounts are enabled. */
import { initializeApp } from 'firebase/app';
import {
  GoogleAuthProvider,
  OAuthProvider,
  browserLocalPersistence,
  browserPopupRedirectResolver,
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  getRedirectResult,
  initializeAuth,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  type User,
} from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore';
import { config } from '../config';
import { FirestoreStore } from './firestoreStore';

const app = initializeApp({
  apiKey: config.firebase.apiKey,
  authDomain: config.firebase.authDomain,
  projectId: config.firebase.projectId,
  appId: config.firebase.appId,
  messagingSenderId: config.firebase.messagingSenderId || undefined,
});

// Stay signed in across restarts (IndexedDB-backed).
const auth = initializeAuth(app, { persistence: browserLocalPersistence, popupRedirectResolver: browserPopupRedirectResolver });
export const db = getFirestore(app);
export { app };

if (config.firebase.emulators) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
}

export interface AccountUser {
  uid: string;
  email: string | null;
}

const toUser = (u: User | null): AccountUser | null => (u ? { uid: u.uid, email: u.email } : null);

export type SocialProvider = 'google' | 'apple';

function providerFor(p: SocialProvider) {
  if (p === 'google') return new GoogleAuthProvider();
  const apple = new OAuthProvider('apple.com');
  apple.addScope('email');
  return apple;
}

/**
 * An app installed on the home screen cannot hand a popup window back reliably (iOS opens it in a
 * separate browser), so there the whole page goes to Google / Apple and comes back.
 */
const standalone = () => window.matchMedia?.('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;

export const firebaseApi = {
  onUser(cb: (u: AccountUser | null) => void): () => void {
    return onAuthStateChanged(auth, (u) => cb(toUser(u)));
  },
  async register(email: string, password: string) {
    await createUserWithEmailAndPassword(auth, email, password);
  },
  async login(email: string, password: string) {
    await signInWithEmailAndPassword(auth, email, password);
  },
  async logout() {
    await signOut(auth);
  },
  async resetPassword(email: string) {
    await sendPasswordResetEmail(auth, email);
  },
  async signInWith(p: SocialProvider) {
    if (standalone()) return signInWithRedirect(auth, providerFor(p));
    try {
      await signInWithPopup(auth, providerFor(p));
    } catch (e) {
      // Popup blocked (some in-app browsers): go the long way round instead.
      if ((e as { code?: string }).code === 'auth/popup-blocked') return signInWithRedirect(auth, providerFor(p));
      throw e;
    }
  },
  /** Finishes a redirect sign-in after the page comes back; throws its error, if any. */
  async finishRedirect() {
    await getRedirectResult(auth);
  },
  store(uid: string) {
    return new FirestoreStore(db, uid);
  },
};

export type FirebaseApi = typeof firebaseApi;
