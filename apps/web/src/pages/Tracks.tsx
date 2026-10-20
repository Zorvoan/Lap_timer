import { useEffect, useMemo, useState } from 'react';
import { Rolling } from '../components/ui/Rolling';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useMapEvents } from 'react-leaflet';
import { distanceMeters, formatDistance, formatLapTime, type Circuit } from '@laptimer/core';
import { BaseMap, FitBounds } from '../components/map/BaseMap';
import { TrackLines, boundsOf, type TrackKind } from '../components/map/TrackLines';
import { RouteShape } from '../components/map/RouteShape';
import { LocateControl } from '../components/map/MapControls';
import { ProfileNotice, loadBoard } from '../components/track/LeaderboardTab';
import { LinkButton, Notice, Segmented, Sheet, Spinner } from '../components/ui/primitives';
import { IconChevronRight, IconPin, IconPlay, IconPlus, IconRecord, IconShare } from '../components/ui/icons';
import { useAccount, useData } from '../hooks/useData';
import { useSettings } from '../hooks/useSettings';
import { useSwipe } from '../hooks/useSwipe';
import { circuitStats, type CircuitStats } from '../lib/circuitStats';
import { describeError, ensureLocalCircuit, publishRoad, refreshFeatured } from '../lib/cloud/account';
import { PUBLIC_ROAD_LIMIT } from '../lib/cloud/leaderboard';
import type { LeaderboardEntry } from '../lib/cloud/leaderboard';
import { listCircuits, listSessions } from '../lib/repo';
import { climbText, useElevation } from '../lib/climb';
import { ClimbSuffix } from '../components/track/ClimbSuffix';

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
  const group = (['community', 'own'] as const).find((g) => g === params.get('group')) ?? 'official';
  // The groups in order, for swiping between them; the new one slides in from the side it came from.
  const groups = ['official', 'community', 'own'] as const;
  const [slide, setSlide] = useState<'next' | 'back' | null>(null);
  const setGroup = (g: (typeof groups)[number]) => {
    if (g === group) return;
    setSlide(groups.indexOf(g) > groups.indexOf(group) ? 'next' : 'back');
    setParams({ ...(view === 'map' ? { view: 'map' } : {}), ...(g === 'official' ? {} : { group: g }) }, { replace: true });
  };
  const swipe = useSwipe(
    (step) => setGroup(groups[groups.indexOf(group) + step]),
    (step) => groups[groups.indexOf(group) + step] !== undefined,
  );
  useEffect(() => {
    void refreshFeatured();
  }, []);

  const { data, loading, error } = useData(async () => ({ circuits: await listCircuits(), sessions: await listSessions() }), [acc.featured.length], 'tracks:list');
  const stats = useMemo(() => circuitStats(data?.sessions ?? [], settings.includeSimulatedInBests), [data, settings.includeSimulatedInBests]);
  const order = (id: string) => acc.featured.findIndex((f) => f.id === id);
  const isOfficial = (id: string) => order(id) >= 0;
  const community = useMemo(() => acc.community.filter((c) => !isOfficial(c.id)), [acc.community, acc.featured]); // eslint-disable-line react-hooks/exhaustive-deps
  const communityOwner = (id: string) => community.find((c) => c.id === id)?.owner;
  const circuits = useMemo(() => {
    const all = data?.circuits ?? [];
    const official = all.filter((c) => isOfficial(c.id)).sort((a, b) => order(a.id) - order(b.id));
    // A public road (yours, or one you drove) is listed under Community roads, not twice.
    return { official, community, own: all.filter((c) => !isOfficial(c.id) && !communityOwner(c.id)) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, acc.featured, community]);
  const all = useMemo(() => [...circuits.official, ...circuits.community, ...circuits.own], [circuits]);
  const kindOf = (id: string): TrackKind => (isOfficial(id) ? 'official' : communityOwner(id) ? 'community' : 'own');

  const boardTracks = useMemo(() => [...acc.featured, ...community], [acc.featured, community]);
  const ids = boardTracks.map((f) => f.id).join(',');
  const { data: boards } = useData(async () => {
    const out = new Map<string, LeaderboardEntry[]>();
    await Promise.all(boardTracks.map(async (f) => out.set(f.id, await loadBoard(f.id, 100).catch(() => []))));
    return out;
  }, [ids], `tracks:boards:${ids}`);

  const near = useNearestStart(all);
  // Read once per visit: the map opens where the user left it during this app session.
  const [mapView] = useState(() => lastMapView);
  const bounds = useMemo(() => boundsOf(all), [all]);

  const [choice, setChoice] = useState<string[] | null>(null);
  // Sharing: pick one of your own roads to make public (up to PUBLIC_ROAD_LIMIT).
  const [sharing, setSharing] = useState(false);
  const [shareBusy, setShareBusy] = useState<string | null>(null);
  const [shareError, setShareError] = useState<string | null>(null);
  const myPublic = community.filter((c) => c.owner?.uid === acc.user?.uid).length;
  const canShare = acc.status === 'signed_in' && !!acc.profile && myPublic < PUBLIC_ROAD_LIMIT;
  async function share(c: Circuit) {
    setShareBusy(c.id);
    setShareError(null);
    try {
      await publishRoad(c);
      setSharing(false);
      navigate(`/tracks/${c.id}`, { state: { from: '/' } });
    } catch (e) {
      setShareError(describeError(e));
    } finally {
      setShareBusy(null);
    }
  }
  const openFromMap = (id: string) => navigate(`/tracks/${id}`, { state: { from: '/?view=map' } });

  async function drive(c: Circuit) {
    const f = boardTracks.find((x) => x.id === c.id);
    if (f) await ensureLocalCircuit(f);
    navigate(`/live?circuit=${c.id}`);
  }

  // Official tracks are numbered like rally stages, in their featured order.
  const stageNo = (id: string) => (isOfficial(id) ? order(id) + 1 : 0);
  const row = (c: Circuit) => (
    <TrackRow
      key={c.id}
      circuit={c}
      stage={stageNo(c.id)}
      stats={stats.get(c.id)}
      board={boards?.get(c.id)}
      official={kindOf(c.id) !== 'own'}
      from={group === 'official' ? '/' : `/?group=${group}`}
      by={communityOwner(c.id)?.uid === acc.user?.uid ? 'you' : communityOwner(c.id)?.nickname}
      myUid={acc.user?.uid ?? null}
    />
  );

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
            <ViewSwitch view={view} onChange={(v) => setParams({ ...(v === 'map' ? { view: 'map' } : {}), ...(group !== 'official' ? { group } : {}) }, { replace: true })} />
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
            // Swipe sideways anywhere on the list to move between the three groups.
            <div className="min-h-[60dvh]" onTouchStart={swipe.onTouchStart} onTouchMove={swipe.onTouchMove} onTouchEnd={swipe.onTouchEnd} onTouchCancel={swipe.onTouchEnd} style={{ touchAction: 'pan-y' }}>
              {/* Three groups, one at a time: official stages, roads other drivers shared, and yours. */}
              <div className="px-4 pb-3">
                <Segmented
                  label="Which roads"
                  itemClass="h-9 text-[13px]"
                  value={group}
                  onChange={setGroup}
                  options={[
                    { value: 'official', label: 'Official' },
                    { value: 'community', label: `Community${circuits.community.length ? ` ${circuits.community.length}` : ''}` },
                    { value: 'own', label: `Yours${circuits.own.length ? ` ${circuits.own.length}` : ''}` },
                  ]}
                />
              </div>
              <div ref={swipe.ref}>
              <div key={group} className={slide ? 'slide-in' : 'anim-reveal'} data-dir={slide ?? undefined}>
              {group === 'official' && <ul className="border-t border-line">{circuits.official.map(row)}</ul>}
              {group === 'community' && (
                <>
                  {circuits.community.length > 0 && <ul className="border-t border-line">{circuits.community.map(row)}</ul>}
                  {canShare && (
                    <div className="mx-4 mt-4 rounded-lg border border-[#d08a4e]/50 bg-[#d08a4e]/10 p-4">
                      <p className="font-display text-lg font-black leading-tight">Share your road</p>
                      <p className="mt-1 text-sm text-muted">
                        {circuits.community.length ? 'Make one of yours public too' : 'Roads other drivers made public show up here. Make one of yours public'} and everyone can race it on its own leaderboard. {myPublic} of {PUBLIC_ROAD_LIMIT} used.
                      </p>
                      <button type="button" onClick={() => setSharing(true)} className="press mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-[#d08a4e] font-extrabold text-black">
                        <IconShare width={18} height={18} /> Share a road
                      </button>
                    </div>
                  )}
                  {!canShare && circuits.community.length === 0 && <p className="px-4 py-4 text-sm text-muted">No public roads yet.</p>}
                </>
              )}
              {group === 'own' && (
                <>
                  {circuits.own.length > 0 ? (
                    <ul className="border-t border-line">
                      {circuits.own.map((c) => (
                        <TrackRow
                          key={c.id}
                          circuit={c}
                          stage={0}
                          stats={stats.get(c.id)}
                          board={undefined}
                          official={false}
                          from="/?group=own"
                          myUid={acc.user?.uid ?? null}
                          action={canShare ? <MakePublicChip busy={shareBusy === c.id} disabled={!!shareBusy} onClick={() => void share(c)} /> : undefined}
                        />
                      ))}
                    </ul>
                  ) : (
                    <p className="px-4 pb-1 pt-2 text-sm text-muted">Roads you add or record show up here. Make them public to race others on them.</p>
                  )}
                </>
              )}
              </div>
              </div>
              <div className="flex flex-wrap justify-center gap-x-6 gap-y-2 px-4 pt-5 text-sm text-muted">
                <Link to="/circuits/new" className="flex items-center gap-1.5 hover:text-fg">
                  <IconPlus width={16} height={16} /> Add your own road
                </Link>
                <Link to="/circuits/record" className="flex items-center gap-1.5 hover:text-fg">
                  <IconRecord width={16} height={16} /> Record one by driving
                </Link>
              </div>
            </div>
          )}
        </div>
      </section>

      <section className={`${view === 'map' ? 'flex' : 'hidden'} anim-view min-h-0 flex-1 flex-col md:flex`}>
        <header className="flex items-center justify-between gap-3 border-b border-line px-4 pb-3 pt-5 md:hidden">
          <h1 className="font-display text-[2.1rem] font-black leading-none tracking-tight">Roads</h1>
          <ViewSwitch view={view} onChange={(v) => setParams({ ...(v === 'map' ? { view: 'map' } : {}), ...(group !== 'official' ? { group } : {}) }, { replace: true })} />
        </header>
        <div className="relative min-h-0 flex-1">
        <BaseMap center={mapView?.center} zoom={mapView?.zoom}>
          <LocateControl />
          {all.length > 0 && <TrackLines circuits={all} kindOf={kindOf} onSelect={(ids) => (ids.length === 1 ? openFromMap(ids[0]) : setChoice(ids))} />}
          {/* Coming back from a track keeps the map where it was; otherwise it shows every track. */}
          {!mapView && <FitBounds bounds={bounds} fitKey={`all:${all.length}`} maxZoom={15} />}
          <KeepView />
        </BaseMap>
        <div className="pointer-events-none absolute bottom-3 left-3 z-[1000] rounded border border-line bg-panel/95 px-3 py-2 text-xs text-muted shadow-lg">Tap a track to open it</div>
        </div>
      </section>

      <Sheet open={sharing} onClose={() => setSharing(false)} labelledBy="share-road" center>
        <h2 id="share-road" className="font-display text-xl font-black">
          Share a road
        </h2>
        <p className="mt-0.5 text-sm text-muted">
          Everyone can race it. Public roads can&apos;t be edited. {myPublic} of {PUBLIC_ROAD_LIMIT} used.
        </p>
        {circuits.own.length === 0 ? (
          <div className="mt-4">
            <p className="text-sm">You have no roads of your own yet.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <LinkButton to="/circuits/new" size="sm" variant="primary">
                Add your own road
              </LinkButton>
              <LinkButton to="/circuits/record" size="sm">
                Record one by driving
              </LinkButton>
            </div>
          </div>
        ) : (
          <ul className="mt-3 max-h-[50vh] divide-y divide-line overflow-y-auto border-y border-line">
            {circuits.own.map((c) => (
              <li key={c.id} className="flex items-center gap-3 py-2.5">
                <RouteShape geometry={c.geometry} size={48} className="shrink-0 rounded-lg bg-raised text-fg/85" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-display font-extrabold">{c.name}</span>
                  <span className="block text-xs text-muted">
                    {formatDistance(c.lengthM, settings.distanceUnit)}
                    <ClimbSuffix circuit={c} />
                  </span>
                </span>
                <MakePublicChip busy={shareBusy === c.id} disabled={!!shareBusy} onClick={() => void share(c)} />
              </li>
            ))}
          </ul>
        )}
        {shareError && (
          <p role="alert" className="anim-shake mt-2 text-sm text-loss">
            {shareError}
          </p>
        )}
      </Sheet>

      {/* Tracks sharing a road (a hill climb and its downhill) are tapped together: pick one. */}
      <Sheet open={!!choice} onClose={() => setChoice(null)} labelledBy="choose-road" center>
        <h2 id="choose-road" className="font-display text-xl font-black">
          {(choice?.length ?? 0) === 2 ? 'Two roads here' : 'Several roads here'}
        </h2>
        <p className="mt-0.5 text-sm text-muted">They share this stretch. Which one?</p>
        <ul className="mt-3 divide-y divide-line border-y border-line">
          {(choice ?? [])
            .map((id) => all.find((c) => c.id === id))
            .filter((c): c is Circuit => !!c)
            .map((c) => {
              return (
                <li key={c.id}>
                  <button type="button" onClick={() => (setChoice(null), openFromMap(c.id))} className="flex w-full items-center gap-3.5 py-3 text-left active:bg-raised">
                    <RouteShape geometry={c.geometry} size={56} className="shrink-0 rounded-lg bg-raised text-fg/85" />
                    <span className="min-w-0 flex-1">
                      {stageNo(c.id) > 0 && <span className="block font-mono text-[11px] font-bold text-accent">SS{stageNo(c.id)}</span>}
                      {communityOwner(c.id) && <span className="block truncate text-[11px] font-semibold text-[#d08a4e]">by {communityOwner(c.id)?.uid === acc.user?.uid ? 'you' : communityOwner(c.id)?.nickname}</span>}
                      <span className="block truncate font-display text-lg font-extrabold leading-tight">{c.name}</span>
                      <span className="block text-xs text-muted">
                        {formatDistance(c.lengthM, settings.distanceUnit)}
                        <ClimbSuffix circuit={c} />
                      </span>
                    </span>
                    <IconChevronRight width={18} height={18} className="shrink-0 text-muted" />
                  </button>
                </li>
              );
            })}
        </ul>
      </Sheet>
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
  by,
  from,
  myUid,
  action,
}: {
  circuit: Circuit;
  /** Stage number of an official track, 0 for the user's own. */
  stage: number;
  stats: CircuitStats | undefined;
  board: LeaderboardEntry[] | undefined;
  /** Has a leaderboard (official track or public road). */
  official: boolean;
  /** Who made a public road public ("you" for the user's own). */
  by?: string;
  /** Where the track page's back arrow returns to. */
  from: string;
  myUid: string | null;
  /** A button next to the row (e.g. Make public on your own roads). */
  action?: React.ReactNode;
}) {
  const { settings } = useSettings();
  const rank = myUid && board ? board.findIndex((e) => e.uid === myUid) + 1 : 0;
  const record = board?.[0];
  const climb = climbText(useElevation(c));
  let right: React.ReactNode;
  if (stats?.bestMs != null) {
    right = (
      <>
        <div className="font-mono text-[17px] font-semibold tabular">
          <Rolling text={formatLapTime(stats.bestMs)} from />
        </div>
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
    <li className="flex items-center border-b border-line">
      <Link to={`/tracks/${c.id}`} state={{ from }} className="flex min-w-0 flex-1 items-center gap-3.5 px-4 py-3.5 hover:bg-raised active:bg-raised">
        <RouteShape geometry={c.geometry} size={68} className="shrink-0 rounded-lg bg-raised text-fg/85" />
        <div className="min-w-0 flex-1">
          {stage > 0 && <div className="font-mono text-[11px] font-bold text-accent">SS{stage}</div>}
          {by && <div className="truncate text-[11px] font-semibold text-[#d08a4e]">by {by}</div>}
          <div className="font-display text-[19px] font-extrabold leading-tight">{c.name}</div>
          <div className="mt-0.5 text-xs text-muted">
            {formatDistance(c.lengthM, settings.distanceUnit)}
            {c.kind === 'closed' ? ', circuit' : ''}
          </div>
          {climb && <div className="mt-0.5 text-xs font-semibold text-[#d08a4e]">{climb}</div>}
        </div>
        {!action && <div className="shrink-0 text-right">{right}</div>}
      </Link>
      {action && <div className="shrink-0 pr-4">{action}</div>}
    </li>
  );
}

/** "+130 m climb" or "130 m descent" from start to finish, when the track has elevation data. */

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

/** The amber "Make public" button used wherever a road can be shared. */
function MakePublicChip({ busy, disabled, onClick }: { busy: boolean; disabled: boolean; onClick: () => void }) {
  return (
    <button type="button" disabled={disabled} onClick={onClick} className="press flex h-10 items-center gap-1.5 rounded-lg bg-[#d08a4e] px-3 text-sm font-extrabold text-black disabled:opacity-40">
      <IconShare width={15} height={15} /> {busy ? 'Sharing…' : 'Make public'}
    </button>
  );
}
