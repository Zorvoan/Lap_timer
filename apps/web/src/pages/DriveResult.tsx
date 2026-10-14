import { useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { formatLapTime, splitTimes, type LapRecord } from '@laptimer/core';
import { loadBoard } from '../components/track/LeaderboardTab';
import { LinkButton, Notice, Spinner } from '../components/ui/primitives';
import { IconCloudOff, IconUndo } from '../components/ui/icons';
import { useAccount, useData } from '../hooks/useData';
import { useSettings } from '../hooks/useSettings';
import { getCircuit, getSession, listSessions } from '../lib/repo';
import { lapLength } from '../lib/references';
import { formatGap } from '../lib/runFormat';

const PURPLE = 'text-[#b36bff]';

/**
 * Shown by itself when a run ends: the time first, then how it compares with the driver's best
 * and where it ranks, then what to do next.
 */
export function DriveResult() {
  const { id = '' } = useParams();
  const acc = useAccount();
  const { settings } = useSettings();
  const { data, loading } = useData(async () => {
    const session = await getSession(id);
    if (!session) return null;
    return { session, circuit: await getCircuit(session.circuitId), sessions: await listSessions(session.circuitId) };
  }, [id]);

  const result = useMemo(() => {
    if (!data) return null;
    const { session, circuit, sessions } = data;
    const sim = session.source === 'simulated';
    const pool = sessions.filter((s) => s.source === 'gps' || sim || settings.includeSimulatedInBests);
    const bestOf = (laps: LapRecord[]) => laps.filter((l) => l.valid).reduce<LapRecord | null>((b, l) => (!b || l.timeMs < b.timeMs ? l : b), null);
    const lap = bestOf(session.laps);
    const previous = bestOf(pool.filter((s) => s.id !== session.id).flatMap((s) => s.laps));
    let lengthM = circuit?.lengthM ?? 0;
    try {
      if (circuit) lengthM = lapLength(circuit);
    } catch {
      /* keep the stored length */
    }
    const partsOf = (l: LapRecord) => (lengthM > 0 ? splitTimes(l.trace, l.timeMs, lengthM, 3) : []);
    const parts = lap ? partsOf(lap) : [];
    const bestParts = [0, 1, 2].map((k) => Math.min(...pool.flatMap((s) => s.laps.filter((l) => l.valid)).map((l) => partsOf(l)[k] ?? Infinity)));
    return { session, circuit, lap, previous, parts, bestParts, sim, laps: session.laps.length };
  }, [data, settings.includeSimulatedInBests]);

  const official = !!result && acc.featured.some((f) => f.id === result.session.circuitId);
  const online = typeof navigator === 'undefined' || navigator.onLine;
  const { data: rank } = useData(async () => {
    if (!result?.lap || !official || result.sim || !online) return null;
    const board = await loadBoard(result.session.circuitId, 200);
    const others = board.filter((e) => e.uid !== acc.user?.uid);
    return { place: 1 + others.filter((e) => e.timeMs < result.lap!.timeMs).length, of: others.length + 1 };
  }, [result?.lap?.timeMs, official, online, acc.user?.uid]);

  if (loading && !data) return <div className="p-6"><Spinner /></div>;
  if (!result) {
    return (
      <div className="space-y-3 p-6">
        <Notice tone="error">This drive could not be found.</Notice>
        <LinkButton to="/">See the roads</LinkButton>
      </div>
    );
  }

  const { session, lap, previous, parts, bestParts, sim } = result;
  const pb = !!lap && (!previous || lap.timeMs < previous.timeMs);
  const first = !!lap && !previous;
  const gapMs = lap && previous ? lap.timeMs - previous.timeMs : null;
  const signedIn = acc.status === 'signed_in' && !!acc.profile;

  return (
    <div className="mx-auto flex min-h-full max-w-xl flex-col px-4 pb-8 pt-8">
      <div className="text-center">
        <div className="text-sm text-muted">{session.circuitName}</div>
        {!lap ? (
          <>
            <div className="mt-3 font-display text-3xl font-black">No time this run</div>
            <p className="mx-auto mt-2 max-w-xs text-sm text-muted">The finish line was not reached, so no lap was timed.</p>
          </>
        ) : (
          <>
            <div className={`mt-2 text-sm font-extrabold uppercase tracking-[0.14em] ${pb && !first ? PURPLE : 'text-muted'}`}>
              {first ? 'Your first time here' : pb ? 'New personal best' : 'Lap time'}
            </div>
            <div className="mt-2 font-mono text-[clamp(3.4rem,16vw,4.5rem)] font-extrabold leading-none tabular">{formatLapTime(lap.timeMs)}</div>
            {gapMs !== null && (
              <div className={`mt-2 text-base font-bold ${gapMs < 0 ? 'text-gain' : 'text-loss'}`}>
                {gapMs < 0 ? `${(Math.abs(gapMs) / 1000).toFixed(3)} s faster than before` : `${formatGap(gapMs, 3)} s to your best`}
              </div>
            )}
            {result.laps > 1 && <div className="mt-1 text-xs text-muted">Best of {result.laps} laps</div>}
          </>
        )}
      </div>

      {lap && (
        <>
          <div className="mt-7 border-y border-line">
            {sim ? (
              <Row muted>Simulated runs don&apos;t go on the leaderboard.</Row>
            ) : !official ? null : !signedIn ? (
              <Row muted action={<LinkButton to="/account" size="sm" variant="primary">{acc.status === 'signed_in' ? 'Add' : 'Sign in'}</LinkButton>}>
                {acc.status === 'signed_in' ? 'Add a nickname and car to get on the leaderboard.' : 'Sign in to put this time on the leaderboard.'}
              </Row>
            ) : !online || acc.sync === 'offline' ? (
              <div className="flex items-center gap-3 py-3.5">
                <IconCloudOff width={20} height={20} className="shrink-0 text-muted" />
                <div>
                  <div className="text-[15px] font-semibold">Saved on this phone</div>
                  <div className="text-xs text-muted">Uploads to the leaderboard when you are back online.</div>
                </div>
              </div>
            ) : (
              <div className="flex items-center py-3.5">
                <span className="flex-1 text-muted">Leaderboard</span>
                {rank ? (
                  <span className="text-lg font-extrabold">
                    P{rank.place} <span className="text-sm font-semibold text-muted">of {rank.of}</span>
                  </span>
                ) : (
                  <Spinner label="" />
                )}
              </div>
            )}
          </div>

          {parts.length === 3 && (
            <div className="mt-5 grid grid-cols-3 gap-2">
              {parts.map((ms, k) => (
                <div key={k} className={`rounded-lg border py-2.5 text-center ${ms <= bestParts[k] ? 'border-[#b36bff]' : 'border-line'}`}>
                  <div className="label">Part {k + 1}</div>
                  <div className={`mt-1 font-mono text-xl font-bold tabular ${ms <= bestParts[k] ? PURPLE : ''}`}>{(ms / 1000).toFixed(2)}</div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      <div className="mt-8 grid gap-3">
        <LinkButton to={`/live?circuit=${session.circuitId}`} variant="primary" size="xl" className="text-xl">
          <IconUndo width={20} height={20} /> Drive again
        </LinkButton>
        {lap && (
          <LinkButton to={`/tracks/${session.circuitId}?session=${session.id}`} size="lg">
            {first ? 'See the replay' : pb ? 'Where did I gain time?' : 'Where did I lose time?'}
          </LinkButton>
        )}
      </div>
    </div>
  );
}

function Row({ children, action, muted = false }: { children: React.ReactNode; action?: React.ReactNode; muted?: boolean }) {
  return (
    <div className="flex items-center gap-3 py-3.5">
      <span className={`flex-1 text-sm ${muted ? 'text-muted' : ''}`}>{children}</span>
      {action}
    </div>
  );
}
