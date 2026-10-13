import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAccount, useLive } from '../hooks/useData';
import { IconHome, IconList, IconMap, IconSettings, IconTimer, IconTrophy } from './ui/icons';

const NAV = [
  { to: '/', label: 'Dashboard', icon: IconHome, end: true },
  { to: '/circuits', label: 'Circuits', icon: IconMap, end: false },
  { to: '/live', label: 'Live', icon: IconTimer, end: false },
  { to: '/leaderboard', label: 'Ranks', icon: IconTrophy, end: false },
  { to: '/sessions', label: 'Sessions', icon: IconList, end: false },
  { to: '/settings', label: 'Settings', icon: IconSettings, end: false },
];

export function AppShell() {
  const live = useLive();
  const loc = useLocation();
  const sessionActive = live.status === 'running' || live.status === 'paused';
  // Live timing gets the full screen while recording: no navigation to tap by accident.
  const immersive = sessionActive && loc.pathname.startsWith('/live');

  return (
    <div className="flex h-full flex-col md:flex-row">
      {!immersive && (
        <nav aria-label="Main" className="hidden w-52 shrink-0 flex-col border-r border-line bg-panel md:flex">
          <div className="flex h-14 items-center gap-2 border-b border-line px-4">
            <span className="h-4 w-1.5 bg-accent" aria-hidden="true" />
            <span className="text-sm font-bold uppercase tracking-[0.2em]">Lap Timer</span>
          </div>
          <ul className="flex flex-col gap-0.5 p-2">
            {NAV.map((n) => (
              <li key={n.to}>
                <NavLink
                  to={n.to}
                  end={n.end}
                  className={({ isActive }) =>
                    `flex h-10 items-center gap-3 rounded px-3 text-sm font-medium ${isActive ? 'bg-raised text-fg' : 'text-muted hover:text-fg'}`
                  }
                >
                  {({ isActive }) => (
                    <>
                      <span className={`h-4 w-0.5 ${isActive ? 'bg-accent' : 'bg-transparent'}`} aria-hidden="true" />
                      <n.icon />
                      {n.label}
                      {n.to === '/live' && sessionActive && <span className="ml-auto h-2 w-2 animate-pulse rounded-full bg-accent" aria-label="Session running" />}
                    </>
                  )}
                </NavLink>
              </li>
            ))}
          </ul>
          <AccountNavItem />
        </nav>
      )}

      <main className="relative min-h-0 min-w-0 flex-1 overflow-auto">
        <Outlet />
      </main>

      {!immersive && (
        <nav aria-label="Main" className="flex shrink-0 border-t border-line bg-panel pb-[env(safe-area-inset-bottom)] md:hidden">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) => `relative flex h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[10px] font-semibold uppercase tracking-wider ${isActive ? 'text-fg' : 'text-muted'}`}
            >
              {({ isActive }) => (
                <>
                  {isActive && <span className="absolute inset-x-4 top-0 h-0.5 bg-accent" aria-hidden="true" />}
                  <n.icon />
                  {n.label}
                  {n.to === '/live' && sessionActive && <span className="absolute right-[30%] top-2 h-2 w-2 animate-pulse rounded-full bg-accent" />}
                </>
              )}
            </NavLink>
          ))}
        </nav>
      )}
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

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-3 border-b border-line px-4 py-4 md:px-6">
      <div className="min-w-0">
        <h1 className="text-xl font-bold tracking-tight">{title}</h1>
        {subtitle && <div className="mt-0.5 text-sm text-muted">{subtitle}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
