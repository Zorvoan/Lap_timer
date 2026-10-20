import { useEffect, useMemo, useState } from 'react';
import { Rolling } from '../components/ui/Rolling';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { distanceMeters, formatLapTime, formatSpeed, speedLabel, type Circuit, type LatLon, type SectorSplit, type Session } from '@laptimer/core';
import { Button, ConfirmButton, Empty, LinkButton, Notice, Sheet, Spinner, buttonClass } from '../components/ui/primitives';
import { IconAlert, IconCheck, IconChevronRight, IconPin, IconPlay, IconSpinner, IconStop, IconTrophy, IconX } from '../components/ui/icons';
import { loadBoard } from '../components/track/LeaderboardTab';
import { useAccount, useData, useLive, useTicker } from '../hooks/useData';
import { useSettings } from '../hooks/useSettings';
import { liveController } from '../lib/liveController';
import { getActiveSession, getCircuit, getKv, getSession, listCircuits, listSessions, saveSession, setActiveSession, setKv, deleteSession } from '../lib/repo';
import { resolveReference, type ReferenceChoice } from '../lib/references';
import { GeolocationSource } from '../lib/gps/geolocation';
import { useGpsPreview, type GpsPreview } from '../lib/gps/preview';
import { DEFAULT_SIMULATOR, SimulatedSource } from '../lib/gps/simulated';
import { unlockAudio } from '../lib/audio';
import { SAFETY_DETAIL, SAFETY_TEXT, acceptSafety, hasAcceptedSafety } from '../lib/safety';
import { simulatorAllowed } from '../lib/developer';
import { ensureLocalCircuit, leaderboardTracks } from '../lib/cloud/account';
import { formatClock, formatGap } from '../lib/runFormat';
import { climbText, useElevation } from '../lib/climb';
import { circuitLapNumbers, lapKey } from '../lib/lapNumbers';
import type { LeaderboardEntry } from '../lib/cloud/leaderboard';
import type { ActiveSessionInfo } from '../lib/db';

/** The Drive tab: the start screen until a run begins, then the driving screen. */
export function Live() {
  const live = useLive();
  if (live.status === 'idle') return <DriveSetup />;
  return <DriveRunning />;
}

// ---------------------------------------------------------------- before driving

/** Within this distance of a start line the road counts as "near you" and needs no directions. */
const NEAR_START_M = 1000;
/** After this long without accurate GPS the driver may start anyway, warned. */
const START_ANYWAY_AFTER_MS = 60_000;

/**
 * Where to drive and against what. The road comes from the link or, once GPS knows where we are,
 * the nearest start line (the last drive until then); other roads nearby are listed with a way to
 * get to their start. The lap to beat can be changed: own laps, the leaderboard, or none.
 * URL: `?circuit=<id>&ref=<pb | session | none | lb:<uid> | <sessionId>#<lap>>`.
 */
function DriveSetup() {
  const { settings } = useSettings();
  const acc = useAccount();
  const [params, setParams] = useSearchParams();
  const { data, loading } = useData(async () => ({ circuits: await listCircuits(), sessions: await listSessions() }), [acc.featured.length]);
  const { data: active } = useData(getActiveSession, []);
  const { data: guideSeen, loading: guideLoading, reload: reloadGuide } = useData(() => getKv<boolean>(GUIDE_KEY), []);
  const canSimulate = simulatorAllowed(acc.user?.uid);
  const [source, setSource] = useState<'gps' | 'simulated'>('gps');
  const [timeScale, setTimeScale] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [askSafety, setAskSafety] = useState(false);
  const [pickRef, setPickRef] = useState(false);
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

  // Every road by distance from here to its start line.
  const nearby = useMemo(() => {
    if (!gps.position) return [];
    return circuits.map((c) => ({ c, d: distanceMeters(gps.position!, startPoint(c)) })).sort((a, b) => a.d - b.d);
  }, [gps.position, circuits]);
  const nearestId = nearby[0]?.c.id ?? null;
  const paramId = params.get('circuit');
  // Without a link, the nearest start line wins once GPS knows where we are; it is then kept.
  useEffect(() => {
    if (!paramId && nearestId) setParams({ circuit: nearestId }, { replace: true });
  }, [paramId, nearestId, setParams]);
  const lastDriven = data?.sessions.find((s) => circuits.some((c) => c.id === s.circuitId))?.circuitId;
  const circuitId = paramId ?? lastDriven ?? circuits[0]?.id ?? null;
  const circuit = circuits.find((c) => c.id === circuitId) ?? null;
  const here = nearby.find((n) => n.c.id === circuitId)?.d ?? null;
  const others = nearby.filter((n) => n.c.id !== circuitId).slice(0, 3);
  const climb = climbText(useElevation(circuit));
  // Official tracks and public roads count for a leaderboard.
  const official = circuit ? leaderboardTracks(acc).some((f) => f.id === circuit.id) : false;
  const simulating = source === 'simulated';
  const pick = (id: string) => setParams({ circuit: id }, { replace: true });

  // This road's own laps, fastest first.
  const laps = useMemo(() => {
    const mine = (data?.sessions ?? []).filter((s) => s.circuitId === circuitId && (s.source !== 'simulated' || simulating || settings.includeSimulatedInBests));
    const nums = circuitLapNumbers(mine);
    return mine
      .flatMap((s) => s.laps.filter((l) => l.valid).map((l) => ({ key: lapKey(s.id, l.lap), timeMs: l.timeMs, n: nums.get(lapKey(s.id, l.lap)) ?? l.lap, at: s.startedAt })))
      .sort((a, b) => a.timeMs - b.timeMs);
  }, [data, circuitId, simulating, settings.includeSimulatedInBests]);
  const best = laps[0] ?? null;
  const { data: board } = useData(async () => (official && circuitId ? loadBoard(circuitId, 200) : null), [official, circuitId], official && circuitId ? `board:${circuitId}` : undefined);
  const me = acc.user?.uid;
  const place = board && me ? board.findIndex((e) => e.uid === me) + 1 : 0;

  const refParam = params.get('ref') ?? REF_PARAM[settings.referenceMode];
  const setRef = (ref: string) => {
    setPickRef(false);
    if (circuitId) setParams({ circuit: circuitId, ref }, { replace: true });
  };
  const rival = refParam.startsWith('lb:') ? (board?.find((e) => e.uid === refParam.slice(3)) ?? null) : null;
  const ownLap = refParam.includes('#') ? (laps.find((l) => l.key === refParam) ?? null) : null;
  const racing: { label: string; detail?: string; timeMs?: number } = refParam.startsWith('lb:')
    ? { label: rival ? `${rival.nickname}, ${rival.car}` : 'Leaderboard lap', timeMs: rival?.timeMs }
    : ownLap
      ? { label: `Your lap ${ownLap.n}`, detail: lapDate(ownLap.at), timeMs: ownLap.timeMs }
      : refParam === 'session'
        ? { label: 'Best lap of this drive', detail: 'Each new best becomes the one to beat.' }
        : refParam === 'none'
          ? { label: 'Just the clock', detail: 'No live gap to another lap.' }
          : best
            ? { label: 'Your best lap', timeMs: best.timeMs }
            : { label: 'Nobody yet', detail: 'Your first run here sets the time to beat.' };

  function choice(): ReferenceChoice {
    if (refParam.startsWith('lb:')) return { kind: 'leaderboard', uid: refParam.slice(3) };
    if (refParam.includes('#')) {
      const [sessionId, lap] = refParam.split('#');
      return { kind: 'lap', sessionId, lap: Number(lap) };
    }
    if (refParam === 'session') return { kind: 'session_best' };
    if (refParam === 'none') return { kind: 'none' };
    return { kind: 'personal_best' };
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
      const f = leaderboardTracks(acc).find((x) => x.id === circuit.id);
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

  const atStart = here !== null && here <= NEAR_START_M;
  // Until the first real drive (or "Got it"), how timing works in three steps.
  const guide = !guideLoading && !guideSeen && !!data && !data.sessions.some((s) => s.source === 'gps');
  return (
    <div className="mx-auto flex min-h-full max-w-xl flex-col px-4 pb-8 pt-5 short:pb-3 short:pt-3 land:max-w-4xl">
      <SafetyDialog
        open={askSafety}
        onCancel={() => setAskSafety(false)}
        onAgree={async () => {
          setAskSafety(false);
          await acceptSafety();
          void start({ confirmed: true });
        }}
      />
      <ReferenceSheet
        open={pickRef}
        onClose={() => setPickRef(false)}
        current={refParam}
        laps={laps}
        board={(board ?? []).map((e, i) => ({ ...e, pos: i + 1 })).filter((e) => e.uid !== me)}
        onPick={setRef}
      />
      {active && <RecoveryBanner info={active} />}

      {/* Sideways phone: what you drive on the left, Start on the right. */}
      <div className="land:grid land:grid-cols-2 land:items-center land:gap-6">
      <div>
      <div className="label">{atStart ? 'Near you' : 'Road'}</div>
      <div className="mt-1 flex items-baseline gap-3">
        <h1 className="min-w-0 flex-1 font-display text-[clamp(1.35rem,6.5vw,1.75rem)] font-black leading-tight tracking-tight">{circuit.name}</h1>
        <label className="relative shrink-0 cursor-pointer overflow-hidden text-sm text-muted underline underline-offset-4">
          Change
          <select
            aria-label="Change road"
            value={circuit.id}
            onChange={(e) => pick(e.target.value)}
            className="absolute inset-0 h-full w-full cursor-pointer appearance-none opacity-0"
          >
            {circuits.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      {(here !== null || climb || place > 0) && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {here !== null && (
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${atStart ? 'bg-gain/15 text-gain' : 'bg-raised text-muted'}`}>
              {here <= AT_START_M ? "You're at the start" : atStart ? `${formatDistance(here)} to the start` : `${formatDistance(here)} away`}
            </span>
          )}
          {climb && <span className="rounded-full bg-raised px-2.5 py-0.5 text-xs font-bold text-muted">{climb}</span>}
          {place > 0 && board && (
            <span className="rounded-full bg-raised px-2.5 py-0.5 text-xs font-bold text-muted">
              #{place} of {board.length}
            </span>
          )}
        </div>
      )}

      <GpsLine gps={gps} simulating={simulating} needM={needM} />

      <button
        type="button"
        onClick={() => setPickRef(true)}
        aria-label={`You race ${racing.label}. Change the lap to beat`}
        className="press mt-5 flex w-full items-center gap-3 border-y border-line py-3.5 text-left short:mt-3 short:py-2.5"
      >
        <div className="min-w-0 flex-1">
          <div className="label">You race</div>
          <div className="mt-0.5 truncate font-semibold">{racing.label}</div>
          {racing.detail && <div className="truncate text-xs text-muted">{racing.detail}</div>}
        </div>
        {racing.timeMs !== undefined && <div className="font-mono text-lg tabular [@media(min-width:360px)]:text-xl">{formatLapTime(racing.timeMs)}</div>}
        <span className="flex shrink-0 items-center text-sm text-muted">
          <span className="hidden [@media(min-width:360px)]:inline">Change</span> <IconChevronRight width={16} height={16} />
        </span>
      </button>
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

      </div>
      <div>
      <Button
        variant={ready ? 'primary' : 'secondary'}
        size="xl" className="mt-6 !h-[clamp(3.5rem,10dvh,5rem)] w-full !text-[clamp(1.25rem,6vw,1.5rem)] !font-extrabold short:mt-4 land:mt-0"
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
      {here !== null && !atStart && (
        <a href={navigateUrl(startPoint(circuit))} target="_blank" rel="noopener noreferrer" className={buttonClass('secondary', 'lg', 'mt-3 w-full')}>
          <IconPin width={18} height={18} /> Navigate to the start
        </a>
      )}
      {waitedLong && !active && (
        <button type="button" onClick={() => void start()} className="mt-3 text-sm text-muted underline underline-offset-4">
          Start anyway (times will be less accurate)
        </button>
      )}
      {guide && (
        <FirstDriveGuide
          sprint={circuit.kind === 'sprint'}
          onDone={async () => {
            await setKv(GUIDE_KEY, true);
            reloadGuide();
          }}
        />
      )}
      <p className={`mx-auto mt-4 max-w-xs text-center text-sm leading-relaxed text-muted short:mt-3 short:text-xs ${guide && ready ? 'hidden' : ''}`}>
        {ready
          ? 'Put the phone in a holder and keep the screen on. Timing starts when you cross the start line.'
          : gps.state === 'denied'
            ? 'Allow location for this site in your browser settings, then come back.'
            : 'Stand outside with a clear view of the sky. Indoors GPS may never get accurate enough.'}
      </p>

      {others.length > 0 && (
        <div className="mt-6 short:mt-4">
          <div className="label">Other roads nearby</div>
          <ul className="mt-1 divide-y divide-line">
            {others.map(({ c, d }) => (
              <li key={c.id} className="flex items-center gap-3 py-2.5">
                <button type="button" onClick={() => pick(c.id)} className="press min-w-0 flex-1 text-left">
                  <div className="truncate font-semibold">{c.name}</div>
                  <div className="text-xs text-muted">{d <= AT_START_M ? 'Starts here' : `${formatDistance(d)} to the start`}</div>
                </button>
                {d <= NEAR_START_M ? (
                  <Button size="sm" onClick={() => pick(c.id)}>
                    Drive this
                  </Button>
                ) : (
                  <a href={navigateUrl(startPoint(c))} target="_blank" rel="noopener noreferrer" className={buttonClass('secondary', 'sm')}>
                    Navigate
                  </a>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

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
      </div>
    </div>
  );
}

const GUIDE_KEY = 'hint:firstDrive';

/** First drive: nothing to do but Start; the clock runs by itself between the lines. */
function FirstDriveGuide({ sprint, onDone }: { sprint: boolean; onDone: () => void }) {
  const steps = [
    ['Tap Start', 'Put the phone in a holder with the screen on. You can tap Start anywhere, before you get to the road.'],
    ['Drive through the start line', 'The clock starts by itself the moment you cross it. No need to touch the phone.'],
    sprint
      ? ['Cross the finish line', 'The clock stops and your time is saved. The drive ends by itself.']
      : ['Keep driving laps', 'Every time you cross the line a lap is saved. Tap Stop when you are done.'],
  ];
  return (
    <section aria-labelledby="guide-title" className="anim-reveal mt-4 rounded-lg border border-line bg-raised p-4 short:mt-3 short:p-3">
      <div className="label">Your first drive</div>
      <h2 id="guide-title" className="mt-0.5 font-display text-lg font-black">
        How timing works
      </h2>
      <ol className="mt-3 space-y-3 short:space-y-2">
        {steps.map(([title, text], i) => (
          <li key={title} className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-extrabold text-white">{i + 1}</span>
            <div className="min-w-0">
              <div className="font-semibold leading-6">{title}</div>
              <div className="text-sm leading-snug text-muted">{text}</div>
            </div>
          </li>
        ))}
      </ol>
      <Button size="sm" className="mt-4 w-full short:mt-3" onClick={onDone}>
        Got it
      </Button>
    </section>
  );
}

/** Within this distance of a start line, "you're at the start". */
const AT_START_M = 150;
/** The `ref` link value for each default in the settings. */
const REF_PARAM: Record<'personal_best' | 'session_best' | 'none', string> = { personal_best: 'pb', session_best: 'session', none: 'none' };

const startPoint = (c: Circuit): LatLon => ({ lat: (c.startLine.a.lat + c.startLine.b.lat) / 2, lon: (c.startLine.a.lon + c.startLine.b.lon) / 2 });
const formatDistance = (m: number) => (m < 1000 ? `${Math.max(10, Math.round(m / 10) * 10)} m` : `${(m / 1000).toFixed(m < 10_000 ? 1 : 0)} km`);
const lapDate = (t: number) => new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

/** Driving directions to a point: Apple Maps on Apple devices, Google Maps elsewhere. */
function navigateUrl(p: LatLon): string {
  const at = `${p.lat.toFixed(6)},${p.lon.toFixed(6)}`;
  return /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent)
    ? `https://maps.apple.com/?daddr=${at}&dirflg=d`
    : `https://www.google.com/maps/dir/?api=1&destination=${at}&travelmode=driving`;
}

/** Choose the lap to beat: own laps, the leaderboard, the best of this drive, or none. */
function ReferenceSheet({
  open,
  onClose,
  current,
  laps,
  board,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  current: string;
  laps: readonly { key: string; timeMs: number; n: number; at: number }[];
  board: readonly (LeaderboardEntry & { pos: number })[];
  onPick: (ref: string) => void;
}) {
  const row = (ref: string, label: string, detail: string | null, timeMs?: number) => (
    <li key={ref}>
      <button
        type="button"
        onClick={() => onPick(ref)}
        aria-pressed={current === ref}
        className={`press flex w-full items-center gap-3 rounded px-3 py-2.5 text-left ${current === ref ? 'bg-accent/15 ring-1 ring-accent/60' : ''}`}
      >
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold">{label}</div>
          {detail && <div className="truncate text-xs text-muted">{detail}</div>}
        </div>
        {timeMs !== undefined && <div className="font-mono tabular">{formatLapTime(timeMs)}</div>}
        {current === ref && <IconCheck width={18} height={18} className="shrink-0 text-accent" />}
      </button>
    </li>
  );
  return (
    <Sheet open={open} onClose={onClose} labelledBy="ref-title" center>
      <div className="flex items-center justify-between">
        <h2 id="ref-title" className="text-xl font-bold">
          Race against
        </h2>
        <button type="button" onClick={onClose} aria-label="Close" className="press -mr-2 p-2 text-muted">
          <IconX width={20} height={20} />
        </button>
      </div>
      <div className="-mx-1 mt-2 max-h-[min(70dvh,34rem)] overflow-y-auto px-1">
        <div className="label mt-2">You</div>
        <ul className="mt-1">
          {row('pb', 'Your best lap', laps[0] ? null : 'None yet', laps[0]?.timeMs)}
          {laps.slice(1, 4).map((l) => row(l.key, `Your lap ${l.n}`, lapDate(l.at), l.timeMs))}
          {row('session', 'Best lap of this drive', 'Each new best becomes the one to beat.')}
          {row('none', 'Just the clock', 'No live gap to another lap.')}
        </ul>
        {board.length > 0 && (
          <>
            <div className="label mt-4">Leaderboard</div>
            <ul className="mt-1">{board.slice(0, 20).map((e) => row(`lb:${e.uid}`, `${e.pos}. ${e.nickname}`, e.car, e.timeMs))}</ul>
          </>
        )}
      </div>
    </Sheet>
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
      <div className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center gap-[clamp(0.75rem,3.5dvh,2rem)] px-4 py-[clamp(0.75rem,3dvh,1.5rem)] tiny:gap-2 tiny:py-2 land:grid land:max-w-4xl land:grid-cols-2 land:items-center land:gap-4">
        <GapBox
          waiting={snap.lapState === 'waiting_start'}
          flash={flash ? { lap: live.lapOffset + flash.lap, timeMs: flash.timeMs, deltaMs: flash.deltaMs } : null}
          gpsGone={gpsGone}
          hasReference={!!live.reference}
          delta={snap.delta}
        />
        {/* Sideways phone: the gap on the left, time, parts and speed on the right. */}
        <div className="flex flex-col gap-[clamp(0.75rem,3.5dvh,2rem)] tiny:gap-2 land:gap-3">
        <div className="text-center">
          <div className="label">Time</div>
          <div className="mt-1 font-mono text-[clamp(2.75rem,min(18vw,9dvh),5.5rem)] font-extrabold leading-none tabular">{formatClock(snap.lapState === 'waiting_start' ? 0 : elapsed)}</div>
        </div>
        <Parts sectors={sectors} />
        <div className="text-center text-muted">
          <span className="font-mono text-[clamp(1.3rem,4dvh,1.7rem)] text-fg tabular">{formatSpeed(snap.speedMs, settings.speedUnit)}</span> {speedLabel(settings.speedUnit)}
        </div>
        </div>
      </div>

      <div className="sticky bottom-0 z-10 border-t border-line bg-bg p-4 pb-[max(1rem,env(safe-area-inset-bottom))] short:p-3 short:pb-[max(0.75rem,env(safe-area-inset-bottom))] land:py-2">
        <div className="mx-auto flex max-w-xl gap-3">
          {live.status === 'paused' && (
            <Button size="xl" variant="primary" className="flex-1 short:!h-14 land:!h-12" onClick={() => liveController.resume()}>
              <IconPlay /> Resume
            </Button>
          )}
          <Button size="xl" className="flex-1 short:!h-14 land:!h-12" onClick={() => setConfirmStop(true)} disabled={stopping}>
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
        <div className="mt-2 text-sm text-muted">Timing starts by itself as you drive through it.</div>
      </div>
    );
  }
  if (flash) {
    const faster = flash.deltaMs !== null && flash.deltaMs < 0;
    return (
      <div key={`lap-${flash.lap}`} className={`${box} anim-pop ${flash.deltaMs === null ? 'border-line' : faster ? 'border-gain/50 bg-gain/10' : 'border-loss/50 bg-loss/10'}`} role="status" aria-live="assertive">
        <div className="label">Lap {flash.lap}</div>
        <div className="mt-2 font-mono text-[clamp(2.75rem,min(15vw,8dvh),3.75rem)] font-extrabold leading-none tabular">
          {/* The lap's time rolls up once; the live numbers above don't roll, so they read at a glance. */}
          <Rolling text={formatClock(flash.timeMs)} from delay={120} />
        </div>
        {flash.deltaMs !== null && (
          <div className={`mt-3 font-mono text-2xl font-bold tabular ${faster ? 'text-gain' : 'text-loss'}`}>
            <Rolling text={formatGap(flash.deltaMs)} from delay={300} />
          </div>
        )}
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
        {!hasReference && <div className="mt-3 text-sm text-muted">First run: this one sets the time to beat.</div>}
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

