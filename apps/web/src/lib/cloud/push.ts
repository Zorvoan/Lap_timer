/**
 * Push notifications through Firebase Cloud Messaging. Loaded lazily with the Firebase SDK.
 *
 * Each device that turns notifications on stores its FCM token at `users/{uid}/push/{id}`; the
 * scheduled job in scripts/notify-overtakes.ts reads them and sends "someone beat your time".
 * The service worker shows the message (public/push-sw.js).
 */
import { deleteDoc, doc, setDoc } from 'firebase/firestore';
import { deleteToken, getMessaging, getToken } from 'firebase/messaging';
import { app, db } from './firebase';
import { forgetDevice, rememberDevice, savedDevice } from '../pushState';

/** A token is refreshed in the account at least this often, so the job can drop stale ones. */
const REFRESH_MS = 7 * 24 * 3600_000;

async function idOf(token: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return [...new Uint8Array(hash)].slice(0, 16).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function currentToken(): Promise<string> {
  const reg = await navigator.serviceWorker.ready;
  return getToken(getMessaging(app), { serviceWorkerRegistration: reg });
}

async function store(uid: string, token: string): Promise<void> {
  const id = await idOf(token);
  const prev = savedDevice();
  if (prev && (prev.uid !== uid || prev.id !== id)) await deleteDoc(doc(db, 'users', prev.uid, 'push', prev.id)).catch(() => undefined);
  await setDoc(doc(db, 'users', uid, 'push', id), { token, updatedAt: Date.now() });
  rememberDevice({ uid, id, at: Date.now() });
}

/** Turns notifications on for this device (asks for permission first). */
export async function enablePush(uid: string): Promise<void> {
  await store(uid, await currentToken());
}

/** Keeps this device's token current; tokens change now and then. */
export async function refreshPush(uid: string): Promise<void> {
  const saved = savedDevice();
  if (!saved || saved.uid !== uid || Notification.permission !== 'granted') return;
  const token = await currentToken();
  if ((await idOf(token)) !== saved.id || Date.now() - saved.at > REFRESH_MS) await store(uid, token);
}

/** Turns notifications off for this device. */
export async function disablePush(): Promise<void> {
  const saved = savedDevice();
  forgetDevice();
  if (saved) await deleteDoc(doc(db, 'users', saved.uid, 'push', saved.id)).catch(() => undefined);
  await deleteToken(getMessaging(app)).catch(() => undefined);
}
