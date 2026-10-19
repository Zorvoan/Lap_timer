/**
 * A chart still waiting for its data, in the style of Bklit UI's loading charts: a band of light
 * sweeps across the dotted field, a pulse runs along a placeholder line and the label shimmers.
 */
import { useId } from 'react';
import { useSize } from './LineChart';

const MUTED = 'rgb(var(--c-muted))';

export function ChartLoading({ label = 'Loading' }: { label?: string }) {
  const uid = useId().replace(/:/g, '');
  const [box, { w, h }] = useSize<HTMLDivElement>();
  const m = { top: 16, right: 12, bottom: 34, left: 46 };
  const iw = Math.max(0, w - m.left - m.right);
  const ih = Math.max(0, h - m.top - m.bottom);
  // A gentle made-up curve for the pulse to run along.
  const wave = Array.from({ length: 41 }, (_, i) => {
    const t = i / 40;
    const v = 0.5 + 0.22 * Math.sin(t * Math.PI * 3.1 + 0.6) + 0.1 * Math.sin(t * Math.PI * 7.3);
    return `${i ? 'L' : 'M'}${(t * iw).toFixed(1)},${(v * ih).toFixed(1)}`;
  }).join('');
  return (
    <div ref={box} className="relative h-full w-full" role="status" aria-label={label}>
      {w > 0 && h > 0 && (
        <svg width={w} height={h} className="block" aria-hidden="true">
          <defs>
            <pattern id={`${uid}-dots`} width={14} height={14} patternUnits="userSpaceOnUse">
              <circle cx={1} cy={1} r={1} fill={MUTED} />
            </pattern>
            <linearGradient id={`${uid}-edge`} x1="0" x2="1" y1="0" y2="0">
              <stop offset="0%" stopColor="#fff" stopOpacity={0} />
              <stop offset="10%" stopColor="#fff" stopOpacity={1} />
              <stop offset="90%" stopColor="#fff" stopOpacity={1} />
              <stop offset="100%" stopColor="#fff" stopOpacity={0} />
            </linearGradient>
            <linearGradient id={`${uid}-band`} x1="0" x2="1" y1="0" y2="0">
              <stop offset="0%" stopColor="#fff" stopOpacity={0} />
              <stop offset="50%" stopColor="#fff" stopOpacity={1} />
              <stop offset="100%" stopColor="#fff" stopOpacity={0} />
            </linearGradient>
            <mask id={`${uid}-field`}>
              <rect width={iw} height={ih} fill={`url(#${uid}-edge)`} />
            </mask>
            <mask id={`${uid}-sweep`}>
              <rect width={iw * 0.4} height={ih} fill={`url(#${uid}-band)`} className="chart-sweep" />
            </mask>
          </defs>
          <g transform={`translate(${m.left},${m.top})`} mask={`url(#${uid}-field)`}>
            <rect width={iw} height={ih} fill={`url(#${uid}-dots)`} opacity={0.3} />
            <rect width={iw} height={ih} fill={`url(#${uid}-dots)`} opacity={0.9} mask={`url(#${uid}-sweep)`} />
            <path d={wave} pathLength={1} fill="none" stroke="rgb(var(--c-fg))" strokeOpacity={0.5} strokeWidth={2} strokeLinecap="round" className="chart-pulse" />
          </g>
        </svg>
      )}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <span className="shimmer-text text-sm font-medium tracking-wide">{label}</span>
      </div>
    </div>
  );
}
