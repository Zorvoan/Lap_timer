import { useState, useSyncExternalStore } from 'react';
import { install, promptInstall } from '../lib/install';
import { Button, Panel } from './ui/primitives';
import { IconDownload, IconX } from './ui/icons';

const DISMISS_KEY = 'laptimer:installDismissed';

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
