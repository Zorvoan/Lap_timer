import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  AreaChart,
  Cell,
} from 'recharts';
import {
  convertDistance,
  convertSpeed,
  formatDelta,
  formatLapTime,
  speedLabel,
  type AlignedRow,
  type DistanceUnit,
  type ElevationPoint,
  type LapRecord,
  type SpeedUnit,
} from '@laptimer/core';

export const COLOR_A = '#e10600';
export const COLOR_B = '#a1a5ad';
export const COLOR_GAIN = '#16c768';
export const COLOR_LOSS = '#ff4036';
const GRID = 'rgba(140,143,150,0.18)';
const AXIS = { fontSize: 11, fill: '#8a8e96' };
const tooltipStyle = {
  contentStyle: { background: '#050506', border: '1px solid #2a2c30', borderRadius: 4, fontSize: 12 },
  labelStyle: { color: '#8a8e96' },
};

function distTick(unit: DistanceUnit) {
  return (m: number) => convertDistance(m, unit).toFixed(unit === 'km' ? 1 : 2);
}

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
  const data = laps.map((l) => ({ lap: l.lap, label: lapLabel(l.lap), time: l.timeMs / 1000, valid: l.valid }));
  const valid = data.filter((d) => d.valid).map((d) => d.time);
  const min = valid.length ? Math.min(...valid) : 0;
  const max = valid.length ? Math.max(...valid) : 1;
  const pad = Math.max(0.5, (max - min) * 0.3);
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={false} />
        <YAxis domain={[Math.max(0, min - pad), max + pad]} tick={AXIS} tickLine={false} axisLine={false} width={56} tickFormatter={(v: number) => formatLapTime(v * 1000).replace(/^00:/, '').slice(0, -2)} />
        <Tooltip {...tooltipStyle} formatter={(v: number) => [formatLapTime(v * 1000), 'Lap time']} labelFormatter={(l) => `Lap ${l}`} />
        <Bar dataKey="time" maxBarSize={28} isAnimationActive={false} onClick={(d: { lap?: number }) => d.lap !== undefined && onSelect?.(d.lap)} cursor="pointer">
          {data.map((d) => (
            <Cell key={d.lap} fill={!d.valid ? '#3a3c40' : d.lap === bestLap ? COLOR_A : '#5b5f66'} />
          ))}
        </Bar>
        <Line dataKey="time" stroke="#f4f4f5" strokeWidth={1.5} dot={false} isAnimationActive={false} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export function SpeedDistanceChart({ rows, speedUnit, distanceUnit, labelA, labelB }: { rows: AlignedRow[]; speedUnit: SpeedUnit; distanceUnit: DistanceUnit; labelA: string; labelB: string | null }) {
  const data = rows.map((r) => ({ d: r.d, a: r.vA === null ? null : convertSpeed(r.vA, speedUnit), b: r.vB === null ? null : convertSpeed(r.vB, speedUnit) }));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid stroke={GRID} />
        <XAxis dataKey="d" type="number" domain={['dataMin', 'dataMax']} tick={AXIS} tickFormatter={distTick(distanceUnit)} unit={` ${distanceUnit}`} />
        <YAxis tick={AXIS} width={44} unit="" />
        <Tooltip
          {...tooltipStyle}
          labelFormatter={(d: number) => `${convertDistance(d, distanceUnit).toFixed(3)} ${distanceUnit}`}
          formatter={(v: number, name: string) => [`${v.toFixed(1)} ${speedLabel(speedUnit)}`, name === 'a' ? labelA : labelB ?? '']}
        />
        <Line dataKey="a" stroke={COLOR_A} dot={false} strokeWidth={1.8} isAnimationActive={false} connectNulls />
        {labelB && <Line dataKey="b" stroke={COLOR_B} dot={false} strokeWidth={1.5} isAnimationActive={false} connectNulls />}
      </LineChart>
    </ResponsiveContainer>
  );
}

export function SpeedTimeChart({ laps, speedUnit, colors }: { laps: LapRecord[]; speedUnit: SpeedUnit; colors: string[] }) {
  const series = laps.map((l) => l.trace.filter((p) => p.v !== null).map((p) => ({ t: p.t / 1000, v: convertSpeed(p.v as number, speedUnit) })));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid stroke={GRID} />
        <XAxis dataKey="t" type="number" domain={[0, 'dataMax']} tick={AXIS} tickFormatter={(v: number) => `${Math.round(v)} s`} allowDuplicatedCategory={false} />
        <YAxis tick={AXIS} width={44} />
        <Tooltip {...tooltipStyle} labelFormatter={(t: number) => `${t.toFixed(1)} s`} formatter={(v: number) => [`${v.toFixed(1)} ${speedLabel(speedUnit)}`, 'Speed']} />
        {series.map((s, i) => (
          <Line key={i} data={s} dataKey="v" name={`Lap ${laps[i].lap}`} stroke={colors[i]} dot={false} strokeWidth={1.6} isAnimationActive={false} />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

/** Delta of lap A relative to lap B by distance. Below zero (green) = A ahead. */
export function DeltaDistanceChart({ rows, distanceUnit }: { rows: AlignedRow[]; distanceUnit: DistanceUnit }) {
  const data = rows.map((r) => ({ d: r.d, delta: r.deltaMs / 1000 }));
  const vals = data.map((d) => d.delta);
  const max = Math.max(...vals, 0);
  const min = Math.min(...vals, 0);
  const off = max - min > 0 ? max / (max - min) : 0;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id="deltaSplit" x1="0" y1="0" x2="0" y2="1">
            <stop offset={off} stopColor={COLOR_LOSS} stopOpacity={0.55} />
            <stop offset={off} stopColor={COLOR_GAIN} stopOpacity={0.55} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={GRID} />
        <XAxis dataKey="d" type="number" domain={['dataMin', 'dataMax']} tick={AXIS} tickFormatter={distTick(distanceUnit)} unit={` ${distanceUnit}`} />
        <YAxis tick={AXIS} width={48} tickFormatter={(v: number) => formatDelta(v * 1000, 1)} />
        <ReferenceLine y={0} stroke="#8a8e96" />
        <Tooltip {...tooltipStyle} labelFormatter={(d: number) => `${convertDistance(d, distanceUnit).toFixed(3)} ${distanceUnit}`} formatter={(v: number) => [`${formatDelta(v * 1000)} s`, 'Delta']} />
        <Area dataKey="delta" stroke="#f4f4f5" strokeWidth={1.2} fill="url(#deltaSplit)" isAnimationActive={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function ElevationChart({ points, distanceUnit, compact = false }: { points: ElevationPoint[]; distanceUnit: DistanceUnit; compact?: boolean }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={points} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
        {!compact && <CartesianGrid stroke={GRID} />}
        <XAxis dataKey="d" type="number" domain={['dataMin', 'dataMax']} hide={compact} tick={AXIS} tickFormatter={distTick(distanceUnit)} />
        <YAxis dataKey="elevation" domain={['dataMin - 5', 'dataMax + 5']} hide={compact} tick={AXIS} width={40} unit=" m" />
        <Tooltip {...tooltipStyle} labelFormatter={(d: number) => `${convertDistance(d, distanceUnit).toFixed(2)} ${distanceUnit}`} formatter={(v: number) => [`${v.toFixed(0)} m`, 'Elevation']} />
        <Area dataKey="elevation" stroke="#a1a5ad" fill="#a1a5ad" fillOpacity={0.15} isAnimationActive={false} />
      </AreaChart>
    </ResponsiveContainer>
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
  const data = points.map((p) => ({ ...p, time: p.timeMs / 1000 }));
  const times = data.map((d) => d.time);
  const min = times.length ? Math.min(...times) : 0;
  const max = times.length ? Math.max(...times) : 1;
  const pad = Math.max(0.5, (max - min) * 0.3);
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="n" tick={AXIS} tickLine={false} axisLine={false} />
        <YAxis
          domain={[Math.max(0, min - pad), max + pad]}
          tick={AXIS}
          tickLine={false}
          axisLine={false}
          width={56}
          tickFormatter={(v: number) => formatLapTime(v * 1000).replace(/^00:/, '').slice(0, -2)}
        />
        <Tooltip
          {...tooltipStyle}
          formatter={(v: number) => [formatLapTime(v * 1000), 'Lap time']}
          labelFormatter={(_l, payload) => {
            const p = payload?.[0]?.payload as HistoryPoint | undefined;
            return p ? new Date(p.date).toLocaleString() : '';
          }}
        />
        <Bar dataKey="time" maxBarSize={24} cursor="pointer" isAnimationActive={false} onClick={(d: { id?: string }) => d.id && onSelect?.(d.id)}>
          {data.map((d) => (
            <Cell key={d.id} fill={d.isA ? COLOR_A : d.isB ? '#f4f4f5' : d.isBest ? '#8a1410' : '#5b5f66'} />
          ))}
        </Bar>
        <Line dataKey="time" stroke="#a1a5ad" strokeWidth={1} dot={false} isAnimationActive={false} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
