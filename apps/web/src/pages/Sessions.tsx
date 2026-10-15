import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { formatLapTime, summarizeSession, type Session } from '@laptimer/core';
import { PageHeader } from '../components/AppShell';
import { Empty, LinkButton, Notice, Panel, Select, SimBadge, Spinner } from '../components/ui/primitives';
import { useData } from '../hooks/useData';
import { listCircuits, listSessions } from '../lib/repo';

export function Sessions() {
  const { data, loading, error } = useData(async () => ({ sessions: await listSessions(), circuits: await listCircuits() }), []);
  const [circuit, setCircuit] = useState('');
  const sessions = useMemo(() => (data?.sessions ?? []).filter((s) => !circuit || s.circuitId === circuit), [data, circuit]);
  const circuitNames = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of data?.sessions ?? []) m.set(s.circuitId, s.circuitName);
    for (const c of data?.circuits ?? []) m.set(c.id, c.name);
    return [...m.entries()];
  }, [data]);

  return (
    <div className="pb-8">
      <PageHeader title="My drives" subtitle="Every drive, newest first." back={{ to: '/me', label: 'Me' }} />
      <div className="mx-auto max-w-5xl space-y-4 p-4 md:p-6">
        {error && <Notice tone="error">{error.message}</Notice>}
        {loading && !data ? (
          <Spinner />
        ) : data && data.sessions.length === 0 ? (
          <Empty title="No drives yet" action={<LinkButton to="/" variant="primary">Pick a track</LinkButton>} />
        ) : (
          <Panel
            title={`${sessions.length} drive${sessions.length === 1 ? '' : 's'}`}
            bodyClass="p-0"
            actions={
              <Select aria-label="Filter by track" value={circuit} onChange={(e) => setCircuit(e.target.value)} className="h-8 w-48 text-xs">
                <option value="">All roads</option>
                {circuitNames.map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </Select>
            }
          >
            <SessionRows sessions={sessions} />
          </Panel>
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
            <Link to={`/sessions/${s.id}`} className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-0.5 px-4 py-3 hover:bg-raised active:bg-raised sm:grid-cols-[1fr_8rem_6rem_7rem]">
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
