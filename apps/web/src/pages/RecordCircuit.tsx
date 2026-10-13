import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CircleMarker, Polyline } from 'react-leaflet';
import L from 'leaflet';
import { cleanRecordedPath, distanceMeters, formatDistance, type GpsSample } from '@laptimer/core';
import { BaseMap, FitBounds, FollowPosition } from '../components/map/BaseMap';
import { RouteLayer } from '../components/map/RouteLayer';
import { Button, Field, Notice, Toggle } from '../components/ui/primitives';
import { IconRecord, IconStop } from '../components/ui/icons';
import { useSettings } from '../hooks/useSettings';
import { GeolocationSource } from '../lib/gps/geolocation';
import { assessGps } from '../lib/gps/capability';
import type { GpsError } from '../lib/gps/types';
import { ScreenWakeLock } from '../lib/wakeLock';
import type { RecordedDraft } from './CircuitEditor';

/** Records a drive with GPS and turns it into circuit geometry. Raw fixes stay in memory only. */
export function RecordCircuit() {
  const navigate = useNavigate();
  const { settings } = useSettings();
  const [phase, setPhase] = useState<'ready' | 'recording' | 'review'>('ready');
  const [samples, setSamples] = useState<GpsSample[]>([]);
  const [error, setError] = useState<GpsError | null>(null);
  const sourceRef = useRef<GeolocationSource | null>(null);
  const wake = useRef(new ScreenWakeLock());

  const [maxAcc, setMaxAcc] = useState(settings.gpsMaxAccuracyM);
  const [tolerance, setTolerance] = useState(1);
  const [smoothing, setSmoothing] = useState(3);
  const [extractLoop, setExtractLoop] = useState(true);
  const [trim, setTrim] = useState<[number, number]>([0, 0]);

  useEffect(() => () => sourceRef.current?.stop(), []);

  function start() {
    setSamples([]);
    setError(null);
    const src = new GeolocationSource();
    sourceRef.current = src;
    src.start(
      (s) => setSamples((prev) => [...prev, s]),
      (e) => setError(e),
    );
    if (settings.keepScreenOn) void wake.current.enable();
    setPhase('recording');
  }

  function stop() {
    sourceRef.current?.stop();
    void wake.current.disable();
    setTrim([0, samples.length]);
    setPhase('review');
  }

  const distance = useMemo(() => {
    let d = 0;
    for (let i = 1; i < samples.length; i++) d += distanceMeters(samples[i - 1], samples[i]);
    return d;
  }, [samples]);

  const cleaned = useMemo(() => {
    if (phase !== 'review' || samples.length < 2) return null;
    return cleanRecordedPath(samples, {
      maxAccuracyM: maxAcc,
      simplifyToleranceM: tolerance,
      smoothingWindow: smoothing,
      extractLoop,
      trimStart: trim[0],
      trimEnd: trim[1],
    });
  }, [phase, samples, maxAcc, tolerance, smoothing, extractLoop, trim]);

  const assessment = assessGps(samples);
  const last = samples[samples.length - 1];
  const raw = samples.map((s) => [s.lat, s.lon] as [number, number]);
  const bounds = raw.length > 1 ? L.latLngBounds(raw) : null;

  function proceed() {
    if (!cleaned) return;
    const draft: RecordedDraft = { geometry: cleaned.coords, closed: cleaned.loopClosed };
    navigate('/circuits/new', { state: { recorded: draft } });
  }

  return (
    <div className="flex h-full flex-col md:flex-row">
      <div className="relative min-h-[50vh] flex-1">
        <BaseMap zoom={16} center={last ? [last.lat, last.lon] : undefined}>
          {phase !== 'review' && raw.length > 1 && <Polyline positions={raw} pathOptions={{ color: '#e10600', weight: 4 }} />}
          {phase === 'review' && raw.length > 1 && <Polyline positions={raw} pathOptions={{ color: '#8a8e96', weight: 2, dashArray: '3 5' }} />}
          {phase === 'review' && cleaned && cleaned.coords.length > 1 && <RouteLayer geometry={cleaned.coords} closed={cleaned.loopClosed} />}
          {last && phase === 'recording' && <CircleMarker center={[last.lat, last.lon]} radius={7} pathOptions={{ color: '#fff', fillColor: '#e10600', fillOpacity: 1, weight: 2 }} />}
          <FollowPosition position={last && phase === 'recording' ? [last.lat, last.lon] : null} enabled={phase === 'recording'} />
          {phase === 'review' && <FitBounds bounds={bounds} fitKey="review" />}
        </BaseMap>
      </div>
      <aside className="max-h-[50vh] space-y-4 overflow-auto border-t border-line bg-panel p-4 md:max-h-none md:w-96 md:border-l md:border-t-0">
        <h1 className="label">Record circuit by driving</h1>
        {phase === 'ready' && (
          <>
            <p className="text-sm text-muted">
              Drive the route once (for a closed circuit, a little past the start). The recorded path follows exactly where you drove. Fixes stay on this device; only the
              cleaned geometry is saved.
            </p>
            <Notice tone="warn">Have a passenger operate the phone, or start recording before you set off.</Notice>
            <Button variant="primary" size="xl" className="w-full" onClick={start}>
              <IconRecord /> Start recording
            </Button>
          </>
        )}
        {phase === 'recording' && (
          <>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <div className="label">Points</div>
                <div className="font-mono text-xl tabular">{samples.length}</div>
              </div>
              <div>
                <div className="label">Distance</div>
                <div className="font-mono text-xl tabular">{formatDistance(distance, settings.distanceUnit)}</div>
              </div>
              <div>
                <div className="label">Accuracy</div>
                <div className="font-mono text-xl tabular">{last ? `${Math.round(last.accuracy)} m` : '—'}</div>
              </div>
            </div>
            {!samples.length && !error && <p className="text-sm text-muted">Waiting for the first GPS fix…</p>}
            {error && <Notice tone={error.fatal ? 'error' : 'warn'}>{error.message}</Notice>}
            {assessment.message && <Notice tone={assessment.level === 'unsuitable' ? 'error' : 'warn'}>{assessment.message}</Notice>}
            <Button variant="primary" size="xl" className="w-full" onClick={stop}>
              <IconStop /> Stop recording
            </Button>
          </>
        )}
        {phase === 'review' && (
          <>
            {samples.length < 2 ? (
              <Notice tone="error">Not enough GPS points were recorded.</Notice>
            ) : (
              <>
                <p className="text-sm text-muted">Clean up the recording. Grey dashes: raw fixes. Red: the geometry that will be saved.</p>
                <Field label={`Drop fixes worse than ${maxAcc} m`}>
                  <input type="range" min={5} max={60} value={maxAcc} onChange={(e) => setMaxAcc(Number(e.target.value))} className="w-full accent-[rgb(var(--c-accent))]" />
                </Field>
                <Field label={`Simplify: ${tolerance.toFixed(1)} m tolerance`}>
                  <input type="range" min={0} max={5} step={0.5} value={tolerance} onChange={(e) => setTolerance(Number(e.target.value))} className="w-full accent-[rgb(var(--c-accent))]" />
                </Field>
                <Field label={`Smoothing window: ${smoothing} point${smoothing === 1 ? '' : 's'}`}>
                  <input type="range" min={1} max={9} step={2} value={smoothing} onChange={(e) => setSmoothing(Number(e.target.value))} className="w-full accent-[rgb(var(--c-accent))]" />
                </Field>
                <Field label={`Trim: keep fixes ${trim[0] + 1}–${trim[1]}`}>
                  <div className="space-y-1">
                    <input aria-label="Trim start" type="range" min={0} max={Math.max(0, trim[1] - 2)} value={trim[0]} onChange={(e) => setTrim([Number(e.target.value), trim[1]])} className="w-full accent-[rgb(var(--c-accent))]" />
                    <input aria-label="Trim end" type="range" min={trim[0] + 2} max={samples.length} value={trim[1]} onChange={(e) => setTrim([trim[0], Number(e.target.value)])} className="w-full accent-[rgb(var(--c-accent))]" />
                  </div>
                </Field>
                <Toggle checked={extractLoop} onChange={setExtractLoop} label="Closed circuit" hint="Cut the path where it first returns to its start." />
                {cleaned && (
                  <div className="space-y-2 text-sm">
                    <div className="grid grid-cols-2 gap-2 text-muted">
                      <span>Points kept</span>
                      <span className="text-right font-mono text-fg">{cleaned.coords.length}</span>
                      <span>Dropped (accuracy)</span>
                      <span className="text-right font-mono text-fg">{cleaned.droppedAccuracy}</span>
                      <span>Dropped (jumps)</span>
                      <span className="text-right font-mono text-fg">{cleaned.droppedJumps}</span>
                    </div>
                    {extractLoop && !cleaned.loopClosed && <Notice tone="warn">The path never returns near its start, so it can't be closed. Save it as a sprint or trim it.</Notice>}
                    {cleaned.loopClosed && cleaned.closureGapM !== null && <p className="text-xs text-muted">Loop closes with a {cleaned.closureGapM.toFixed(1)} m gap.</p>}
                  </div>
                )}
                <div className="flex gap-2">
                  <Button onClick={() => setPhase('ready')}>Discard</Button>
                  <Button variant="primary" className="flex-1" onClick={proceed} disabled={!cleaned || cleaned.coords.length < 2}>
                    Continue: set start line
                  </Button>
                </div>
              </>
            )}
          </>
        )}
      </aside>
    </div>
  );
}
