import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useMapEvents } from 'react-leaflet';
import { distanceMeters, formatDistance, formatLapTime, type Circuit } from '@laptimer/core';
import { BaseMap, FitBounds } from '../components/map/BaseMap';
import { TrackLines, boundsOf } from '../components/map/TrackLines';
import { RouteShape } from '../components/map/RouteShape';
import { LocateControl } from '../components/map/MapControls';
import { ProfileNotice, loadBoard } from '../components/track/LeaderboardTab';
import { Notice, Segmented, Spinner } from '../components/ui/primitives';
import { IconPin, IconPlay, IconPlus, IconRecord } from '../components/ui/icons';
import { useAccount, useData } from '../hooks/useData';
import { useSettings } from '../hooks/useSettings';
import { circuitStats, type CircuitStats } from '../lib/circuitStats';
import { ensureLocalCircuit, refreshFeatured } from '../lib/cloud/account';
import type { LeaderboardEntry } from '../lib/cloud/leaderboard';
import { listCircuits, listSessions } from '../lib/repo';

/** A start line closer than this is "where you are". */
const AT_START_M = 400;

/** Where the tracks map was last left during this app session (not stored across restarts). */
let lastMapView: { center: [number, number]; zoom: number } | null = null;

function KeepView() {
  useMapEvents({
    moveend(e) {
      if (e.target.getSize().x === 0) return; // hidden (list view on phones)
      const c = e.target.getCenter();
      lastMapView = { center: [c.lat, c.lng], zoom: e.target.getZoom() };
    },
  });
  return null;
}

/**
 * The home screen: every track (official first, then the user's own) with the user's best time
 * and rank, or the track record. `?view=map` shows the same tracks on a map on phones; desktop
 * shows both. A track whose start line is nearby is offered at the top.
 */
export function Tracks() {
  const acc = useAccount();
  const { settings } = useSettings();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const view = params.get('view') === 'map' ? 'map' : 'list';
  useEffect(() => {
    void refreshFeatured();
  }, []);

  const { data, loading, error } = useData(async () => ({ circuits: await listCircuits(), sessions: await listSessions() }), [acc.featured.length]);
  const stats = useMemo(() => circuitStats(data?.sessions ?? [], settings.includeSimulatedInBests), [data, settings.includeSimulatedInBests]);
  const order = (id: string) => acc.featured.findIndex((f) => f.id === id);
  const isOfficial = (id: string) => order(id) >= 0;
  const circuits = useMemo(() => {
    const all = data?.circuits ?? [];
    const official = all.filter((c) => isOfficial(c.id)).sort((a, b) => order(a.id) - order(b.id));
    return { official, own: all.filter((c) => !isOfficial(c.id)) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, acc.featured]);
  const all = useMemo(() => [...circuits.official, ...circuits.own], [circuits]);

  const ids = acc.featured.map((f) => f.id).join(',');
  const { data: boards } = useData(async () => {
    const out = new Map<string, LeaderboardEntry[]>();
    await Promise.all(acc.featured.map(async (f) => out.set(f.id, await loadBoard(f.id, 100).catch(() => []))));
    return out;
  }, [ids]);

  const near = useNearestStart(all);
  // Read once per visit: the map opens where the user left it during this app session.
  const [mapView] = useState(() => lastMapView);
  const bounds = useMemo(() => boundsOf(all), [all]);

  async function drive(c: Circuit) {
    const f = acc.featured.find((x) => x.id === c.id);
    if (f) await ensureLocalCircuit(f);
    navigate(`/live?circuit=${c.id}`);
  }

  // Official tracks are numbered like rally stages, in their featured order.
  const stageNo = (id: string) => (isOfficial(id) ? order(id) + 1 : 0);
  const row = (c: Circuit) => <TrackRow key={c.id} circuit={c} stage={stageNo(c.id)} stats={stats.get(c.id)} board={boards?.get(c.id)} official={isOfficial(c.id)} myUid={acc.user?.uid ?? null} />;

  return (
    <div className="flex h-full flex-col md:flex-row">
      <section className={`${view === 'list' ? 'flex' : 'hidden'} anim-view min-h-0 flex-1 flex-col md:flex md:w-[26rem] md:flex-none md:border-r md:border-line`}>
        <div className="min-h-0 flex-1 overflow-auto pb-6">
          <header className="flex items-end justify-between gap-3 px-4 pb-4 pt-5">
            <div>
              {circuits.official.length > 0 && (
                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#d08a4e]">{circuits.official.length} official roads</div>
              )}
              <h1 className="font-display text-[2.1rem] font-black leading-none tracking-tight">Roads</h1>
            </div>
            <ViewSwitch view={view} onChange={(v) => setParams(v === 'map' ? { view: 'map' } : {}, { replace: true })} />
          </header>

          {near && (
            <div className="mx-4 mb-3 flex items-center gap-3 rounded-lg border border-line bg-raised py-2 pl-3.5 pr-2">
              <IconPin width={16} height={16} className="shrink-0 text-[#ff8a84]" />
              <div className="min-w-0 flex-1 text-sm">
                <span className="text-muted">At the start of </span>
                <span className="font-display font-extrabold">
                  {stageNo(near.id) ? `SS${stageNo(near.id)} ` : ''}
                  {near.name}
                </span>
              </div>
              <button type="button" onClick={() => void drive(near)} className="press flex h-10 shrink-0 items-center gap-2 rounded bg-accent px-3.5 font-bold text-white">
                <IconPlay width={13} height={13} /> Drive
              </button>
            </div>
          )}

          <div className="px-4">
            <ProfileNotice />
          </div>
          {error && (
            <div className="px-4 pb-3">
              <Notice tone="error">Could not load your roads: {error.message}</Notice>
            </div>
          )}
          {loading && !data ? (
            <div className="px-4 py-6">
              <Spinner label="Loading roads" />
            </div>
          ) : (
            <>
              <ul className="border-t border-line">{circuits.official.map(row)}</ul>
              {circuits.own.length > 0 && (
                <>
                  <h2 className="label px-4 pb-2 pt-6">Your roads</h2>
                  <ul className="border-t border-line">{circuits.own.map(row)}</ul>
                </>
              )}
              <div className="flex flex-wrap justify-center gap-x-6 gap-y-2 px-4 pt-5 text-sm text-muted">
                <Link to="/circuits/new" className="flex items-center gap-1.5 hover:text-fg">
                  <IconPlus width={16} height={16} /> Add your own road
                </Link>
                <Link to="/circuits/record" className="flex items-center gap-1.5 hover:text-fg">
                  <IconRecord width={16} height={16} /> Record one by driving
                </Link>
              </div>
            </>
          )}
        </div>
      </section>

      <section className={`${view === 'map' ? 'flex' : 'hidden'} anim-view min-h-0 flex-1 flex-col md:flex`}>
        <header className="flex items-center justify-between gap-3 border-b border-line px-4 pb-3 pt-5 md:hidden">
          <h1 className="font-display text-[2.1rem] font-black leading-none tracking-tight">Roads</h1>
          <ViewSwitch view={view} onChange={(v) => setParams(v === 'map' ? { view: 'map' } : {}, { replace: true })} />
        </header>
        <div className="relative min-h-0 flex-1">
        <BaseMap center={mapView?.center} zoom={mapView?.zoom}>
          <LocateControl />
          {all.length > 0 && <TrackLines circuits={all} isOfficial={isOfficial} onSelect={(id) => navigate(`/tracks/${id}`, { state: { from: '/?view=map' } })} />}
          {/* Coming back from a track keeps the map where it was; otherwise it shows every track. */}
          {!mapView && <FitBounds bounds={bounds} fitKey={`all:${all.length}`} maxZoom={15} />}
          <KeepView />
        </BaseMap>
        <div className="pointer-events-none absolute bottom-3 left-3 z-[1000] rounded border border-line bg-panel/95 px-3 py-2 text-xs text-muted shadow-lg">Tap a track to open it</div>
        </div>
      </section>
    </div>
  );
}

function ViewSwitch({ view, onChange }: { view: 'list' | 'map'; onChange: (v: 'list' | 'map') => void }) {
  return (
    <Segmented
      label="View"
      className="w-36 md:hidden"
      itemClass="h-8"
      value={view}
      onChange={onChange}
      options={[
        { value: 'list', label: 'List' },
        { value: 'map', label: 'Map' },
      ]}
    />
  );
}

function TrackRow({
  circuit: c,
  stage,
  stats,
  board,
  official,
  myUid,
}: {
  circuit: Circuit;
  /** Stage number of an official track, 0 for the user's own. */
  stage: number;
  stats: CircuitStats | undefined;
  board: LeaderboardEntry[] | undefined;
  official: boolean;
  myUid: string | null;
}) {
  const { settings } = useSettings();
  const rank = myUid && board ? board.findIndex((e) => e.uid === myUid) + 1 : 0;
  const record = board?.[0];
  const climb = elevationChange(c);
  let right: React.ReactNode;
  if (stats?.bestMs != null) {
    right = (
      <>
        <div className="font-mono text-[17px] font-semibold tabular">{formatLapTime(stats.bestMs)}</div>
        {rank > 0 && <div className="text-xs font-bold text-gain">P{rank} of {board!.length}</div>}
      </>
    );
  } else if (record) {
    right = (
      <div className="text-muted">
        <div className="text-xs">Record</div>
        <div className="font-mono text-sm tabular">{formatLapTime(record.timeMs)}</div>
      </div>
    );
  } else {
    right = <div className="max-w-[5.5rem] text-sm text-muted">{official && !board ? '' : 'No time yet'}</div>;
  }
  return (
    <li className="border-b border-line">
      <Link to={`/tracks/${c.id}`} state={{ from: '/' }} className="flex items-center gap-3.5 px-4 py-3.5 hover:bg-raised active:bg-raised">
        <RouteShape geometry={c.geometry} size={68} className="shrink-0 rounded-lg bg-raised text-fg/85" />
        <div className="min-w-0 flex-1">
          {stage > 0 && <div className="font-mono text-[11px] font-bold text-accent">SS{stage}</div>}
          <div className="font-display text-[19px] font-extrabold leading-tight">{c.name}</div>
          <div className="mt-0.5 text-xs text-muted">
            {formatDistance(c.lengthM, settings.distanceUnit)}
            {c.kind === 'closed' ? ', circuit' : ''}
          </div>
          {climb && <div className="mt-0.5 text-xs font-semibold text-[#d08a4e]">{climb}</div>}
        </div>
        <div className="shrink-0 text-right">{right}</div>
      </Link>
    </li>
  );
}

/** "+130 m climb" or "130 m descent" from start to finish, when the track has elevation data. */
function elevationChange(c: Circuit): string | null {
  const e = c.elevation;
  if (!e || e.length < 2) return null;
  const change = Math.round(e[e.length - 1].elevation - e[0].elevation);
  if (Math.abs(change) < 20) return null;
  return change > 0 ? `+${change} m climb` : `${-change} m descent`;
}

/**
 * The track whose start line is within AT_START_M of the user, if location is already allowed.
 * The page never asks for the permission itself: a prompt on opening the app would be a surprise.
 */
function useNearestStart(circuits: Circuit[]): Circuit | null {
  const [pos, setPos] = useState<{ lat: number; lon: number } | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (!('geolocation' in navigator) || !navigator.permissions) return;
    void navigator.permissions
      .query({ name: 'geolocation' })
      .then((p) => {
        if (p.state !== 'granted' || cancelled) return;
        navigator.geolocation.getCurrentPosition(
          (g) => !cancelled && setPos({ lat: g.coords.latitude, lon: g.coords.longitude }),
          () => undefined,
          { enableHighAccuracy: true, maximumAge: 60_000, timeout: 15_000 },
        );
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  return useMemo(() => {
    if (!pos) return null;
    let best: { c: Circuit; d: number } | null = null;
    for (const c of circuits) {
      const { a, b } = c.startLine;
      const d = distanceMeters(pos, { lat: (a.lat + b.lat) / 2, lon: (a.lon + b.lon) / 2 });
      if (d <= AT_START_M && (!best || d < best.d)) best = { c, d };
    }
    return best?.c ?? null;
  }, [pos, circuits]);
}
