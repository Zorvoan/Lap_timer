/**
 * A bar chart in the style of Bklit UI's (MIT, github.com/bklit/bklit-ui): bars grow out of the
 * baseline one after another with a little overshoot on a dotted field; the bar under the finger
 * lights up while the others fade, and its details show in the strip above the plot.
 * Bars above zero point up, below zero down (a gap chart: lost time up, gained time down).
 */
import { useId, useState, type ReactNode } from 'react';
import { scaleLinear } from 'd3-scale';
import { useSize } from './LineChart';

export interface Bar {
  id: string;
  /** Under the bar (short: "S1"). */
  label: string;
  value: number;
  color: string;
  /** Over the bar's end. */
  valueLabel: string;
  /** What the strip above says while this bar is picked. */
  detail: ReactNode;
}

const MUTED = 'rgb(var(--c-muted))';
/** Bklit staggers bars over the first 40% of a ~1.2 s entrance. */
const STAGGER_MS = 480;

export function BarChart({ bars, ariaLabel, hint, onFocus }: { bars: readonly Bar[]; ariaLabel: string; hint: string; onFocus?: (i: number | null) => void }) {
  const uid = useId().replace(/:/g, '');
  const [box, { w, h }] = useSize<HTMLDivElement>();
  const [focus, setFocus] = useState<number | null>(null);
  const pick = (i: number | null) => {
    setFocus(i);
    onFocus?.(i);
  };

  const m = { top: 46, right: 8, bottom: 26, left: 8 };
  const iw = Math.max(0, w - m.left - m.right);
  const ih = Math.max(0, h - m.top - m.bottom);
  const lo = Math.min(0, ...bars.map((b) => b.value));
  const hi = Math.max(0, ...bars.map((b) => b.value));
  const pad = (hi - lo || 1) * 0.22;
  // Room above and below for the value labels.
  const y = scaleLinear()
    .domain([lo < 0 ? lo - pad : 0, hi > 0 ? hi + pad : 0.001])
    .range([ih, 0]);
  const zero = y(0);
  const band = bars.length ? iw / bars.length : 0;
  const bw = Math.max(4, Math.min(44, band * 0.62));

  function at(e: React.PointerEvent<SVGRectElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    return Math.max(0, Math.min(bars.length - 1, Math.floor(((e.clientX - r.left) / r.width) * bars.length)));
  }

  return (
    <div ref={box} className="relative h-full w-full select-none" role="img" aria-label={ariaLabel}>
      {w > 0 && h > 0 && (
        <svg width={w} height={h} className="block overflow-visible">
          <defs>
            <pattern id={`${uid}-dots`} width={14} height={14} patternUnits="userSpaceOnUse">
              <circle cx={1} cy={1} r={1} fill={MUTED} opacity={0.35} />
            </pattern>
            <linearGradient id={`${uid}-fade`} x1="0" x2="1" y1="0" y2="0">
              <stop offset="0%" stopColor="#fff" stopOpacity={0} />
              <stop offset="10%" stopColor="#fff" stopOpacity={1} />
              <stop offset="90%" stopColor="#fff" stopOpacity={1} />
              <stop offset="100%" stopColor="#fff" stopOpacity={0} />
            </linearGradient>
            <mask id={`${uid}-mask`}>
              <rect width={iw} height={ih} fill={`url(#${uid}-fade)`} />
            </mask>
          </defs>
          <g transform={`translate(${m.left},${m.top})`}>
            <rect width={iw} height={ih} fill={`url(#${uid}-dots)`} mask={`url(#${uid}-mask)`} />
            <line x1={0} x2={iw} y1={zero} y2={zero} stroke={MUTED} strokeOpacity={0.6} strokeDasharray="3 4" />
            {bars.map((b, i) => {
              const cx = band * (i + 0.5);
              const top = Math.min(y(b.value), zero);
              const height = Math.max(1, Math.abs(y(b.value) - zero));
              const up = b.value >= 0;
              const lit = focus === i;
              const dim = focus !== null && !lit;
              const delay = bars.length > 1 ? (i * STAGGER_MS) / bars.length : 0;
              return (
                <g key={b.id} opacity={dim ? 0.35 : 1} style={{ transition: 'opacity 150ms ease' }}>
                  <rect
                    x={cx - bw / 2}
                    y={top}
                    width={bw}
                    height={height}
                    rx={Math.min(5, bw / 2, height / 2)}
                    fill={b.color}
                    fillOpacity={lit ? 1 : 0.85}
                    className="bar-grow"
                    style={{
                      transformOrigin: up ? 'bottom' : 'top',
                      ['--d' as string]: `${delay}ms`,
                      filter: lit ? `drop-shadow(0 0 8px ${b.color})` : undefined,
                      transition: 'fill-opacity 150ms ease',
                    }}
                  />
                  <text
                    x={cx}
                    y={up ? top - 6 : top + height + 13}
                    textAnchor="middle"
                    fontSize={10}
                    fontWeight={lit ? 700 : 500}
                    fill={lit ? 'rgb(var(--c-fg))' : MUTED}
                    className="chart-fade tabular"
                    style={{ animationDelay: `${delay + 450}ms` }}
                  >
                    {b.valueLabel}
                  </text>
                  <text x={cx} y={ih + 18} textAnchor="middle" fontSize={11} fontWeight={lit ? 700 : 500} fill={lit ? 'rgb(var(--c-fg))' : MUTED}>
                    {b.label}
                  </text>
                </g>
              );
            })}
            <rect
              width={iw}
              height={ih + m.bottom}
              fill="transparent"
              style={{ touchAction: 'pan-y', cursor: 'pointer' }}
              onPointerMove={(e) => pick(at(e))}
              onPointerDown={(e) => pick(at(e))}
              onPointerLeave={(e) => e.pointerType === 'mouse' && pick(null)}
            />
          </g>
        </svg>
      )}
      <div className="pointer-events-none absolute inset-x-0 top-1 flex justify-center px-2">
        {focus !== null && bars[focus] ? (
          <div key={focus} className="chart-roll max-w-full rounded-xl border border-line bg-panel/90 px-3 py-1.5 text-sm shadow-xl backdrop-blur-md">
            {bars[focus].detail}
          </div>
        ) : (
          <p className="chart-fade pt-1.5 text-xs text-muted/70">{hint}</p>
        )}
      </div>
    </div>
  );
}
