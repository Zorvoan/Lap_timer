import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { formatDelta, formatLapTime, formatSpeed, idealLap, speedLabel, splitTimes, type Circuit, type LapRecord, type Session } from '@laptimer/core';
import { Badge, Panel, SimBadge, Stat, Toggle } from '../ui/primitives';
import { LapHistoryChart, type HistoryPoint } from '../charts/Charts';
import { ABButtons, ComparisonCharts, GpsQuality, ReplayPanel, useComparisonRows, useLapLength } from '../laps/LapComparison';
import { SectorCell } from '../laps/SectorCell';
import { useSettings } from '../../hooks/useSettings';
import { circuitLapNumbers, lapKey } from '../../lib/lapNumbers';

/** One lap on this circuit, from any session. */
interface Entry {
  key: string;
  session: Session;
  lap: LapRecord;
  /** Lap number on this circuit across all sessions (1 = first lap ever driven here). */
  n: number;
}

const NO_LAPS: LapRecord[] = [];

function entryLabel(e: Entry): string {
  return `lap ${e.n}${e.session.source === 'simulated' ? ' (sim)' : ''} · ${new Date(e.session.startedAt).toLocaleDateString()}`;
}

/** Every lap the user drove on a track, across all sessions, with A/B comparison. */
export function MyLapsTab({ circuit, sessions }: { circuit: Circuit; sessions: Session[] }) {
  const { settings } = useSettings();
  const [params] = useSearchParams();
  const focusSession = params.get('session');

  const hasSim = sessions.some((s) => s.source === 'simulated' && s.laps.length);
  const hasReal = sessions.some((s) => s.source === 'gps' && s.laps.length);
  // Show simulated laps when the user counts them, when there is nothing else to show, or when
  // arriving from a simulated session (so the laps just driven are visible).
  const focusIsSim = sessions.some((s) => s.id === focusSession && s.source === 'simulated');
  const [showSim, setShowSim] = useState(settings.includeSimulatedInBests || !hasReal || focusIsSim);
  const [validOnly, setValidOnly] = useState(true);
  const [sortBy, setSortBy] = useState<'time' | 'date'>('time');

  const all: Entry[] = useMemo(() => {
    const numbers = circuitLapNumbers(sessions);
    return sessions.flatMap((s) => s.laps.map((l) => ({ key: lapKey(s.id, l.lap), session: s, lap: l, n: numbers.get(lapKey(s.id, l.lap)) ?? l.lap })));
  }, [sessions]);
  const visible = useMemo(
    () => all.filter((e) => (showSim || e.session.source !== 'simulated') && (!validOnly || e.lap.valid)),
    [all, showSim, validOnly],
  );
  const chronological = useMemo(() => [...visible].sort((a, b) => a.lap.startT - b.lap.startT), [visible]);
  const byTime = useMemo(() => [...visible].sort((a, b) => Number(b.lap.valid) - Number(a.lap.valid) || a.lap.timeMs - b.lap.timeMs), [visible]);
  const best = byTime.find((e) => e.lap.valid) ?? null;
  const rows = sortBy === 'time' ? byTime : [...chronological].reverse();

  // Default comparison: the focused session's best lap (or the personal best) against the
  // personal best (or the most recent other lap).
  const [keyA, setKeyA] = useState<string | null>(null);
  const [keyB, setKeyB] = useState<string | null>(null);
  useEffect(() => {
    if (keyA !== null || !visible.length) return;
    const fromSession = focusSession ? byTime.find((e) => e.session.id === focusSession) : undefined;
    const a = fromSession ?? best ?? byTime[0];
    // B: the personal best; if A already is the PB, the best lap of the most recent other session.
    const otherSessions = chronological.filter((e) => e.session.id !== a.session.id);
    const lastOther = otherSessions.at(-1)?.session.id;
    const bestOfLastOther = byTime.find((e) => e.session.id === lastOther);
    const b = a.key !== best?.key && best ? best : bestOfLastOther ?? chronological.filter((e) => e.key !== a.key).at(-1);
    setKeyA(a.key);
    setKeyB(b?.key ?? null);
  }, [visible, byTime, chronological, best, focusSession, keyA]);

  const A = all.find((e) => e.key === keyA) ?? null;
  const B = all.find((e) => e.key === keyB && e.key !== keyA) ?? null;
  const lengthM = useLapLength(circuit, NO_LAPS);
  const cmpRows = useComparisonRows(A?.lap ?? null, B?.lap ?? null, lengthM);

  // Sector times from the circuit's sector lines when every lap has them; otherwise the lap is
  // split into thirds by distance (works for every lap, as it only needs the trace).
  const lineSectors = visible.length && visible.every((e) => e.lap.sectorTimesMs.length === visible[0].lap.sectorTimesMs.length) ? visible[0].lap.sectorTimesMs.length : 0;
  const splitsByKey = useMemo(
    () => new Map(visible.map((e) => [e.key, lineSectors ? e.lap.sectorTimesMs : splitTimes(e.lap.trace, e.lap.timeMs, lengthM, 3)])),
    [visible, lineSectors, lengthM],
  );
  const sectorCount = lineSectors || (lengthM > 0 ? 3 : 0);
  const ideal = useMemo(() => idealLap(visible.filter((e) => e.lap.valid).map((e) => splitsByKey.get(e.key) ?? [])), [visible, splitsByKey]);
  const bestSectors = ideal?.sectorsMs ?? [];
  const sessionCount = new Set(visible.map((e) => e.session.id)).size;
  const lastDriven = chronological.at(-1)?.session.startedAt ?? null;

  const history: HistoryPoint[] = chronological.map((e, i) => ({
    id: e.key,
    n: i + 1,
    timeMs: e.lap.timeMs,
    date: e.session.startedAt,
    isBest: e.key === best?.key,
    isA: e.key === keyA,
    isB: e.key === keyB,
  }));

  if (all.length === 0) {
    return (
      <div className="py-10 text-center">
        <div className="font-semibold">No laps here yet</div>
        <p className="mx-auto mt-1.5 max-w-xs text-sm text-muted">Drive the track once and your time, parts and replay appear here.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4 rounded border border-line bg-panel p-4 sm:grid-cols-5">
          <Stat label="Personal best" value={formatLapTime(best?.lap.timeMs)} hint={best ? entryLabel(best) : undefined} />
          <Stat
            label="Best possible"
            value={<span className={ideal ? 'text-[#b36bff]' : ''}>{formatLapTime(ideal?.timeMs)}</span>}
            hint={ideal && best ? (ideal.timeMs < best.lap.timeMs - 0.5 ? `${formatDelta(ideal.timeMs - best.lap.timeMs)} s to find` : 'your PB is already ideal') : 'your best parts combined'}
          />
          <Stat label="Laps" value={visible.length} hint={`${visible.filter((e) => e.lap.valid).length} valid`} />
          <Stat label="Sessions" value={sessionCount} />
          <Stat label="Last driven" value={lastDriven ? new Date(lastDriven).toLocaleDateString() : '—'} />
        </div>

        <>
            <Panel
              title="All laps on this circuit"
              bodyClass="p-0"
              actions={
                <div className="flex overflow-hidden rounded border border-line text-xs font-semibold uppercase tracking-wider">
                  {(['time', 'date'] as const).map((k) => (
                    <button key={k} type="button" aria-pressed={sortBy === k} onClick={() => setSortBy(k)} className={`h-8 px-3 ${sortBy === k ? 'bg-accent text-white' : 'text-muted'}`}>
                      {k === 'time' ? 'Fastest' : 'Newest'}
                    </button>
                  ))}
                </div>
              }
            >
              <div className="flex flex-wrap gap-x-6 border-b border-line px-4">
                <Toggle checked={validOnly} onChange={setValidOnly} label="Valid laps only" />
                {hasSim && <Toggle checked={showSim} onChange={setShowSim} label="Include simulated" />}
              </div>
              {rows.length === 0 ? (
                <p className="p-4 text-sm text-muted">No laps match the filters.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px] text-sm">
                    <thead>
                      <tr className="border-b border-line text-left">
                        <th className="label px-3 py-2 font-semibold">Compare</th>
                        <th className="label px-3 py-2 font-semibold" title="Rank by lap time">Rank</th>
                        <th className="label px-3 py-2 text-right font-semibold">Time</th>
                        <th className="label px-3 py-2 text-right font-semibold">Δ PB</th>
                        <th className="label px-3 py-2 font-semibold">Driven</th>
                        {Array.from({ length: sectorCount }, (_, i) => (
                          <th key={i} className="label px-3 py-2 text-right font-semibold" title={lineSectors ? 'Sector line times' : 'Thirds of the lap by distance'}>
                            Part {i + 1}
                          </th>
                        ))}
                        <th className="label px-3 py-2 text-right font-semibold">Max {speedLabel(settings.speedUnit)}</th>
                        <th className="label px-3 py-2 font-semibold">GPS</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {rows.map((e) => {
                        const rank = byTime.filter((x) => x.lap.valid).indexOf(e) + 1;
                        const isPb = e.key === best?.key;
                        return (
                          <tr key={e.key} className={`${e.key === keyA ? 'bg-raised' : ''} ${!e.lap.valid ? 'text-muted' : ''}`}>
                            <td className="px-3 py-2">
                              <ABButtons isA={e.key === keyA} isB={e.key === keyB} onA={() => setKeyA(e.key)} onB={() => setKeyB(e.key === keyB ? null : e.key)} />
                            </td>
                            <td className="px-3 py-2 font-mono tabular">{rank > 0 ? rank : '—'}</td>
                            <td className="whitespace-nowrap px-3 py-2 text-right font-mono tabular">
                              {formatLapTime(e.lap.timeMs)} {isPb && <Badge tone="accent">PB</Badge>} {!e.lap.valid && <Badge tone="loss">Invalid</Badge>}
                            </td>
                            <td className={`px-3 py-2 text-right font-mono tabular ${best && e.lap.valid && !isPb ? 'text-loss' : ''}`}>
                              {best && e.lap.valid && !isPb ? formatDelta(e.lap.timeMs - best.lap.timeMs) : '—'}
                            </td>
                            <td className="whitespace-nowrap px-3 py-2">
                              <Link to={`/sessions/${e.session.id}`} className="hover:underline">
                                {new Date(e.session.startedAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                              </Link>{' '}
                              <span className="text-xs text-muted">lap {e.n}</span> {e.session.source === 'simulated' && <SimBadge />}
                            </td>
                            {Array.from({ length: sectorCount }, (_, i) => (
                              <SectorCell key={i} ms={splitsByKey.get(e.key)?.[i]} best={e.lap.valid && splitsByKey.get(e.key)?.[i] === bestSectors[i]} />
                            ))}
                            <td className="px-3 py-2 text-right font-mono tabular">{formatSpeed(e.lap.maxSpeedMs, settings.speedUnit)}</td>
                            <td className="px-3 py-2">
                              <GpsQuality lap={e.lap} />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>

            <div className="grid gap-4 lg:grid-cols-2">
              <Panel title="Lap times over time (oldest → newest)">
                <div className="h-56">{history.length ? <LapHistoryChart points={history} onSelect={setKeyA} /> : <p className="text-sm text-muted">No laps match the filters.</p>}</div>
              </Panel>
              <ComparisonCharts
                A={A?.lap ?? null}
                B={B?.lap ?? null}
                labelA={A ? entryLabel(A) : '—'}
                labelB={B ? entryLabel(B) : null}
                rows={cmpRows}
                speedUnit={settings.speedUnit}
                distanceUnit={settings.distanceUnit}
              />
            </div>

            {A && <ReplayPanel circuit={circuit} lapA={A.lap} lapB={B?.lap ?? null} labelA={entryLabel(A)} labelB={B ? entryLabel(B) : null} rows={cmpRows} lengthM={lengthM} speedUnit={settings.speedUnit} />}
        </>
      </div>
    </div>
  );
}
