import { useState } from 'react';
import { useAccount } from '../hooks/useData';
import { pushOn, pushSupport, turnOffPush, turnOnPush, usePushChanges } from '../lib/pushState';
import { IconBell } from './ui/icons';

const WHY: Record<string, string> = {
  'install-first': 'On iPhone, add Lap Timer to your home screen first (Share, Add to Home Screen) and turn this on there.',
  denied: 'Notifications are blocked for Lap Timer. Allow them in your phone settings.',
  unsupported: 'This browser cannot show notifications.',
};

/**
 * "Tell me when someone beats my time": a row with a switch. Turning it on asks the phone for
 * permission, so it must come from the tap itself.
 */
export function NotifySwitch({ className = '' }: { className?: string }) {
  const acc = useAccount();
  usePushChanges();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const uid = acc.user?.uid;
  if (acc.status !== 'signed_in' || !uid) return null;
  const support = pushSupport();
  const on = pushOn(uid);

  async function toggle() {
    setBusy(true);
    setError(null);
    try {
      if (on) await turnOffPush();
      else setError(await turnOnPush(uid!));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={className}>
      <label className={`flex items-center gap-3 ${support === 'ok' || on ? 'cursor-pointer' : ''}`}>
        <IconBell width={20} height={20} className={`shrink-0 ${on ? 'text-accent' : 'text-muted'}`} />
        <span className="min-w-0 flex-1">
          <span className="block">Tell me when someone beats my time</span>
          {!on && support !== 'ok' && <span className="mt-0.5 block text-xs text-muted">{WHY[support]}</span>}
        </span>
        <input type="checkbox" role="switch" className="peer sr-only" checked={on} disabled={busy || (!on && support !== 'ok')} onChange={() => void toggle()} />
        <span
          aria-hidden="true"
          className="relative h-7 w-12 shrink-0 rounded-full border border-line bg-raised transition-colors after:absolute after:left-0.5 after:top-0.5 after:h-[22px] after:w-[22px] after:rounded-full after:bg-muted after:transition-transform motion-reduce:after:transition-none peer-checked:border-accent peer-checked:bg-accent peer-checked:after:translate-x-5 peer-checked:after:bg-white peer-disabled:opacity-40 peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-accent"
        />
      </label>
      {error && (
        <p role="alert" className="anim-shake mt-2 text-sm text-loss">
          {error}
        </p>
      )}
    </div>
  );
}
