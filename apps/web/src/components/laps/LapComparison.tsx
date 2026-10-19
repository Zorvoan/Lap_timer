import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { CircleMarker, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';
import {
  TrackModel,
  compareLaps,
  convertDistance,
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
import { BaseMap, FitBounds, PrefetchRoute } from '../map/BaseMap';
import { RouteLayer } from '../map/RouteLayer';
import { TimingLineView } from '../map/TimingLines';
import { COLOR_A, COLOR_B, COLOR_GAIN, COLOR_LOSS, DeltaDistanceChart, SpeedDistanceChart } from '../charts/Charts';
import { RadarChart, type RadarMetric } from '../charts/RadarChart';
import { BarChart, type Bar } from '../charts/BarChart';
import { drivingStyle, type DrivingStyle } from '../../lib/drivingStyle';
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

/**
 * The distance a finger is on in the comparison charts. The replay map below reads it and moves
 * the cars there, so sliding along a chart shows where on the road that is.
 */
let chartDistance: number | null = null;
const chartListeners = new Set<() => void>();
function setChartDistance(d: number | null) {
  if (d === chartDistance) return;
  chartDistance = d;
  chartListeners.forEach((l) => l());
}
function subscribeChartDistance(l: () => void) {
  chartListeners.add(l);
  return () => void chartListeners.delete(l);
}

/** When the lap reached distance d (ms), interpolated between trace points. */
function timeAtDistance(trace: LapRecord['trace'], d: number): number | null {
  if (!trace.length) return null;
  if (d <= trace[0].d) return trace[0].t;
  for (let i = 1; i < trace.length; i++) {
    const b = trace[i];
    if (b.d >= d) {
      const a = trace[i - 1];
      return a.t + (b.d > a.d ? (d - a.d) / (b.d - a.d) : 0) * (b.t - a.t);
    }
  }
  return trace[trace.length - 1].t;
}

function Unavailable() {
  return <p className="text-sm text-muted">No data available.</p>;
}

/** Delta, time by part, driving style and speed-vs-distance charts for laps A and B. */
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
            <DeltaDistanceChart rows={rows} distanceUnit={distanceUnit} gaps={gaps} onHover={setChartDistance} />
          ) : (
            <p className="text-sm text-muted">Select a lap B to see where lap A gained (green, below zero) or lost (red) time. Laps are aligned by distance along the circuit.</p>
          )}
        </div>
      </Panel>
      {A && B && rows.length > 1 && <PartsPanel rows={rows} distanceUnit={distanceUnit} />}
      {A && B && <StylePanel A={A} B={B} labelA={labelA} labelB={labelB ?? 'B'} speedUnit={speedUnit} />}
      <Panel title={`Speed vs distance (${speedLabel(speedUnit)})`}>
        <div className="h-56">
          {A && rows.length ? <SpeedDistanceChart rows={rows} speedUnit={speedUnit} distanceUnit={distanceUnit} labelA={labelA} labelB={B ? labelB : null} gaps={gaps} onHover={setChartDistance} /> : <Unavailable />}
        </div>
      </Panel>
    </>
  );
}

/**
 * The road cut into equal parts (about 750 m each, 4 to 10 of them) and how much time A gained
 * (green, down) or lost (red, up) against B in each. Picking a part moves the map to it.
 */
function PartsPanel({ rows, distanceUnit }: { rows: AlignedRow[]; distanceUnit: DistanceUnit }) {
  const bars = useMemo<(Bar & { mid: number })[]>(() => {
    const len = rows[rows.length - 1].d;
    const n = Math.max(4, Math.min(10, Math.round(len / 750)));
    const rowAt = (d: number) => rows.find((r) => r.d >= d - 1e-6) ?? rows[rows.length - 1];
    const dist = (m: number) => convertDistance(m, distanceUnit).toFixed(distanceUnit === 'km' ? 1 : 2);
    return Array.from({ length: n }, (_, k) => {
      const from = rowAt((len * k) / n);
      const to = rowAt((len * (k + 1)) / n);
      const a = to.tA - from.tA;
      const b = to.tB - from.tB;
      const delta = a - b;
      return {
        id: String(k),
        label: String(k + 1),
        value: delta / 1000,
        color: delta > 0 ? COLOR_LOSS : COLOR_GAIN,
        valueLabel: formatDelta(delta, 1),
        detail: (
          <span className="flex flex-wrap items-center justify-center gap-x-3 gap-y-0.5 whitespace-nowrap">
            <span className="font-medium">
              Part {k + 1} <span className="text-muted">· {dist(from.d)}–{dist(to.d)} {distanceUnit}</span>
            </span>
            <span className="font-mono tabular" style={{ color: COLOR_A }}>{(a / 1000).toFixed(2)}</span>
            <span className="font-mono tabular" style={{ color: COLOR_B }}>{(b / 1000).toFixed(2)}</span>
            <span className={`font-mono font-semibold tabular ${delta > 0 ? 'text-loss' : 'text-gain'}`}>{formatDelta(delta, 2)}</span>
          </span>
        ),
        mid: (from.d + to.d) / 2,
      };
    });
  }, [rows, distanceUnit]);
  return (
    <Panel title="Time by part of the road · A vs B">
      <div className="h-56">
        <BarChart
          bars={bars}
          ariaLabel="Time A gained or lost against B in each part of the road"
          hint="Tap a part · up = A lost time, down = A gained"
          onFocus={(i) => i !== null && setChartDistance(bars[i].mid)}
        />
      </div>
    </Panel>
  );
}

const STYLE_METRICS: (RadarMetric & { key: keyof Omit<DrivingStyle, 'corners'> })[] = [
  { key: 'topSpeed', label: 'Top speed' },
  { key: 'cornerSpeed', label: 'Corner speed', short: 'Corners' },
  { key: 'accel', label: 'Acceleration', short: 'Accel' },
  { key: 'braking', label: 'Braking' },
  { key: 'avgSpeed', label: 'Average' },
];

/**
 * How A and B were driven, side by side: top speed, the slowest speeds through the corners,
 * how hard they accelerated and braked, average speed. Further out is better on every axis;
 * each axis is scaled to the two laps so the difference shows.
 */
function StylePanel({ A, B, labelA, labelB, speedUnit }: { A: LapRecord; B: LapRecord; labelA: string; labelB: string; speedUnit: SpeedUnit }) {
  const styles = useMemo(() => [drivingStyle(A), drivingStyle(B)] as const, [A, B]);
  const [sa, sb] = styles;
  if (!sa || !sb) return null;
  const unit = speedLabel(speedUnit);
  const show = (k: keyof DrivingStyle, v: number) => (k === 'accel' || k === 'braking' ? `${(v / 9.81).toFixed(2)} g` : `${convertSpeed(v, speedUnit).toFixed(0)} ${unit}`);
  const score = (k: keyof DrivingStyle, v: number) => {
    const lo = Math.min(sa[k], sb[k]) * 0.7;
    const hi = Math.max(sa[k], sb[k]) * 1.05;
    return hi > lo ? 20 + (80 * (v - lo)) / (hi - lo) : 80;
  };
  const series = [
    { id: 'a', label: 'A', color: COLOR_A, s: sa },
    { id: 'b', label: 'B', color: COLOR_B, s: sb },
  ].map(({ id, label, color, s }) => ({
    id,
    label,
    color,
    scores: Object.fromEntries(STYLE_METRICS.map((m) => [m.key, score(m.key, s[m.key])])),
    display: Object.fromEntries(STYLE_METRICS.map((m) => [m.key, show(m.key, s[m.key])])),
  }));
  return (
    <Panel
      title={
        <span>
          Driving style · <span style={{ color: COLOR_A }}>A {labelA}</span> vs <span style={{ color: COLOR_B }}>B {labelB}</span>
        </span>
      }
    >
      <div className="grid items-center gap-4 md:grid-cols-[1fr_16rem]">
        <div className="mx-auto aspect-square w-full max-w-[22rem]">
          <RadarChart metrics={STYLE_METRICS} series={series} ariaLabel="Driving style of lap A and lap B" />
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left">
              <th className="label py-1.5 font-semibold" />
              <th className="label py-1.5 text-right font-semibold" style={{ color: COLOR_A }}>
                A
              </th>
              <th className="label py-1.5 text-right font-semibold" style={{ color: COLOR_B }}>
                B
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line border-t border-line">
            {STYLE_METRICS.map((m) => {
              const better = sa[m.key] > sb[m.key] ? 'a' : sa[m.key] < sb[m.key] ? 'b' : null;
              return (
                <tr key={m.key}>
                  <td className="py-2 text-muted">{m.label}</td>
                  <td className={`py-2 text-right font-mono tabular ${better === 'a' ? 'font-bold text-gain' : ''}`}>{show(m.key, sa[m.key])}</td>
                  <td className={`py-2 text-right font-mono tabular ${better === 'b' ? 'font-bold text-gain' : ''}`}>{show(m.key, sb[m.key])}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-muted">
        Corner speed is the average of the slowest points through the corners ({sa.corners} found on A, {sb.corners} on B). Acceleration and braking are averages while speeding up and slowing
        down, in g. Further out is better; each axis is scaled to these two laps.
      </p>
    </Panel>
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
  chooseFollow = false,
}: {
  circuit: Circuit | null;
  lapA: LapRecord;
  lapB: LapRecord | null;
  labelA: string;
  labelB: string | null;
  rows: AlignedRow[];
  lengthM: number;
  speedUnit: SpeedUnit;
  /** Offer a Follow A / Follow B switch (racing someone else); otherwise the map follows A. */
  chooseFollow?: boolean;
}) {
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(4);
  // The map follows one car, zoomed in: A, or B when the user picks it.
  const [followB, setFollowB] = useState(false);
  const raf = useRef(0);
  // The replay runs until the slower of the two has finished.
  const endMs = Math.max(lapA.timeMs, lapB?.timeMs ?? 0);

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
        if (next >= endMs) {
          setPlaying(false);
          return endMs;
        }
        return next;
      });
      raf.current = requestAnimationFrame(loop);
    };
    raf.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf.current);
  }, [playing, rate, endMs]);

  // Cars are drawn on the road at their distance along the circuit, not at the raw GPS fix.
  const onTrack = useMemo(() => (circuit ? lapDistanceToPosition(circuit) : null), [circuit]);
  const place = (p: ReturnType<typeof positionAtTime>) => (p && onTrack ? { ...p, ...onTrack(p.d) } : p);
  const posA = place(positionAtTime(lapA.trace, t));
  const posB = lapB ? place(positionAtTime(lapB.trace, t)) : null;
  // Following B, the numbers are B's: its distance, its speed, its gap to A where it is.
  const onB = !!(chooseFollow && followB && posB);
  const followed = onB ? posB : posA;
  const deltaAt = (d: number) => (rows.length && lapB ? rows[Math.min(rows.length - 1, Math.max(0, Math.round((d / lengthM) * (rows.length - 1))))]?.deltaMs ?? null : null);
  const deltaA = posA ? deltaAt(posA.d) : null;
  const deltaB = posB ? deltaAt(posB.d) : null;
  const deltaHere = onB ? (deltaB === null ? null : -deltaB) : deltaA;

  // Sliding along a chart above puts the followed car at that distance (the other one where it
  // was at the same moment).
  const scrubD = useSyncExternalStore(subscribeChartDistance, () => chartDistance);
  const scrubTo = useRef((_d: number) => {});
  scrubTo.current = (d) => {
    // The charts' rows hold each lap's time at exactly the distances they plot.
    const row = rows.length && lengthM > 0 ? rows[Math.min(rows.length - 1, Math.max(0, Math.round((d / lengthM) * (rows.length - 1))))] : null;
    const at = row ? (onB ? row.tB : row.tA) : timeAtDistance(onB && lapB ? lapB.trace : lapA.trace, d);
    if (at === null) return;
    setPlaying(false);
    setT(Math.min(endMs, Math.max(0, at)));
  };
  useEffect(() => {
    if (scrubD !== null) scrubTo.current(scrubD);
  }, [scrubD]);

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

  const route = useMemo(
    () => (circuit ? circuit.geometry.map(([lon, lat]) => [lat, lon] as [number, number]) : lapA.trace.map((p) => [p.lat, p.lon] as [number, number])),
    [circuit, lapA],
  );
  const bounds = useMemo(() => (route.length > 1 ? L.latLngBounds(route) : null), [route]);
  // Once a replay starts, load the road ahead at the follow zoom so the map keeps up with the car.
  const [warm, setWarm] = useState(false);
  useEffect(() => {
    if (playing) setWarm(true);
  }, [playing]);

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
            {/* The followed car wears the white ring (and is drawn on top); the other one a dark edge. */}
            {onB ? (
              <>
                {posA && <Car pos={posA} color={COLOR_A} />}
                {posB && <Car pos={posB} color={COLOR_B} followed />}
              </>
            ) : (
              <>
                {posB && <Car pos={posB} color={COLOR_B} />}
                {posA && <Car pos={posA} color={COLOR_A} followed />}
              </>
            )}
            {followed ? <FollowCar position={followed} /> : <FitBounds bounds={bounds} fitKey={circuit?.id ?? labelA} padding={24} />}
            <PrefetchRoute points={route} zooms={FOLLOW_ZOOMS} active={warm} />
          </BaseMap>
        </div>
        <div className="space-y-4 border-t border-line p-4 lg:border-l lg:border-t-0">
          <div className="flex items-center gap-2">
            <Button variant="primary" onClick={() => (t >= endMs && setT(0), setPlaying((p) => !p))} aria-label={playing ? 'Pause replay' : 'Play replay'}>
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
          {chooseFollow && lapB && (
            <div className="grid grid-cols-2 gap-1 rounded border border-line bg-raised p-1 text-sm" role="group" aria-label="Map follows">
              {([false, true] as const).map((b) => (
                <button
                  key={String(b)}
                  type="button"
                  aria-pressed={followB === b}
                  onClick={() => setFollowB(b)}
                  className={`flex h-9 items-center justify-center gap-1.5 rounded font-semibold ${followB === b ? 'bg-panel text-fg shadow' : 'text-muted hover:text-fg'}`}
                >
                  <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: b ? COLOR_B : COLOR_A }} aria-hidden="true" />
                  Follow {b ? 'B' : 'A'}
                </button>
              ))}
            </div>
          )}
          <input
            type="range"
            aria-label="Replay position"
            min={0}
            max={endMs}
            step={50}
            value={t}
            onChange={(e) => (setPlaying(false), setT(Number(e.target.value)))}
            className="w-full accent-[rgb(var(--c-accent))]"
          />
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Elapsed" value={formatLapTime(t)} />
            <Stat label={`Distance ${onB ? 'B' : 'A'}`} value={followed ? `${Math.round(followed.d)}` : '—'} unit="m" />
            <Stat label={`Speed ${onB ? 'B' : 'A'}`} value={followed?.v != null ? convertSpeed(followed.v, speedUnit).toFixed(0) : '—'} unit={speedLabel(speedUnit)} />
            <Stat label={onB ? 'Δ B vs A here' : 'Δ A vs B here'} value={deltaHere != null ? formatDelta(deltaHere) : '—'} unit={deltaHere != null ? 's' : undefined} />
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

/** A car on the replay map; the one the map follows gets a white ring and a soft halo. */
function Car({ pos, color, followed = false }: { pos: { lat: number; lon: number }; color: string; followed?: boolean }) {
  const at: [number, number] = [pos.lat, pos.lon];
  return (
    <>
      {followed && <CircleMarker center={at} radius={15} interactive={false} pathOptions={{ color: '#fff', weight: 1.5, opacity: 0.55, fillColor: '#fff', fillOpacity: 0.12 }} />}
      <CircleMarker center={at} radius={followed ? 8 : 6.5} interactive={false} pathOptions={{ color: followed ? '#fff' : '#000', weight: followed ? 2.5 : 2, fillColor: color, fillOpacity: 1 }} />
    </>
  );
}

/** Zoom the replay map uses while following a car: a few hundred metres of road around it. */
const FOLLOW_ZOOM = 16;
const FOLLOW_ZOOMS = [FOLLOW_ZOOM];

/**
 * Keeps the map centred on a moving car. It zooms in once; the user may still zoom with the
 * buttons, and may pan around while the replay is paused: the map picks the car up again as
 * soon as it moves.
 */
function FollowCar({ position }: { position: { lat: number; lon: number } }) {
  const map = useMap();
  const zoomed = useRef(false);
  useEffect(() => {
    if (!zoomed.current) {
      map.setView([position.lat, position.lon], Math.max(map.getZoom(), FOLLOW_ZOOM), { animate: false });
      zoomed.current = true;
    } else {
      map.panTo([position.lat, position.lon], { animate: false });
    }
  }, [map, position.lat, position.lon]);
  return null;
}
