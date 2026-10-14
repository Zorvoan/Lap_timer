import { useMemo } from 'react';
import type { LonLat } from '@laptimer/core';

/**
 * A track's real outline as a small static drawing (no map, no tiles), north up. The shape is
 * scaled to fit the box with its proportions kept, so every track is recognisable at a glance.
 */
export function RouteShape({ geometry, size = 64, pad = 8, className = '' }: { geometry: readonly LonLat[]; size?: number; pad?: number; className?: string }) {
  const d = useMemo(() => {
    if (geometry.length < 2) return '';
    const k = Math.cos((geometry.reduce((s, c) => s + c[1], 0) / geometry.length) * (Math.PI / 180));
    const xs = geometry.map((c) => c[0] * k);
    const ys = geometry.map((c) => -c[1]);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const s = (size - 2 * pad) / Math.max(x1 - x0, y1 - y0, 1e-9);
    const ox = (size - (x1 - x0) * s) / 2;
    const oy = (size - (y1 - y0) * s) / 2;
    return xs.map((x, i) => `${i ? 'L' : 'M'}${((x - x0) * s + ox).toFixed(1)} ${((ys[i] - y0) * s + oy).toFixed(1)}`).join('');
  }, [geometry, size, pad]);
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" className={className}>
      <path d={d} fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
