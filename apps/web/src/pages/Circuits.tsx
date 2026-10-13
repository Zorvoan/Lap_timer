import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { formatDistance, formatLapTime, type Circuit, type Session } from '@laptimer/core';
import { BaseMap, FitBounds, MapClick } from '../components/map/BaseMap';
import { TRACK_COLORS, TrackLines, boundsOf, trackColor } from '../components/map/TrackLines';
import { LocateControl, SearchControl } from '../components/map/MapControls';
import { Badge, Button, ConfirmButton, Empty, LinkButton, Notice, Spinner } from '../components/ui/primitives';
import { IconDownload, IconMap, IconPlus, IconRecord, IconTimer, IconTrash, IconX } from '../components/ui/icons';
import { useAccount, useData } from '../hooks/useData';
import { useSettings } from '../hooks/useSettings';
import { deleteCircuit, listCircuits, listSessions } from '../lib/repo';
import { buildExport, downloadText } from '../lib/exportImport';
import { ElevationChart } from '../components/charts/Charts';

/**
 * Circuits: list plus a map of every track (official and the user's own). Nothing is selected
 * at first; clicking a track on the map or in the list opens its card.
 * URL: `?view=map` shows the map on phones, `?selected=<id>` the opened track. Tapping
 * "Circuits" in the navigation again clears both, which returns phones to the list.
 */
export function Circuits() {
  const { settings } = useSettings();
  const acc = useAccount();
  const [params, setParams] = useSearchParams();
  const { data, loading, error } = useData(async () => ({ circuits: await listCircuits(), sessions: await listSessions() }), []);
  const stats = useMemo(() => circuitStats(data?.sessions ?? [], settings.includeSimulatedInBests), [data, settings.includeSimulatedInBests]);

  const isOfficial = (id: string) => acc.featured.some((f) => f.id === id);
  const featuredOrder = (id: string) => acc.featured.findIndex((f) => f.id === id);
  const all = data?.circuits;
  const official = (all ?? []).filter((c) => isOfficial(c.id)).sort((a, b) => featuredOrder(a.id) - featuredOrder(b.id));
  const own = (all ?? []).filter((c) => !isOfficial(c.id));

  const selectedId = params.get('selected');
  const selected = all?.find((c) => c.id === selectedId) ?? null;
  const view = params.get('view') === 'map' ? 'map' : 'list';

  // The map frames every track until a track is picked from the list; picking one on the map
  // keeps the view, so the user can hop between neighbouring tracks.
  const [fitTo, setFitTo] = useState<string | null>(selectedId);
  const fitBounds = useMemo(() => boundsOf((all ?? []).filter((c) => !fitTo || c.id === fitTo)), [all, fitTo]);

  function update(next: { view?: 'list' | 'map'; selected?: string | null }) {
    const v = next.view ?? view;
    const s = next.selected === undefined ? selectedId : next.selected;
    const p: Record<string, string> = {};
    if (v === 'map') p.view = 'map';
    if (s) p.selected = s;
    setParams(p);
  }

  function selectFromList(id: string, showMap: boolean) {
    setFitTo(id);
    update({ selected: id, view: showMap ? 'map' : undefined });
  }

  async function remove(c: Circuit) {
    await deleteCircuit(c.id);
    setFitTo(null);
    update({ selected: null });
  }

  const listItem = (c: Circuit) => (
    <CircuitListItem
      key={c.id}
      circuit={c}
      stats={stats.get(c.id)}
      official={isOfficial(c.id)}
      selected={c.id === selectedId}
      onSelect={(showMap) => selectFromList(c.id, showMap)}
    />
  );

  return (
    <div className="flex h-full flex-col md:flex-row">
      {/* Phone: title + List/Map switch */}
      <div className="flex items-center justify-between gap-3 border-b border-line bg-panel px-4 py-3 md:hidden">
        <h1 className="text-2xl font-bold tracking-tight">Circuits</h1>
        <div role="tablist" aria-label="View" className="flex overflow-hidden rounded border border-line text-sm font-semibold">
          {(['list', 'map'] as const).map((v) => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={view === v}
              onClick={() => update({ view: v })}
              className={`h-10 px-5 ${view === v ? 'bg-accent text-white' : 'text-muted'}`}
            >
              {v === 'list' ? 'List' : 'Map'}
            </button>
          ))}
        </div>
      </div>

      <aside className={`${view === 'list' ? 'flex' : 'hidden'} min-h-0 flex-1 flex-col bg-bg md:flex md:w-80 md:flex-none md:border-r md:border-line md:bg-panel`}>
        <div className="hidden items-center justify-between gap-2 border-b border-line p-3 md:flex">
          <h1 className="text-lg font-bold tracking-tight">Circuits</h1>
          <div className="flex gap-2">
            <LinkButton to="/circuits/record" size="sm" title="Record a circuit by driving it">
              <IconRecord width={16} height={16} /> Record
            </LinkButton>
            <LinkButton to="/circuits/new" size="sm" variant="primary">
              <IconPlus width={16} height={16} /> New
            </LinkButton>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-auto pb-4">
          <div className="grid grid-cols-2 gap-2 p-3 md:hidden">
            <LinkButton to="/circuits/new" variant="primary" size="lg">
              <IconPlus width={18} height={18} /> New circuit
            </LinkButton>
            <LinkButton to="/circuits/record" size="lg">
              <IconRecord width={18} height={18} /> Record drive
            </LinkButton>
          </div>
          {loading && !all && (
            <div className="p-4">
              <Spinner />
            </div>
          )}
          {error && (
            <div className="p-3">
              <Notice tone="error">{error.message}</Notice>
            </div>
          )}

          {official.length > 0 && (
            <ListSection title="Official tracks" color={TRACK_COLORS.official}>
              {official.map(listItem)}
            </ListSection>
          )}
          {all && (
            <ListSection title="My circuits" color={TRACK_COLORS.own}>
              {own.length ? (
                own.map(listItem)
              ) : (
                <li className="px-3 md:px-4 md:py-3">
                  <Empty title="No circuits of your own yet">Build one from roads on the map, or record one by driving it.</Empty>
                </li>
              )}
            </ListSection>
          )}
        </div>
      </aside>

      <div className={`${view === 'map' ? 'block' : 'hidden'} relative min-h-0 flex-1 overflow-hidden md:block`}>
        <BaseMap>
          <SearchControl />
          <LocateControl />
          <MapClick onClick={() => selectedId && update({ selected: null })} />
          {all && <TrackLines circuits={all} isOfficial={isOfficial} selectedId={selectedId} onSelect={(id) => update({ selected: id })} />}
          <FitBounds bounds={fitBounds} fitKey={`${fitTo ?? 'all'}:${all?.length ?? 0}`} maxZoom={15} />
        </BaseMap>

        {!selected && all && all.length > 0 && (
          <div className="pointer-events-none absolute bottom-3 left-3 z-[1000] rounded border border-line bg-panel/95 px-3 py-2 text-sm shadow-lg">
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {official.length > 0 && <LegendItem color={TRACK_COLORS.official} label="Official" />}
              <LegendItem color={TRACK_COLORS.own} label="My circuits" />
            </div>
            <div className="mt-1 text-xs text-muted">Tap a track to open it</div>
          </div>
        )}

        {selected && (
          <div className="absolute inset-x-3 bottom-3 z-[1001] max-h-[calc(100%-4.5rem)] overflow-auto rounded border border-line bg-panel shadow-2xl md:left-auto md:right-14 md:w-[26rem]">
            <CircuitCard
              circuit={selected}
              stats={stats.get(selected.id)}
              official={isOfficial(selected.id)}
              onClose={() => update({ selected: null })}
              onDelete={() => remove(selected)}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function ListSection({ title, color, children }: { title: string; color: string; children: React.ReactNode }) {
  return (
    <section className="mt-2 md:mt-0">
      <h2 className="flex items-center gap-2 px-4 pb-2 pt-3 md:border-b md:border-line md:py-2.5">
        <span className="h-3 w-1 rounded-sm" style={{ background: color }} aria-hidden="true" />
        <span className="label whitespace-nowrap">{title}</span>
      </h2>
      <ul className="space-y-3 px-3 md:space-y-0 md:divide-y md:divide-line md:px-0">{children}</ul>
    </section>
  );
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-2 font-medium">
      <span className="h-1 w-5 rounded-full" style={{ background: color }} aria-hidden="true" />
      {label}
    </span>
  );
}

function CircuitListItem({
  circuit: c,
  stats: st,
  official,
  selected,
  onSelect,
}: {
  circuit: Circuit;
  stats: CircuitStats | undefined;
  official: boolean;
  selected: boolean;
  onSelect: (showMap: boolean) => void;
}) {
  const { settings } = useSettings();
  const meta = `${formatDistance(c.lengthM, settings.distanceUnit)} · ${c.kind === 'closed' ? 'closed circuit' : 'sprint A→B'}`;
  return (
    <li className={selected ? 'md:bg-raised' : ''}>
      {/* desktop row: opens the circuit on the map */}
      <button type="button" onClick={() => onSelect(false)} className="hidden w-full items-center gap-3 px-4 py-3 text-left hover:bg-raised md:flex" aria-current={selected}>
        <span className="h-8 w-1 shrink-0 rounded-sm" style={{ background: selected ? trackColor(official) : 'transparent' }} aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold">{c.name}</span>
          <span className="mt-0.5 block text-xs text-muted">{meta}</span>
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
              <div className="mt-0.5 text-sm text-muted">{meta}</div>
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
          <Button size="lg" aria-label={`Show ${c.name} on the map`} title="Show on the map" onClick={() => onSelect(true)}>
            <IconMap width={18} height={18} />
          </Button>
        </div>
      </div>
    </li>
  );
}

/** Details of the track opened on the map. */
function CircuitCard({
  circuit: c,
  stats: st,
  official,
  onClose,
  onDelete,
}: {
  circuit: Circuit;
  stats: CircuitStats | undefined;
  official: boolean;
  onClose: () => void;
  onDelete: () => void;
}) {
  const { settings } = useSettings();
  const navigate = useNavigate();
  return (
    <div className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-xl font-bold">{c.name}</h2>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {official && <Badge tone="accent">Official · leaderboard</Badge>}
            <Badge>{c.kind === 'closed' ? 'Closed circuit' : 'Sprint'}</Badge>
            {!official && <Badge>{c.origin === 'routed' ? 'Road routed' : c.origin === 'recorded' ? 'GPS recorded' : 'Imported'}</Badge>}
            {c.sectors.length > 0 && <Badge>{c.sectors.length + 1} sectors</Badge>}
          </div>
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className="-mr-2 -mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded text-muted hover:bg-raised hover:text-fg">
          <IconX />
        </button>
      </div>

      <dl className="mt-4 grid grid-cols-3 gap-3">
        <div>
          <dt className="label">Length</dt>
          <dd className="mt-0.5 font-mono text-lg tabular">{formatDistance(c.lengthM, settings.distanceUnit)}</dd>
        </div>
        <div>
          <dt className="label">Your best</dt>
          <dd className="mt-0.5 font-mono text-lg tabular">{formatLapTime(st?.bestMs)}</dd>
        </div>
        <div className="text-right">
          <dt className="label">Laps</dt>
          <dd className="mt-0.5 font-mono text-lg tabular">{st?.laps ?? 0}</dd>
        </div>
      </dl>

      {!official && c.routing?.warnings.length ? (
        <div className="mt-3">
          <Notice tone="warn">{c.routing.warnings[0]}</Notice>
        </div>
      ) : null}
      {c.elevation && c.elevation.length > 1 && (
        <div className="mt-3 hidden h-16 md:block">
          <ElevationChart points={c.elevation} distanceUnit={settings.distanceUnit} compact />
        </div>
      )}

      <div className="mt-4 grid grid-cols-2 gap-2">
        <Button variant="primary" size="lg" onClick={() => navigate(`/live?circuit=${c.id}`)}>
          <IconTimer width={18} height={18} /> Drive
        </Button>
        <LinkButton to={`/circuits/${c.id}`} size="lg" className="whitespace-nowrap">
          Times<span className="hidden sm:inline">&nbsp;&amp; compare</span>
        </LinkButton>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1">
        {official ? (
          <LinkButton to={`/leaderboard/${c.id}`} variant="ghost" size="sm">
            Leaderboard
          </LinkButton>
        ) : (
          <LinkButton to={`/circuits/${c.id}/edit`} variant="ghost" size="sm">
            Edit
          </LinkButton>
        )}
        <Button variant="ghost" size="sm" title="Export circuit (JSON)" onClick={() => downloadText(`${slug(c.name)}.laptimer.json`, buildExport([c], [], []), 'application/json')}>
          <IconDownload width={16} height={16} /> Export
        </Button>
        {!official && (
          <ConfirmButton variant="ghost" size="sm" className="ml-auto text-loss" title="Delete circuit (sessions are kept)" onConfirm={onDelete} confirmLabel="Tap again to delete">
            <IconTrash width={16} height={16} /> Delete
          </ConfirmButton>
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
