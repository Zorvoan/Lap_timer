import { useEffect, useMemo } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import L from 'leaflet';
import { formatDelta, formatDistance, formatLapTime, formatSpeed, idealLap, speedLabel, splitTimes } from '@laptimer/core';
import { PageHeader } from '../components/AppShell';
import { Badge, Button, Empty, LinkButton, Notice, Panel, Spinner } from '../components/ui/primitives';
import { IconTimer } from '../components/ui/icons';
import { BaseMap, FitBounds } from '../components/map/BaseMap';
import { RouteLayer } from '../components/map/RouteLayer';
import { TimingLineView } from '../components/map/TimingLines';
import { useAccount, useData } from '../hooks/useData';
import { useSettings } from '../hooks/useSettings';
import { cloudEnabled, ensureLocalCircuit, refreshFeatured } from '../lib/cloud/account';
import { parsePublishedTrace, type LeaderboardEntry } from '../lib/cloud/leaderboard';

const loadBoard = async (circuitId: string, max: number): Promise<LeaderboardEntry[]> => (await import('../lib/cloud/community')).getLeaderboard(circuitId, max);

export function LeaderboardList() {
  const acc = useAccount();
  const { settings } = useSettings();
  useEffect(() => {
    void refreshFeatured();
  }, []);
  const ids = acc.featured.map((f) => f.id).join(',');
  const { data: boards, error } = useData(async () => {
    const out = new Map<string, LeaderboardEntry[]>();
    await Promise.all(acc.featured.map(async (f) => out.set(f.id, await loadBoard(f.id, 100))));
    return out;
  }, [ids]);

  if (!cloudEnabled) {
    return (
      <div className="p-6">
        <Notice>Leaderboards need the online service, which is not configured in this build.</Notice>
      </div>
    );
  }

  return (
    <div className="pb-10">
      <PageHeader title="Leaderboard" subtitle="Official tracks. Your best real-GPS lap on each is published automatically when you're signed in." />
      <div className="mx-auto max-w-5xl space-y-4 p-4 md:p-6">
        <ProfileNotice />
        {error && <Notice tone="error">Could not load leaderboards: {error.message}</Notice>}
        {!acc.featured.length ? (
          <Spinner label="Loading tracks" />
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {acc.featured.map((f) => {
              const board = boards?.get(f.id);
              const leader = board?.[0];
              const myPos = acc.user && board ? board.findIndex((e) => e.uid === acc.user!.uid) + 1 : 0;
              return (
                <li key={f.id}>
                  <Link to={`/leaderboard/${f.id}`} className="block rounded border border-line bg-panel p-4 hover:border-muted">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-lg font-bold">{f.name}</div>
                        <div className="text-xs text-muted">
                          {formatDistance(f.lengthM, settings.distanceUnit)} · {f.kind === 'closed' ? 'closed circuit' : 'sprint A→B'}
                        </div>
                      </div>
                      <Badge tone="accent">Official</Badge>
                    </div>
                    <div className="mt-4 flex items-end justify-between gap-3">
                      <div className="min-w-0">
                        <div className="label">Record</div>
                        {leader ? (
                          <>
                            <div className="font-mono text-2xl tabular">{formatLapTime(leader.timeMs)}</div>
                            <div className="truncate text-xs text-muted">
                              {leader.nickname} · {leader.car}
                            </div>
                          </>
                        ) : (
                          <div className="text-sm text-muted">{board ? 'No times yet' : '…'}</div>
                        )}
                      </div>
                      <div className="text-right">
                        <div className="label">Drivers</div>
                        <div className="font-mono text-xl tabular">{board ? (board.length >= 100 ? '100+' : board.length) : '—'}</div>
                        {myPos > 0 && <div className="text-xs font-semibold text-accent">You: P{myPos}</div>}
                      </div>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

export function LeaderboardTrack() {
  const { id = '' } = useParams();
  const acc = useAccount();
  const { settings } = useSettings();
  const navigate = useNavigate();
  useEffect(() => {
    if (!acc.featured.length) void refreshFeatured();
  }, [acc.featured.length]);
  const track = acc.featured.find((f) => f.id === id) ?? null;
  const { data: board, error, loading, reload } = useData(() => loadBoard(id, 200), [id]);
  const bounds = useMemo(() => (track ? L.latLngBounds(track.geometry.map(([lon, lat]) => [lat, lon] as [number, number])) : null), [track]);
  const me = acc.user?.uid;
  const leader = board?.[0];
  // Sector splits: stored with newer entries, worked out from the published trace for older ones.
  const { data: splitsByUid } = useData(async () => {
    const out = new Map<string, number[]>();
    if (!board || !track) return out;
    const c = await import('../lib/cloud/community');
    await Promise.all(
      board.slice(0, 50).map(async (e) => {
        if (e.splitTimesMs?.length === 3) return out.set(e.uid, e.splitTimesMs);
        const t = await c.getPublishedTrace(track.id, e.uid).catch(() => null);
        if (t) out.set(e.uid, splitTimes(parsePublishedTrace(t), t.timeMs, t.lengthM, 3));
      }),
    );
    return out;
  }, [board, track?.id]);
  const withSplits = useMemo(() => (board ?? []).filter((e) => splitsByUid?.get(e.uid)?.length === 3), [board, splitsByUid]);
  const ideal = useMemo(() => idealLap(withSplits.map((e) => splitsByUid!.get(e.uid)!)), [withSplits, splitsByUid]);

  async function drive(refUid?: string) {
    if (!track) return;
    await ensureLocalCircuit(track);
    navigate(`/live?circuit=${track.id}${refUid ? `&ref=${encodeURIComponent(`lb:${refUid}`)}` : ''}`);
  }

  if (!track) {
    return <div className="p-6">{acc.featured.length ? <Notice tone="error">This track is not on the leaderboard.</Notice> : <Spinner />}</div>;
  }

  return (
    <div className="pb-10">
      <PageHeader
        title={track.name}
        back={{ to: '/leaderboard', label: 'All tracks' }}
        subtitle={`${formatDistance(track.lengthM, settings.distanceUnit)} · ${track.kind === 'closed' ? 'closed circuit' : 'sprint A→B'}`}
        actions={
          <>
            <Button variant="primary" onClick={() => void drive()}>
              <IconTimer width={18} height={18} /> Drive this track
            </Button>
            <LinkButton to={`/circuits/${track.id}`}>My laps here</LinkButton>
          </>
        }
      />
      <div className="mx-auto grid max-w-6xl gap-4 p-4 md:p-6 lg:grid-cols-[1fr_22rem]">
        <div className="min-w-0 space-y-4">
          <ProfileNotice />
          <Panel title="Leaderboard" bodyClass="p-0" actions={<Button size="sm" variant="ghost" onClick={reload}>Refresh</Button>}>
            {board && board.length > 0 && <p className="border-b border-line px-4 py-2 text-sm text-muted">Tap a driver to see their telemetry and compare it with your laps.</p>}
            {ideal && withSplits.length > 0 && (
              <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-line px-4 py-2.5 text-sm">
                <span>
                  <span className="label">Theoretical best</span> <span className="font-mono font-bold tabular">{formatLapTime(ideal.timeMs)}</span>
                </span>
                <span className="text-xs text-muted">
                  best sectors of all drivers:{' '}
                  {ideal.from.map((i, k) => (
                    <span key={k} className="mr-2 whitespace-nowrap">
                      S{k + 1} <span className="text-[#b36bff]">{withSplits[i].nickname}</span>
                    </span>
                  ))}
                </span>
              </div>
            )}
            {error && (
              <div className="p-4">
                <Notice tone="error">Could not load the leaderboard: {error.message}</Notice>
              </div>
            )}
            {loading && !board ? (
              <div className="p-4">
                <Spinner />
              </div>
            ) : board && board.length === 0 ? (
              <div className="p-4">
                <Empty title="No times yet">Be the first: drive the track with real GPS while signed in.</Empty>
              </div>
            ) : (
              <div>
                <table className="w-full table-fixed text-sm">
                  <thead>
                    <tr className="border-b border-line text-left">
                      <th className="label w-12 px-3 py-2 font-semibold">Pos</th>
                      <th className="label px-3 py-2 font-semibold">Driver</th>
                      <th className="label w-28 px-3 py-2 text-right font-semibold">Time</th>
                      <th className="label hidden w-20 px-3 py-2 text-right font-semibold sm:table-cell">Gap</th>
                      {[1, 2, 3].map((n) => (
                        <th key={n} className="label hidden w-16 px-2 py-2 text-right font-semibold md:table-cell" title="Thirds of the track by distance">
                          S{n}
                        </th>
                      ))}
                      <th className="label hidden w-20 px-3 py-2 text-right font-semibold sm:table-cell">Max {speedLabel(settings.speedUnit)}</th>
                      <th className="label hidden w-24 px-3 py-2 font-semibold 2xl:table-cell">Driven</th>
                      <th className="w-[4.75rem] px-3 py-2" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {board?.map((e, i) => {
                      const mine = e.uid === me;
                      const compareUrl = `/leaderboard/${track.id}/compare?a=${encodeURIComponent(`lb:${e.uid}`)}`;
                      return (
                        <tr key={e.uid} onClick={() => navigate(compareUrl)} className={`cursor-pointer hover:bg-raised ${mine ? 'bg-raised' : ''}`}>
                          <td className="px-3 py-2 font-mono font-bold tabular">{i === 0 ? <span className="text-accent">P1</span> : `P${i + 1}`}</td>
                          <td className="px-3 py-2">
                            <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 font-semibold">
                              <Link to={compareUrl} onClick={(ev) => ev.stopPropagation()} className="break-words hover:underline">
                                {e.nickname}
                              </Link>{' '}
                              {mine && <Badge tone="accent">You</Badge>}
                            </div>
                            <div className="truncate text-xs text-muted">{e.car}</div>
                          </td>
                          <td className="px-3 py-2 text-right font-mono tabular">
                            {formatLapTime(e.timeMs)}
                            {leader && i > 0 && <div className="text-xs text-muted sm:hidden">{formatDelta(e.timeMs - leader.timeMs)}</div>}
                          </td>
                          <td className="hidden px-3 py-2 text-right font-mono tabular text-muted sm:table-cell">{leader && i > 0 ? formatDelta(e.timeMs - leader.timeMs) : '—'}</td>
                          {[0, 1, 2].map((k) => {
                            const ms = splitsByUid?.get(e.uid)?.[k];
                            const isBest = ms !== undefined && ideal?.sectorsMs[k] === ms;
                            return (
                              <td key={k} className={`hidden px-2 py-2 text-right font-mono tabular md:table-cell ${isBest ? 'font-bold text-[#b36bff]' : ''}`}>
                                {ms !== undefined ? (ms / 1000).toFixed(2) : '—'}
                              </td>
                            );
                          })}
                          <td className="hidden px-3 py-2 text-right font-mono tabular sm:table-cell">{formatSpeed(e.maxSpeedMs, settings.speedUnit)}</td>
                          <td className="hidden px-3 py-2 text-xs text-muted 2xl:table-cell">{new Date(e.drivenAt).toLocaleDateString()}</td>
                          <td className="px-3 py-2 text-right">
                            {!mine && (
                              <Button size="sm" onClick={(ev) => (ev.stopPropagation(), void drive(e.uid))} title={`Live delta against ${e.nickname}'s lap`}>
                                Race
                              </Button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
          <p className="text-xs text-muted">
            Only valid laps timed with real GPS count; simulator laps are never published. Times are measured by each driver's phone, so expect a few tenths of GPS uncertainty.
            Drive legally: public roads are not race tracks.
          </p>
        </div>
        <div className="h-80 overflow-hidden rounded border border-line lg:sticky lg:top-4 lg:h-[28rem]">
          <BaseMap scrollWheelZoom={false}>
            <RouteLayer geometry={track.geometry} closed={track.kind === 'closed'} />
            <TimingLineView line={track.startLine} kind="start" label={track.kind === 'closed' ? 'Start / finish' : 'Start'} />
            {track.finishLine && <TimingLineView line={track.finishLine} kind="finish" label="Finish" />}
            <FitBounds bounds={bounds} fitKey={track.id} />
          </BaseMap>
        </div>
      </div>
    </div>
  );
}

function ProfileNotice() {
  const acc = useAccount();
  if (acc.status === 'signed_out') {
    return (
      <Notice title="Want your times here?" action={<LinkButton to="/account" variant="primary" size="sm">Sign in</LinkButton>}>
        Create an account with a nickname and car; your best laps on these tracks are then published automatically.
      </Notice>
    );
  }
  if (acc.status === 'signed_in' && acc.profile === null) {
    return (
      <Notice tone="warn" title="Set your nickname and car" action={<LinkButton to="/account" variant="primary" size="sm">Complete profile</LinkButton>}>
        Your laps can't appear on leaderboards until your profile is complete.
      </Notice>
    );
  }
  return null;
}
