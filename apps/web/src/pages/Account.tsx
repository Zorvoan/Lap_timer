import { useState, type FormEvent } from 'react';
import { PageHeader } from '../components/AppShell';
import { SAFETY_DETAIL, SAFETY_TEXT, acceptSafety } from '../lib/safety';
import { Button, ConfirmButton, Field, Input, Notice, Panel, Spinner } from '../components/ui/primitives';
import { useAccount } from '../hooks/useData';
import { describeError, login, logout, register, resetPassword, syncNow, updateProfile } from '../lib/cloud/account';
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

function SignInForm() {
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [legal, setLegal] = useState(false);
  const [confirm, setConfirm] = useState('');
  const [nickname, setNickname] = useState('');
  const [car, setCar] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
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

  const tabs: { id: Mode; label: string }[] = [
    { id: 'login', label: 'Sign in' },
    { id: 'register', label: 'Create account' },
  ];

  return (
    <Panel bodyClass="p-0">
      {mode !== 'reset' && (
        <div className="grid grid-cols-2 border-b border-line" role="tablist">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={mode === t.id}
              onClick={() => (setMode(t.id), setError(null), setInfo(null))}
              className={`h-12 text-sm font-semibold uppercase tracking-wider ${mode === t.id ? 'border-b-2 border-accent text-fg' : 'text-muted'}`}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}
      <form onSubmit={submit} className="space-y-4 p-4" noValidate>
        {mode === 'reset' && <p className="text-sm text-muted">Enter your e-mail and we'll send you a link to set a new password.</p>}
        <Field label="E-mail">
          <Input type="email" autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={200} required />
        </Field>
        {mode !== 'reset' && (
          <Field label="Password" hint={mode === 'register' ? 'At least 6 characters.' : undefined}>
            <Input type="password" autoComplete={mode === 'register' ? 'new-password' : 'current-password'} value={password} onChange={(e) => setPassword(e.target.value)} maxLength={200} required />
          </Field>
        )}
        {mode === 'register' && (
          <>
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
          </>
        )}
        {error && (
          <p role="alert" className="text-sm text-loss">
            {error}
          </p>
        )}
        {info && <Notice>{info}</Notice>}
        <Button type="submit" variant="primary" size="lg" className="w-full" disabled={busy}>
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
    </Panel>
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
    </>
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

function ProfileForm({ submitLabel, onDone }: { submitLabel: string; onDone?: () => void }) {
  const acc = useAccount();
  const [nickname, setNickname] = useState(acc.profile?.nickname ?? '');
  const [car, setCar] = useState(acc.profile?.car ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const p = validateNickname(nickname) ?? validateCar(car);
    if (p) return setError(p);
    setBusy(true);
    try {
      await updateProfile({ nickname, car });
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
      {error && (
        <p role="alert" className="text-sm text-loss">
          {error}
        </p>
      )}
      <Button type="submit" variant="primary" disabled={busy}>
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
