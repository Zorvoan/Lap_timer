import { useEffect, useMemo, useRef, useState } from 'react';
import { CircleMarker, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';
import {
  TrackModel,
  compareLaps,
  convertSpeed,
  formatDelta,
  formatLapTime,
  gainLoss,
  lapDistanceToPosition,
  traceGaps,
  lineAlong,
  positionAtTime,
  speedLabel,
  type AlignedRow,
  type Circuit,
  type DistanceUnit,
  type LapRecord,
  type SpeedUnit,
} from '@laptimer/core';
import { Badge, Button, Panel, Stat } from '../ui/primitives';
import { IconPause, IconPlay } from '../ui/icons';
import { BaseMap, FitBounds } from '../map/BaseMap';
import { RouteLayer } from '../map/RouteLayer';
import { TimingLineView } from '../map/TimingLines';
import { COLOR_A, COLOR_B, COLOR_GAIN, COLOR_LOSS, DeltaDistanceChart, SpeedDistanceChart, SpeedTimeChart } from '../charts/Charts';
import { lapLength } from '../../lib/references';

export const FLAG_TEXT: Record<string, string> = {
  poor_gps: 'Some fixes had poor accuracy',
  signal_gap: 'GPS fixes missing for several seconds',
  tracking_lost: 'Position could not be matched to the circuit at times',
  distance_mismatch: 'Lap distance does not match the circuit: a line crossing was probably missed',
  crossing_interpolated_over_gap: 'Line crossing interpolated across a GPS gap',
  simulated: 'Simulated',
};

/** Distance from start to finish line; falls back to the laps' own traces when the circuit is gone. */
export function useLapLength(circuit: Circuit | null, laps: readonly LapRecord[]): number {
  return useMemo(() => {
    if (circuit) {
      try {
        return lapLength(circuit);
      } catch {
        /* fall through */
      }
    }
    return laps[0]?.trace.at(-1)?.d ?? 0;
  }, [circuit, laps]);
}

/** Lap A against lap B aligned by distance along the circuit (B defaults to A itself). */
export function useComparisonRows(A: LapRecord | null, B: LapRecord | null, lengthM: number): AlignedRow[] {
  return useMemo(() => {
    if (!A || lengthM <= 0) return [];
    try {
      return compareLaps(A, B ?? A, lengthM, Math.max(2, lengthM / 600));
    } catch {
      return [];
    }
  }, [A, B, lengthM]);
}

export function GpsQuality({ lap }: { lap: LapRecord }) {
  const acc = lap.gps.meanAccuracyM;
  const tone = lap.flags.includes('distance_mismatch') ? 'loss' : lap.flags.length ? 'warn' : 'neutral';
  const title = [
    `Mean accuracy ${Number.isFinite(acc) ? `${acc.toFixed(1)} m` : 'n/a'}`,
    `${lap.gps.meanRateHz.toFixed(1)} Hz`,
    `max gap ${(lap.gps.maxGapMs / 1000).toFixed(1)} s`,
    ...lap.flags.map((f) => FLAG_TEXT[f] ?? f),
  ].join('\n');
  return (
    <span title={title} className="inline-flex items-center gap-1.5">
      <Badge tone={tone}>{Number.isFinite(acc) ? `±${acc.toFixed(0)} m` : 'n/a'}</Badge>
      {lap.flags.length > 0 && <span className="text-xs text-warn">{lap.flags.length} flag{lap.flags.length > 1 ? 's' : ''}</span>}
    </span>
  );
}

/** A/B picker buttons for a lap row. */
export function ABButtons({ isA, isB, onA, onB }: { isA: boolean; isB: boolean; onA: () => void; onB: () => void }) {
  return (
    <div className="flex gap-1">
      <button type="button" aria-pressed={isA} onClick={onA} title="Set as lap A" className={`h-7 w-7 rounded-sm border text-xs font-bold ${isA ? 'border-accent bg-accent text-white' : 'border-line text-muted'}`}>
        A
      </button>
      <button type="button" aria-pressed={isB} onClick={onB} title="Set as lap B" className={`h-7 w-7 rounded-sm border text-xs font-bold ${isB ? 'border-fg bg-fg text-bg' : 'border-line text-muted'}`}>
        B
      </button>
    </div>
  );
}

function Unavailable() {
  return <p className="text-sm text-muted">No data available.</p>;
}

/** Delta, speed-vs-distance and speed-vs-time charts for laps A and B. */
export function ComparisonCharts({
  A,
  B,
  labelA,
  labelB,
  rows,
  speedUnit,
  distanceUnit,
}: {
  A: LapRecord | null;
  B: LapRecord | null;
  labelA: string;
  labelB: string | null;
  rows: AlignedRow[];
  speedUnit: SpeedUnit;
  distanceUnit: DistanceUnit;
}) {
  // Stretches either lap drove without a GPS fix: the charts can't know what happened there.
  const gaps = useMemo(() => [A, B].flatMap((l) => (l ? traceGaps(l.trace).map((g) => ({ from: g.fromD, to: g.toD })) : [])), [A, B]);
  return (
    <>
      <Panel
        title={
          <span>
            Delta by distance · <span style={{ color: COLOR_A }}>A {labelA}</span> vs <span style={{ color: COLOR_B }}>B {B ? labelB : '—'}</span>
          </span>
        }
      >
        <div className="h-56">
          {A && B ? (
            <DeltaDistanceChart rows={rows} distanceUnit={distanceUnit} gaps={gaps} />
          ) : (
            <p className="text-sm text-muted">Select a lap B to see where lap A gained (green, below zero) or lost (red) time. Laps are aligned by distance along the circuit.</p>
          )}
        </div>
      </Panel>
      <Panel title={`Speed vs distance (${speedLabel(speedUnit)})`}>
        <div className="h-56">
          {A && rows.length ? <SpeedDistanceChart rows={rows} speedUnit={speedUnit} distanceUnit={distanceUnit} labelA={labelA} labelB={B ? labelB : null} gaps={gaps} /> : <Unavailable />}
        </div>
      </Panel>
      <Panel title={`Speed vs time (${speedLabel(speedUnit)})`}>
        <div className="h-56">{A ? <SpeedTimeChart laps={B ? [A, B] : [A]} speedUnit={speedUnit} colors={[COLOR_A, COLOR_B]} /> : <Unavailable />}</div>
      </Panel>
    </>
  );
}

/** Map coloured by where A gained/lost against B, with a replay of both laps. */
export function ReplayPanel({
  circuit,
  lapA,
  lapB,
  labelA,
  labelB,
  rows,
  lengthM,
  speedUnit,
}: {
  circuit: Circuit | null;
  lapA: LapRecord;
  lapB: LapRecord | null;
  labelA: string;
  labelB: string | null;
  rows: AlignedRow[];
  lengthM: number;
  speedUnit: SpeedUnit;
}) {
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(4);
  // The map follows car A, zoomed in, until the user pans it or asks for the whole track.
  const [follow, setFollow] = useState(true);
  const [fitCount, setFitCount] = useState(0);
  const raf = useRef(0);

  useEffect(() => {
    setT(0);
    setPlaying(false);
  }, [lapA, lapB]);

  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = (now - last) * rate;
      last = now;
      setT((cur) => {
        const next = cur + dt;
        if (next >= lapA.timeMs) {
          setPlaying(false);
          return lapA.timeMs;
        }
        return next;
      });
      raf.current = requestAnimationFrame(loop);
    };
    raf.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf.current);
  }, [playing, rate, lapA.timeMs]);

  // Cars are drawn on the road at their distance along the circuit, not at the raw GPS fix.
  const onTrack = useMemo(() => (circuit ? lapDistanceToPosition(circuit) : null), [circuit]);
  const place = (p: ReturnType<typeof positionAtTime>) => (p && onTrack ? { ...p, ...onTrack(p.d) } : p);
  const posA = place(positionAtTime(lapA.trace, t));
  const posB = lapB ? place(positionAtTime(lapB.trace, t)) : null;
  const deltaHere = posA && rows.length && lapB ? rows[Math.min(rows.length - 1, Math.round((posA.d / lengthM) * (rows.length - 1)))]?.deltaMs : null;

  const segments = useMemo(() => {
    if (!circuit || !lapB || !rows.length) return [];
    let track: TrackModel;
    try {
      track = TrackModel.fromCoordinates(circuit.geometry, circuit.kind === 'closed');
    } catch {
      return [];
    }
    const s0 = lineAlong(track, circuit.startLine) ?? 0;
    const segs = gainLoss(rows, Math.max(25, lengthM / 60));
    const maxAbs = Math.max(1, ...segs.map((s) => Math.abs(s.changeMs)));
    return segs.map((s) => {
      const pts: [number, number][] = [];
      const step = Math.max(2, (s.toD - s.fromD) / 12);
      for (let d = s.fromD; d <= s.toD + 1e-6; d += step) {
        const p = track.latLonAt(s0 + d);
        pts.push([p.lat, p.lon]);
      }
      return { pts, gained: s.changeMs < 0, weight: 3 + 6 * (Math.abs(s.changeMs) / maxAbs) };
    });
  }, [circuit, lapB, rows, lengthM]);

  const bounds = useMemo(() => {
    const pts = circuit ? circuit.geometry.map(([lon, lat]) => [lat, lon] as [number, number]) : lapA.trace.map((p) => [p.lat, p.lon] as [number, number]);
    return pts.length > 1 ? L.latLngBounds(pts) : null;
  }, [circuit, lapA]);

  return (
    <Panel title={lapB ? `Map · ${labelA} vs ${labelB}: green = A gained, red = A lost` : `Map replay · ${labelA}`} bodyClass="p-0">
      <div className="grid lg:grid-cols-[1fr_18rem]">
        <div className="h-[420px]">
          <BaseMap scrollWheelZoom={false} zoomSnap={0.1}>
            {circuit && !segments.length && <RouteLayer geometry={circuit.geometry} closed={circuit.kind === 'closed'} weight={4} opacity={0.6} />}
            {segments.map((s, i) => (
              <Polyline key={i} positions={s.pts} pathOptions={{ color: s.gained ? COLOR_GAIN : COLOR_LOSS, weight: s.weight, opacity: 0.9 }} />
            ))}
            {!circuit && lapA.trace.length > 1 && <Polyline positions={lapA.trace.map((p) => [p.lat, p.lon] as [number, number])} pathOptions={{ color: COLOR_A, weight: 3 }} />}
            {circuit && <TimingLineView line={circuit.startLine} kind="start" label={circuit.kind === 'closed' ? 'Start / finish' : 'Start'} />}
            {circuit?.finishLine && <TimingLineView line={circuit.finishLine} kind="finish" label="Finish" />}
            {posB && <CircleMarker center={[posB.lat, posB.lon]} radius={7} pathOptions={{ color: '#000', weight: 2, fillColor: COLOR_B, fillOpacity: 1 }} />}
            {posA && <CircleMarker center={[posA.lat, posA.lon]} radius={8} pathOptions={{ color: '#fff', weight: 2, fillColor: COLOR_A, fillOpacity: 1 }} />}
            {follow ? (
              <FollowCar position={posA} onUserMove={() => setFollow(false)} />
            ) : (
              <FitBounds bounds={bounds} fitKey={`${circuit?.id ?? labelA}:${fitCount}`} padding={24} />
            )}
          </BaseMap>
        </div>
        <div className="space-y-4 border-t border-line p-4 lg:border-l lg:border-t-0">
          <div className="flex items-center gap-2">
            <Button variant="primary" onClick={() => (t >= lapA.timeMs && setT(0), setPlaying((p) => !p))} aria-label={playing ? 'Pause replay' : 'Play replay'}>
              {playing ? <IconPause width={18} height={18} /> : <IconPlay width={18} height={18} />}
            </Button>
            <select aria-label="Replay speed" value={rate} onChange={(e) => setRate(Number(e.target.value))} className="h-10 rounded border border-line bg-raised px-2 text-sm">
              {[1, 2, 4, 8, 16].map((r) => (
                <option key={r} value={r}>
                  {r}×
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-1 rounded border border-line bg-raised p-1 text-sm" role="group" aria-label="Map view">
            <button
              type="button"
              aria-pressed={follow}
              onClick={() => setFollow(true)}
              className={`h-9 rounded font-semibold ${follow ? 'bg-panel text-fg shadow' : 'text-muted hover:text-fg'}`}
            >
              Follow A
            </button>
            <button
              type="button"
              aria-pressed={!follow}
              onClick={() => (setFollow(false), setFitCount((n) => n + 1))}
              className={`h-9 rounded font-semibold ${!follow ? 'bg-panel text-fg shadow' : 'text-muted hover:text-fg'}`}
            >
              Whole track
            </button>
          </div>
          <input
            type="range"
            aria-label="Replay position"
            min={0}
            max={lapA.timeMs}
            step={50}
            value={t}
            onChange={(e) => (setPlaying(false), setT(Number(e.target.value)))}
            className="w-full accent-[rgb(var(--c-accent))]"
          />
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Elapsed" value={formatLapTime(t)} />
            <Stat label="Distance" value={posA ? `${Math.round(posA.d)}` : '—'} unit="m" />
            <Stat label="Speed A" value={posA?.v != null ? convertSpeed(posA.v, speedUnit).toFixed(0) : '—'} unit={speedLabel(speedUnit)} />
            <Stat label="Δ A vs B here" value={deltaHere != null ? formatDelta(deltaHere) : '—'} unit={deltaHere != null ? 's' : undefined} />
          </div>
          <p className="text-xs text-muted">
            <span style={{ color: COLOR_A }}>●</span> A: {labelA}
            {lapB && (
              <>
                <br />
                <span style={{ color: COLOR_B }}>●</span> B: {labelB} (at the same elapsed time)
              </>
            )}
          </p>
        </div>
      </div>
    </Panel>
  );
}

/** Zoom the replay map uses while following a car: a few hundred metres of road around it. */
const FOLLOW_ZOOM = 16;

/**
 * Keeps the map centred on a moving car. It zooms in once when following starts; the user may
 * still zoom with the buttons. Dragging the map hands control back to the user.
 */
function FollowCar({ position, onUserMove }: { position: { lat: number; lon: number } | null; onUserMove: () => void }) {
  const map = useMap();
  const zoomed = useRef(false);
  const onMove = useRef(onUserMove);
  onMove.current = onUserMove;
  useEffect(() => {
    if (!position) return;
    if (!zoomed.current) {
      map.setView([position.lat, position.lon], Math.max(map.getZoom(), FOLLOW_ZOOM), { animate: false });
      zoomed.current = true;
    } else {
      map.panTo([position.lat, position.lon], { animate: false });
    }
  }, [map, position?.lat, position?.lon]);
  useEffect(() => {
    const h = () => onMove.current();
    map.on('dragstart', h);
    return () => {
      map.off('dragstart', h);
    };
  }, [map]);
  return null;
}
