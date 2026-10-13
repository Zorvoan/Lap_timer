export type SpeedUnit = 'kmh' | 'mph';
export type DistanceUnit = 'km' | 'mi';

/** `mm:ss.SSS` (or `h:mm:ss.SSS` past an hour). Truncates, never rounds up into the next unit. */
export function formatLapTime(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '--:--.---';
  const neg = ms < 0;
  const total = Math.floor(Math.abs(ms));
  const millis = total % 1000;
  const secs = Math.floor(total / 1000) % 60;
  const mins = Math.floor(total / 60000) % 60;
  const hours = Math.floor(total / 3600000);
  const core = `${pad(mins, 2)}:${pad(secs, 2)}.${pad(millis, 3)}`;
  return `${neg ? '-' : ''}${hours ? `${hours}:` : ''}${core}`;
}

/** Signed seconds with millisecond precision: `-0.342`, `+0.517`, `+0.000`. */
export function formatDelta(ms: number | null | undefined, decimals = 3): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '-.---';
  const s = ms / 1000;
  const rounded = Number(s.toFixed(decimals));
  const sign = rounded < 0 ? '-' : '+';
  return `${sign}${Math.abs(rounded).toFixed(decimals)}`;
}

export function convertSpeed(ms: number, unit: SpeedUnit): number {
  return unit === 'kmh' ? ms * 3.6 : ms * 2.2369362920544;
}

export function speedLabel(unit: SpeedUnit): string {
  return unit === 'kmh' ? 'km/h' : 'mph';
}

export function formatSpeed(ms: number | null | undefined, unit: SpeedUnit, decimals = 0): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '—';
  return convertSpeed(ms, unit).toFixed(decimals);
}

export function convertDistance(m: number, unit: DistanceUnit): number {
  return unit === 'km' ? m / 1000 : m / 1609.344;
}

export function formatDistance(m: number | null | undefined, unit: DistanceUnit, decimals = 2): string {
  if (m === null || m === undefined || !Number.isFinite(m)) return '—';
  return `${convertDistance(m, unit).toFixed(decimals)} ${unit}`;
}

function pad(n: number, w: number): string {
  return String(n).padStart(w, '0');
}
