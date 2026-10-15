import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { distanceMeters, formatLapTime, formatSpeed, speedLabel, type SectorSplit, type Session } from '@laptimer/core';
import { Button, ConfirmButton, Empty, LinkButton, Notice, Sheet, Spinner } from '../components/ui/primitives';
import { IconAlert, IconCheck, IconPlay, IconSpinner, IconStop, IconTrophy } from '../components/ui/icons';
import { loadBoard } from '../components/track/LeaderboardTab';
import { useAccount, useData, useLive, useTicker } from '../hooks/useData';
import { useSettings } from '../hooks/useSettings';
import { liveController } from '../lib/liveController';
import { getActiveSession, getCircuit, getSession, listCircuits, listSessions, saveSession, setActiveSession, deleteSession } from '../lib/repo';
import { resolveReference, type ReferenceChoice } from '../lib/references';
import { GeolocationSource } from '../lib/gps/geolocation';
import { useGpsPreview, type GpsPreview } from '../lib/gps/preview';
import { DEFAULT_SIMULATOR, SimulatedSource } from '../lib/gps/simulated';
import { unlockAudio } from '../lib/audio';
import { SAFETY_DETAIL, SAFETY_TEXT, acceptSafety, hasAcceptedSafety } from '../lib/safety';
import { simulatorAllowed } from '../lib/developer';
import { ensureLocalCircuit } from '../lib/cloud/account';
import { formatClock, formatGap } from '../lib/runFormat';
import type { ActiveSessionInfo } from '../lib/db';

/** The Drive tab: the start screen until a run begins, then the driving screen. */
export function Live() {
  const live = useLive();
  if (live.status === 'idle') return <DriveSetup />;
  return <DriveRunning />;
}

// ---------------------------------------------------------------- before driving

/** A start line within this distance picks the track by itself. */
const NEAR_START_M = 1000;
/** After this long without accurate GPS the driver may start anyway, warned. */
const START_ANYWAY_AFTER_MS = 60_000;

/**
 * Nothing to choose: the track comes from the link, the nearest start line or the last drive;
 * the lap to beat is the driver's best; Start unlocks once GPS is accurate enough.
 * URL: `?circuit=<id>`, `?ref=lb:<uid>` to race a leaderboard lap.
 */
function DriveSetup() {
  const { settings } = useSettings();
  const acc = useAccount();
  const [params, setParams] = useSearchParams();
  const { data, loading } = useData(async () => ({ circuits: await listCircuits(), sessions: await listSessions() }), [acc.featured.length]);
  const { data: active } = useData(getActiveSession, []);
  const canSimulate = simulatorAllowed(acc.user?.uid);
  const [source, setSource] = useState<'gps' | 'simulated'>('gps');
  const [timeScale, setTimeScale] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [askSafety, setAskSafety] = useState(false);
  const needM = settings.gpsMaxAccuracyM;
  const gps = useGpsPreview(source === 'gps', needM);
  useTicker(gps.state === 'searching', () => Date.now());

  const order = (id: string) => acc.featured.findIndex((f) => f.id === id);
  const circuits = useMemo(() => {
    const all = data?.circuits ?? [];
    const official = all.filter((c) => order(c.id) >= 0).sort((a, b) => order(a.id) - order(b.id));
    return [...official, ...all.filter((c) => order(c.id) < 0)];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, acc.featured]);

  const nearestId = useMemo(() => {
    if (!gps.position) return null;
    let best: { id: string; d: number } | null = null;
    for (const c of circuits) {
      const { a, b } = c.startLine;
      const d = distanceMeters(gps.position, { lat: (a.lat + b.lat) / 2, lon: (a.lon + b.lon) / 2 });
      if (d <= NEAR_START_M && (!best || d < best.d)) best = { id: c.id, d };
    }
    return best?.id ?? null;
  }, [gps.position, circuits]);
  const paramId = params.get('circuit');
  // Without a link, the nearest start line wins once GPS knows where we are; it is then kept.
  useEffect(() => {
    if (!paramId && nearestId) setParams({ circuit: nearestId }, { replace: true });
  }, [paramId, nearestId, setParams]);
  const lastDriven = data?.sessions.find((s) => circuits.some((c) => c.id === s.circuitId))?.circuitId;
  const circuitId = paramId ?? lastDriven ?? circuits[0]?.id ?? null;
  const circuit = circuits.find((c) => c.id === circuitId) ?? null;
  const official = circuit ? order(circuit.id) >= 0 : false;

  const refParam = params.get('ref');
  const simulating = source === 'simulated';
  const best = useMemo(() => {
    let b: { timeMs: number } | null = null;
    for (const s of data?.sessions ?? []) {
      if (s.circuitId !== circuitId || (s.source === 'simulated' && !simulating && !settings.includeSimulatedInBests)) continue;
      for (const l of s.laps) if (l.valid && (!b || l.timeMs < b.timeMs)) b = l;
    }
    return b;
  }, [data, circuitId, simulating, settings.includeSimulatedInBests]);
  const { data: rival } = useData(async () => {
    if (!refParam?.startsWith('lb:') || !circuitId) return null;
    const uid = refParam.slice(3);
    return (await loadBoard(circuitId, 200)).find((e) => e.uid === uid) ?? null;
  }, [refParam, circuitId]);

  function choice(): ReferenceChoice {
    if (refParam?.startsWith('lb:')) return { kind: 'leaderboard', uid: refParam.slice(3) };
    if (refParam?.includes('#')) {
      const [sessionId, lap] = refParam.split('#');
      return { kind: 'lap', sessionId, lap: Number(lap) };
    }
    return { kind: settings.referenceMode };
  }

  const waitedLong = gps.state === 'searching' && gps.accuracyM !== null && Date.now() - gps.waitingSince > START_ANYWAY_AFTER_MS;
  const ready = simulating || gps.state === 'ready';

  async function start(opts: { confirmed?: boolean } = {}) {
    if (!circuit) return;
    if (!opts.confirmed && !simulating && !(await hasAcceptedSafety())) return setAskSafety(true);
    setBusy(true);
    setError(null);
    unlockAudio();
    try {
      const f = acc.featured.find((x) => x.id === circuit.id);
      if (f) await ensureLocalCircuit(f);
      const ref = await resolveReference(circuit, choice(), settings.includeSimulatedInBests || simulating);
      const src = simulating ? new SimulatedSource(circuit, { ...DEFAULT_SIMULATOR, timeScale, seed: Date.now() % 100000 }) : new GeolocationSource();
      await liveController.start(circuit, src, ref, settings);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start.');
    } finally {
      setBusy(false);
    }
  }

  if (loading && !data) return <div className="p-6"><Spinner /></div>;
  if (!circuit) {
    return (
      <div className="p-6">
        <Empty title="No roads yet" action={<LinkButton to="/" variant="primary">See the roads</LinkButton>}>
          Pick a road to drive first.
        </Empty>
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-full max-w-xl flex-col px-4 pb-8 pt-5 short:pb-3 short:pt-3">
      <SafetyDialog
        open={askSafety}
        onCancel={() => setAskSafety(false)}
        onAgree={async () => {
          setAskSafety(false);
          await acceptSafety();
          void start({ confirmed: true });
        }}
      />
      {active && <RecoveryBanner info={active} />}

      <div className="label">Track</div>
      <div className="mt-1 flex items-baseline gap-3">
        <h1 className="min-w-0 flex-1 font-display text-[clamp(1.35rem,6.5vw,1.75rem)] font-black leading-tight tracking-tight">{circuit.name}</h1>
        <label className="relative shrink-0 cursor-pointer text-sm text-muted underline underline-offset-4">
          Change
          <select
            aria-label="Change track"
            value={circuit.id}
            onChange={(e) => setParams({ circuit: e.target.value }, { replace: true })}
            className="absolute inset-0 cursor-pointer opacity-0"
          >
            {circuits.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <GpsLine gps={gps} simulating={simulating} needM={needM} />

      <ul className="mt-5 border-y border-line short:mt-3">
        <li className="flex items-center gap-3 py-3.5 short:py-2.5">
          <div className="min-w-0 flex-1">
            <div className="label">You race</div>
            <div className="mt-0.5 truncate font-semibold">{rival ? `${rival.nickname}, ${rival.car}` : best ? 'Your best lap' : 'Nobody yet'}</div>
          </div>
          <div className="font-mono text-xl tabular">{rival ? formatLapTime(rival.timeMs) : best ? formatLapTime(best.timeMs) : ''}</div>
        </li>
        {!rival && !best && <li className="-mt-2 pb-3 text-xs text-muted">Your first run here sets the time to beat.</li>}
      </ul>
      {official && <LeaderboardLine simulating={simulating} />}

      {error && (
        <div className="mt-4">
          <Notice tone="error">{error}</Notice>
        </div>
      )}
      {active && (
        <div className="mt-4">
          <Notice tone="warn">Finish the interrupted drive above first.</Notice>
        </div>
      )}

      <Button
        variant={ready ? 'primary' : 'secondary'}
        size="xl" className="mt-6 !h-[clamp(3.5rem,10dvh,5rem)] w-full !text-[clamp(1.25rem,6vw,1.5rem)] !font-extrabold short:mt-4"
        onClick={() => void start()}
        disabled={busy || !!active || !ready}
      >
        {ready ? (
          <>
            <IconPlay width={22} height={22} /> {busy ? 'Starting…' : 'Start'}
          </>
        ) : gps.state === 'denied' || gps.state === 'unsupported' ? (
          'Location is off'
        ) : (
          'Waiting for GPS'
        )}
      </Button>
      {waitedLong && !active && (
        <button type="button" onClick={() => void start()} className="mt-3 text-sm text-muted underline underline-offset-4">
          Start anyway (times will be less accurate)
        </button>
      )}
      <p className="mx-auto mt-4 max-w-xs text-center text-sm leading-relaxed text-muted short:mt-3 short:text-xs">
        {ready
          ? 'Put the phone in a holder and keep the screen on. Timing starts when you cross the start line.'
          : gps.state === 'denied'
            ? 'Allow location for this site in your browser settings, then come back.'
            : 'Stand outside with a clear view of the sky. Indoors GPS may never get accurate enough.'}
      </p>

      {canSimulate && (
        <div className="mt-8 rounded border border-warn/40 p-3 short:mt-5 short:p-2.5">
          <div className="label !text-warn">Developer</div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <Button size="sm" variant={!simulating ? 'primary' : 'secondary'} onClick={() => setSource('gps')}>
              Real GPS
            </Button>
            <Button size="sm" variant={simulating ? 'primary' : 'secondary'} onClick={() => setSource('simulated')}>
              Simulator
            </Button>
          </div>
          {simulating && (
            <select aria-label="Playback speed" value={timeScale} onChange={(e) => setTimeScale(Number(e.target.value))} className="mt-2 h-9 w-full rounded border border-line bg-raised px-2 text-sm">
              {[1, 2, 5, 10].map((v) => (
                <option key={v} value={v}>
                  {v}× real time
                </option>
              ))}
            </select>
          )}
        </div>
      )}
    </div>
  );
}

/** One line: is GPS good enough to start? */
function GpsLine({ gps, simulating, needM }: { gps: GpsPreview; simulating: boolean; needM: number }) {
  const box = 'tint mt-4 flex items-center gap-3 rounded-lg border p-3.5 short:mt-3 short:p-2.5';
  if (simulating) {
    return (
      <div className={`${box} border-warn/50 bg-warn/10`}>
        <div className="font-bold text-warn">Simulator: no GPS needed</div>
      </div>
    );
  }
  if (gps.state === 'ready') {
    return (
      <div className={`${box} border-gain/40 bg-gain/10`} role="status">
        <IconCheck width={26} height={26} className="anim-icon shrink-0 text-gain" />
        <div>
          <div className="font-extrabold text-gain">GPS ready</div>
          <div className="text-xs text-gain/80">Accurate to {Math.round(gps.accuracyM ?? 0)} m</div>
        </div>
      </div>
    );
  }
  if (gps.state === 'denied' || gps.state === 'unsupported') {
    return (
      <div className={`${box} border-loss/50 bg-loss/10`} role="alert">
        <IconAlert width={24} height={24} className="shrink-0 text-loss" />
        <div>
          <div className="font-extrabold text-loss">{gps.state === 'denied' ? 'Location is not allowed' : 'No location on this device'}</div>
          <div className="text-xs text-loss/80">{gps.state === 'denied' ? 'Timing needs your position.' : 'Open the app on a phone with GPS.'}</div>
        </div>
      </div>
    );
  }
  return (
    <div className={`${box} border-warn/40 bg-warn/10`} role="status">
      <IconSpinner width={24} height={24} className="shrink-0 animate-spin text-warn" />
      <div>
        <div className="font-extrabold text-warn">Finding GPS</div>
        <div className="text-xs text-warn/80">
          {gps.accuracyM !== null ? `Accurate to ${Math.round(gps.accuracyM)} m, needs ${needM} m. ` : ''}Usually under a minute outdoors.
        </div>
      </div>
    </div>
  );
}

/** Whether this run will reach the leaderboard, in one line. */
function LeaderboardLine({ simulating }: { simulating: boolean }) {
  const acc = useAccount();
  const line = 'mt-3 flex items-center gap-2 text-sm text-muted';
  if (simulating) return <p className={line}>Simulated runs never count for the leaderboard.</p>;
  if (acc.status === 'signed_in' && acc.profile) {
    return (
      <p className={line}>
        <IconTrophy width={16} height={16} className="text-accent" /> Counts for the leaderboard as {acc.profile.nickname}
      </p>
    );
  }
  if (acc.status === 'disabled' || acc.status === 'loading') return null;
  return (
    <p className={line}>
      <IconTrophy width={16} height={16} />
      <span>
        {acc.status === 'signed_in' ? 'Add a nickname and car' : 'Sign in'} to count for the leaderboard.{' '}
        <Link to="/account" className="font-semibold text-fg underline underline-offset-4">
          {acc.status === 'signed_in' ? 'Add' : 'Sign in'}
        </Link>
      </span>
    </p>
  );
}

function SafetyDialog({ open, onCancel, onAgree }: { open: boolean; onCancel: () => void; onAgree: () => void }) {
  return (
    <Sheet open={open} onClose={onCancel} labelledBy="safety-title" center>
      <h2 id="safety-title" className="text-xl font-bold">
        Before your first run
      </h2>
      <p className="mt-2 text-sm">{SAFETY_TEXT}</p>
      <p className="mt-2 text-sm text-muted">{SAFETY_DETAIL}</p>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <Button size="lg" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="lg" variant="primary" onClick={onAgree}>
          I agree
        </Button>
      </div>
    </Sheet>
  );
}

function RecoveryBanner({ info }: { info: ActiveSessionInfo }) {
  const { settings } = useSettings();
  const { data } = useData(async () => ({ session: await getSession(info.sessionId), circuit: await getCircuit(info.circuitId) }), [info.sessionId]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const session = data?.session;
  const circuit = data?.circuit;

  async function resume() {
    if (!session || !circuit) return;
    setBusy(true);
    try {
      unlockAudio();
      const ref = info.reference ? await resolveReference(circuit, { kind: 'lap', ...info.reference }, true) : null;
      await liveController.recover(info, circuit, session, new GeolocationSource(), ref, settings);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not resume.');
    } finally {
      setBusy(false);
    }
  }

  async function finish() {
    if (session) await saveSession({ ...session, endedAt: session.laps.at(-1)?.endT ?? info.updatedAt } satisfies Session);
    await setActiveSession(null);
    navigate(session ? `/result/${session.id}` : '/me');
  }

  async function discard() {
    if (session) await deleteSession(session.id);
    await setActiveSession(null);
    window.location.reload();
  }

  return (
    <div className="mb-5">
      <Notice
        tone="warn"
        title="A drive was interrupted"
        action={
          <div className="flex flex-col gap-2">
            {info.source === 'gps' && (
              <Button size="sm" variant="primary" disabled={busy || !session || !circuit} onClick={() => void resume()}>
                Resume
              </Button>
            )}
            <Button size="sm" onClick={() => void finish()}>
              Save
            </Button>
            <ConfirmButton size="sm" onConfirm={discard} confirmLabel="Sure?">
              Discard
            </ConfirmButton>
          </div>
        }
      >
        {circuit?.name ?? 'Unknown road'}, started {new Date(info.startedAt).toLocaleTimeString()}, {session?.laps.length ?? 0} laps saved.
        {info.source === 'simulated' ? ' Simulated drives cannot be resumed.' : ' Resuming keeps the finished laps; the lap that was in progress is lost.'}
        {error && <span className="block text-loss">{error}</span>}
      </Notice>
    </div>
  );
}

// ---------------------------------------------------------------- driving

/** Driving: the gap to the best lap first, then the time, three parts and speed. Nothing else. */
function DriveRunning() {
  const live = useLive();
  const { settings } = useSettings();
  const navigate = useNavigate();
  const [stopping, setStopping] = useState(false);
  /** Stop asks first in a panel: a stray tap while driving must not end the run. */
  const [confirmStop, setConfirmStop] = useState(false);
  /** Sprints stop and save themselves shortly after the finish (Settings), unless the driver keeps timing. */
  const [autoStopAt, setAutoStopAt] = useState<number | null>(null);
  const finishedAt = live.lastLap?.at;
  useEffect(() => {
    if (!finishedAt || Date.now() - finishedAt > 5000) return;
    if (live.circuit?.kind !== 'sprint' || !settings.autoStopSprint || live.status !== 'running') return;
    setAutoStopAt(Date.now() + 3500);
    // Only a newly finished run arms it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finishedAt]);
  useEffect(() => {
    if (autoStopAt === null) return;
    const t = setTimeout(() => {
      setAutoStopAt(null);
      void stop();
    }, Math.max(0, autoStopAt - Date.now()));
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStopAt]);
  const snap = live.snapshot;
  const running = live.status === 'running';
  const now = useTicker(running && snap?.lapState !== 'waiting_start', live.clock);

  useEffect(() => {
    document.querySelector('main')?.scrollTo(0, 0);
  }, []);

  async function stop() {
    setStopping(true);
    try {
      const id = await liveController.stop();
      navigate(id ? `/result/${id}` : '/me');
    } finally {
      setStopping(false);
    }
  }

  if (!snap || !live.circuit) return <div className="p-6"><Spinner /></div>;

  const elapsed = snap.lapStartT != null ? Math.max(0, now - snap.lapStartT) : null;
  const flash = live.lastLap && snap.lapState === 'lap_completed' ? live.lastLap : null;
  const sectors = live.sectorsLap === snap.lap ? live.sectors : [];
  const gpsGone = snap.gpsState === 'lost' || snap.gpsState === 'no_fix';

  return (
    <div className="flex min-h-full flex-col bg-bg">
      {live.source === 'simulated' && (
        <div className="bg-warn px-3 py-1 text-center text-xs font-bold uppercase tracking-[0.2em] text-black" role="status">
          Simulation, not real GPS
        </div>
      )}
      <div className="mx-auto flex w-full max-w-xl items-center justify-between gap-3 px-4 pt-4 short:pt-3">
        <GpsStatus state={snap.gpsState} />
        <span className="truncate text-sm text-muted">{live.circuit.name}</span>
      </div>
      {(live.error || live.assessment.level === 'unsuitable') && (
        <div className="mx-auto w-full max-w-xl px-4 pt-3">
          <Notice tone={live.error?.fatal ? 'error' : 'warn'}>{live.error?.message ?? live.assessment.message}</Notice>
        </div>
      )}

      {/* Sizes follow the screen's height as well as its width, so it all fits on small phones. */}
      <div className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center gap-[clamp(0.75rem,3.5dvh,2rem)] px-4 py-[clamp(0.75rem,3dvh,1.5rem)]">
        <GapBox
          waiting={snap.lapState === 'waiting_start'}
          flash={flash ? { lap: live.lapOffset + flash.lap, timeMs: flash.timeMs, deltaMs: flash.deltaMs } : null}
          gpsGone={gpsGone}
          hasReference={!!live.reference}
          delta={snap.delta}
        />
        <div className="text-center">
          <div className="label">Time</div>
          <div className="mt-1 font-mono text-[clamp(2.75rem,min(18vw,9dvh),5.5rem)] font-extrabold leading-none tabular">{formatClock(snap.lapState === 'waiting_start' ? 0 : elapsed)}</div>
        </div>
        <Parts sectors={sectors} />
        <div className="text-center text-muted">
          <span className="font-mono text-[clamp(1.3rem,4dvh,1.7rem)] text-fg tabular">{formatSpeed(snap.speedMs, settings.speedUnit)}</span> {speedLabel(settings.speedUnit)}
        </div>
      </div>

      <div className="sticky bottom-0 z-10 border-t border-line bg-bg p-4 pb-[max(1rem,env(safe-area-inset-bottom))] short:p-3 short:pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="mx-auto flex max-w-xl gap-3">
          {live.status === 'paused' && (
            <Button size="xl" variant="primary" className="flex-1 short:!h-14" onClick={() => liveController.resume()}>
              <IconPlay /> Resume
            </Button>
          )}
          <Button size="xl" className="flex-1 short:!h-14" onClick={() => setConfirmStop(true)} disabled={stopping}>
            <IconStop width={18} height={18} /> {stopping ? 'Saving…' : 'Stop'}
          </Button>
        </div>
      </div>

      {autoStopAt !== null && (
        <div role="status" className="fixed inset-x-0 bottom-0 z-[1500] border-t border-accent bg-panel p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <div className="mx-auto flex max-w-xl items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-lg font-bold">Finish!{live.lastLap && ` ${formatLapTime(live.lastLap.timeMs)}`}</div>
              <div className="text-sm text-muted">Saving the run…</div>
            </div>
            <Button size="lg" onClick={() => setAutoStopAt(null)}>
              Keep timing
            </Button>
          </div>
        </div>
      )}

      <Sheet open={confirmStop} onClose={() => setConfirmStop(false)} labelledBy="stop-title">
        <h2 id="stop-title" className="text-xl font-bold">
          Stop and save?
        </h2>
        <p className="mt-1 text-sm text-muted">
          {snap.completedLaps === 0 ? 'No lap is finished yet, so this run has no time.' : `${snap.completedLaps} lap${snap.completedLaps > 1 ? 's' : ''} will be saved.`}
          {snap.lapState === 'in_lap' && snap.completedLaps > 0 && ' The lap in progress is not counted.'}
        </p>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <Button size="xl" onClick={() => setConfirmStop(false)}>
            Keep timing
          </Button>
          <Button size="xl" variant="primary" className="whitespace-nowrap" disabled={stopping} onClick={() => (setConfirmStop(false), void stop())}>
            <IconStop /> Stop
          </Button>
        </div>
      </Sheet>
    </div>
  );
}

function GpsStatus({ state }: { state: string }) {
  const [color, text] = state === 'good' ? ['bg-gain text-gain', 'GPS good'] : state === 'weak' ? ['bg-warn text-warn', 'GPS weak'] : ['bg-loss text-loss', 'No GPS signal'];
  return (
    <span className={`flex items-center gap-2 text-sm font-bold ${color.split(' ')[1]}`}>
      <span className={`h-2.5 w-2.5 rounded-full ${color.split(' ')[0]}`} aria-hidden="true" />
      {text}
    </span>
  );
}

/**
 * The biggest thing on the screen: the gap to the lap being raced. Green with a minus sign when
 * faster, red with a plus sign when slower. Before the start line, after a lap, without GPS or
 * without a lap to race, it says so instead.
 */
function GapBox({
  waiting,
  flash,
  gpsGone,
  hasReference,
  delta,
}: {
  waiting: boolean;
  flash: { lap: number; timeMs: number; deltaMs: number | null } | null;
  gpsGone: boolean;
  hasReference: boolean;
  delta: { deltaMs: number; reliable: boolean } | null;
}) {
  const box = 'tint rounded-xl border px-4 pb-[clamp(1rem,3.5dvh,1.75rem)] pt-[clamp(0.75rem,2.5dvh,1.25rem)] text-center';
  if (waiting) {
    return (
      <div className={`${box} border-line`}>
        <div className="label">Ready</div>
        <div className="mt-2 font-display text-[clamp(1.5rem,7vw,1.875rem)] font-black leading-tight">Cross the start line</div>
        <div className="mt-2 text-sm text-muted">Timing starts by itself.</div>
      </div>
    );
  }
  if (flash) {
    const faster = flash.deltaMs !== null && flash.deltaMs < 0;
    return (
      <div key={`lap-${flash.lap}`} className={`${box} anim-pop ${flash.deltaMs === null ? 'border-line' : faster ? 'border-gain/50 bg-gain/10' : 'border-loss/50 bg-loss/10'}`} role="status" aria-live="assertive">
        <div className="label">Lap {flash.lap}</div>
        <div className="mt-2 font-mono text-[clamp(2.75rem,min(15vw,8dvh),3.75rem)] font-extrabold leading-none tabular">{formatClock(flash.timeMs)}</div>
        {flash.deltaMs !== null && <div className={`mt-3 font-mono text-2xl font-bold tabular ${faster ? 'text-gain' : 'text-loss'}`}>{formatGap(flash.deltaMs)}</div>}
      </div>
    );
  }
  if (gpsGone) {
    return (
      <div className={`${box} border-line`}>
        <div className="label">vs best</div>
        <div className="mt-2 font-mono text-[clamp(3.5rem,min(25vw,12dvh),6.5rem)] font-extrabold leading-none text-muted">—</div>
        <div className="mt-3 flex items-center justify-center gap-2 font-bold text-warn">
          <IconAlert width={18} height={18} /> Keep driving, timing continues
        </div>
      </div>
    );
  }
  if (!hasReference || !delta) {
    return (
      <div className={`${box} border-line`}>
        <div className="label">vs best</div>
        <div className="mt-2 font-mono text-[clamp(3.5rem,min(25vw,12dvh),6.5rem)] font-extrabold leading-none text-muted">—</div>
        {!hasReference && <div className="mt-3 text-sm text-muted">First run here: this one sets the time to beat.</div>}
      </div>
    );
  }
  const faster = delta.deltaMs < 0;
  const tone = !delta.reliable ? 'border-line' : faster ? 'border-gain/50 bg-gain/10' : 'border-loss/50 bg-loss/10';
  const text = !delta.reliable ? 'text-muted' : faster ? 'text-gain' : 'text-loss';
  return (
    <div className={`${box} ${tone}`} role="timer" aria-label="Gap to your best lap">
      <div className={`label ${delta.reliable ? (faster ? '!text-gain/80' : '!text-loss/80') : ''}`}>vs best</div>
      <div className={`tint mt-2 font-mono text-[clamp(3.5rem,min(25vw,12dvh),7rem)] font-extrabold leading-none tabular ${text}`}>{formatGap(delta.deltaMs)}</div>
      {!delta.reliable && <div className="mt-2 text-sm text-muted">GPS uncertain here</div>}
    </div>
  );
}

/**
 * The lap's three parts (thirds by distance), filled in as they are driven: a part faster than any
 * before is purple with its time; otherwise the gap to the lap being raced, green or red.
 */
function Parts({ sectors }: { sectors: SectorSplit[] }) {
  return (
    <div className="grid grid-cols-3 gap-2" aria-label="Parts">
      {[0, 1, 2].map((k) => {
        const s = sectors.find((x) => x.sector === k);
        const purple = !!s?.personalBest;
        const gap = s && !purple && s.refDeltaMs !== null ? s.refDeltaMs : null;
        const tone = !s ? 'border-line' : purple ? 'border-[#b36bff]' : gap === null ? 'border-line' : gap < 0 ? 'border-gain/50' : 'border-loss/50';
        const text = !s ? 'text-muted' : purple ? 'text-[#b36bff]' : gap === null ? 'text-fg' : gap < 0 ? 'text-gain' : 'text-loss';
        return (
          <div key={k} className={`tint rounded-lg border py-2.5 text-center short:py-1.5 ${tone}`}>
            <div className="label">Part {k + 1}</div>
            {/* A part's result arrives once, when it is driven; it lands rather than appearing. */}
            <div key={s ? s.timeMs : 'empty'} className={`mt-1 font-mono text-[clamp(1.2rem,6vw,1.5rem)] font-bold tabular ${text}`}>
              <span className={s ? 'anim-num' : ''}>{!s ? '—' : gap !== null ? formatGap(gap) : (s.timeMs / 1000).toFixed(2)}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

