import {
  convertDistance,
  convertSpeed,
  formatDelta,
  formatLapTime,
  speedLabel,
  traceGaps,
  TRACE_GAP_MS,
  type AlignedRow,
  type DistanceUnit,
  type ElevationPoint,
  type LapRecord,
  type SpeedUnit,
} from '@laptimer/core';
import { LineChart, type ChartMarker, type ChartPoint } from './LineChart';

export const COLOR_A = '#e10600';
export const COLOR_B = '#a1a5ad';
export const COLOR_GAIN = '#16c768';
export const COLOR_LOSS = '#ff4036';
const DIM = '#5b5f66';
const INVALID = '#3a3c40';

/** A stretch without GPS fixes, in the chart's x units. */
export interface ChartGap {
  from: number;
  to: number;
}

const noGps = (gaps: readonly ChartGap[]) => gaps.map((g) => ({ ...g, label: 'No GPS' }));
const distTick = (unit: DistanceUnit) => (m: number) => `${convertDistance(m, unit).toFixed(unit === 'km' ? 1 : 2)}`;
const distTitle = (unit: DistanceUnit, digits = 3) => (m: number) => `${convertDistance(m, unit).toFixed(digits)} ${unit}`;
/** "1:12.4" for an axis; the full time in tooltips. */
const shortTime = (s: number) => formatLapTime(s * 1000).replace(/^0(\d:)/, '$1').slice(0, -2);
const lapTime = (s: number) => formatLapTime(s * 1000);

export function LapTimesChart({
  laps,
  bestLap,
  onSelect,
  lapLabel = (n) => n,
}: {
  laps: LapRecord[];
  bestLap: number | null;
  onSelect?: (lap: number) => void;
  /** Display number for a session lap (e.g. the circuit-wide lap number). */
  lapLabel?: (lap: number) => number;
}) {
  const byX = new Map(laps.map((l) => [lapLabel(l.lap), l]));
  const points: ChartPoint[] = laps.map((l) => ({ x: lapLabel(l.lap), y: l.timeMs / 1000, id: String(l.lap) }));
  const best = laps.find((l) => l.lap === bestLap);
  const markers: ChartMarker[] = best ? [{ x: lapLabel(best.lap), label: '★', color: COLOR_A, title: 'Best lap' }] : [];
  return (
    <LineChart
      ariaLabel="Lap times"
      integerX
      yPad={0.3}
      series={[
        {
          id: 'time',
          label: 'Lap time',
          color: 'rgb(var(--c-fg))',
          width: 1.75,
          points,
          format: lapTime,
          dots: (p) => {
            const l = byX.get(p.x);
            return !l?.valid ? INVALID : l.lap === bestLap ? COLOR_A : COLOR_B;
          },
        },
      ]}
      markers={markers}
      xFormat={(x) => String(x)}
      yFormat={shortTime}
      tooltipTitle={(x) => `Lap ${x}${byX.get(x)?.valid === false ? ' (not counted)' : ''}`}
      onSelect={onSelect ? (p) => onSelect(Number(p.id)) : undefined}
    />
  );
}

export function SpeedDistanceChart({
  rows,
  speedUnit,
  distanceUnit,
  labelA,
  labelB,
  gaps = [],
}: {
  rows: AlignedRow[];
  speedUnit: SpeedUnit;
  distanceUnit: DistanceUnit;
  labelA: string;
  labelB: string | null;
  /** Distances without GPS fixes; the lines break there instead of bridging them. */
  gaps?: ChartGap[];
}) {
  const unit = speedLabel(speedUnit);
  const fmt = (v: number) => `${v.toFixed(1)} ${unit}`;
  const a = rows.map((r) => ({ x: r.d, y: r.vA === null ? null : convertSpeed(r.vA, speedUnit) }));
  const b = rows.map((r) => ({ x: r.d, y: r.vB === null ? null : convertSpeed(r.vB, speedUnit) }));
  return (
    <LineChart
      ariaLabel={`Speed by distance, ${unit}`}
      series={[
        { id: 'a', label: labelA, color: COLOR_A, points: a, format: fmt, area: labelB ? undefined : 'gradient' },
        ...(labelB ? [{ id: 'b', label: labelB, color: COLOR_B, points: b, width: 1.5, format: fmt }] : []),
      ]}
      bands={noGps(gaps)}
      xFormat={distTick(distanceUnit)}
      yFormat={(v) => String(Math.round(v))}
      tooltipTitle={distTitle(distanceUnit)}
    />
  );
}

export function SpeedTimeChart({ laps, speedUnit, colors }: { laps: LapRecord[]; speedUnit: SpeedUnit; colors: string[] }) {
  const unit = speedLabel(speedUnit);
  // A null point inside each signal gap breaks the line there rather than drawing a straight one across.
  const series = laps.map((l, i) => {
    const points: ChartPoint[] = [];
    for (const p of l.trace) {
      if (p.v === null) continue;
      const prev = points[points.length - 1];
      if (prev && p.t / 1000 - prev.x > TRACE_GAP_MS / 1000) points.push({ x: (prev.x + p.t / 1000) / 2, y: null });
      points.push({ x: p.t / 1000, y: convertSpeed(p.v, speedUnit) });
    }
    return { id: String(l.lap), label: `Lap ${l.lap}`, color: colors[i], points, width: 1.75, format: (v: number) => `${v.toFixed(1)} ${unit}` };
  });
  const gaps = laps.flatMap((l) => traceGaps(l.trace).map((g) => ({ from: g.fromT / 1000, to: g.toT / 1000 })));
  return (
    <LineChart
      ariaLabel={`Speed by time, ${unit}`}
      series={series}
      bands={noGps(gaps)}
      xFormat={(t) => `${Math.round(t)} s`}
      yFormat={(v) => String(Math.round(v))}
      tooltipTitle={(t) => `${t.toFixed(1)} s`}
    />
  );
}

/** Delta of lap A relative to lap B by distance. Below zero (green) = A ahead. */
export function DeltaDistanceChart({ rows, distanceUnit, gaps = [] }: { rows: AlignedRow[]; distanceUnit: DistanceUnit; gaps?: ChartGap[] }) {
  const points = rows.map((r) => ({ x: r.d, y: r.deltaMs / 1000 }));
  return (
    <LineChart
      ariaLabel="Gap of lap A to lap B by distance"
      zeroLine
      series={[{ id: 'delta', label: 'Gap', color: 'rgb(var(--c-fg))', width: 1.5, points, area: 'split', format: (v) => `${formatDelta(v * 1000)} s` }]}
      bands={noGps(gaps)}
      xFormat={distTick(distanceUnit)}
      yFormat={(v) => formatDelta(v * 1000, 1)}
      tooltipTitle={distTitle(distanceUnit)}
    />
  );
}

export function ElevationChart({ points, distanceUnit, compact = false }: { points: ElevationPoint[]; distanceUnit: DistanceUnit; compact?: boolean }) {
  return (
    <LineChart
      ariaLabel="Elevation along the road"
      compact={compact}
      yPad={0.15}
      series={[{ id: 'elev', label: 'Elevation', color: COLOR_B, width: 1.75, points: points.map((p) => ({ x: p.d, y: p.elevation })), area: 'gradient', format: (v) => `${v.toFixed(0)} m` }]}
      xFormat={distTick(distanceUnit)}
      yFormat={(v) => `${Math.round(v)} m`}
      tooltipTitle={distTitle(distanceUnit, 2)}
    />
  );
}

export interface HistoryPoint {
  id: string;
  /** Chronological index, 1-based. */
  n: number;
  timeMs: number;
  date: number;
  isBest: boolean;
  isA: boolean;
  isB: boolean;
}

/** Every lap on a circuit in the order it was driven, across sessions. */
export function LapHistoryChart({ points, onSelect }: { points: HistoryPoint[]; onSelect?: (key: string) => void }) {
  const byN = new Map(points.map((p) => [p.n, p]));
  const markers: ChartMarker[] = [];
  for (const p of points) {
    if (p.isA) markers.push({ x: p.n, label: 'A', color: COLOR_A, title: 'Lap A' });
    else if (p.isB) markers.push({ x: p.n, label: 'B', color: 'rgb(var(--c-fg))', title: 'Lap B' });
    else if (p.isBest) markers.push({ x: p.n, label: '★', color: COLOR_A, title: 'Best lap' });
  }
  return (
    <LineChart
      ariaLabel="Lap times in the order they were driven"
      integerX
      yPad={0.3}
      series={[
        {
          id: 'time',
          label: 'Lap time',
          color: COLOR_B,
          width: 1.5,
          points: points.map((p) => ({ x: p.n, y: p.timeMs / 1000, id: p.id })),
          format: lapTime,
          dots: (c) => {
            const p = byN.get(c.x);
            return p?.isA ? COLOR_A : p?.isB ? '#f4f4f5' : p?.isBest ? '#8a1410' : DIM;
          },
        },
      ]}
      markers={markers}
      xFormat={(x) => String(x)}
      yFormat={shortTime}
      tooltipTitle={(x) => {
        const p = byN.get(x);
        return p ? new Date(p.date).toLocaleString(undefined, { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' }) : `Lap ${x}`;
      }}
      onSelect={onSelect ? (p) => p.id && onSelect(p.id) : undefined}
    />
  );
}
