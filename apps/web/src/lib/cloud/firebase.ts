/** Firebase initialisation. Loaded lazily so the SDK is only downloaded when accounts are enabled. */
import { initializeApp } from 'firebase/app';
import {
  browserLocalPersistence,
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  initializeAuth,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
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
});

// Stay signed in across restarts (IndexedDB-backed).
const auth = initializeAuth(app, { persistence: browserLocalPersistence });
export const db = getFirestore(app);

if (config.firebase.emulators) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
}

export interface AccountUser {
  uid: string;
  email: string | null;
}

const toUser = (u: User | null): AccountUser | null => (u ? { uid: u.uid, email: u.email } : null);

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
  store(uid: string) {
    return new FirestoreStore(db, uid);
  },
};

export type FirebaseApi = typeof firebaseApi;
