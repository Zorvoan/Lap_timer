import { useMemo, useState, useSyncExternalStore } from 'react';
import { Link } from 'react-router-dom';
import { InstallCard } from '../components/InstallCard';
import { NotifySwitch } from '../components/NotifySwitch';
import { Spinner } from '../components/ui/primitives';
import { IconChevronRight, IconUser } from '../components/ui/icons';
import { useAccount, useData } from '../hooks/useData';
import { install } from '../lib/install';
import { listSessions } from '../lib/repo';
import { useSettings } from '../hooks/useSettings';
import { LapRows, lapRows } from './Sessions';
import { DriverCard } from '../components/me/DriverCard';
import { loadBoard } from '../components/track/LeaderboardTab';
import { leaderboardTracks } from '../lib/cloud/account';
import { driverRating, type BoardTimes } from '../lib/driverRating';

/** Everything that is not a track: the account, past drives and settings. */
export function Me() {
  const acc = useAccount();
  const installed = useSyncExternalStore(install.subscribe, install.getState).installed;
  const [showInstall, setShowInstall] = useState(false);
  const { settings } = useSettings();
  const { data: sessions, loading } = useData(() => listSessions(), []);
  const laps = useMemo(() => lapRows(sessions ?? [], settings.includeSimulatedInBests), [sessions, settings.includeSimulatedInBests]);
  // Leaderboards of the roads the user has driven, for pace and position; the rating works without them.
  const uid = acc.user?.uid ?? null;
  const boardIds = useMemo(() => {
    const driven = new Set((sessions ?? []).filter((s) => s.source !== 'simulated').map((s) => s.circuitId));
    return leaderboardTracks(acc)
      .map((f) => f.id)
      .filter((id) => driven.has(id))
      .join(',');
  }, [sessions, acc]);
  const { data: boards } = useData(
    async (): Promise<BoardTimes[]> => {
      const all = await Promise.all(
        boardIds
          .split(',')
          .filter(Boolean)
          .map(async (id) => {
            // A board that could not be loaded (offline) is left out rather than read as empty.
            const board = await loadBoard(id, 200).catch(() => null);
            return board ? { circuitId: id, othersMs: board.filter((e) => e.uid !== uid).map((e) => e.timeMs) } : null;
          }),
      );
      return all.filter((b): b is BoardTimes => !!b);
    },
    [boardIds, uid],
  );
  const rating = useMemo(() => (sessions ? driverRating(sessions, boards ?? []) : null), [sessions, boards]);

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

      {rating && (
        <>
          <h2 className="label px-4 pb-2 pt-6">My driving</h2>
          <DriverCard rating={rating} speedUnit={settings.speedUnit} />
        </>
      )}

      <h2 className="label px-4 pb-2 pt-6">My laps</h2>
      <div className="border-y border-line">
        {loading && !sessions ? (
          <div className="px-4 py-3">
            <Spinner />
          </div>
        ) : laps.length === 0 ? (
          <p className="px-4 py-3 text-sm text-muted">No laps yet. Pick a road and press Drive.</p>
        ) : (
          <LapRows rows={laps.slice(0, 3)} />
        )}
        {laps.length > 3 && (
          <Link to="/sessions" className="flex items-center border-t border-line px-4 py-3 text-sm text-muted hover:bg-raised hover:text-fg active:bg-raised">
            <span className="flex-1">All laps ({laps.length})</span>
            <IconChevronRight width={18} height={18} />
          </Link>
        )}
      </div>

      {signedIn && (
        <div className="mt-6 border-y border-line px-4 py-3.5">
          <NotifySwitch />
        </div>
      )}

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
