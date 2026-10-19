import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { formatLapTime, type LapRecord, type Session } from '@laptimer/core';
import { PageHeader } from '../components/AppShell';
import { Empty, LinkButton, Notice, Panel, Select, SimBadge, Spinner } from '../components/ui/primitives';
import { IconChevronRight } from '../components/ui/icons';
import { useData } from '../hooks/useData';
import { useSettings } from '../hooks/useSettings';
import { listCircuits, listSessions } from '../lib/repo';

export interface LapRow {
  session: Session;
  lap: LapRecord;
  /** The fastest valid lap on its road. */
  best: boolean;
}

/**
 * Every timed lap, newest first: what a driver thinks of as "a run". Drives that never crossed
 * the finish (no lap) are left out. `best` marks the fastest valid lap on each road, simulated
 * laps only counting when the settings say so.
 */
export function lapRows(sessions: readonly Session[], includeSimulated: boolean): LapRow[] {
  const bestMs = new Map<string, number>();
  for (const s of sessions) {
    if (s.source === 'simulated' && !includeSimulated) continue;
    for (const l of s.laps) if (l.valid && l.timeMs < (bestMs.get(s.circuitId) ?? Infinity)) bestMs.set(s.circuitId, l.timeMs);
  }
  return sessions
    .flatMap((session) => session.laps.map((lap) => ({ session, lap, best: lap.valid && bestMs.get(session.circuitId) === lap.timeMs && (session.source !== 'simulated' || includeSimulated) })))
    .sort((a, b) => b.lap.startT - a.lap.startT);
}

export function Sessions() {
  const { settings } = useSettings();
  const { data, loading, error } = useData(async () => ({ sessions: await listSessions(), circuits: await listCircuits() }), []);
  const [circuit, setCircuit] = useState('');
  const all = useMemo(() => lapRows(data?.sessions ?? [], settings.includeSimulatedInBests), [data, settings.includeSimulatedInBests]);
  const rows = useMemo(() => all.filter((r) => !circuit || r.session.circuitId === circuit), [all, circuit]);
  const circuitNames = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of all) m.set(r.session.circuitId, r.session.circuitName);
    for (const c of data?.circuits ?? []) if (m.has(c.id)) m.set(c.id, c.name);
    return [...m.entries()];
  }, [all, data]);

  return (
    <div className="pb-8">
      <PageHeader title="My laps" subtitle="Every timed lap, newest first." back={{ to: '/me', label: 'Me' }} />
      <div className="mx-auto max-w-3xl space-y-4 p-4 md:p-6">
        {error && <Notice tone="error">{error.message}</Notice>}
        {loading && !data ? (
          <Spinner />
        ) : all.length === 0 ? (
          <Empty title="No laps yet" action={<LinkButton to="/" variant="primary">Pick a road</LinkButton>}>
            A lap appears here once you drive a road from start to finish.
          </Empty>
        ) : (
          <Panel
            title={`${rows.length} lap${rows.length === 1 ? '' : 's'}`}
            bodyClass="p-0"
            actions={
              <Select aria-label="Filter by road" value={circuit} onChange={(e) => setCircuit(e.target.value)} className="h-8 w-48 text-xs">
                <option value="">All roads</option>
                {circuitNames.map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </Select>
            }
          >
            <LapRows rows={rows} />
          </Panel>
        )}
      </div>
    </div>
  );
}

/**
 * One row per lap: road, when, time; the best on each road is marked, invalid ones say so. Tapping
 * one opens all your laps on that road with this one picked as lap A.
 */
export function LapRows({ rows }: { rows: readonly LapRow[] }) {
  return (
    <ul className="divide-y divide-line">
      {rows.map(({ session, lap, best }) => (
        <li key={`${session.id}#${lap.lap}`}>
          <Link to={`/tracks/${session.circuitId}?session=${encodeURIComponent(session.id)}&lap=${lap.lap}`} className="flex items-center gap-3 px-4 py-3 hover:bg-raised active:bg-raised">
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2 truncate font-semibold">
                <span className="truncate">{session.circuitName}</span>
                {session.source === 'simulated' && <SimBadge />}
              </span>
              <span className="block text-xs text-muted">
                {new Date(lap.startT).toLocaleString(undefined, { day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                {!lap.valid && <span className="text-loss"> · not counted</span>}
              </span>
            </span>
            {best && (
              <span className="rounded border border-[#b36bff]/60 px-1.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-[#b36bff]" title="Your best on this road">
                Best
              </span>
            )}
            <span className={`font-mono text-sm tabular ${lap.valid ? '' : 'text-muted line-through'}`}>{formatLapTime(lap.timeMs)}</span>
            <IconChevronRight width={18} height={18} className="shrink-0 text-muted" />
          </Link>
        </li>
      ))}
    </ul>
  );
}
