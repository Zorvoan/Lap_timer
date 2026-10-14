import { formatDelta } from '@laptimer/core';

/** A running time readable at a glance: `1:12.4`, `0:08.9`. */
export function formatClock(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return '0:00.0';
  const tenths = Math.floor(Math.max(0, ms) / 100);
  const s = Math.floor(tenths / 10) % 60;
  const m = Math.floor(tenths / 600);
  return `${m}:${String(s).padStart(2, '0')}.${tenths % 10}`;
}

/** A gap with a real minus sign: `−0.42`, `+0.85`. */
export function formatGap(ms: number, decimals = 2): string {
  return formatDelta(ms, decimals).replace(/^-/, '−');
}
