import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { LegalLinks } from './Legal';
import { PageHeader } from '../components/AppShell';
import { SAFETY_DETAIL, SAFETY_TEXT, acceptSafety } from '../lib/safety';
import { Button, ConfirmButton, Field, Input, Notice, Panel, Segmented, Spinner } from '../components/ui/primitives';
import { useAccount } from '../hooks/useData';
import { deleteAccount, describeError, login, logout, register, resetPassword, signInWith, syncNow, updateProfile, usesPassword } from '../lib/cloud/account';
import type { SocialProvider } from '../lib/cloud/firebase';
import { validateCar, validateNickname } from '../lib/cloud/leaderboard';

type Mode = 'login' | 'register' | 'reset';

export function Account() {
  const acc = useAccount();

  if (acc.status === 'disabled') {
    return (
      <div className="pb-10">
        <PageHeader title="Account" />
        <div className="mx-auto max-w-lg p-4 md:p-6">
          <Notice title="Accounts are not configured">This build has no cloud project configured, so data stays on this device. Use Settings → Export/Import to move it.</Notice>
        </div>
      </div>
    );
  }

  return (
    <div className="pb-10">
      <PageHeader title="Account" subtitle="Sign in to back up your circuits and laps and see them on every device." />
      <div className="mx-auto max-w-lg space-y-4 p-4 md:p-6">
        {acc.status === 'loading' ? <Spinner /> : acc.status === 'signed_in' ? <SignedIn /> : <SignInForm />}
      </div>
    </div>
  );
}

export function SignInForm() {
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [legal, setLegal] = useState(false);
  const [confirm, setConfirm] = useState('');
  const [nickname, setNickname] = useState('');
  const [car, setCar] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setErrorText] = useState<string | null>(null);
  // Counts failed attempts so the message shakes again even when the text is the same.
  const [attempt, setAttempt] = useState(0);
  function setError(m: string | null) {
    setErrorText(m);
    if (m) setAttempt((n) => n + 1);
  }
  const [info, setInfo] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setError('Enter a valid e-mail address.');
    if (mode === 'register') {
      if (password.length < 6) return setError('Use a password with at least 6 characters.');
      if (password !== confirm) return setError('The passwords do not match.');
      const p = validateNickname(nickname) ?? validateCar(car);
      if (p) return setError(p);
      if (!legal) return setError('Please confirm that you will only drive legally.');
    }
    setBusy(true);
    try {
      if (mode === 'login') await login(email, password);
      else if (mode === 'register') {
        await register(email, password, nickname, car);
        await acceptSafety();
      }
      else {
        await resetPassword(email);
        setInfo('If an account exists for this e-mail, a link to set a new password is on its way.');
      }
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      {mode !== 'reset' && <SocialButtons />}
      {mode !== 'reset' && (
        <Segmented
          label="Account"
          itemClass="h-10"
          value={mode}
          onChange={(m) => (setMode(m), setError(null), setInfo(null))}
          options={[
            { value: 'login', label: 'Sign in' },
            { value: 'register', label: 'Create account' },
          ]}
        />
      )}
      <form onSubmit={submit} className="space-y-4 pt-5" noValidate>
        {mode === 'reset' && <p className="anim-reveal text-sm text-muted">Enter your e-mail and we'll send you a link to set a new password.</p>}
        <Field label="E-mail">
          <Input type="email" autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={200} required />
        </Field>
        {mode !== 'reset' && (
          <Field label="Password" hint={mode === 'register' ? 'At least 6 characters.' : undefined}>
            <Input type="password" autoComplete={mode === 'register' ? 'new-password' : 'current-password'} value={password} onChange={(e) => setPassword(e.target.value)} maxLength={200} required />
          </Field>
        )}
        {mode === 'register' && (
          <div className="anim-reveal space-y-4">
            <Field label="Confirm password">
              <Input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} maxLength={200} required />
            </Field>
            <Field label="Nickname" hint="Shown on leaderboards. 3–20 characters, must be unique.">
              <Input autoComplete="nickname" value={nickname} onChange={(e) => setNickname(e.target.value)} maxLength={20} required />
            </Field>
            <Field label="Car" hint='Shown next to your times, e.g. "Škoda Octavia RS 2.0 TSI".'>
              <Input value={car} onChange={(e) => setCar(e.target.value)} maxLength={60} required />
            </Field>
            <label className="flex items-start gap-3 rounded border border-line p-3 text-sm">
              <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-[rgb(var(--c-accent))]" checked={legal} onChange={(e) => setLegal(e.target.checked)} />
              <span>
                {SAFETY_TEXT} <span className="text-muted">{SAFETY_DETAIL}</span>
              </span>
            </label>
            <p className="text-xs text-muted">
              By creating an account you agree to the{' '}
              <Link to="/terms" className="underline underline-offset-4">
                terms of use
              </Link>{' '}
              and the{' '}
              <Link to="/privacy" className="underline underline-offset-4">
                privacy policy
              </Link>
              .
            </p>
          </div>
        )}
        {error && (
          <p key={attempt} role="alert" className="anim-shake text-sm text-loss">
            {error}
          </p>
        )}
        {info && <Notice>{info}</Notice>}
        <Button type="submit" variant="primary" size="xl" className="w-full !text-xl !font-extrabold" disabled={busy}>
          {busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : mode === 'register' ? 'Create account' : 'Send reset link'}
        </Button>
        <div className="text-center text-sm">
          {mode === 'login' && (
            <button type="button" className="text-muted underline underline-offset-4 hover:text-fg" onClick={() => (setMode('reset'), setError(null))}>
              Forgot password?
            </button>
          )}
          {mode === 'reset' && (
            <button type="button" className="text-muted underline underline-offset-4 hover:text-fg" onClick={() => (setMode('login'), setError(null), setInfo(null))}>
              ← Back to sign in
            </button>
          )}
        </div>
        {mode === 'register' && (
          <p className="text-xs text-muted">
            Circuits and laps already on this device are uploaded to the new account. Raw GPS fixes stay on the device; lap traces (positions along the circuit) are stored in
            the account.
          </p>
        )}
      </form>
    </div>
  );
}

/**
 * "Continue with Apple / Google", for the providers switched on in Firebase. Styled to each
 * brand's rules for dark backgrounds (Apple: white button; Google: dark button with the full-colour G).
 */
function SocialButtons() {
  const acc = useAccount();
  const [busy, setBusy] = useState<SocialProvider | null>(null);
  if (!acc.providers.length) return null;
  async function go(p: SocialProvider) {
    setBusy(p);
    await signInWith(p).finally(() => setBusy(null));
  }
  return (
    <div className="mb-6">
      <div className="space-y-3">
        {acc.providers.includes('apple') && (
          <button type="button" disabled={!!busy} onClick={() => void go('apple')} className="press flex h-12 w-full items-center justify-center gap-2.5 rounded-lg bg-white text-[17px] font-semibold text-black disabled:opacity-60">
            <AppleLogo /> {busy === 'apple' ? 'Opening Apple…' : 'Continue with Apple'}
          </button>
        )}
        {acc.providers.includes('google') && (
          <button type="button" disabled={!!busy} onClick={() => void go('google')} className="press flex h-12 w-full items-center justify-center gap-2.5 rounded-lg border border-[#8e918f] bg-[#131314] text-[16px] font-medium text-[#e3e3e3] disabled:opacity-60">
            <GoogleLogo /> {busy === 'google' ? 'Opening Google…' : 'Continue with Google'}
          </button>
        )}
      </div>
      {acc.authError && (
        <p role="alert" className="anim-shake mt-3 text-sm text-loss">
          {acc.authError}
        </p>
      )}
      <div className="mt-6 flex items-center gap-3 text-xs font-semibold uppercase tracking-[0.12em] text-muted" aria-hidden="true">
        <span className="h-px flex-1 bg-line" /> or with e-mail <span className="h-px flex-1 bg-line" />
      </div>
    </div>
  );
}

function AppleLogo() {
  return (
    <svg width="17" height="20" viewBox="0 0 17 20" aria-hidden="true" fill="currentColor">
      <path d="M14.06 10.62c-.02-2.2 1.8-3.26 1.88-3.31-1.03-1.5-2.62-1.7-3.18-1.73-1.35-.14-2.64.8-3.33.8-.69 0-1.74-.78-2.87-.76-1.47.02-2.83.86-3.59 2.18-1.53 2.66-.39 6.6 1.1 8.75.73 1.05 1.6 2.24 2.73 2.2 1.1-.05 1.51-.71 2.84-.71 1.32 0 1.7.71 2.86.69 1.18-.02 1.93-1.07 2.65-2.13.84-1.22 1.18-2.4 1.2-2.47-.03-.01-2.27-.87-2.29-3.45zM11.9 4.15c.6-.73 1.01-1.75.9-2.76-.87.04-1.92.58-2.54 1.31-.56.65-1.05 1.68-.92 2.67.97.08 1.96-.49 2.56-1.22z" />
    </svg>
  );
}

function GoogleLogo() {
  return (
    <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

function SignedIn() {
  const acc = useAccount();
  const [busy, setBusy] = useState(false);
  const r = acc.lastReport;
  return (
    <>
      {acc.profile === null && (
        <Panel title="Complete your profile">
          <p className="mb-3 text-sm text-muted">Choose the nickname and car shown next to your times on the leaderboards. Your best real-GPS laps on official tracks are published automatically.</p>
          <ProfileForm submitLabel="Save profile" />
        </Panel>
      )}
      <Panel title="Signed in">
        <div className="text-lg font-semibold">{acc.user?.email}</div>
        {acc.profile && (
          <div className="mt-1 text-sm">
            <span className="font-semibold">{acc.profile.nickname}</span> <span className="text-muted">· {acc.profile.car}</span>
          </div>
        )}
        <p className="mt-1 text-sm text-muted">Your circuits and laps are saved to this account. Sign in with the same e-mail on another device to see them there.</p>
      </Panel>
      {acc.profile && <EditProfile />}
      <Panel title="Sync">
        <div className="flex items-center justify-between gap-3">
          <div>
            <SyncLine />
            {r && (r.uploaded > 0 || r.downloaded > 0 || r.deleted > 0) && (
              <div className="mt-1 text-xs text-muted">
                Last sync: {r.uploaded} uploaded, {r.downloaded} downloaded{r.deleted ? `, ${r.deleted} deleted` : ''}.
              </div>
            )}
          </div>
          <Button onClick={() => void syncNow()} disabled={acc.sync === 'syncing'}>
            {acc.sync === 'syncing' ? 'Syncing…' : 'Sync now'}
          </Button>
        </div>
        {acc.syncError && (
          <div className="mt-3">
            <Notice tone="error">{acc.syncError}</Notice>
          </div>
        )}
        <p className="mt-3 text-xs text-muted">
          Sync runs automatically after each drive and every few minutes while the app is open. Everything keeps working offline; changes are sent when you're back online.
        </p>
      </Panel>
      <Panel title="Sign out">
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await logout(false).finally(() => setBusy(false));
            }}
          >
            Sign out
          </Button>
          <ConfirmButton
            disabled={busy}
            onConfirm={async () => {
              setBusy(true);
              await logout(true).finally(() => setBusy(false));
            }}
            confirmLabel="Tap again: sign out & remove from this device"
          >
            Sign out and remove data from this device
          </ConfirmButton>
        </div>
        <p className="mt-2 text-xs text-muted">Removing data from this device does not delete it from your account. Use it on shared computers.</p>
      </Panel>
      <DeleteAccount />
      <nav aria-label="Legal" className="flex gap-5 px-1 text-sm text-muted">
        <LegalLinks />
      </nav>
    </>
  );
}

/** Deletes the account and everything in it, after the password (or Google / Apple) once more. */
function DeleteAccount() {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [needsPassword, setNeedsPassword] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void usesPassword().then(setNeedsPassword);
  }, []);
  async function go() {
    setError(null);
    if (needsPassword && !password) return setError('Enter your password.');
    setBusy(true);
    try {
      await deleteAccount(needsPassword ? password : null);
    } catch (e) {
      setError(describeError(e) || 'Could not delete the account. Try again.');
      setBusy(false);
    }
  }
  return (
    <Panel title="Delete account">
      <p className="text-sm text-muted">
        Deletes your account for good: your profile and nickname, your times on every leaderboard, your public roads with their leaderboards, and all circuits and drives saved
        in the account and on this device. This cannot be undone.
      </p>
      {!open ? (
        <Button variant="danger" className="mt-3" onClick={() => setOpen(true)}>
          Delete account
        </Button>
      ) : (
        <div className="mt-3 space-y-3">
          {needsPassword && (
            <Field label="Password">
              <Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} maxLength={200} />
            </Field>
          )}
          {error && (
            <p role="alert" className="anim-shake text-sm text-loss">
              {error}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <ConfirmButton disabled={busy} onConfirm={go} confirmLabel="Tap again: delete everything">
              {busy ? 'Deleting…' : 'Delete my account'}
            </ConfirmButton>
            <Button disabled={busy} onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </Panel>
  );
}

/** One-line sync status, e.g. "Synced 2 min ago". */
export function SyncLine() {
  const acc = useAccount();
  let text = 'Not synced yet';
  let tone = 'text-muted';
  if (acc.sync === 'syncing') text = 'Syncing…';
  else if (acc.sync === 'offline') {
    text = 'Offline: changes will sync when you are back online';
    tone = 'text-warn';
  } else if (acc.sync === 'error') {
    text = 'Sync failed';
    tone = 'text-loss';
  } else if (acc.lastSyncAt) text = `Synced ${relativeTime(acc.lastSyncAt)}`;
  return <div className={`text-sm ${tone}`}>{text}</div>;
}

function relativeTime(t: number): string {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  return new Date(t).toLocaleString();
}

export function ProfileForm({ submitLabel, onDone, wide = false, requireLegal = false }: { submitLabel: string; onDone?: () => void; wide?: boolean; requireLegal?: boolean }) {
  const acc = useAccount();
  const [legal, setLegal] = useState(false);
  const [nickname, setNickname] = useState(acc.profile?.nickname ?? '');
  const [car, setCar] = useState(acc.profile?.car ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const p = validateNickname(nickname) ?? validateCar(car);
    if (p) return setError(p);
    if (requireLegal && !legal) return setError('Please confirm that you will only drive legally.');
    setBusy(true);
    try {
      await updateProfile({ nickname, car });
      if (requireLegal) await acceptSafety();
      onDone?.();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3" noValidate>
      <Field label="Nickname" hint="3–20 characters, unique.">
        <Input value={nickname} onChange={(e) => setNickname(e.target.value)} maxLength={20} autoComplete="nickname" />
      </Field>
      <Field label="Car">
        <Input value={car} onChange={(e) => setCar(e.target.value)} maxLength={60} placeholder="e.g. Škoda Octavia RS 2.0 TSI" />
      </Field>
      {requireLegal && (
        <>
          <label className="flex items-start gap-3 rounded border border-line p-3 text-sm">
            <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-[rgb(var(--c-accent))]" checked={legal} onChange={(e) => setLegal(e.target.checked)} />
            <span>
              {SAFETY_TEXT} <span className="text-muted">{SAFETY_DETAIL}</span>
            </span>
          </label>
          <p className="text-xs text-muted">
            By continuing you agree to the{' '}
            <Link to="/terms" className="underline underline-offset-4">
              terms of use
            </Link>{' '}
            and the{' '}
            <Link to="/privacy" className="underline underline-offset-4">
              privacy policy
            </Link>
            .
          </p>
        </>
      )}
      {error && (
        <p role="alert" className="anim-shake text-sm text-loss">
          {error}
        </p>
      )}
      <Button type="submit" variant="primary" size={wide ? 'xl' : 'md'} className={wide ? 'w-full !text-xl !font-extrabold' : ''} disabled={busy}>
        {busy ? 'Saving…' : submitLabel}
      </Button>
    </form>
  );
}

function EditProfile() {
  const [editing, setEditing] = useState(false);
  return (
    <Panel title="Leaderboard profile" actions={!editing && <Button size="sm" onClick={() => setEditing(true)}>Edit</Button>}>
      {editing ? (
        <ProfileForm submitLabel="Save changes" onDone={() => setEditing(false)} />
      ) : (
        <p className="text-sm text-muted">Your nickname and car appear on the leaderboards next to your best laps on official tracks. Simulated laps are never published.</p>
      )}
    </Panel>
  );
}
