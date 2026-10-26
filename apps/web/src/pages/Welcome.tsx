import type { CSSProperties, ReactNode } from 'react';
import { Button, Notice } from '../components/ui/primitives';
import { useAccount } from '../hooks/useData';
import { logout } from '../lib/cloud/account';
import { ProfileForm, SignInForm } from './Account';
import { LegalLinks } from './Legal';

/**
 * The first screen for anyone not signed in: what the app is, then sign in or create an account.
 * Signed in without a nickname and car, it asks for those instead. Shown by AppShell in place of
 * the app until both are done.
 */
export function Welcome() {
  const acc = useAccount();

  if (acc.status === 'loading') {
    // Only shows when starting takes a moment, so a quick start doesn't flash a splash.
    return (
      <div className="flex h-full flex-col items-center justify-center gap-5 bg-bg" style={{ animation: 'lt-fade-in 300ms ease 400ms backwards' }}>
        <Wordmark />
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-muted border-t-transparent" role="status" aria-label="Loading" />
      </div>
    );
  }

  const needsProfile = acc.status === 'signed_in';
  const official = acc.featured.length;

  return (
    <div className="h-full overflow-y-auto overflow-x-hidden bg-bg pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]">
      <div className="mx-auto flex min-h-full max-w-md flex-col px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(1.5rem,env(safe-area-inset-top))]">
        <Step i={0}>
          <Wordmark />
        </Step>

        {needsProfile ? (
          <>
            <Step i={1} className="mt-12">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#d08a4e]">One more thing</div>
              <h1 className="mt-1 font-display text-[2.4rem] font-black leading-[1.02] tracking-tight">Who&apos;s driving?</h1>
            </Step>
            <Step i={2}>
              <p className="mt-3 text-muted">Your nickname and car stand next to your times on the leaderboard.</p>
            </Step>
            <Step i={3} className="mt-8">
              <ProfileForm submitLabel="Continue" wide requireLegal />
              <button type="button" onClick={() => void logout(false)} className="mt-6 text-sm text-muted underline underline-offset-4 hover:text-fg">
                Sign out{acc.user?.email ? ` (${acc.user.email})` : ''}
              </button>
            </Step>
          </>
        ) : (
          <>
            <Step i={1} className="mt-12">
              {official > 0 && <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#d08a4e]">{official} official stages</div>}
              <h1 className="mt-1 font-display text-[2.6rem] font-black leading-[1.02] tracking-tight">
                Every road,
                <br />
                timed.
              </h1>
            </Step>
            <Step i={2}>
              <p className="mt-3 text-muted">Drive the stages, keep every time, and see where you stand against other drivers.</p>
            </Step>
            {acc.syncError && (
              <div className="mt-6">
                <Notice tone="error" action={<Button size="sm" onClick={() => location.reload()}>Retry</Button>}>
                  {acc.syncError}
                </Notice>
              </div>
            )}
            <Step i={3} className="mt-8">
              <SignInForm />
            </Step>
          </>
        )}
        <nav aria-label="Legal" className="mt-auto flex gap-5 pt-10 text-xs text-muted">
          <LegalLinks />
        </nav>
      </div>
    </div>
  );
}

function Wordmark() {
  return (
    <div className="flex items-center gap-2">
      <span className="h-4 w-1.5 bg-accent" aria-hidden="true" />
      <span className="text-sm font-bold uppercase tracking-[0.2em]">Lap Timer</span>
    </div>
  );
}

/** One part of the screen, rising into place a beat after the one before. */
function Step({ i, className = '', children }: { i: number; className?: string; children: ReactNode }) {
  return (
    <div className={`anim-stagger ${className}`} style={{ '--i': i } as CSSProperties}>
      {children}
    </div>
  );
}
