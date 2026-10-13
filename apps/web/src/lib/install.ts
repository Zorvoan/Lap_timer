/**
 * "Add to home screen" support. Chromium browsers fire `beforeinstallprompt`, which lets the app
 * show its own Install button; iOS has no such API, so the UI shows the Share → Add to Home
 * Screen steps instead.
 */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export interface InstallState {
  /** Running as an installed app (home screen / standalone window). */
  installed: boolean;
  /** The browser offered an install prompt we can trigger. */
  canPrompt: boolean;
  platform: 'ios' | 'android' | 'desktop';
}

let deferred: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();

function detectPlatform(): InstallState['platform'] {
  const ua = navigator.userAgent;
  const iPadOS = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  if (/iPhone|iPad|iPod/.test(ua) || iPadOS) return 'ios';
  if (/Android/.test(ua)) return 'android';
  return 'desktop';
}

function isStandalone(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

let state: InstallState = { installed: false, canPrompt: false, platform: 'desktop' };

function set(patch: Partial<InstallState>) {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

/** Call once at startup, before the browser fires its install event. */
export function initInstall(): void {
  state = { installed: isStandalone(), canPrompt: false, platform: detectPlatform() };
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    set({ canPrompt: true });
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    set({ installed: true, canPrompt: false });
  });
  window.matchMedia('(display-mode: standalone)').addEventListener('change', () => set({ installed: isStandalone() }));
}

export async function promptInstall(): Promise<boolean> {
  if (!deferred) return false;
  await deferred.prompt();
  const { outcome } = await deferred.userChoice;
  deferred = null;
  set({ canPrompt: false });
  return outcome === 'accepted';
}

export const install = {
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  getState: () => state,
};
