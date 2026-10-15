/**
 * Whether this device can get "someone beat your time" notifications, and whether it does.
 * Kept out of the Firebase chunk so screens can show the switch without loading the SDK.
 */
import { useSyncExternalStore } from 'react';

export type PushSupport = 'ok' | 'install-first' | 'denied' | 'unsupported';

const KEY = 'lt-push-device';
interface Device {
  uid: string;
  /** Id of the token document in users/{uid}/push. */
  id: string;
  at: number;
}

const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function savedDevice(): Device | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    return v && typeof v.uid === 'string' && typeof v.id === 'string' ? (v as Device) : null;
  } catch {
    return null;
  }
}
export function rememberDevice(d: Device): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(d));
  } catch {
    // not remembered: the switch shows off and can be turned on again
  }
  emit();
}
export function forgetDevice(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // nothing stored
  }
  emit();
}

const isIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = () => window.matchMedia?.('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;

export function pushSupport(): PushSupport {
  // iPhone only allows notifications for apps added to the home screen.
  if (isIos() && !standalone()) return 'install-first';
  if (import.meta.env.DEV || !('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  return 'ok';
}

/** True when this device gets notifications for this account. */
export function pushOn(uid: string | undefined): boolean {
  const d = savedDevice();
  return !!uid && d?.uid === uid && 'Notification' in window && Notification.permission === 'granted';
}

const snapshot = () => {
  try {
    return (localStorage.getItem(KEY) ?? '') + (('Notification' in window && Notification.permission) || '');
  } catch {
    return '';
  }
};

/** Re-renders when notifications are turned on or off on this device. */
export function usePushChanges(): void {
  useSyncExternalStore(
    (l) => (listeners.add(l), () => void listeners.delete(l)),
    snapshot,
    () => '',
  );
}

/**
 * Turns notifications on: asks for permission (must run from a tap), then registers the device.
 * Returns a message when it could not be done.
 */
export async function turnOnPush(uid: string): Promise<string | null> {
  if (pushSupport() !== 'ok') return null;
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') {
    emit();
    return perm === 'denied' ? 'Notifications are blocked. Allow them for Lap Timer in your phone settings.' : null;
  }
  try {
    await (await import('./cloud/push')).enablePush(uid);
    return null;
  } catch {
    return 'Could not turn notifications on. Check your connection and try again.';
  }
}

export async function turnOffPush(): Promise<void> {
  await (await import('./cloud/push')).disablePush();
}
