import { useState, useSyncExternalStore } from 'react';
import { Link } from 'react-router-dom';
import { formatLapTime, summarizeSession } from '@laptimer/core';
import { InstallCard } from '../components/InstallCard';
import { SimBadge, Spinner } from '../components/ui/primitives';
import { IconChevronRight, IconUser } from '../components/ui/icons';
import { useAccount, useData } from '../hooks/useData';
import { install } from '../lib/install';
import { listSessions } from '../lib/repo';

/** Everything that is not a track: the account, past drives and settings. */
export function Me() {
  const acc = useAccount();
  const installed = useSyncExternalStore(install.subscribe, install.getState).installed;
  const [showInstall, setShowInstall] = useState(false);
  const { data: sessions, loading } = useData(() => listSessions(), []);
  const recent = (sessions ?? []).slice(0, 3);

  const signedIn = acc.status === 'signed_in';
  const name = acc.profile?.nickname ?? (signedIn ? acc.user?.email ?? 'Signed in' : 'Sign in');
  const initials = acc.profile?.nickname
    ? acc.profile.nickname.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase()
    : signedIn
      ? (acc.user?.email ?? '?')[0].toUpperCase()
      : '';
  const sub = !signedIn
    ? 'Get your times on the leaderboard'
    : acc.profile === null
      ? 'Add a nickname and car'
      : [acc.profile?.car, acc.sync === 'error' ? 'sync failed' : acc.sync === 'offline' ? 'offline' : 'signed in'].filter(Boolean).join(', ');

  return (
    <div className="mx-auto max-w-2xl pb-10">
      <h1 className="px-4 pb-4 pt-5 font-display text-[2.1rem] font-black leading-none tracking-tight">Me</h1>

      {acc.status !== 'disabled' && (
        <Link to="/account" className="flex items-center gap-3 border-y border-line px-4 py-3.5 hover:bg-raised active:bg-raised">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-line bg-raised text-sm font-extrabold text-muted">{initials || <IconUser />}</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-bold">{name}</span>
            <span className={`block truncate text-xs ${acc.sync === 'error' ? 'text-loss' : 'text-muted'}`}>{sub}</span>
          </span>
          <IconChevronRight width={18} height={18} className="text-muted" />
        </Link>
      )}

      <h2 className="label px-4 pb-2 pt-6">My drives</h2>
      <ul className="border-y border-line">
        {loading && !sessions ? (
          <li className="px-4 py-3">
            <Spinner />
          </li>
        ) : recent.length === 0 ? (
          <li className="px-4 py-3 text-sm text-muted">No drives yet. Pick a track and press Drive.</li>
        ) : (
          recent.map((s) => {
            const sum = summarizeSession(s.laps);
            return (
              <li key={s.id} className="border-b border-line last:border-0">
                <Link to={`/sessions/${s.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-raised active:bg-raised">
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 truncate font-semibold">
                      {s.circuitName} {s.source === 'simulated' && <SimBadge />}
                    </span>
                    <span className="block text-xs text-muted">
                      {new Date(s.startedAt).toLocaleDateString()}, {sum.laps} {sum.laps === 1 ? 'lap' : 'laps'}
                    </span>
                  </span>
                  <span className="font-mono text-sm tabular">{formatLapTime(sum.bestLap?.timeMs)}</span>
                  <IconChevronRight width={18} height={18} className="text-muted" />
                </Link>
              </li>
            );
          })
        )}
        {(sessions?.length ?? 0) > recent.length && (
          <li className="border-t border-line">
            <Link to="/sessions" className="flex items-center px-4 py-3 text-sm text-muted hover:bg-raised active:bg-raised hover:text-fg">
              <span className="flex-1">All drives ({sessions!.length})</span>
              <IconChevronRight width={18} height={18} />
            </Link>
          </li>
        )}
      </ul>

      <ul className="mt-6 border-y border-line">
        <MeRow to="/settings" label="Settings" />
        {!installed && (
          <li className="border-b border-line">
            <button type="button" onClick={() => setShowInstall((v) => !v)} aria-expanded={showInstall} className="flex w-full items-center px-4 py-3.5 text-left hover:bg-raised active:bg-raised">
              <span className="flex-1">Install on home screen</span>
              <IconChevronRight width={18} height={18} className={`text-muted transition-transform motion-reduce:transition-none ${showInstall ? 'rotate-90' : ''}`} />
            </button>
            {showInstall && (
              <div className="anim-reveal px-4 pb-4">
                <InstallCard />
              </div>
            )}
          </li>
        )}
        <MeRow to="/help" label="How it works" last />
      </ul>
    </div>
  );
}

function MeRow({ to, label, last = false }: { to: string; label: string; last?: boolean }) {
  return (
    <li className={last ? '' : 'border-b border-line'}>
      <Link to={to} className="flex items-center px-4 py-3.5 hover:bg-raised active:bg-raised">
        <span className="flex-1">{label}</span>
        <IconChevronRight width={18} height={18} className="text-muted" />
      </Link>
    </li>
  );
}
