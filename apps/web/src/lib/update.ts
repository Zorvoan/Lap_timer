import { Workbox } from 'workbox-window';
import { liveController } from './liveController';

/**
 * Picks up new versions of the app. The service worker looks for one when the app starts, when
 * it comes back to the foreground and every half hour. A new version is switched to (one reload)
 * at a safe moment: on load, on returning to the app or on moving to another page, never while
 * a session is being timed or a circuit is being edited, where a reload would lose work.
 *
 * If the new version takes over while timing or editing has started meanwhile (another page or
 * tab triggered it), the reload waits until that is over.
 */
const CHECK_EVERY_MS = 30 * 60_000;

let wb: Workbox | null = null;
/** A new version is installed and waiting for the go-ahead. */
let waiting = false;
/** The new version has taken over; this page still runs the old code. */
let reloadPending = false;

function busy(): boolean {
  const s = liveController.getState().status;
  if (s === 'running' || s === 'paused' || s === 'saving') return true;
  return /^\/live(\/|$)|\/(new|edit|record)(\/|$)/.test(window.location.pathname);
}

/** Switches to a downloaded version if nothing would be lost by reloading now. */
export function applyUpdateIfReady(): void {
  if (busy()) return;
  if (reloadPending) {
    window.location.reload();
  } else if (waiting && wb) {
    waiting = false;
    wb.messageSkipWaiting();
    // Requests still open in this page (Firestore keeps one open while connected) hold the old
    // version in place; leaving the page ends them, and the new version takes over the reload.
    setTimeout(() => window.location.reload(), 300);
  }
}

export function initUpdates(): void {
  if (!('serviceWorker' in navigator) || import.meta.env.DEV) return;
  const w = new Workbox('/sw.js', { scope: '/' });
  wb = w;
  w.addEventListener('waiting', () => {
    waiting = true;
    applyUpdateIfReady();
  });
  w.addEventListener('controlling', (e) => {
    // A new version took over (switched here or from another tab).
    if (!e.isUpdate && !e.isExternal) return;
    reloadPending = true;
    applyUpdateIfReady();
  });
  void w.register().then((reg) => {
    if (!reg) return;
    const check = () => {
      if (document.visibilityState === 'visible' && navigator.onLine) void reg.update().catch(() => undefined);
    };
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      check();
      applyUpdateIfReady();
    });
    setInterval(check, CHECK_EVERY_MS);
  });
  // A session that ends (or is discarded) frees the app to update.
  liveController.subscribe(() => {
    if ((waiting || reloadPending) && liveController.getState().status === 'idle') applyUpdateIfReady();
  });
}
