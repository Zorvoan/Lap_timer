import { useState, useSyncExternalStore } from 'react';
import { install, promptInstall } from '../lib/install';
import { Button, Panel, Sheet } from './ui/primitives';
import { IconDownload, IconX } from './ui/icons';

const DISMISS_KEY = 'laptimer:installDismissed';
const BANNER_KEY = 'laptimer:installBannerHidden';

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

const remembered = (key: string) => {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
};
const remember = (key: string) => {
  try {
    localStorage.setItem(key, '1');
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

/** A slim strip offering the home screen app, until it is installed or hidden. */
export function InstallBanner({ className = '' }: { className?: string }) {
  const { installed, add, sheet } = useAddToHomeScreen();
  const [hidden, setHidden] = useState(() => remembered(BANNER_KEY));
  if (installed || hidden) return null;
  return (
    <div className={`flex items-center gap-3 rounded-lg border border-line bg-raised py-2 pl-3.5 pr-2 ${className}`}>
      <IconDownload width={16} height={16} className="shrink-0 text-accent" />
      <div className="min-w-0 flex-1 text-sm">
        <span className="font-semibold">Get the app</span> <span className="hidden text-muted min-[440px]:inline">full screen, works offline</span>
      </div>
      <Button size="sm" variant="primary" onClick={add}>
        Add to home screen
      </Button>
      <button
        type="button"
        aria-label="Hide"
        className="press flex h-8 w-8 shrink-0 items-center justify-center text-muted"
        onClick={() => {
          remember(BANNER_KEY);
          setHidden(true);
        }}
      >
        <IconX width={16} height={16} />
      </button>
      {sheet}
    </div>
  );
}
