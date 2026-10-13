import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Polyline } from 'react-leaflet';
import { formatDistance, formatLapTime, type Circuit, type Session } from '@laptimer/core';
import { BaseMap, FitBounds } from '../components/map/BaseMap';
import { RouteLayer } from '../components/map/RouteLayer';
import { TimingLineView } from '../components/map/TimingLines';
import { LocateControl, SearchControl } from '../components/map/MapControls';
import { Badge, Button, ConfirmButton, Empty, LinkButton, Notice, Spinner } from '../components/ui/primitives';
import { IconDownload, IconMap, IconPlus, IconRecord, IconTimer, IconTrash } from '../components/ui/icons';
import { useAccount, useData } from '../hooks/useData';
import { useSettings } from '../hooks/useSettings';
import { deleteCircuit, listCircuits, listSessions } from '../lib/repo';
import { buildExport, downloadText } from '../lib/exportImport';
import { ElevationChart } from '../components/charts/Charts';

function bounds(c: Circuit): [[number, number], [number, number]] {
  let s = 90,
    n = -90,
    w = 180,
    e = -180;
  for (const [lon, lat] of c.geometry) {
    s = Math.min(s, lat);
    n = Math.max(n, lat);
    w = Math.min(w, lon);
    e = Math.max(e, lon);
  }
  return [
    [s, w],
    [n, e],
  ];
}

export function Circuits() {
  const { settings } = useSettings();
  const acc = useAccount();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { data, loading, error } = useData(async () => ({ circuits: await listCircuits(), sessions: await listSessions() }), []);
  const circuits = data?.circuits;
  const selectedId = params.get('selected') ?? circuits?.[0]?.id ?? null;
  const selected = circuits?.find((c) => c.id === selectedId) ?? null;
  const stats = useMemo(() => circuitStats(data?.sessions ?? [], settings.includeSimulatedInBests), [data, settings.includeSimulatedInBests]);
  const selStats = selectedId ? stats.get(selectedId) : undefined;

  const fitBounds = useMemo(() => (selected ? bounds(selected) : null), [selected]);
  const [mobileView, setMobileView] = useState<'list' | 'map'>(params.get('selected') ? 'map' : 'list');

  async function remove(c: Circuit) {
    await deleteCircuit(c.id);
    setParams({});
  }

  const isOfficial = (id: string) => acc.featured.some((f) => f.id === id);

  return (
    <div className="flex h-full flex-col md:flex-row">
      {/* Phone: title + List/Map switch */}
      <div className="flex items-center justify-between gap-3 border-b border-line bg-panel px-4 py-3 md:hidden">
        <h1 className="text-xl font-bold tracking-tight">Circuits</h1>
        <div role="tablist" aria-label="View" className="flex overflow-hidden rounded border border-line text-xs font-semibold uppercase tracking-wider">
          {(['list', 'map'] as const).map((v) => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={mobileView === v}
              onClick={() => setMobileView(v)}
              className={`h-9 px-4 ${mobileView === v ? 'bg-accent text-white' : 'text-muted'}`}
            >
              {v === 'list' ? 'List' : 'Map'}
            </button>
          ))}
        </div>
      </div>

      <aside className={`${mobileView === 'list' ? 'flex' : 'hidden'} min-h-0 flex-1 flex-col bg-bg md:flex md:w-80 md:flex-none md:border-r md:border-line md:bg-panel`}>
        <div className="hidden items-center justify-between gap-2 border-b border-line p-3 md:flex">
          <h1 className="label">Circuits</h1>
          <div className="flex gap-2">
            <LinkButton to="/circuits/record" size="sm" title="Record a circuit by driving it">
              <IconRecord width={16} height={16} /> Record
            </LinkButton>
            <LinkButton to="/circuits/new" size="sm" variant="primary">
              <IconPlus width={16} height={16} /> New
            </LinkButton>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          <div className="grid grid-cols-2 gap-2 p-3 md:hidden">
            <LinkButton to="/circuits/new" variant="primary" size="lg">
              <IconPlus width={18} height={18} /> New circuit
            </LinkButton>
            <LinkButton to="/circuits/record" size="lg">
              <IconRecord width={18} height={18} /> Record drive
            </LinkButton>
          </div>
          {loading && !circuits && (
            <div className="p-4">
              <Spinner />
            </div>
          )}
          {error && (
            <div className="p-3">
              <Notice tone="error">{error.message}</Notice>
            </div>
          )}
          {circuits && circuits.length === 0 && (
            <div className="p-3">
              <Empty title="No circuits yet">Build one from roads on the map, or record one by driving it.</Empty>
            </div>
          )}
          <ul className="space-y-3 px-3 pb-4 md:space-y-0 md:divide-y md:divide-line md:p-0">
            {circuits?.map((c) => {
              const st = stats.get(c.id);
              const isSel = c.id === selectedId;
              const official = isOfficial(c.id);
              return (
                <li key={c.id} className={isSel ? 'md:bg-raised' : ''}>
                  {/* desktop row: selects the circuit on the map */}
                  <button
                    type="button"
                    onClick={() => setParams({ selected: c.id })}
                    className="hidden w-full items-center gap-3 px-4 py-3 text-left hover:bg-raised md:flex"
                    aria-current={isSel}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        {isSel && <span className="h-3 w-0.5 bg-accent" aria-hidden="true" />}
                        <span className="truncate font-medium">{c.name}</span>
                      </span>
                      <span className="mt-0.5 block text-xs text-muted">
                        {formatDistance(c.lengthM, settings.distanceUnit)} · {c.kind === 'closed' ? 'closed' : 'sprint'}
                        {official && ' · official'}
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block font-mono text-sm tabular">{formatLapTime(st?.bestMs)}</span>
                      <span className="block text-[11px] text-muted">{st?.laps ?? 0} laps</span>
                    </span>
                  </button>

                  {/* phone card */}
                  <div className="rounded border border-line bg-panel p-4 md:hidden">
                    <Link to={`/circuits/${c.id}`} className="block">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-lg font-bold">{c.name}</div>
                          <div className="mt-0.5 text-sm text-muted">
                            {formatDistance(c.lengthM, settings.distanceUnit)} · {c.kind === 'closed' ? 'closed circuit' : 'sprint A→B'}
                          </div>
                          {official && (
                            <div className="mt-1.5">
                              <Badge tone="accent">Official · leaderboard</Badge>
                            </div>
                          )}
                        </div>
                        <div className="shrink-0 text-right">
                          <div className="label">Best</div>
                          <div className="font-mono text-lg tabular">{formatLapTime(st?.bestMs)}</div>
                          <div className="text-xs text-muted">{st?.laps ?? 0} laps</div>
                        </div>
                      </div>
                    </Link>
                    <div className="mt-3 grid grid-cols-[1fr_1fr_auto] gap-2">
                      <LinkButton to={`/live?circuit=${c.id}`} variant="primary" size="lg">
                        <IconTimer width={18} height={18} /> Drive
                      </LinkButton>
                      <LinkButton to={`/circuits/${c.id}`} size="lg">
                        Times
                      </LinkButton>
                      <Button size="lg" aria-label={`Show ${c.name} on the map`} onClick={() => (setParams({ selected: c.id }), setMobileView('map'))}>
                        <IconMap width={18} height={18} />
                      </Button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </aside>

      <div className={`${mobileView === 'map' ? 'block' : 'hidden'} relative min-h-0 flex-1 md:block`}>
        <BaseMap>
          <SearchControl />
          <LocateControl />
          {circuits
            ?.filter((c) => c.id !== selectedId)
            .map((c) => (
              <Polyline
                key={c.id}
                positions={c.geometry.map(([lon, lat]) => [lat, lon] as [number, number])}
                pathOptions={{ color: '#8a8e96', weight: 3, opacity: 0.7 }}
                eventHandlers={{ click: () => setParams({ selected: c.id }) }}
              />
            ))}
          {selected && (
            <>
              <RouteLayer geometry={selected.geometry} closed={selected.kind === 'closed'} />
              <TimingLineView line={selected.startLine} kind="start" label={selected.kind === 'closed' ? 'Start / finish' : 'Start'} />
              {selected.finishLine && <TimingLineView line={selected.finishLine} kind="finish" label="Finish" />}
              {selected.sectors.map((s, i) => (
                <TimingLineView key={i} line={s} kind="sector" label={`Sector ${i + 1} end`} />
              ))}
              <FitBounds bounds={fitBounds} fitKey={selected.id} />
            </>
          )}
        </BaseMap>

        {/* phone: compact card for the selected circuit */}
        {selected && (
          <div className="absolute bottom-3 left-3 right-14 z-[1000] rounded border border-line bg-panel p-3 shadow-xl md:hidden">
            <div className="truncate font-bold">{selected.name}</div>
            <div className="text-xs text-muted">
              {formatDistance(selected.lengthM, settings.distanceUnit)} · best {formatLapTime(selStats?.bestMs)}
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <LinkButton to={`/live?circuit=${selected.id}`} variant="primary">
                <IconTimer width={16} height={16} /> Drive
              </LinkButton>
              <LinkButton to={`/circuits/${selected.id}`}>Times</LinkButton>
            </div>
          </div>
        )}

        {selected && (
          <div className="absolute bottom-3 right-14 z-[1000] hidden w-[min(24rem,calc(100%-4.5rem))] rounded border border-line bg-panel p-4 shadow-xl md:block">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-lg font-bold">{selected.name}</div>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  <Badge>{selected.kind === 'closed' ? 'Closed circuit' : 'Sprint'}</Badge>
                  <Badge>{selected.origin === 'routed' ? 'Road routed' : selected.origin === 'recorded' ? 'GPS recorded' : 'Imported'}</Badge>
                  {selected.sectors.length > 0 && <Badge>{selected.sectors.length + 1} sectors</Badge>}
                  {isOfficial(selected.id) && <Badge tone="accent">Official · leaderboard</Badge>}
                </div>
              </div>
              <div className="text-right">
                <div className="label">Length</div>
                <div className="font-mono tabular">{formatDistance(selected.lengthM, settings.distanceUnit)}</div>
              </div>
            </div>
            <div className="mt-3 flex items-center justify-between">
              <div>
                <div className="label">Personal best</div>
                <div className="font-mono text-xl tabular">{formatLapTime(selStats?.bestMs)}</div>
              </div>
              <div className="text-right">
                <div className="label">Laps driven</div>
                <div className="font-mono text-xl tabular">{selStats?.laps ?? 0}</div>
              </div>
            </div>
            {selected.routing?.warnings.length ? (
              <div className="mt-3">
                <Notice tone="warn">{selected.routing.warnings[0]}</Notice>
              </div>
            ) : null}
            {selected.elevation && selected.elevation.length > 1 && (
              <div className="mt-3 h-20">
                <ElevationChart points={selected.elevation} distanceUnit={settings.distanceUnit} compact />
              </div>
            )}
            <div className="mt-4 flex flex-wrap gap-2">
              <Button variant="primary" onClick={() => navigate(`/live?circuit=${selected.id}`)}>
                <IconTimer width={18} height={18} /> Drive
              </Button>
              <LinkButton to={`/circuits/${selected.id}`}>Times & compare</LinkButton>
              {!isOfficial(selected.id) && <LinkButton to={`/circuits/${selected.id}/edit`}>Edit</LinkButton>}
              <Button
                aria-label="Export circuit"
                title="Export circuit (JSON)"
                onClick={() => downloadText(`${slug(selected.name)}.laptimer.json`, buildExport([selected], [], []), 'application/json')}
              >
                <IconDownload width={18} height={18} />
              </Button>
              <ConfirmButton aria-label="Delete circuit" title="Delete circuit (sessions are kept)" onConfirm={() => remove(selected)} confirmLabel="Delete?">
                <IconTrash width={18} height={18} />
              </ConfirmButton>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}


interface CircuitStats {
  laps: number;
  bestMs: number | null;
}

/** Lap count and best valid time per circuit, across all sessions. */
function circuitStats(sessions: Session[], includeSimulated: boolean): Map<string, CircuitStats> {
  const out = new Map<string, CircuitStats>();
  const hasReal = new Set(sessions.filter((s) => s.source === 'gps' && s.laps.length).map((s) => s.circuitId));
  for (const s of sessions) {
    const st = out.get(s.circuitId) ?? { laps: 0, bestMs: null };
    // Simulated laps only count when wanted, or when the circuit has no real laps at all
    // (the same rule the circuit page uses by default).
    const counts = s.source === 'gps' || includeSimulated || !hasReal.has(s.circuitId);
    if (counts) st.laps += s.laps.length;
    if (counts) for (const l of s.laps) if (l.valid && (st.bestMs === null || l.timeMs < st.bestMs)) st.bestMs = l.timeMs;
    out.set(s.circuitId, st);
  }
  return out;
}

export function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'circuit';
}
