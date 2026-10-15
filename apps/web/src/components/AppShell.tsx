import { Suspense, lazy, useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { formatDelta, formatLapTime } from '@laptimer/core';
import { useAccount, useData, useLive } from '../hooks/useData';
import { getActiveSession } from '../lib/repo';
import { applyUpdateIfReady } from '../lib/update';
import { buttonClass } from './ui/primitives';
import { NotifyPrompt } from './NotifyPrompt';
import { IconArrowLeft, IconMap, IconTimer, IconTrophy, IconUser, IconX } from './ui/icons';

const Welcome = lazy(() => import('../pages/Welcome').then((m) => ({ default: m.Welcome })));
const SIGNED_IN_HINT = 'lt-was-signed-in';

/**
 * Whether the app needs the sign-in screen first: signed out, or signed in without a nickname and
 * car. While the sign-in service is still starting, someone who was signed in last time goes
 * straight in instead of seeing a splash on every launch.
 */
function useNeedsAccount(): boolean {
  const acc = useAccount();
  useEffect(() => {
    try {
      if (acc.status === 'signed_in') localStorage.setItem(SIGNED_IN_HINT, '1');
      else if (acc.status === 'signed_out') localStorage.removeItem(SIGNED_IN_HINT);
    } catch {
      // Storage blocked: the splash simply shows while signing in.
    }
  }, [acc.status]);
  if (acc.status === 'signed_out') return true;
  if (acc.status === 'signed_in') return acc.profile === null;
  if (acc.status === 'loading') {
    try {
      return localStorage.getItem(SIGNED_IN_HINT) !== '1';
    } catch {
      return true;
    }
  }
  return false;
}

/** Which tab a path belongs to: tracks and everything about them, or the user's own things. */
function tabOf(path: string): 'tracks' | 'drive' | 'me' {
  if (path.startsWith('/live') || path.startsWith('/result')) return 'drive';
  if (/^\/(me|account|settings|sessions|help)(\/|$)/.test(path)) return 'me';
  return 'tracks';
}

export function AppShell() {
  const live = useLive();
  const loc = useLocation();
  const sessionActive = live.status === 'running' || live.status === 'paused';
  // Live timing gets the full screen while recording: no navigation to tap by accident.
  const immersive = sessionActive && loc.pathname.startsWith('/live');
  const tab = tabOf(loc.pathname);
  // Moving to another page is a natural moment to switch to a newly deployed version.
  useEffect(() => applyUpdateIfReady(), [loc.pathname]);
  const needsAccount = useNeedsAccount();

  // Everyone signs in before using the app; a run already being timed is never interrupted.
  if (needsAccount && !sessionActive) {
    return (
      <Suspense fallback={<div className="h-full bg-bg" />}>
        <Welcome />
      </Suspense>
    );
  }

  return (
    // Sideways on a phone with a notch, keep everything clear of it.
    <div className="flex h-full flex-col pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] md:flex-row">
      {!immersive && (
        <nav aria-label="Main" className="hidden w-52 shrink-0 flex-col border-r border-line bg-panel md:flex">
          <div className="flex h-14 items-center gap-2 border-b border-line px-4">
            <span className="h-4 w-1.5 bg-accent" aria-hidden="true" />
            <span className="text-sm font-bold uppercase tracking-[0.2em]">Lap Timer</span>
          </div>
          <ul className="flex flex-col gap-0.5 p-2">
            <SideItem to="/" label="Roads" icon={IconMap} active={tab === 'tracks'} />
            <SideItem to="/me" label="Me" icon={IconUser} active={tab === 'me'} />
          </ul>
          <div className="px-2">
            <Link to="/live" className={`press flex h-11 items-center justify-center gap-2 rounded-lg font-bold text-white ${tab === 'drive' ? 'bg-accent ring-2 ring-fg/60' : 'bg-accent hover:brightness-110'}`}>
              <IconTimer /> Drive
            </Link>
          </div>
          <AccountNavItem />
        </nav>
      )}

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {!loc.pathname.startsWith('/live') && <SessionBanner />}
        <main className="relative min-h-0 min-w-0 flex-1 overflow-auto">
          {/* Each new page fades up into place. The time card has its own entrance. */}
          <div key={loc.pathname} className={`h-full ${loc.pathname.startsWith('/result') ? '' : 'anim-page'}`}>
            <Outlet />
          </div>
        </main>
      </div>
      {!immersive && <LeaderboardToast />}
      {/* Not while driving or about to: the Drive screens stay uninterrupted. */}
      <NotifyPrompt paused={sessionActive || loc.pathname.startsWith('/live')} />

      {!immersive && (
        <nav aria-label="Main" className="grid shrink-0 grid-cols-3 border-t border-line bg-panel pb-[env(safe-area-inset-bottom)] md:hidden">
          <TabItem to="/" label="Roads" icon={IconMap} active={tab === 'tracks'} />
          <div className="flex items-center justify-center">
            <Link to="/live" aria-current={tab === 'drive' ? 'page' : undefined} className="press flex h-12 w-[6.5rem] items-center justify-center gap-2 rounded-xl bg-accent text-[15px] font-extrabold text-white land:h-9">
              <IconTimer /> Drive
            </Link>
          </div>
          <TabItem to="/me" label="Me" icon={IconUser} active={tab === 'me'} />
        </nav>
      )}
    </div>
  );
}

/**
 * While a session is recording, or one was interrupted (app closed mid-session), this bar on
 * every other screen leads back to it.
 */
type NavIcon = (p: React.SVGProps<SVGSVGElement>) => React.ReactElement;

function TabItem({ to, label, icon: Icon, active }: { to: string; label: string; icon: NavIcon; active: boolean }) {
  return (
    <Link to={to} aria-current={active ? 'page' : undefined} className={`press relative flex h-[4.25rem] flex-col items-center justify-center gap-1 text-xs font-semibold land:h-12 land:flex-row land:gap-2 land:text-sm ${active ? 'text-fg' : 'text-muted'}`}>
      {active && <span className="anim-bar absolute inset-x-[28%] top-0 h-[3px] rounded-b bg-accent" aria-hidden="true" />}
      <Icon width={22} height={22} />
      {label}
    </Link>
  );
}

function SideItem({ to, label, icon: Icon, active }: { to: string; label: string; icon: NavIcon; active: boolean }) {
  return (
    <li>
      <Link to={to} aria-current={active ? 'page' : undefined} className={`flex h-10 items-center gap-3 rounded px-3 text-sm font-medium ${active ? 'bg-raised text-fg' : 'text-muted hover:text-fg'}`}>
        <span className={`h-4 w-0.5 ${active ? 'bg-accent' : 'bg-transparent'}`} aria-hidden="true" />
        <Icon />
        {label}
      </Link>
    </li>
  );
}

function SessionBanner() {
  const live = useLive();
  const { data: interrupted } = useData(getActiveSession, []);
  if (live.status === 'running' || live.status === 'paused') {
    return (
      <Link to="/live" className="flex items-center gap-3 bg-accent px-4 py-2.5 text-sm font-semibold text-white">
        <span className="h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-white" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate">
          {live.status === 'paused' ? 'Paused' : 'Recording'} · {live.circuit?.name}
        </span>
        <span className="flex shrink-0 items-center gap-1">
          <IconTimer width={16} height={16} /> Back to timing
        </span>
      </Link>
    );
  }
  if (live.status === 'idle' && interrupted) {
    return (
      <Link to="/live" className="flex items-center gap-3 bg-warn px-4 py-2.5 text-sm font-semibold text-black">
        <span className="min-w-0 flex-1 truncate">A session was interrupted. Resume or save it.</span>
        <span className="shrink-0">Open →</span>
      </Link>
    );
  }
  return null;
}

const TOAST_MS = 20_000;

/**
 * Leaderboard news after a sync: laps just published ("New leaderboard place: P3") and tracks
 * where someone else went faster ("Pushed to P2 on Mladcová").
 */
function LeaderboardToast() {
  const { submissions, overtakes } = useAccount();
  const [dismissedAt, setDismissedAt] = useState(0);
  const latest = Math.max(0, ...submissions.map((s) => s.at), ...overtakes.map((o) => o.at));
  const visible = latest > dismissedAt && Date.now() - latest < TOAST_MS;
  useEffect(() => {
    if (!visible) return;
    const t = setTimeout(() => setDismissedAt(latest), TOAST_MS - (Date.now() - latest));
    return () => clearTimeout(t);
  }, [visible, latest]);
  if (!visible) return null;
  return (
    <div role="status" className="anim-toast fixed inset-x-3 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-[2000] mx-auto max-w-md rounded border border-accent bg-panel p-4 shadow-2xl md:bottom-6 md:left-auto md:right-6 md:mx-0 md:w-96">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 text-accent">
          <IconTrophy />
        </span>
        <div className="min-w-0 flex-1 space-y-2">
          {overtakes
            .filter((o) => o.at > dismissedAt)
            .map((o) => (
              <div key={`o-${o.circuitId}`}>
                <div className="font-bold text-loss">
                  {o.by ? `${o.by} beat your time` : 'Someone beat your time'}
                </div>
                <div className="text-sm text-muted">
                  {o.circuitName}: P{o.from} → <span className="font-semibold text-fg">P{o.to}</span>
                </div>
                <Link to={`/tracks/${o.circuitId}`} onClick={() => setDismissedAt(latest)} className="mt-1 inline-block text-sm font-semibold text-accent hover:underline">
                  See the times →
                </Link>
              </div>
            ))}
          {submissions.filter((s) => s.at > dismissedAt).map((s) => (
            <div key={s.circuitId}>
              <div className="font-bold">{s.position > 0 ? `New leaderboard place: P${s.position}` : 'New leaderboard time'}</div>
              <div className="text-sm text-muted">
                {s.circuitName} · <span className="font-mono tabular text-fg">{formatLapTime(s.timeMs)}</span>
                {s.previousMs !== null && <> ({formatDelta(s.timeMs - s.previousMs)} s on your previous)</>}
              </div>
              <Link to={`/tracks/${s.circuitId}`} onClick={() => setDismissedAt(latest)} className="mt-1 inline-block text-sm font-semibold text-accent hover:underline">
                View leaderboard →
              </Link>
            </div>
          ))}
        </div>
        <button type="button" onClick={() => setDismissedAt(latest)} aria-label="Dismiss" className="-mr-2 -mt-2 flex h-9 w-9 items-center justify-center rounded text-muted hover:bg-raised active:bg-raised hover:text-fg">
          <IconX width={18} height={18} />
        </button>
      </div>
    </div>
  );
}

function AccountNavItem() {
  const acc = useAccount();
  if (acc.status === 'disabled') return null;
  const signedIn = acc.status === 'signed_in';
  const dot = !signedIn ? 'bg-muted' : acc.sync === 'error' ? 'bg-loss' : acc.sync === 'offline' ? 'bg-warn' : acc.sync === 'syncing' ? 'bg-fg animate-pulse' : 'bg-gain';
  return (
    <NavLink
      to="/account"
      className={({ isActive }) => `mt-auto flex items-center gap-3 border-t border-line px-4 py-3 text-sm ${isActive ? 'bg-raised text-fg' : 'text-muted hover:text-fg'}`}
    >
      <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} aria-hidden="true" />
      <span className="min-w-0">
        <span className="block truncate font-medium text-fg">{signedIn ? acc.user?.email : 'Sign in'}</span>
        <span className="block text-xs">{signedIn ? (acc.sync === 'syncing' ? 'Syncing…' : acc.sync === 'error' ? 'Sync failed' : acc.sync === 'offline' ? 'Offline' : 'Synced to account') : 'Save laps to your account'}</span>
      </span>
    </NavLink>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
  back,
}: {
  title: string;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  /** Link back to the parent list, shown as a button above the title. */
  back?: { to: string; label: string };
}) {
  return (
    <header className="border-b border-line px-4 py-4 md:px-6">
      {back && (
        <Link to={back.to} className={buttonClass('secondary', 'md', 'mb-4 pl-3')}>
          <IconArrowLeft width={18} height={18} /> {back.label}
        </Link>
      )}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
          {subtitle && <div className="mt-1 text-sm text-muted">{subtitle}</div>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}
