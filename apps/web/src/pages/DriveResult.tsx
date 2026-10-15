import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { formatLapTime, splitTimes, type LapRecord } from '@laptimer/core';
import { loadBoard } from '../components/track/LeaderboardTab';
import { LinkButton, Notice, Spinner } from '../components/ui/primitives';
import { NotifySwitch } from '../components/NotifySwitch';
import { pushOn } from '../lib/pushState';
import { IconCloudOff, IconUndo } from '../components/ui/icons';
import { useAccount, useData } from '../hooks/useData';
import { useSettings } from '../hooks/useSettings';
import { getCircuit, getSession, listSessions } from '../lib/repo';
import { lapLength } from '../lib/references';
import { formatGap } from '../lib/runFormat';

const PURPLE = 'text-[#b36bff]';

/** Runs whose card has already been revealed; coming back to one shows it without the show. */
const revealed = new Set<string>();

/**
 * Shown by itself when a run ends: the time first, then how it compares with the driver's best
 * and where it ranks, then what to do next.
 */
export function DriveResult() {
  const { id = '' } = useParams();
  const acc = useAccount();
  const { settings } = useSettings();
  const [reveal] = useState(() => !revealed.has(id));
  useEffect(() => {
    revealed.add(id);
  }, [id]);
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
    const prevParts = previous ? partsOf(previous) : [];
    const bestParts = [0, 1, 2].map((k) => Math.min(...pool.flatMap((s) => s.laps.filter((l) => l.valid)).map((l) => partsOf(l)[k] ?? Infinity)));
    return { session, circuit, lap, previous, parts, prevParts, bestParts, sim, laps: session.laps.length };
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

  const { session, lap, previous, parts, prevParts, bestParts, sim } = result;
  const pb = !!lap && (!previous || lap.timeMs < previous.timeMs);
  const first = !!lap && !previous;
  const gapMs = lap && previous ? lap.timeMs - previous.timeMs : null;
  const signedIn = acc.status === 'signed_in' && !!acc.profile;
  const stage = acc.featured.findIndex((f) => f.id === session.circuitId) + 1;

  return (
    <div className="mx-auto flex min-h-full max-w-xl flex-col px-4 pb-8 pt-6">
      <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#d08a4e]">Time card</div>
      <h1 className="mt-1 font-display text-[2rem] font-black leading-tight tracking-tight">
        {stage > 0 && `SS${stage} `}
        {session.circuitName}
      </h1>

      <div className={`relative mt-6 rounded-lg border border-line bg-panel px-5 pb-4 pt-5 ${reveal ? 'tc-card' : ''}`}>
        {lap && (pb || first) && (
          <div
            className={`absolute -top-4 right-3 rotate-[-7deg] rounded-md ${reveal ? 'tc-stamp' : ''} border-[3px] bg-panel px-3 py-1 text-center text-[13px] font-black uppercase leading-tight tracking-wider ${first ? 'border-[#d08a4e] text-[#d08a4e]' : 'border-[#b36bff] text-[#b36bff]'}`}
          >
            {first ? 'First run' : 'Personal best'}
            {!first && gapMs !== null && <div className="font-mono text-sm tracking-normal">{formatGap(gapMs, 3)}</div>}
          </div>
        )}
        <div className="label">Stage time</div>
        {lap ? (
          <>
            <div className="mt-1 font-mono text-[clamp(2.9rem,14vw,3.6rem)] font-extrabold leading-none tabular">
              {reveal ? <LandingDigits text={formatLapTime(lap.timeMs)} /> : formatLapTime(lap.timeMs)}
            </div>
            {gapMs !== null && gapMs >= 0 && <div className="mt-2 text-sm font-semibold text-loss">{formatGap(gapMs, 3)} s to your best</div>}
            {result.laps > 1 && <div className="mt-1 text-xs text-muted">Best of {result.laps} laps</div>}
          </>
        ) : (
          <>
            <div className="mt-2 font-display text-2xl font-black">No time this run</div>
            <p className="mt-1 text-sm text-muted">The finish line was not reached, so no lap was timed.</p>
          </>
        )}

        {lap && parts.length === 3 && (
          <div className="mt-4 border-t border-dashed border-line pt-2">
            {parts.map((ms, k) => {
              const gap = prevParts.length === 3 ? ms - prevParts[k] : null;
              return (
                <div key={k} className="flex items-baseline gap-3 py-1.5">
                  <span className="flex-1 text-muted">Part {k + 1}</span>
                  <span className={`font-mono text-lg font-bold tabular ${ms <= bestParts[k] ? PURPLE : ''}`}>{(ms / 1000).toFixed(2)}</span>
                  {gap !== null && <span className={`w-16 text-right font-mono text-sm font-semibold tabular ${gap < 0 ? 'text-gain' : 'text-loss'}`}>{formatGap(gap)}</span>}
                </div>
              );
            })}
          </div>
        )}

        {lap && (sim || official) && (
          <div className="mt-2 border-t border-dashed border-line pt-1">
            {sim ? (
              <Row muted>Simulated runs don&apos;t go on the leaderboard.</Row>
            ) : !signedIn ? (
              <Row muted action={<LinkButton to="/account" size="sm" variant="primary">{acc.status === 'signed_in' ? 'Add' : 'Sign in'}</LinkButton>}>
                {acc.status === 'signed_in' ? 'Add a nickname and car to get on the leaderboard.' : 'Sign in to put this time on the leaderboard.'}
              </Row>
            ) : !online || acc.sync === 'offline' ? (
              <div className="flex items-center gap-3 py-3">
                <IconCloudOff width={20} height={20} className="shrink-0 text-muted" />
                <div>
                  <div className="text-[15px] font-semibold">Saved on this phone</div>
                  <div className="text-xs text-muted">Uploads to the leaderboard when you are back online.</div>
                </div>
              </div>
            ) : (
              <div className="flex items-baseline gap-3 py-3">
                <span className="flex-1 text-muted">Leaderboard</span>
                {rank ? (
                  <>
                    <span className="anim-num font-mono text-lg font-bold">P{rank.place}</span>
                    <span className="w-16 text-right font-mono text-sm text-muted">of {rank.of}</span>
                  </>
                ) : (
                  <Spinner label="" />
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Right after a leaderboard time is when "tell me if someone beats it" makes sense. */}
      {lap && official && !sim && signedIn && !pushOn(acc.user?.uid) && (
        <div className="mt-4 rounded-lg border border-line px-4 py-3">
          <NotifySwitch />
        </div>
      )}

      <div className="mt-auto grid gap-3 pt-8">
        <LinkButton to={`/live?circuit=${session.circuitId}`} variant="primary" size="xl" className="text-xl">
          <IconUndo width={20} height={20} /> Run it again
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

/** The stage time, its characters landing one after another (the card's one flourish). */
function LandingDigits({ text }: { text: string }) {
  return (
    <>
      <span className="sr-only">{text}</span>
      <span aria-hidden="true">
        {[...text].map((ch, i) => (
          <span key={i} className="tc-digit" style={{ animationDelay: `${180 + i * 35}ms` }}>
            {ch}
          </span>
        ))}
      </span>
    </>
  );
}

function Row({ children, action, muted = false }: { children: React.ReactNode; action?: React.ReactNode; muted?: boolean }) {
  return (
    <div className="flex items-center gap-3 py-3">
      <span className={`flex-1 text-sm ${muted ? 'text-muted' : ''}`}>{children}</span>
      {action}
    </div>
  );
}
