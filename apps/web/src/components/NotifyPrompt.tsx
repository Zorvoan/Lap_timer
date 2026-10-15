import { useEffect, useState } from 'react';
import { useAccount } from '../hooks/useData';
import { pushOn, pushSupport, turnOnPush } from '../lib/pushState';
import { Button, Sheet } from './ui/primitives';
import { IconBell } from './ui/icons';

const ASKED_KEY = 'lt-push-asked';
/** After "Not now", ask again a week later. */
const ASK_AGAIN_MS = 7 * 24 * 3600_000;
let shownThisRun = false;

function askedRecently(): boolean {
  try {
    return Date.now() - Number(localStorage.getItem(ASKED_KEY) ?? 0) < ASK_AGAIN_MS;
  } catch {
    return false;
  }
}
function rememberAsked() {
  try {
    localStorage.setItem(ASKED_KEY, String(Date.now()));
  } catch {
    // asked again next start
  }
}

/**
 * When the app opens: "Know when someone beats your time?", for a signed-in driver whose device
 * can get notifications but doesn't yet. The permission request itself comes from the Turn on tap.
 */
export function NotifyPrompt({ paused }: { paused: boolean }) {
  const acc = useAccount();
  const uid = acc.user?.uid;
  const eligible = !!uid && !!acc.profile && pushSupport() === 'ok' && !pushOn(uid) && !askedRecently() && !shownThisRun;
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!eligible || paused) return;
    // A moment after the app appears, not on top of its first frame.
    const t = setTimeout(() => {
      shownThisRun = true;
      setOpen(true);
    }, 1200);
    return () => clearTimeout(t);
  }, [eligible, paused]);

  function later() {
    rememberAsked();
    setOpen(false);
  }

  async function turnOn() {
    setBusy(true);
    setError(null);
    const problem = await turnOnPush(uid!);
    setBusy(false);
    if (problem) return setError(problem);
    rememberAsked();
    setOpen(false);
  }

  return (
    <Sheet open={open} onClose={later} labelledBy="notify-title" center>
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent">
          <IconBell width={20} height={20} />
        </span>
        <div className="min-w-0">
          <h2 id="notify-title" className="font-display text-xl font-black leading-tight">
            Know when someone beats your time?
          </h2>
          <p className="mt-1 text-sm text-muted">You get a notification when another driver goes faster than you on an official road.</p>
        </div>
      </div>
      {error && (
        <p role="alert" className="anim-shake mt-3 text-sm text-loss">
          {error}
        </p>
      )}
      <div className="mt-4 grid grid-cols-2 gap-3">
        <Button size="lg" onClick={later} disabled={busy}>
          Not now
        </Button>
        <Button size="lg" variant="primary" onClick={() => void turnOn()} disabled={busy}>
          {busy ? 'Turning on…' : 'Turn on'}
        </Button>
      </div>
      <p className="mt-3 text-xs text-muted">You can change this any time under Me.</p>
    </Sheet>
  );
}
