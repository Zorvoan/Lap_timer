import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CircleMarker, Polyline } from 'react-leaflet';
import L from 'leaflet';
import { formatDelta, formatDistance, formatLapTime, formatSpeed, speedLabel, type Circuit, type Session } from '@laptimer/core';
import { BaseMap, FitBounds, FollowPosition } from '../components/map/BaseMap';
import { RouteLayer } from '../components/map/RouteLayer';
import { TimingLineView } from '../components/map/TimingLines';
import { BigTime, DeltaDisplay, GpsIndicator, StatusChip } from '../components/live/LiveDisplay';
import { Badge, Button, ConfirmButton, Empty, Field, LinkButton, Notice, Panel, Select, Spinner } from '../components/ui/primitives';
import { IconPause, IconPlay, IconStop } from '../components/ui/icons';
import { PageHeader } from '../components/AppShell';
import { useData, useLive, useTicker } from '../hooks/useData';
import { useSettings } from '../hooks/useSettings';
import { liveController } from '../lib/liveController';
import { getActiveSession, getCircuit, getSession, listCircuits, listSessions, saveSession, setActiveSession, deleteSession } from '../lib/repo';
import { resolveReference, type ReferenceChoice } from '../lib/references';
import { GeolocationSource, geolocationSupport } from '../lib/gps/geolocation';
import { DEFAULT_SIMULATOR, SimulatedSource } from '../lib/gps/simulated';
import { unlockAudio } from '../lib/audio';
import { config } from '../lib/config';
import { ScreenWakeLock } from '../lib/wakeLock';
import type { ActiveSessionInfo } from '../lib/db';
import { circuitLapNumbers, lapKey } from '../lib/lapNumbers';

export function Live() {
  const live = useLive();
  if (live.status === 'idle') return <LiveSetup />;
  return <LiveRunning />;
}

// ---------------------------------------------------------------- setup

function LiveSetup() {
  const { settings } = useSettings();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { data: circuits } = useData(listCircuits, []);
  const { data: active } = useData(getActiveSession, []);
  const [circuitId, setCircuitId] = useState<string>(params.get('circuit') ?? '');
  const refParam = params.get('ref');
  const [refKey, setRefKey] = useState<string>(refParam ?? settings.referenceMode);
  const [source, setSource] = useState<'gps' | 'simulated'>('gps');
  const [timeScale, setTimeScale] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!circuitId && circuits?.length) setCircuitId(circuits[0].id);
  }, [circuits, circuitId]);
  useEffect(() => {
    if (!refParam) setRefKey(settings.referenceMode);
  }, [settings.referenceMode, refParam]);

  const circuit = circuits?.find((c) => c.id === circuitId) ?? null;
  const { data: sessions } = useData(async () => (circuitId ? listSessions(circuitId) : []), [circuitId]);
  const lapNumbers = useMemo(() => circuitLapNumbers(sessions ?? []), [sessions]);
  const lapOptions = useMemo(() => {
    const laps = (sessions ?? [])
      .filter((s) => s.source === 'gps' || settings.includeSimulatedInBests || source === 'simulated')
      .flatMap((s) => s.laps.filter((l) => l.valid).map((l) => ({ s, l })));
    return laps.sort((a, b) => a.l.timeMs - b.l.timeMs).slice(0, 15);
  }, [sessions, settings.includeSimulatedInBests, source]);

  const gpsProblem = source === 'gps' ? geolocationSupport() : null;

  function choice(): ReferenceChoice {
    if (refKey === 'personal_best' || refKey === 'session_best' || refKey === 'none') return { kind: refKey };
    if (refKey.startsWith('lb:')) return { kind: 'leaderboard', uid: refKey.slice(3) };
    const [sessionId, lap] = refKey.split('#');
    return { kind: 'lap', sessionId, lap: Number(lap) };
  }

  async function start() {
    if (!circuit) return;
    setBusy(true);
    setError(null);
    unlockAudio();
    try {
      const ref = await resolveReference(circuit, choice(), settings.includeSimulatedInBests || source === 'simulated');
      const src = source === 'simulated' ? new SimulatedSource(circuit, { ...DEFAULT_SIMULATOR, timeScale, seed: Date.now() % 100000 }) : new GeolocationSource();
      await liveController.start(circuit, src, ref, settings);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start the session.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="pb-8">
      <PageHeader title="Live timing" subtitle="Choose a circuit and a reference lap, then start. Timing begins when you cross the start line." />
      <div className="mx-auto grid max-w-5xl gap-4 p-4 md:grid-cols-[1fr_20rem] md:p-6">
        {active && <RecoveryBanner info={active} />}
        <Panel title="Session" className="md:row-span-2">
          {!circuits ? (
            <Spinner />
          ) : circuits.length === 0 ? (
            <Empty title="No circuits yet" action={<LinkButton to="/circuits/new" variant="primary">Create a circuit</LinkButton>}>
              You need a circuit with a start/finish line before you can time laps.
            </Empty>
          ) : (
            <div className="space-y-4">
              <Field label="Circuit">
                <Select value={circuitId} onChange={(e) => setCircuitId(e.target.value)}>
                  {circuits.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} · {formatDistance(c.lengthM, settings.distanceUnit)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Reference lap for delta" hint="A faster lap set during the session replaces personal-best and session-best references automatically.">
                <Select value={refKey} onChange={(e) => setRefKey(e.target.value)}>
                  <option value="personal_best">Personal best on this circuit</option>
                  <option value="session_best">Best lap of this session</option>
                  <option value="none">No reference (timing only)</option>
                  {refKey.startsWith('lb:') && <option value={refKey}>Leaderboard lap (chosen on the leaderboard)</option>}
                  {lapOptions.length > 0 && (
                    <optgroup label="Specific lap (fixed)">
                      {lapOptions.map(({ s, l }) => (
                        <option key={`${s.id}#${l.lap}`} value={`${s.id}#${l.lap}`}>
                          {formatLapTime(l.timeMs)} · lap {lapNumbers.get(lapKey(s.id, l.lap)) ?? l.lap} · {new Date(s.startedAt).toLocaleDateString()}
                          {s.source === 'simulated' ? ' · SIM' : ''}
                        </option>
                      ))}
                    </optgroup>
                  )}
                </Select>
              </Field>

              {config.simulatorEnabled && (
                <fieldset className="rounded border border-warn/50 p-3">
                  <legend className="px-1 text-xs font-bold uppercase tracking-wider text-warn">Position source · developer option</legend>
                  <div className="grid grid-cols-2 gap-2">
                    <Button variant={source === 'gps' ? 'primary' : 'secondary'} onClick={() => setSource('gps')}>
                      Real GPS
                    </Button>
                    <Button variant={source === 'simulated' ? 'primary' : 'secondary'} onClick={() => setSource('simulated')}>
                      Simulator
                    </Button>
                  </div>
                  {source === 'simulated' && (
                    <div className="mt-3 space-y-2">
                      <p className="text-xs text-warn">
                        SIMULATION: synthetic positions along the circuit. Not real GPS. Sessions are saved and labelled as simulated.
                      </p>
                      <Field label="Playback speed">
                        <Select value={timeScale} onChange={(e) => setTimeScale(Number(e.target.value))}>
                          {[1, 2, 5, 10].map((v) => (
                            <option key={v} value={v}>
                              {v}× real time
                            </option>
                          ))}
                        </Select>
                      </Field>
                    </div>
                  )}
                </fieldset>
              )}

              {gpsProblem && <Notice tone="error">{gpsProblem.message}</Notice>}
              {error && <Notice tone="error">{error}</Notice>}
              {active && <Notice tone="warn">Resolve the interrupted session above before starting a new one.</Notice>}

              <Button variant="primary" size="xl" className="w-full" onClick={() => void start()} disabled={!circuit || busy || !!gpsProblem || !!active}>
                <IconPlay /> {busy ? 'Starting…' : source === 'simulated' ? 'Start simulated session' : 'Start session'}
              </Button>
              {circuit && (
                <Button variant="ghost" className="w-full" onClick={() => navigate(`/circuits?selected=${circuit.id}`)}>
                  View circuit on map
                </Button>
              )}
            </div>
          )}
        </Panel>
        <Panel title="Before you drive">
          <ul className="list-disc space-y-2 pl-4 text-sm text-muted">
            <li>Use a phone with GPS outdoors. Desktop browsers usually have no GPS receiver; their positions are too coarse for timing.</li>
            <li>Keep this screen on and the app in front. Standard browsers may pause GPS when the screen turns off or the app goes to the background; laps are flagged when fixes are missing.</li>
            <li>Mount the phone and don’t touch it while driving. The display is designed to be read at a glance.</li>
            <li>Consumer GPS timing is accurate to roughly a tenth of a second, not to motorsport-transponder precision.</li>
            <li>Only drive on closed courses or legally, within limits. Public roads are not race tracks.</li>
          </ul>
          <div className="mt-3 text-xs text-muted">Screen wake lock: {ScreenWakeLock.supported ? 'supported' : 'not supported in this browser'}</div>
        </Panel>
      </div>
    </div>
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
    navigate(session ? `/sessions/${session.id}` : '/sessions');
  }

  async function discard() {
    if (session) await deleteSession(session.id);
    await setActiveSession(null);
    window.location.reload();
  }

  return (
    <div className="md:col-span-2">
      <Notice
        tone="warn"
        title="A session was interrupted"
        action={
          <div className="flex flex-col gap-2 sm:flex-row">
            {info.source === 'gps' && (
              <Button size="sm" variant="primary" disabled={busy || !session || !circuit} onClick={() => void resume()}>
                Resume
              </Button>
            )}
            <Button size="sm" onClick={() => void finish()}>
              Save & finish
            </Button>
            <ConfirmButton size="sm" onConfirm={discard} confirmLabel="Confirm discard">
              Discard
            </ConfirmButton>
          </div>
        }
      >
        {circuit?.name ?? 'Unknown circuit'} · started {new Date(info.startedAt).toLocaleTimeString()} · {session?.laps.length ?? 0} laps saved.
        {info.source === 'simulated' ? ' Simulated sessions cannot be resumed.' : ' Resuming restores completed laps; the lap that was in progress is discarded.'}
        {error && <span className="block text-loss">{error}</span>}
      </Notice>
    </div>
  );
}

// ---------------------------------------------------------------- running

function LiveRunning() {
  const live = useLive();
  const { settings } = useSettings();
  const navigate = useNavigate();
  const [showMap, setShowMap] = useState(settings.showLiveMap);
  const [stopping, setStopping] = useState(false);
  const snap = live.snapshot;
  const running = live.status === 'running';
  const now = useTicker(running && snap?.lapState !== 'waiting_start', live.clock);

  // Start at the top: the delta and lap time must be visible without scrolling.
  useEffect(() => {
    document.querySelector('main')?.scrollTo(0, 0);
  }, []);

  const elapsed = snap?.lapStartT != null ? Math.max(0, now - snap.lapStartT) : null;
  const flash = live.lastLap && snap?.lapState === 'lap_completed' ? live.lastLap : null;

  async function stop() {
    setStopping(true);
    try {
      const circuitId = live.circuit?.id;
      const id = await liveController.stop();
      navigate(id && circuitId ? `/circuits/${circuitId}?session=${id}` : id ? `/sessions/${id}` : '/sessions');
    } finally {
      setStopping(false);
    }
  }

  if (!snap || !live.circuit) return <Spinner />;

  return (
    <div className="flex min-h-full flex-col bg-bg">
      {live.source === 'simulated' && (
        <div className="bg-warn px-3 py-1 text-center text-xs font-bold uppercase tracking-[0.2em] text-black" role="status">
          Simulation — not real GPS
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2">
        <div className="flex items-center gap-3">
          <StatusChip lapState={snap.lapState} gpsState={snap.gpsState} />
          <span className="font-mono text-sm font-bold tabular" title="Lap number on this circuit, counting earlier sessions">
            LAP {snap.lap ? live.lapOffset + snap.lap : '—'}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <GpsIndicator state={snap.gpsState} accuracy={snap.accuracyM} rateHz={live.assessment.rateHz} />
          <span className="hidden truncate text-xs text-muted sm:inline">{live.circuit.name}</span>
        </div>
      </div>

      {(live.error || live.assessment.message) && (
        <div className="space-y-2 px-4 pt-3">
          {live.error && <Notice tone={live.error.fatal ? 'error' : 'warn'}>{live.error.message}</Notice>}
          {live.assessment.message && <Notice tone={live.assessment.level === 'unsuitable' ? 'error' : 'warn'}>{live.assessment.message}</Notice>}
        </div>
      )}

      <div className={`grid flex-1 gap-4 p-4 ${showMap ? 'lg:grid-cols-[1fr_24rem]' : ''}`}>
        <div className="flex flex-col justify-center gap-6">
          {flash ? (
            <div className="flex flex-col items-center gap-2 py-6" role="status" aria-live="assertive">
              <div className="label">Lap {flash.lap} {flash.valid ? '' : '· invalid'}</div>
              <div className="font-mono text-[clamp(3rem,14vw,8rem)] font-bold leading-none tabular">{formatLapTime(flash.timeMs)}</div>
              {flash.deltaMs !== null && (
                <div className={`font-mono text-3xl font-bold tabular ${flash.deltaMs < 0 ? 'text-gain' : 'text-loss'}`}>
                  {flash.deltaMs < 0 ? '▼' : '▲'} {formatDelta(flash.deltaMs)} s
                </div>
              )}
              {flash.newBest && <Badge tone="accent">Best lap</Badge>}
            </div>
          ) : (
            <DeltaDisplay delta={snap.delta} hasReference={!!live.reference} referenceLabel={live.reference ? formatLapTime(live.reference.lapTimeMs) : null} />
          )}

          <BigTime ms={snap.lapState === 'waiting_start' ? null : elapsed} label={snap.lapState === 'waiting_start' ? 'Cross the start line to begin' : 'Lap time'} />

          <div className="mx-auto grid w-full max-w-3xl grid-cols-2 gap-px overflow-hidden rounded border border-line bg-line sm:grid-cols-4">
            <Readout label="Speed" value={formatSpeed(snap.speedMs, settings.speedUnit)} unit={speedLabel(settings.speedUnit)} />
            <Readout label="Reference here" value={snap.delta?.reliable ? formatLapTime(snap.delta.referenceElapsedMs) : '—'} />
            <Readout label="Projected · est." value={snap.delta?.reliable ? formatLapTime(snap.delta.projectedLapMs) : '—'} />
            <Readout
              label="Distance"
              value={snap.lapDistanceM !== null ? `${formatDistance(snap.lapDistanceM, settings.distanceUnit, 2).split(' ')[0]}` : '—'}
              unit={`/ ${formatDistance(snap.lapLengthM, settings.distanceUnit, 2)}`}
            />
          </div>

          <div className="mx-auto grid w-full max-w-3xl grid-cols-2 gap-4 text-center">
            <div>
              <div className="label">Last lap</div>
              <div className="font-mono text-2xl tabular">{formatLapTime(snap.lastLap?.timeMs)}</div>
            </div>
            <div>
              <div className="label">Session best</div>
              <div className="font-mono text-2xl tabular">{formatLapTime(snap.bestLap?.timeMs)}</div>
            </div>
          </div>
          {live.reference && <div className="text-center text-xs text-muted">Reference: {live.reference.label}</div>}
        </div>

        {showMap && <LiveMap circuit={live.circuit} />}
      </div>

      <div className="sticky bottom-0 z-10 grid grid-cols-[auto_1fr_1fr] gap-3 border-t border-line bg-panel p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <Button size="xl" variant="ghost" onClick={() => setShowMap((v) => !v)} aria-pressed={showMap}>
          Map
        </Button>
        {live.status === 'paused' ? (
          <Button size="xl" onClick={() => liveController.resume()}>
            <IconPlay /> Resume
          </Button>
        ) : (
          <Button size="xl" onClick={() => liveController.pause()} disabled={live.status !== 'running'} title="Pausing discards the lap in progress">
            <IconPause /> Pause
          </Button>
        )}
        <ConfirmButton size="xl" variant="primary" onConfirm={stop} disabled={stopping} confirmLabel="Tap again to stop & save">
          <IconStop /> {stopping ? 'Saving…' : 'Stop'}
        </ConfirmButton>
      </div>
    </div>
  );
}

function Readout({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="bg-panel px-3 py-3 text-center">
      <div className="label">{label}</div>
      <div className="mt-1 font-mono text-2xl font-semibold tabular">
        {value}
        {unit && <span className="ml-1 text-xs font-normal text-muted">{unit}</span>}
      </div>
    </div>
  );
}

function LiveMap({ circuit }: { circuit: Circuit }) {
  const live = useLive();
  const pos = live.snapshot?.position;
  const bounds = useMemo(() => L.latLngBounds(circuit.geometry.map(([lon, lat]) => [lat, lon] as [number, number])), [circuit]);
  const [follow, setFollow] = useState(false);
  return (
    <div className="relative h-72 overflow-hidden rounded border border-line lg:h-auto">
      <BaseMap>
        <RouteLayer geometry={circuit.geometry} closed={circuit.kind === 'closed'} weight={4} arrows={false} />
        <TimingLineView line={circuit.startLine} kind="start" label="Start / finish" />
        {circuit.finishLine && <TimingLineView line={circuit.finishLine} kind="finish" label="Finish" />}
        {live.trail.length > 1 && <Polyline positions={live.trail.map((p) => [p.lat, p.lon] as [number, number])} pathOptions={{ color: '#f4f4f5', weight: 2, opacity: 0.6 }} />}
        {pos && <CircleMarker center={[pos.lat, pos.lon]} radius={8} pathOptions={{ color: '#fff', weight: 3, fillColor: '#e10600', fillOpacity: 1 }} />}
        <FitBounds bounds={bounds} fitKey={circuit.id} />
        <FollowPosition position={pos ? [pos.lat, pos.lon] : null} enabled={follow} />
      </BaseMap>
      <button type="button" className="absolute left-2 top-2 z-[1000] rounded border border-line bg-panel px-2 py-1 text-xs" onClick={() => setFollow((f) => !f)} aria-pressed={follow}>
        {follow ? 'Following' : 'Follow'}
      </button>
    </div>
  );
}
