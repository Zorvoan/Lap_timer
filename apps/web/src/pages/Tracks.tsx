import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { distanceMeters, formatDistance, formatLapTime, type Circuit } from '@laptimer/core';
import { BaseMap, FitBounds } from '../components/map/BaseMap';
import { TrackLines, boundsOf } from '../components/map/TrackLines';
import { LocateControl } from '../components/map/MapControls';
import { ProfileNotice, loadBoard } from '../components/track/LeaderboardTab';
import { Notice, Spinner } from '../components/ui/primitives';
import { IconChevronRight, IconPin, IconPlay, IconPlus, IconRecord } from '../components/ui/icons';
import { useAccount, useData } from '../hooks/useData';
import { useSettings } from '../hooks/useSettings';
import { circuitStats, type CircuitStats } from '../lib/circuitStats';
import { ensureLocalCircuit, refreshFeatured } from '../lib/cloud/account';
import type { LeaderboardEntry } from '../lib/cloud/leaderboard';
import { listCircuits, listSessions } from '../lib/repo';

/** A start line closer than this is "where you are". */
const AT_START_M = 400;

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
  const bounds = useMemo(() => boundsOf(all), [all]);

  async function drive(c: Circuit) {
    const f = acc.featured.find((x) => x.id === c.id);
    if (f) await ensureLocalCircuit(f);
    navigate(`/live?circuit=${c.id}`);
  }

  const row = (c: Circuit) => <TrackRow key={c.id} circuit={c} stats={stats.get(c.id)} board={boards?.get(c.id)} official={isOfficial(c.id)} myUid={acc.user?.uid ?? null} />;

  return (
    <div className="flex h-full flex-col md:flex-row">
      <section className={`${view === 'list' ? 'flex' : 'hidden'} min-h-0 flex-1 flex-col md:flex md:w-[26rem] md:flex-none md:border-r md:border-line`}>
        <div className="min-h-0 flex-1 overflow-auto pb-6">
          <header className="flex items-center justify-between gap-3 px-4 pb-3 pt-5">
            <h1 className="text-[1.7rem] font-extrabold tracking-tight">Tracks</h1>
            <ViewSwitch view={view} onChange={(v) => setParams(v === 'map' ? { view: 'map' } : {}, { replace: true })} />
          </header>

          {near && (
            <div className="mx-4 mb-3 rounded-lg border border-accent/40 bg-accent/10 p-3.5">
              <div className="label flex items-center gap-1.5 !text-[#ff8a84]">
                <IconPin width={14} height={14} /> At the start line
              </div>
              <div className="mt-1.5 flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xl font-extrabold">{near.name}</div>
                  {stats.get(near.id)?.bestMs != null && (
                    <div className="text-xs text-muted">
                      Your best <span className="font-mono text-fg tabular">{formatLapTime(stats.get(near.id)!.bestMs)}</span>
                    </div>
                  )}
                </div>
                <button type="button" onClick={() => void drive(near)} className="flex h-11 items-center gap-2 rounded bg-accent px-4 font-bold text-white">
                  <IconPlay width={14} height={14} /> Drive
                </button>
              </div>
            </div>
          )}

          <div className="px-4">
            <ProfileNotice />
          </div>
          {error && (
            <div className="px-4 pb-3">
              <Notice tone="error">Could not load your tracks: {error.message}</Notice>
            </div>
          )}
          {loading && !data ? (
            <div className="px-4 py-6">
              <Spinner label="Loading tracks" />
            </div>
          ) : (
            <>
              <ul className="border-t border-line">{circuits.official.map(row)}</ul>
              {circuits.own.length > 0 && (
                <>
                  <h2 className="label px-4 pb-2 pt-6">Your tracks</h2>
                  <ul className="border-t border-line">{circuits.own.map(row)}</ul>
                </>
              )}
              <div className="flex flex-wrap justify-center gap-x-6 gap-y-2 px-4 pt-5 text-sm text-muted">
                <Link to="/circuits/new" className="flex items-center gap-1.5 hover:text-fg">
                  <IconPlus width={16} height={16} /> Add your own track
                </Link>
                <Link to="/circuits/record" className="flex items-center gap-1.5 hover:text-fg">
                  <IconRecord width={16} height={16} /> Record one by driving
                </Link>
              </div>
            </>
          )}
        </div>
      </section>

      <section className={`${view === 'map' ? 'flex' : 'hidden'} min-h-0 flex-1 flex-col md:flex`}>
        <header className="flex items-center justify-between gap-3 border-b border-line px-4 pb-3 pt-5 md:hidden">
          <h1 className="text-[1.7rem] font-extrabold tracking-tight">Tracks</h1>
          <ViewSwitch view={view} onChange={(v) => setParams(v === 'map' ? { view: 'map' } : {}, { replace: true })} />
        </header>
        <div className="relative min-h-0 flex-1">
        <BaseMap>
          <LocateControl />
          {all.length > 0 && <TrackLines circuits={all} isOfficial={isOfficial} onSelect={(id) => navigate(`/tracks/${id}`)} />}
          <FitBounds bounds={bounds} fitKey={`all:${all.length}`} maxZoom={15} />
        </BaseMap>
        <div className="pointer-events-none absolute bottom-3 left-3 z-[1000] rounded border border-line bg-panel/95 px-3 py-2 text-xs text-muted shadow-lg">Tap a track to open it</div>
        </div>
      </section>
    </div>
  );
}

function ViewSwitch({ view, onChange }: { view: 'list' | 'map'; onChange: (v: 'list' | 'map') => void }) {
  return (
    <div role="tablist" aria-label="View" className="grid w-36 grid-cols-2 gap-1 rounded border border-line bg-raised p-1 text-sm font-semibold md:hidden">
      {(['list', 'map'] as const).map((v) => (
        <button key={v} type="button" role="tab" aria-selected={view === v} onClick={() => onChange(v)} className={`h-8 rounded ${view === v ? 'bg-panel text-fg shadow' : 'text-muted'}`}>
          {v === 'list' ? 'List' : 'Map'}
        </button>
      ))}
    </div>
  );
}

function TrackRow({
  circuit: c,
  stats,
  board,
  official,
  myUid,
}: {
  circuit: Circuit;
  stats: CircuitStats | undefined;
  board: LeaderboardEntry[] | undefined;
  official: boolean;
  myUid: string | null;
}) {
  const { settings } = useSettings();
  const rank = myUid && board ? board.findIndex((e) => e.uid === myUid) + 1 : 0;
  const record = board?.[0];
  let right: React.ReactNode;
  if (stats?.bestMs != null) {
    right = (
      <>
        <div className="font-mono tabular">{formatLapTime(stats.bestMs)}</div>
        {rank > 0 && <div className="text-xs font-bold text-gain">P{rank} of {board!.length}</div>}
      </>
    );
  } else if (record) {
    right = (
      <>
        <div className="text-xs text-muted">Record</div>
        <div className="font-mono text-sm tabular">{formatLapTime(record.timeMs)}</div>
      </>
    );
  } else {
    right = <div className="text-sm text-muted">{official && !board ? '' : 'No times yet'}</div>;
  }
  return (
    <li className="border-b border-line">
      <Link to={`/tracks/${c.id}`} className="flex min-h-[4.25rem] items-center gap-3 px-4 py-3 hover:bg-raised">
        <div className="min-w-0 flex-1">
          <div className="truncate font-bold">{c.name}</div>
          <div className="mt-0.5 text-xs text-muted">
            {formatDistance(c.lengthM, settings.distanceUnit)}
            {c.kind === 'closed' ? ', circuit' : ''}
          </div>
        </div>
        <div className="shrink-0 text-right">{right}</div>
        <IconChevronRight width={18} height={18} className="shrink-0 text-muted" />
      </Link>
    </li>
  );
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
