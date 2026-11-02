import { useEffect, useState, useSyncExternalStore } from 'react';
import { install, promptInstall } from '../lib/install';
import { Button, Panel, Sheet } from './ui/primitives';
import { IconDownload, IconX } from './ui/icons';

const DISMISS_KEY = 'laptimer:installDismissed';
const SNOOZE_KEY = 'laptimer:installPromptAt';
/** After "Not now", offer again a week later. */
const OFFER_AGAIN_MS = 7 * 24 * 3600_000;

function useInstall() {
  return useSyncExternalStore(install.subscribe, install.getState);
}

function ShareIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth={2} className="inline align-[-3px]" aria-label="Share">
      <path d="M12 3v12M8 7l4-4 4 4M5 11v9h14v-9" />
    </svg>
  );
}

function Steps({ platform }: { platform: 'ios' | 'android' | 'desktop' }) {
  if (platform === 'ios') {
    return (
      <ol className="list-decimal space-y-1 pl-5 text-sm text-muted">
        <li>
          Tap <b className="text-fg">Share</b> <ShareIcon /> in the browser bar (in some browsers it's under <b className="text-fg">⋯</b>).
        </li>
        <li>
          Choose <b className="text-fg">Add to Home Screen</b> and confirm with <b className="text-fg">Add</b>.
        </li>
        <li>Open Lap Timer from the home screen: full screen, no browser bars.</li>
      </ol>
    );
  }
  return (
    <p className="text-sm text-muted">
      Open the browser menu <b className="text-fg">⋮</b> and choose <b className="text-fg">Install app</b> or <b className="text-fg">Add to Home screen</b>.
    </p>
  );
}

/** Install instructions / button. Renders nothing once the app runs installed. */
export function InstallCard({ dismissible = false }: { dismissible?: boolean }) {
  const s = useInstall();
  const [dismissed, setDismissed] = useState(() => {
    try {
      return dismissible && localStorage.getItem(DISMISS_KEY) === '1';
    } catch {
      return false;
    }
  });
  if (s.installed || dismissed) return null;

  function dismiss() {
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      /* storage unavailable */
    }
    setDismissed(true);
  }

  return (
    <Panel
      title="Install the app"
      actions={
        dismissible && (
          <Button size="sm" variant="ghost" aria-label="Hide" onClick={dismiss}>
            <IconX width={16} height={16} />
          </Button>
        )
      }
    >
      <p className="mb-3 text-sm">Add Lap Timer to your home screen: it opens full screen like a normal app and works offline.</p>
      {s.canPrompt ? (
        <Button variant="primary" onClick={() => void promptInstall()}>
          <IconDownload width={18} height={18} /> Install Lap Timer
        </Button>
      ) : (
        <Steps platform={s.platform} />
      )}
    </Panel>
  );
}

const remember = (key: string, value = '1') => {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable */
  }
};

/**
 * "Add to home screen" in one tap where the browser allows it (Chrome and Edge on Android and
 * computers show their own install dialog); elsewhere, notably iPhone, where no website may add
 * itself, a sheet with the few steps instead.
 */
function useAddToHomeScreen() {
  const s = useInstall();
  const [steps, setSteps] = useState(false);
  const add = () => (s.canPrompt ? void promptInstall() : setSteps(true));
  const sheet = (
    <Sheet open={steps} onClose={() => setSteps(false)} labelledBy="install-title" center>
      <h2 id="install-title" className="font-display text-xl font-black">
        Add to home screen
      </h2>
      <p className="mb-3 mt-1 text-sm">{s.platform === 'ios' ? 'iPhone adds apps from the browser menu:' : 'Your browser adds apps from its menu:'}</p>
      <Steps platform={s.platform} />
      <Button className="mt-4 w-full" onClick={() => setSteps(false)}>
        Got it
      </Button>
    </Sheet>
  );
  return { installed: s.installed, add, sheet };
}

/** A big "Add to home screen" button, for the welcome screen. Nothing once the app runs installed. */
export function InstallButton() {
  const { installed, add, sheet } = useAddToHomeScreen();
  if (installed) return null;
  return (
    <>
      <Button size="lg" className="w-full" onClick={add}>
        <IconDownload width={18} height={18} /> Add to home screen
      </Button>
      {sheet}
    </>
  );
}

/** Whether the home screen offer was shown in this run, so other first-run prompts wait for the next one. */
let offered = false;
const offerListeners = new Set<() => void>();
export function useInstallOffered(): boolean {
  return useSyncExternalStore(
    (l) => {
      offerListeners.add(l);
      return () => offerListeners.delete(l);
    },
    () => offered,
  );
}

function snoozed(): boolean {
  try {
    return Date.now() - Number(localStorage.getItem(SNOOZE_KEY) ?? 0) < OFFER_AGAIN_MS;
  } catch {
    return false;
  }
}

/**
 * A moment after the app opens in a browser: "Add Lap Timer to your home screen?". Add installs it
 * where the browser can (or shows the steps, on iPhone); Not now offers again a week later.
 */
export function InstallPrompt({ paused }: { paused: boolean }) {
  const s = useInstall();
  const [open, setOpen] = useState(false);
  const [steps, setSteps] = useState(false);
  const eligible = !s.installed && !snoozed() && !offered;

  useEffect(() => {
    if (!eligible || paused) return;
    const t = setTimeout(() => {
      offered = true;
      for (const l of offerListeners) l();
      setOpen(true);
    }, 2000);
    return () => clearTimeout(t);
  }, [eligible, paused]);

  function later() {
    remember(SNOOZE_KEY, String(Date.now()));
    setOpen(false);
  }

  async function add() {
    if (!s.canPrompt) return setSteps(true);
    const accepted = await promptInstall();
    if (!accepted) remember(SNOOZE_KEY, String(Date.now()));
    setOpen(false);
  }

  return (
    <Sheet open={open && !s.installed} onClose={later} labelledBy="install-offer-title" center>
      <div className="flex items-start gap-3">
        <img src="/pwa-192x192.png" alt="" className="h-12 w-12 shrink-0 rounded-xl" />
        <div className="min-w-0">
          <h2 id="install-offer-title" className="font-display text-xl font-black leading-tight">
            Add Lap Timer to your home screen?
          </h2>
          <p className="mt-1 text-sm text-muted">It opens full screen like a normal app, starts faster and works without signal.</p>
        </div>
      </div>
      {steps ? (
        <>
          <div className="mt-4">
            <Steps platform={s.platform} />
          </div>
          <Button size="lg" className="mt-4 w-full" onClick={() => setOpen(false)}>
            Got it
          </Button>
        </>
      ) : (
        <div className="mt-4 grid grid-cols-2 gap-3">
          <Button size="lg" onClick={later}>
            Not now
          </Button>
          <Button size="lg" variant="primary" onClick={() => void add()}>
            <IconDownload width={18} height={18} /> Add
          </Button>
        </div>
      )}
    </Sheet>
  );
}
