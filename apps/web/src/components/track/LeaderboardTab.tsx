import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { formatDelta, formatLapTime, formatSpeed, idealLap, speedLabel, splitTimes } from '@laptimer/core';
import { Badge, Button, Empty, LinkButton, Notice, Spinner } from '../ui/primitives';
import { IconChevronRight } from '../ui/icons';
import { useAccount, useData } from '../../hooks/useData';
import { useSettings } from '../../hooks/useSettings';
import { ensureLocalCircuit } from '../../lib/cloud/account';
import { parsePublishedTrace, type LeaderboardEntry } from '../../lib/cloud/leaderboard';
import type { FeaturedCircuit } from '../../lib/cloud/community';

export const loadBoard = async (circuitId: string, max: number): Promise<LeaderboardEntry[]> => (await import('../../lib/cloud/community')).getLeaderboard(circuitId, max);

/** The leaderboard of an official track. Tapping a driver compares their lap with yours. */
export function LeaderboardTab({ track }: { track: FeaturedCircuit }) {
  const acc = useAccount();
  const { settings } = useSettings();
  const navigate = useNavigate();
  const { data: board, error, loading, reload } = useData(() => loadBoard(track.id, 200), [track.id]);
  const me = acc.user?.uid;
  const leader = board?.[0];
  // Part times: stored with newer entries, worked out from the published trace for older ones.
  const { data: splitsByUid } = useData(async () => {
    const out = new Map<string, number[]>();
    if (!board) return out;
    const c = await import('../../lib/cloud/community');
    await Promise.all(
      board.slice(0, 50).map(async (e) => {
        if (e.splitTimesMs?.length === 3) return out.set(e.uid, e.splitTimesMs);
        const t = await c.getPublishedTrace(track.id, e.uid).catch(() => null);
        if (t) out.set(e.uid, splitTimes(parsePublishedTrace(t), t.timeMs, t.lengthM, 3));
      }),
    );
    return out;
  }, [board, track.id]);
  const withSplits = useMemo(() => (board ?? []).filter((e) => splitsByUid?.get(e.uid)?.length === 3), [board, splitsByUid]);
  const ideal = useMemo(() => idealLap(withSplits.map((e) => splitsByUid!.get(e.uid)!)), [withSplits, splitsByUid]);

  async function race(refUid: string) {
    await ensureLocalCircuit(track);
    navigate(`/live?circuit=${track.id}&ref=${encodeURIComponent(`lb:${refUid}`)}`);
  }

  if (error) {
    return (
      <div className="space-y-3 py-4">
        <Notice tone="error">Could not load the leaderboard: {error.message}</Notice>
        <Button onClick={reload}>Try again</Button>
      </div>
    );
  }
  if (loading && !board) return <div className="py-6"><Spinner label="Loading leaderboard" /></div>;
  if (!board?.length) {
    return (
      <div className="py-6">
        <Empty title="No times yet">Be the first: drive it with real GPS while signed in, and your time appears here.</Empty>
      </div>
    );
  }

  return (
    <div>
      <ProfileNotice />
      <table className="w-full table-fixed text-sm">
        <thead>
          <tr className="text-left">
            <th className="label w-12 py-2 pl-2 font-semibold">Pos</th>
            <th className="label px-2 py-2 font-semibold">Driver</th>
            <th className="label w-28 px-2 py-2 text-right font-semibold">Time</th>
            <th className="label hidden w-20 px-2 py-2 text-right font-semibold sm:table-cell">Gap</th>
            {[1, 2, 3].map((n) => (
              <th key={n} className="label hidden w-[4.5rem] px-2 py-2 text-right font-semibold md:table-cell" title="Thirds of the track by distance">
                Part {n}
              </th>
            ))}
            <th className="label hidden w-20 px-2 py-2 text-right font-semibold lg:table-cell">Max {speedLabel(settings.speedUnit)}</th>
            <th className="w-[4.75rem] py-2 pr-2" />
          </tr>
        </thead>
        <tbody className="divide-y divide-line border-y border-line">
          {board.map((e, i) => {
            const mine = e.uid === me;
            // Someone else's lap opens as B against your own lap (A); your own row opens as A.
            const compareUrl = `/leaderboard/${track.id}/compare?${mine ? 'a' : 'b'}=${encodeURIComponent(`lb:${e.uid}`)}`;
            return (
              <tr key={e.uid} onClick={() => navigate(compareUrl)} className={`cursor-pointer hover:bg-raised active:bg-raised ${mine ? 'bg-raised' : ''}`}>
                <td className="py-3 pl-2 font-mono font-bold tabular">{i === 0 ? <span className="text-accent">P1</span> : `P${i + 1}`}</td>
                <td className="px-2 py-3">
                  <Link to={compareUrl} onClick={(ev) => ev.stopPropagation()} className="block truncate font-semibold hover:underline">
                    {e.nickname}
                  </Link>
                  <div className="truncate text-xs text-muted" title={`${e.car} · driven ${new Date(e.drivenAt).toLocaleDateString()}`}>
                    {e.car}
                    <span className="hidden sm:inline"> · {new Date(e.drivenAt).toLocaleDateString()}</span>
                  </div>
                </td>
                <td className="px-2 py-3 text-right font-mono tabular">
                  {formatLapTime(e.timeMs)}
                  {leader && i > 0 && <div className="text-xs text-muted sm:hidden">{formatDelta(e.timeMs - leader.timeMs)}</div>}
                </td>
                <td className="hidden px-2 py-3 text-right font-mono tabular text-muted sm:table-cell">{leader && i > 0 ? formatDelta(e.timeMs - leader.timeMs) : '—'}</td>
                {[0, 1, 2].map((k) => {
                  const ms = splitsByUid?.get(e.uid)?.[k];
                  const isBest = ms !== undefined && ideal?.sectorsMs[k] === ms;
                  return (
                    <td key={k} className={`hidden px-2 py-3 text-right font-mono tabular md:table-cell ${isBest ? 'font-bold text-[#b36bff]' : ''}`}>
                      {ms !== undefined ? (ms / 1000).toFixed(2) : '—'}
                    </td>
                  );
                })}
                <td className="hidden px-2 py-3 text-right font-mono tabular lg:table-cell">{formatSpeed(e.maxSpeedMs, settings.speedUnit)}</td>
                <td className="py-3 pr-2 text-right">
                  {/* Your own row has nothing to race, so it is marked where the Race button would be. */}
                  {mine ? (
                    <Badge tone="accent">You</Badge>
                  ) : (
                    <>
                      <Button size="sm" className="hidden sm:inline-flex" onClick={(ev) => (ev.stopPropagation(), void race(e.uid))} title={`Live gap against ${e.nickname}'s lap`}>
                        Race
                      </Button>
                      <IconChevronRight width={18} height={18} className="ml-auto text-muted sm:hidden" />
                    </>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {ideal && withSplits.length > 0 && (
        <p className="px-2 py-3 text-sm text-muted">
          Best possible time <span className="font-mono font-bold tabular text-[#b36bff]">{formatLapTime(ideal.timeMs)}</span>
          {ideal.from.every((i) => i === ideal.from[0])
            ? `: all three best parts are ${withSplits[ideal.from[0]].nickname}'s.`
            : ', the fastest drivers\' best parts put together.'}
        </p>
      )}
      <p className="px-2 pb-2 text-xs text-muted">Only real-GPS laps count. Times come from each driver's phone, so allow a few tenths either way. Drive legally.</p>
    </div>
  );
}

/** One line telling a signed-out (or profile-less) user how to get on the leaderboard. */
export function ProfileNotice() {
  const acc = useAccount();
  const line = (text: string, action: string) => (
    <div className="mb-3 flex items-center gap-3 rounded-r border-l-[3px] border-accent bg-panel px-3 py-2.5">
      <p className="min-w-0 flex-1 text-sm">{text}</p>
      <LinkButton to="/account" variant="primary" size="sm">
        {action}
      </LinkButton>
    </div>
  );
  if (acc.status === 'signed_out') return line('Sign in to get your times on the leaderboard.', 'Sign in');
  if (acc.status === 'signed_in' && acc.profile === null) return line('Add a nickname and car to appear on the leaderboard.', 'Add');
  return null;
}
