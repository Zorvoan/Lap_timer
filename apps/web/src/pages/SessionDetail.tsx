import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { formatDelta, formatDistance, formatLapTime, formatSpeed, speedLabel, idealLap, splitTimes, summarizeSession, type Circuit, type Session } from '@laptimer/core';
import { PageHeader } from '../components/AppShell';
import { Badge, Button, ConfirmButton, LinkButton, Notice, Panel, SimBadge, Spinner, Stat } from '../components/ui/primitives';
import { IconDownload, IconTimer, IconTrash } from '../components/ui/icons';
import { LapTimesChart } from '../components/charts/Charts';
import { ABButtons, ComparisonCharts, GpsQuality, ReplayPanel, useComparisonRows, useLapLength } from '../components/laps/LapComparison';
import { useData } from '../hooks/useData';
import { useSettings } from '../hooks/useSettings';
import { deleteSession, getCircuit, getSamples, getSession, listSessions } from '../lib/repo';
import { circuitLapNumbers, lapKey } from '../lib/lapNumbers';
import { exportSession } from '../lib/dataTransfer';
import { downloadText, lapsToCsv, samplesToCsv } from '../lib/exportImport';
import { slug } from '../lib/circuitStats';
import { SectorCell } from '../components/laps/SectorCell';

export function SessionDetail() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { settings } = useSettings();
  const { data, loading } = useData(async () => {
    const session = await getSession(id);
    const circuit = session ? await getCircuit(session.circuitId) : undefined;
    return { session, circuit };
  }, [id]);

  if (loading && !data) return <div className="p-6"><Spinner /></div>;
  const session = data?.session;
  if (!session) return <div className="p-6"><Notice tone="error">Session not found.</Notice></div>;
  return <SessionView session={session} circuit={data?.circuit ?? null} onDeleted={() => navigate('/sessions')} speedUnit={settings.speedUnit} distanceUnit={settings.distanceUnit} />;
}

function SessionView({ session, circuit, onDeleted, speedUnit, distanceUnit }: { session: Session; circuit: Circuit | null; onDeleted: () => void; speedUnit: 'kmh' | 'mph'; distanceUnit: 'km' | 'mi' }) {
  const summary = useMemo(() => summarizeSession(session.laps), [session]);
  const lengthM = useLapLength(circuit, session.laps);

  const valid = session.laps.filter((l) => l.valid).sort((a, b) => a.timeMs - b.timeMs);
  const [lapA, setLapA] = useState<number | null>(valid[0]?.lap ?? session.laps[0]?.lap ?? null);
  const [lapB, setLapB] = useState<number | null>(valid[1]?.lap ?? null);
  const A = session.laps.find((l) => l.lap === lapA) ?? null;
  const B = session.laps.find((l) => l.lap === lapB && l.lap !== lapA) ?? null;

  const rows = useComparisonRows(A, B, lengthM);

  // Laps are numbered across every session on this circuit (1 = first lap ever driven here).
  const { data: circuitSessions } = useData(() => listSessions(session.circuitId), [session.circuitId]);
  const numbers = useMemo(() => circuitLapNumbers(circuitSessions ?? [session]), [circuitSessions, session]);
  const num = (lap: number) => numbers.get(lapKey(session.id, lap)) ?? lap;

  const { data: samples } = useData(() => getSamples(session.id), [session.id]);

  async function remove() {
    await deleteSession(session.id);
    onDeleted();
  }

  const best = summary.bestLap;
  // Three parts by distance, like everywhere else (older tracks' own sector lines are not used).
  const splits = new Map(session.laps.map((l) => [l.lap, splitTimes(l.trace, l.timeMs, lengthM, 3)]));
  const sectorCount = lengthM > 0 ? 3 : 0;
  const theoretical = idealLap(valid.map((l) => splits.get(l.lap) ?? []));
  const bestSectors = theoretical?.sectorsMs ?? [];

  return (
    <div className="pb-10">
      <PageHeader
        title={session.circuitName}
        back={{ to: '/sessions', label: 'All sessions' }}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            {new Date(session.startedAt).toLocaleString()} {session.source === 'simulated' && <SimBadge />}
            {session.endedAt === null && <Badge tone="warn">Interrupted</Badge>}
            {!circuit && <Badge>Circuit deleted</Badge>}
            {circuit && (
              <Link to={`/tracks/${circuit.id}?session=${session.id}`} className="font-semibold text-fg underline decoration-accent underline-offset-4">
                Compare with all times on this circuit →
              </Link>
            )}
          </span>
        }
        actions={
          <>
            {circuit && (
              <LinkButton to={`/live?circuit=${circuit.id}${A?.valid ? `&ref=${encodeURIComponent(`${session.id}#${A.lap}`)}` : ''}`} variant="primary" title={A?.valid ? `Live delta against lap ${num(A.lap)}` : undefined}>
                <IconTimer width={18} height={18} /> {A?.valid ? `Drive vs lap ${num(A.lap)}` : 'Drive again'}
              </LinkButton>
            )}
            <Button onClick={async () => downloadText(`${slug(session.circuitName)}-${session.id.slice(0, 8)}.laptimer.json`, await exportSession(session.id, true), 'application/json')}>
              <IconDownload width={18} height={18} /> JSON
            </Button>
            <Button onClick={() => downloadText(`${slug(session.circuitName)}-laps.csv`, lapsToCsv(session), 'text/csv')}>
              <IconDownload width={18} height={18} /> Laps CSV
            </Button>
            {samples && samples.length > 0 && (
              <Button onClick={() => downloadText(`${slug(session.circuitName)}-gps.csv`, samplesToCsv(session.id, samples), 'text/csv')}>
                <IconDownload width={18} height={18} /> GPS CSV
              </Button>
            )}
            <ConfirmButton aria-label="Delete session" title="Delete session and its GPS data" onConfirm={remove} confirmLabel="Delete?">
              <IconTrash width={18} height={18} />
            </ConfirmButton>
          </>
        }
      />

      <div className="mx-auto max-w-7xl space-y-4 p-4 md:p-6">
        <div className="grid grid-cols-2 gap-4 rounded-2xl border border-line bg-panel p-4 sm:grid-cols-3 lg:grid-cols-6">
          <Stat label="Fastest lap" value={formatLapTime(best?.timeMs)} hint={best ? `Lap ${num(best.lap)}` : undefined} />
          <Stat label="Laps" value={summary.laps} hint={`${summary.validLaps} valid`} />
          <Stat
            label="Theoretical best"
            value={formatLapTime(theoretical?.timeMs)}
            hint={theoretical && best ? (theoretical.timeMs < best.timeMs - 0.5 ? `${formatDelta(theoretical.timeMs - best.timeMs)} s · best parts` : 'best parts') : 'needs a valid lap'}
          />
          <Stat label="Distance" value={formatDistance(summary.totalDistanceM, distanceUnit)} />
          <Stat label="Max speed" value={formatSpeed(summary.maxSpeedMs, speedUnit)} unit={speedLabel(speedUnit)} />
        </div>

        {session.laps.length === 0 ? (
          <Notice title="No completed laps">
            No lap was completed in this session. A lap is recorded between two crossings of the start/finish line in the right direction.
          </Notice>
        ) : (
          <>
            <Panel title="Laps" bodyClass="overflow-x-auto p-0">
              {/* On a phone: compare, time (with the lap number) and the three parts, so nothing scrolls sideways. */}
              <table className="lap-table w-full text-sm sm:min-w-[720px]">
                <thead>
                  <tr className="border-b border-line text-left">
                    <th className="label px-2 py-2 font-semibold sm:px-3">
                          <span className="sm:hidden">A / B</span>
                          <span className="hidden sm:inline">Compare</span>
                        </th>
                    <th className="label hidden sm:table-cell px-3 py-2 font-semibold">Lap</th>
                    <th className="label px-1.5 py-2 text-right font-semibold sm:px-3">Time</th>
                    <th className="label hidden sm:table-cell px-3 py-2 text-right font-semibold">Δ best</th>
                    {Array.from({ length: sectorCount }, (_, i) => (
                      <th key={i} className="label px-1.5 py-2 text-right font-semibold !tracking-normal sm:px-3 sm:!tracking-[0.12em]">
                        Part {i + 1}
                      </th>
                    ))}
                    <th className="label hidden sm:table-cell px-3 py-2 text-right font-semibold">Avg</th>
                    <th className="label hidden sm:table-cell px-3 py-2 text-right font-semibold">Max</th>
                    <th className="label hidden sm:table-cell px-3 py-2 text-right font-semibold">Dist</th>
                    <th className="label hidden sm:table-cell px-3 py-2 font-semibold">GPS</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {session.laps.map((l) => (
                    <tr key={l.lap} className={`${l.lap === lapA ? 'bg-raised' : ''} ${!l.valid ? 'text-muted' : ''}`}>
                      <td className="px-2 py-2 sm:px-3">
                        <ABButtons isA={l.lap === lapA} isB={l.lap === lapB} onA={() => setLapA(l.lap)} onB={() => setLapB(l.lap === lapB ? null : l.lap)} />
                      </td>
                      <td className="hidden sm:table-cell px-3 py-2 font-mono tabular">
                        {num(l.lap)} {best?.lap === l.lap && <Badge tone="accent">Best</Badge>} {!l.valid && <Badge tone="loss">Invalid</Badge>}
                      </td>
                      <td className="whitespace-nowrap px-1.5 py-2 text-right font-mono tabular sm:px-3">
                        {formatLapTime(l.timeMs)}
                        <span className="block whitespace-normal font-sans text-[11px] text-muted sm:hidden">
                          Lap {num(l.lap)}
                          {best?.lap === l.lap ? ', best' : !l.valid ? ', invalid' : best && l.valid ? `, ${formatDelta(l.timeMs - best.timeMs)}` : ''}
                        </span>
                      </td>
                      <td className={`hidden sm:table-cell px-3 py-2 text-right font-mono tabular ${best && l.valid && l.lap !== best.lap ? 'text-loss' : ''}`}>
                        {best && l.valid && l.lap !== best.lap ? formatDelta(l.timeMs - best.timeMs) : '—'}
                      </td>
                      {Array.from({ length: sectorCount }, (_, i) => (
                        <SectorCell key={i} ms={splits.get(l.lap)?.[i]} best={l.valid && splits.get(l.lap)?.[i] === bestSectors[i]} />
                      ))}
                      <td className="hidden sm:table-cell px-3 py-2 text-right font-mono tabular">{formatSpeed(l.avgSpeedMs, speedUnit)}</td>
                      <td className="hidden sm:table-cell px-3 py-2 text-right font-mono tabular">{formatSpeed(l.maxSpeedMs, speedUnit)}</td>
                      <td className="hidden sm:table-cell px-3 py-2 text-right font-mono tabular">{formatDistance(l.distanceM, distanceUnit, 3)}</td>
                      <td className="hidden sm:table-cell px-3 py-2">
                        <GpsQuality lap={l} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Panel>

            <div className="grid gap-4 lg:grid-cols-2">
              <Panel title="Lap time progression">
                <div className="h-56">
                  <LapTimesChart laps={session.laps} bestLap={best?.lap ?? null} onSelect={setLapA} lapLabel={num} />
                </div>
              </Panel>
              <ComparisonCharts A={A} B={B} labelA={A ? `lap ${num(A.lap)}` : '—'} labelB={B ? `lap ${num(B.lap)}` : null} rows={rows} speedUnit={speedUnit} distanceUnit={distanceUnit} circuit={circuit} />
            </div>

            {A && <ReplayPanel circuit={circuit} lapA={A} lapB={B} labelA={`lap ${num(A.lap)}`} labelB={B ? `lap ${num(B.lap)}` : null} rows={rows} lengthM={lengthM} speedUnit={speedUnit} />}
          </>
        )}
      </div>
    </div>
  );
}
