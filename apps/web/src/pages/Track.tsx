import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import L from 'leaflet';
import { formatDistance, type Circuit } from '@laptimer/core';
import { BaseMap, FitBounds } from '../components/map/BaseMap';
import { RouteLayer } from '../components/map/RouteLayer';
import { TimingLineView } from '../components/map/TimingLines';
import { LeaderboardTab } from '../components/track/LeaderboardTab';
import { MyLapsTab } from '../components/track/MyLapsTab';
import { Button, ConfirmButton, LinkButton, Notice, Segmented, Spinner } from '../components/ui/primitives';
import { IconArrowLeft, IconPlay } from '../components/ui/icons';
import { useAccount, useData } from '../hooks/useData';
import { useSettings } from '../hooks/useSettings';
import { describeError, ensureLocalCircuit, leaderboardTracks, publishRoad, refreshCommunity, refreshFeatured, unpublishRoad } from '../lib/cloud/account';
import { PUBLIC_ROAD_LIMIT } from '../lib/cloud/leaderboard';
import { buildExport, downloadText } from '../lib/exportImport';
import { slug } from '../lib/circuitStats';
import { deleteCircuit, getCircuit, listSessions } from '../lib/repo';

/**
 * One track, one page: its map, the Drive button, then the leaderboard (official tracks) and
 * the user's own laps. URL: `?tab=leaderboard|laps`, `?session=<id>` focuses that session's laps.
 */
export function Track() {
  const { id = '' } = useParams();
  const acc = useAccount();
  const { settings } = useSettings();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  // Back returns to the list or the map, whichever the track was opened from.
  const from = (useLocation().state as { from?: string } | null)?.from;
  const backTo = from === '/' || from === '/?view=map' ? from : '/';
  useEffect(() => {
    if (!acc.featured.length) void refreshFeatured();
  }, [acc.featured.length]);
  const { data, loading } = useData(async () => ({ circuit: await getCircuit(id), sessions: await listSessions(id) }), [id]);
  // A link to a public road this device hasn't seen yet: look it up before saying it's gone.
  const [remoteChecked, setRemoteChecked] = useState(false);
  const unknown = !loading && !!data && !data.circuit && !leaderboardTracks(acc).some((f) => f.id === id);
  useEffect(() => {
    if (!unknown) return setRemoteChecked(true);
    setRemoteChecked(false);
    void refreshCommunity().finally(() => setRemoteChecked(true));
  }, [unknown, id]);
  // Official tracks and public roads have leaderboards; `road` is set for public roads.
  const featured = leaderboardTracks(acc).find((f) => f.id === id) ?? null;
  const road = featured?.owner ? featured : null;
  const mine = !!road && road.owner?.uid === acc.user?.uid;
  const myPublicCount = acc.community.filter((c) => c.owner?.uid === acc.user?.uid).length;
  const [shareBusy, setShareBusy] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);
  const circuit: Circuit | null = data?.circuit ?? featured;
  const sessions = data?.sessions ?? [];
  const lapCount = sessions.reduce((n, s) => n + s.laps.length, 0);
  // The page itself fades in on arrival; the tab content animates only when the user switches.
  const [tabSwitched, setTabSwitched] = useState(false);
  const tab = featured && params.get('tab') !== 'laps' && !params.get('session') ? 'leaderboard' : 'laps';
  const bounds = useMemo(() => (circuit ? L.latLngBounds(circuit.geometry.map(([lon, lat]) => [lat, lon] as [number, number])) : null), [circuit]);

  async function makePublic(c: Circuit) {
    setShareError(null);
    if (c.name.trim().length > 60) return setShareError('Shorten the name to 60 characters or less first (Edit track).');
    if (c.lengthM < 300) return setShareError('This road is too short to make public (at least 300 m).');
    setShareBusy(true);
    try {
      await publishRoad(c);
    } catch (e) {
      setShareError(describeError(e));
    } finally {
      setShareBusy(false);
    }
  }

  async function unpublish() {
    setShareError(null);
    setShareBusy(true);
    try {
      await unpublishRoad(id);
    } catch (e) {
      setShareError(describeError(e));
    } finally {
      setShareBusy(false);
    }
  }

  async function drive() {
    if (featured) await ensureLocalCircuit(featured);
    navigate(`/live?circuit=${id}`);
  }

  if (!circuit) {
    if (loading || (!data && !acc.featured.length) || !remoteChecked) return <div className="p-6"><Spinner /></div>;
    return (
      <div className="space-y-3 p-6">
        <Notice tone="error">This track no longer exists. Its drives are still under Me, My drives.</Notice>
        <LinkButton to="/">All roads</LinkButton>
      </div>
    );
  }

  return (
    <div className="pb-10">
      <div className="relative h-52 border-b border-line md:h-72 land:h-28">
        <BaseMap scrollWheelZoom={false} zoomSnap={0.1}>
          <RouteLayer geometry={circuit.geometry} closed={circuit.kind === 'closed'} />
          <TimingLineView line={circuit.startLine} kind="start" label={circuit.kind === 'closed' ? 'Start / finish' : 'Start'} />
          {circuit.finishLine && <TimingLineView line={circuit.finishLine} kind="finish" label="Finish" />}
          <FitBounds bounds={bounds} fitKey={circuit.id} padding={28} />
        </BaseMap>
        <Link to={backTo} aria-label="Back to all roads" className="absolute left-3 top-3 z-[1000] flex h-11 w-11 items-center justify-center rounded border border-line bg-panel/95 text-fg shadow-lg">
          <IconArrowLeft />
        </Link>
      </div>

      <div className="mx-auto max-w-5xl px-4 md:px-6">
        <div className="flex flex-wrap items-end justify-between gap-4 pt-4">
          <div className="min-w-0">
            {road && <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#d08a4e]">{mine ? 'Your public road' : `Public road by ${road.owner?.nickname}`}</div>}
            <h1 className="font-display text-[1.75rem] font-black leading-tight tracking-tight">{circuit.name}</h1>
            <p className="mt-0.5 text-sm text-muted">
              {formatDistance(circuit.lengthM, settings.distanceUnit)}, {circuit.kind === 'closed' ? 'a closed circuit' : 'from start to finish'}
            </p>
          </div>
          <Button variant="primary" size="xl" className="w-full text-xl md:w-64" onClick={() => void drive()}>
            <IconPlay width={20} height={20} /> Drive
          </Button>
        </div>

        {featured ? (
          <Segmented
            label="Track"
            className="mt-5 md:max-w-sm"
            value={tab}
            onChange={(t) => (setTabSwitched(true), setParams(t === 'laps' ? { tab: 'laps' } : {}, { replace: true, state: { from } }))}
            options={[
              { value: 'leaderboard', label: 'Leaderboard' },
              { value: 'laps', label: `My laps${lapCount ? ` (${lapCount})` : ''}` },
            ]}
          />
        ) : (
          <h2 className="label mt-6">My laps</h2>
        )}

        <div key={tab} className={`mt-3 ${tabSwitched ? 'anim-page' : ''}`}>
          {tab === 'leaderboard' && featured ? <LeaderboardTab track={featured} /> : data ? <MyLapsTab circuit={circuit} sessions={sessions} /> : <Spinner />}
        </div>

        {mine && (
          <div className="mt-8 border-t border-line pt-4">
            <p className="text-sm text-muted">Everyone can see and race this road. It can&apos;t be edited while it is public, so all drivers are timed on the same lines.</p>
            <ConfirmButton size="sm" className="mt-3" disabled={shareBusy} onConfirm={unpublish} confirmLabel="Tap again: unpublish and delete its leaderboard">
              {shareBusy ? 'Unpublishing…' : 'Unpublish'}
            </ConfirmButton>
            {shareError && <p role="alert" className="anim-shake mt-2 text-sm text-loss">{shareError}</p>}
          </div>
        )}

        {!featured && data?.circuit && acc.status === 'signed_in' && acc.profile && (
          <div className="mt-8 border-t border-line pt-4">
            <h2 className="label">Make it public</h2>
            <p className="mt-1 text-sm text-muted">Everyone sees it on the map and races it on its own leaderboard. Once public it can&apos;t be edited; unpublish it to change it.</p>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <Button variant="primary" size="sm" disabled={shareBusy || myPublicCount >= PUBLIC_ROAD_LIMIT} onClick={() => void makePublic(data.circuit!)}>
                {shareBusy ? 'Publishing…' : 'Make public'}
              </Button>
              <span className="text-xs text-muted">
                {myPublicCount} of {PUBLIC_ROAD_LIMIT} public roads used{myPublicCount >= PUBLIC_ROAD_LIMIT ? '. Unpublish one to share this.' : ''}
              </span>
            </div>
            {shareError && <p role="alert" className="anim-shake mt-2 text-sm text-loss">{shareError}</p>}
          </div>
        )}

        {!featured && data?.circuit && (
          <div className="mt-8 flex flex-wrap gap-2 border-t border-line pt-4">
            <LinkButton to={`/circuits/${circuit.id}/edit`} size="sm">
              Edit track
            </LinkButton>
            <Button size="sm" onClick={() => downloadText(`${slug(circuit.name)}.laptimer.json`, buildExport([circuit], sessions, []), 'application/json')}>
              Export
            </Button>
            <ConfirmButton size="sm" className="ml-auto" onConfirm={async () => (await deleteCircuit(circuit.id), navigate('/'))} confirmLabel="Tap again to delete">
              Delete track
            </ConfirmButton>
          </div>
        )}
      </div>
    </div>
  );
}

/** Old addresses (`/circuits/:id`, `/leaderboard/:id`) lead to the track page. */
export function TrackRedirect({ tab }: { tab?: 'leaderboard' }) {
  const { id = '' } = useParams();
  const [params] = useSearchParams();
  const session = params.get('session');
  const q = session ? `?session=${encodeURIComponent(session)}` : tab ? '' : '?tab=laps';
  return <Navigate to={`/tracks/${id}${q}`} replace />;
}
