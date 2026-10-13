import { Link } from 'react-router-dom';
import { formatDistance, formatLapTime, summarizeSession, type Circuit, type Session } from '@laptimer/core';
import { PageHeader } from '../components/AppShell';
import { InstallCard } from '../components/InstallCard';
import { Empty, LinkButton, Notice, Panel, SimBadge, Spinner } from '../components/ui/primitives';
import { IconMap, IconPlus, IconTimer } from '../components/ui/icons';
import { useAccount, useData, useLive } from '../hooks/useData';
import { useSettings } from '../hooks/useSettings';
import { listCircuits, listSessions } from '../lib/repo';

export function Dashboard() {
  const { settings } = useSettings();
  const live = useLive();
  const acc = useAccount();
  const { data, loading, error } = useData(async () => ({ circuits: await listCircuits(), sessions: await listSessions() }), []);

  const circuits = data?.circuits ?? [];
  const sessions = data?.sessions ?? [];
  const lastSession = sessions.find((s) => s.endedAt !== null) ?? null;
  const lastCircuit = lastSession ? circuits.find((c) => c.id === lastSession.circuitId) ?? null : null;
  const bests = personalBests(circuits, sessions, settings.includeSimulatedInBests);

  return (
    <div className="pb-8">
      <PageHeader
        title="Dashboard"
        actions={
          <>
            <LinkButton to="/circuits" variant="secondary">
              <IconMap /> Map
            </LinkButton>
            <LinkButton to="/live" variant="primary" size="md">
              <IconTimer /> Start session
            </LinkButton>
          </>
        }
      />
      <div className="mx-auto grid max-w-6xl gap-4 p-4 md:p-6 lg:grid-cols-3">
        <div className="lg:col-span-3 empty:hidden">
          <InstallCard dismissible />
        </div>
        {acc.status === 'signed_in' && acc.profile === null && (
          <div className="lg:col-span-3">
            <Notice tone="warn" title="Set your nickname and car" action={<LinkButton to="/account" variant="primary" size="sm">Complete profile</LinkButton>}>
              Needed for the leaderboards on official tracks.
            </Notice>
          </div>
        )}
        {acc.status === 'signed_out' && (
          <div className="lg:col-span-3">
            <Notice title="Keep your laps in your account" action={<LinkButton to="/account" variant="primary" size="sm">Sign in</LinkButton>}>
              Laps are only on this device right now. Sign in to back them up and analyse them on your computer.
            </Notice>
          </div>
        )}
        {(live.status === 'running' || live.status === 'paused') && (
          <div className="lg:col-span-3">
            <Notice tone="warn" title="Session in progress" action={<LinkButton to="/live" variant="primary" size="sm">Open live timing</LinkButton>}>
              Recording on {live.circuit?.name}.
            </Notice>
          </div>
        )}
        {error && (
          <div className="lg:col-span-3">
            <Notice tone="error" title="Could not load local data">{error.message}</Notice>
          </div>
        )}
        {loading && !data ? (
          <Spinner />
        ) : (
          <>
            <Panel title="Last driven circuit" className="lg:col-span-2">
              {lastCircuit && lastSession ? (
                <div className="flex flex-wrap items-end justify-between gap-4">
                  <div>
                    <Link to={`/circuits/${lastCircuit.id}`} className="text-2xl font-bold hover:underline">
                      {lastCircuit.name}
                    </Link>
                    <div className="mt-1 text-sm text-muted">
                      {formatDistance(lastCircuit.lengthM, settings.distanceUnit)} · {lastCircuit.kind === 'closed' ? 'Closed circuit' : 'Sprint'} · last driven{' '}
                      {new Date(lastSession.startedAt).toLocaleString()}
                    </div>
                    <div className="mt-3 flex gap-6">
                      <div>
                        <div className="label">Personal best</div>
                        <div className="font-mono text-2xl tabular">{formatLapTime(bests.get(lastCircuit.id)?.timeMs)}</div>
                      </div>
                      <div>
                        <div className="label">Last session best</div>
                        <div className="font-mono text-2xl tabular">{formatLapTime(summarizeSession(lastSession.laps).bestLap?.timeMs)}</div>
                      </div>
                    </div>
                  </div>
                  <LinkButton to={`/live?circuit=${lastCircuit.id}`} variant="primary" size="lg">
                    <IconTimer /> Drive again
                  </LinkButton>
                </div>
              ) : circuits.length ? (
                <Empty title="No sessions yet" action={<LinkButton to="/live" variant="primary">Start your first session</LinkButton>}>
                  Pick one of your circuits and start timing.
                </Empty>
              ) : (
                <Empty
                  title="Create your first circuit"
                  action={
                    <div className="flex flex-wrap gap-2">
                      <LinkButton to="/circuits/new" variant="primary">
                        <IconPlus /> Build from roads
                      </LinkButton>
                      <LinkButton to="/circuits/record">Record by driving</LinkButton>
                    </div>
                  }
                >
                  Select roads on the map, or drive the route once while recording GPS.
                </Empty>
              )}
            </Panel>

            <Panel title="Personal bests" bodyClass="p-0">
              {bests.size === 0 ? (
                <p className="p-4 text-sm text-muted">No valid laps recorded yet.</p>
              ) : (
                <ul className="divide-y divide-line">
                  {circuits
                    .filter((c) => bests.has(c.id))
                    .map((c) => (
                      <li key={c.id}>
                        <Link to={`/circuits/${c.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-raised">
                          <span className="truncate text-sm">{c.name}</span>
                          <span className="font-mono text-sm tabular">{formatLapTime(bests.get(c.id)?.timeMs)}</span>
                        </Link>
                      </li>
                    ))}
                </ul>
              )}
            </Panel>

            <Panel
              title="Recent sessions"
              className="lg:col-span-3"
              bodyClass="p-0"
              actions={
                <Link to="/sessions" className="text-xs text-muted hover:text-fg">
                  All sessions →
                </Link>
              }
            >
              {sessions.length === 0 ? (
                <p className="p-4 text-sm text-muted">Sessions you record appear here.</p>
              ) : (
                <SessionRows sessions={sessions.slice(0, 6)} />
              )}
            </Panel>
          </>
        )}
      </div>
    </div>
  );
}

export function SessionRows({ sessions }: { sessions: Session[] }) {
  return (
    <ul className="divide-y divide-line">
      {sessions.map((s) => {
        const sum = summarizeSession(s.laps);
        return (
          <li key={s.id}>
            <Link to={`/sessions/${s.id}`} className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-0.5 px-4 py-3 hover:bg-raised sm:grid-cols-[1fr_8rem_6rem_7rem]">
              <span className="min-w-0">
                <span className="flex items-center gap-2 truncate text-sm font-medium">
                  {s.circuitName} {s.source === 'simulated' && <SimBadge />}
                  {s.endedAt === null && <span className="text-[10px] uppercase tracking-wider text-warn">Interrupted</span>}
                </span>
                <span className="text-xs text-muted">{new Date(s.startedAt).toLocaleString()}</span>
              </span>
              <span className="hidden text-sm text-muted sm:block">{sum.laps} laps</span>
              <span className="hidden text-sm text-muted sm:block">{sum.validLaps} valid</span>
              <span className="text-right font-mono text-sm tabular">{formatLapTime(sum.bestLap?.timeMs)}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function personalBests(circuits: Circuit[], sessions: Session[], includeSim: boolean) {
  const out = new Map<string, { timeMs: number }>();
  for (const s of sessions) {
    if (s.source === 'simulated' && !includeSim) continue;
    if (!circuits.some((c) => c.id === s.circuitId)) continue;
    for (const l of s.laps) {
      if (!l.valid) continue;
      const cur = out.get(s.circuitId);
      if (!cur || l.timeMs < cur.timeMs) out.set(s.circuitId, { timeMs: l.timeMs });
    }
  }
  return out;
}
