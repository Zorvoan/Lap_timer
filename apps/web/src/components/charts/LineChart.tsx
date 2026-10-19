/**
 * One small line chart for the whole app, styled after Bklit UI's line chart (MIT,
 * github.com/bklit/bklit-ui): smooth curves that draw themselves in, dashed rows, quiet axis
 * labels, a dashed crosshair with dots and a tooltip that follow the finger, and markers (a
 * dashed line with a round badge) for moments worth pointing at.
 */
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { area as d3area, curveMonotoneX, line as d3line } from 'd3-shape';
import { scaleLinear } from 'd3-scale';

export interface ChartPoint {
  x: number;
  /** null breaks the line (no data there). */
  y: number | null;
  id?: string;
}

export interface ChartSeries {
  id: string;
  label: string;
  color: string;
  /** Sorted by x. */
  points: readonly ChartPoint[];
  width?: number;
  /** Fill under the line: a fading gradient, or green below / red above zero (gaps). */
  area?: 'gradient' | 'split';
  /** Dots on every point (few, discrete points such as laps); colour per point. */
  dots?: boolean | ((p: ChartPoint) => string);
  /** Shown in the tooltip; default: the y value with one decimal. */
  format?: (y: number) => string;
}

export interface ChartMarker {
  x: number;
  /** One or two characters (or an emoji) in the round badge. */
  label: string;
  color?: string;
  title?: string;
}

export interface ChartBand {
  from: number;
  to: number;
  label?: string;
}

export interface LineChartProps {
  series: readonly ChartSeries[];
  xFormat?: (x: number) => string;
  yFormat?: (y: number) => string;
  /** Tooltip heading for an x value; default: xFormat. */
  tooltipTitle?: (x: number, nearest: ChartPoint | null) => ReactNode;
  yDomain?: [number, number];
  /** Extra room above and below the data, as a share of its range. */
  yPad?: number;
  /** Whole-number x ticks only (lap numbers). */
  integerX?: boolean;
  zeroLine?: boolean;
  markers?: readonly ChartMarker[];
  bands?: readonly ChartBand[];
  /** No axes, rows or tooltip: a sparkline-like preview. */
  compact?: boolean;
  /** Tapping a point of the first series. */
  onSelect?: (p: ChartPoint) => void;
  ariaLabel: string;
}

const MUTED = 'rgb(var(--c-muted))';
const LINE = 'rgb(var(--c-line))';

function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: Math.round(e.contentRect.width), h: Math.round(e.contentRect.height) }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size] as const;
}

/** Index of the point nearest to x among those with a value. */
function nearest(points: readonly ChartPoint[], x: number): ChartPoint | null {
  let lo = 0;
  let hi = points.length - 1;
  if (hi < 0) return null;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid].x < x) lo = mid + 1;
    else hi = mid;
  }
  let best: ChartPoint | null = null;
  for (let k = Math.max(0, lo - 3); k <= Math.min(points.length - 1, lo + 3); k++) {
    const p = points[k];
    if (p.y !== null && (!best || Math.abs(p.x - x) < Math.abs(best.x - x))) best = p;
  }
  return best;
}

export function LineChart({
  series,
  xFormat = (x) => String(Math.round(x * 10) / 10),
  yFormat = (y) => String(Math.round(y * 10) / 10),
  tooltipTitle,
  yDomain,
  yPad = 0.08,
  integerX = false,
  zeroLine = false,
  markers = [],
  bands = [],
  compact = false,
  onSelect,
  ariaLabel,
}: LineChartProps) {
  const uid = useId().replace(/:/g, '');
  const [box, { w, h }] = useSize<HTMLDivElement>();
  const [hoverX, setHoverX] = useState<number | null>(null);

  const m = compact
    ? { top: 2, right: 2, bottom: 2, left: 2 }
    : { top: markers.length ? 30 : 10, right: 10, bottom: 22, left: 46 };
  const iw = Math.max(0, w - m.left - m.right);
  const ih = Math.max(0, h - m.top - m.bottom);

  const { x, y } = useMemo(() => {
    let x0 = Infinity;
    let x1 = -Infinity;
    let y0 = Infinity;
    let y1 = -Infinity;
    for (const s of series)
      for (const p of s.points) {
        x0 = Math.min(x0, p.x);
        x1 = Math.max(x1, p.x);
        if (p.y !== null) {
          y0 = Math.min(y0, p.y);
          y1 = Math.max(y1, p.y);
        }
      }
    if (!Number.isFinite(x0)) [x0, x1] = [0, 1];
    if (!Number.isFinite(y0)) [y0, y1] = [0, 1];
    if (zeroLine) [y0, y1] = [Math.min(y0, 0), Math.max(y1, 0)];
    if (x0 === x1) [x0, x1] = [x0 - 1, x1 + 1];
    const pad = (y1 - y0 || Math.abs(y1) || 1) * yPad;
    // Charts with dots keep them clear of the edges.
    const inset = series.some((s) => s.dots) ? 12 : 0;
    const xs = scaleLinear().domain([x0, x1]).range([inset, Math.max(inset, iw - inset)]);
    const ys = scaleLinear()
      .domain(yDomain ?? [y0 - pad, y1 + pad])
      .range([ih, 0]);
    if (!yDomain && !compact) ys.nice(4);
    return { x: xs, y: ys };
  }, [series, iw, ih, yDomain, yPad, zeroLine, compact]);

  const paths = useMemo(
    () =>
      series.map((s) => {
        const ln = d3line<ChartPoint>()
          .defined((p) => p.y !== null)
          .x((p) => x(p.x))
          .y((p) => y(p.y as number))
          .curve(curveMonotoneX);
        const base = s.area === 'split' ? y(0) : ih;
        const ar = s.area
          ? d3area<ChartPoint>()
              .defined((p) => p.y !== null)
              .x((p) => x(p.x))
              .y0(base)
              .y1((p) => y(p.y as number))
              .curve(curveMonotoneX)(s.points as ChartPoint[])
          : null;
        return { line: ln(s.points as ChartPoint[]) ?? '', area: ar };
      }),
    [series, x, y, ih],
  );

  const xTicks = compact || !iw ? [] : x.ticks(Math.max(2, Math.floor(iw / 80))).filter((t) => !integerX || Number.isInteger(t));
  const yTicks = compact || !ih ? [] : y.ticks(4);
  const first = series[0]?.points ?? [];
  const hoverPts = hoverX === null ? [] : series.map((s) => nearest(s.points, hoverX));
  const lead = hoverPts.find(Boolean) ?? null;
  const hx = lead ? x(lead.x) : 0;

  function toX(e: React.PointerEvent | React.MouseEvent): number {
    const r = (e.currentTarget as Element).getBoundingClientRect();
    return x.invert(Math.min(iw, Math.max(0, e.clientX - r.left)));
  }

  const zero = y(0);
  return (
    <div ref={box} className="relative h-full w-full select-none" role="img" aria-label={ariaLabel}>
      {w > 0 && h > 0 && (
        <svg width={w} height={h} className="block overflow-visible">
          <defs>
            {series.map((s, i) =>
              s.area === 'split' ? (
                <linearGradient key={i} id={`${uid}-a${i}`} gradientUnits="userSpaceOnUse" x1="0" y1={0} x2="0" y2={ih}>
                  <stop offset={0} stopColor="rgb(var(--c-loss))" stopOpacity={0.45} />
                  <stop offset={Math.min(1, Math.max(0, zero / ih))} stopColor="rgb(var(--c-loss))" stopOpacity={0.12} />
                  <stop offset={Math.min(1, Math.max(0, zero / ih))} stopColor="rgb(var(--c-gain))" stopOpacity={0.12} />
                  <stop offset={1} stopColor="rgb(var(--c-gain))" stopOpacity={0.45} />
                </linearGradient>
              ) : (
                <linearGradient key={i} id={`${uid}-a${i}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={s.color} stopOpacity={0.28} />
                  <stop offset="100%" stopColor={s.color} stopOpacity={0} />
                </linearGradient>
              ),
            )}
            <clipPath id={`${uid}-clip`}>
              <rect x={-2} y={-4} width={iw + 4} height={ih + 8} />
            </clipPath>
          </defs>
          <g transform={`translate(${m.left},${m.top})`}>
            {/* Rows: dashed, quiet. */}
            {yTicks.map((t) => (
              <g key={t}>
                <line x1={0} x2={iw} y1={y(t)} y2={y(t)} stroke={LINE} strokeDasharray="4 4" />
                <text x={-8} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill={MUTED} className="tabular">
                  {yFormat(t)}
                </text>
              </g>
            ))}
            {xTicks.map((t) => (
              <text key={t} x={x(t)} y={ih + 16} textAnchor="middle" fontSize={11} fill={MUTED} className="tabular">
                {xFormat(t)}
              </text>
            ))}
            {zeroLine && <line x1={0} x2={iw} y1={zero} y2={zero} stroke={MUTED} strokeOpacity={0.7} />}
            {bands.map((b, i) => (
              <g key={i}>
                <rect x={x(b.from)} width={Math.max(1, x(b.to) - x(b.from))} y={0} height={ih} fill={MUTED} opacity={0.12} />
                {b.label && !compact && (
                  <text x={(x(b.from) + x(b.to)) / 2} y={10} textAnchor="middle" fontSize={10} fill={MUTED}>
                    {b.label}
                  </text>
                )}
              </g>
            ))}
            {/* Markers: a dashed line with a round badge on top. */}
            {!compact &&
              markers.map((mk, i) => (
                <g key={i} className="chart-fade" style={{ animationDelay: `${500 + i * 80}ms` }}>
                  <title>{mk.title ?? mk.label}</title>
                  <line x1={x(mk.x)} x2={x(mk.x)} y1={-6} y2={ih} stroke={MUTED} strokeOpacity={0.6} strokeDasharray="4 4" />
                  <circle cx={x(mk.x)} cy={-17} r={11} fill="rgb(var(--c-raised))" stroke={mk.color ?? LINE} strokeWidth={1.5} />
                  <text x={x(mk.x)} y={-17} dy="0.35em" textAnchor="middle" fontSize={mk.label.length > 1 ? 9 : 11} fontWeight={800} fill={mk.color ?? 'rgb(var(--c-fg))'}>
                    {mk.label}
                  </text>
                </g>
              ))}
            <g clipPath={`url(#${uid}-clip)`}>
              {series.map((_s, i) =>
                paths[i].area ? <path key={`a${i}`} d={paths[i].area!} fill={`url(#${uid}-a${i})`} className="chart-fade" style={{ animationDelay: '250ms' }} /> : null,
              )}
              {series.map((s, i) => (
                <path
                  key={`l${i}`}
                  d={paths[i].line}
                  pathLength={1}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={s.width ?? 2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="chart-draw"
                  style={{ animationDelay: `${i * 120}ms` }}
                />
              ))}
              {series.map((s, i) =>
                s.dots
                  ? s.points.map((p, k) =>
                      p.y === null ? null : (
                        <circle
                          key={`d${i}-${k}`}
                          cx={x(p.x)}
                          cy={y(p.y)}
                          r={hoverX !== null && lead?.x === p.x ? 5.5 : 4}
                          fill={typeof s.dots === 'function' ? s.dots(p) : s.color}
                          stroke="rgb(var(--c-panel))"
                          strokeWidth={2}
                          className="chart-fade"
                          style={{ animationDelay: `${300 + k * 25}ms`, transition: 'r 120ms ease' }}
                        />
                      ),
                    )
                  : null,
              )}
            </g>
            {/* Crosshair: dashed line and a dot on every series where the finger is. */}
            {!compact && lead && (
              <g pointerEvents="none">
                <line x1={hx} x2={hx} y1={0} y2={ih} stroke="rgb(var(--c-fg))" strokeOpacity={0.45} strokeDasharray="4 4" />
                {hoverPts.map((p, i) =>
                  p && p.y !== null && !series[i].dots ? <circle key={i} cx={x(p.x)} cy={y(p.y)} r={4.5} fill={series[i].color} stroke="rgb(var(--c-panel))" strokeWidth={2} /> : null,
                )}
              </g>
            )}
            {!compact && (
              <rect
                width={iw}
                height={ih}
                fill="transparent"
                style={{ touchAction: 'pan-y', cursor: onSelect ? 'pointer' : 'crosshair' }}
                onPointerMove={(e) => setHoverX(toX(e))}
                onPointerDown={(e) => setHoverX(toX(e))}
                onPointerLeave={(e) => e.pointerType === 'mouse' && setHoverX(null)}
                onClick={(e) => {
                  const p = onSelect ? nearest(first, toX(e)) : null;
                  if (p) onSelect!(p);
                }}
              />
            )}
          </g>
        </svg>
      )}
      {!compact && lead && (
        <div
          className="pointer-events-none absolute top-0 z-10 min-w-[7.5rem] rounded-lg border border-line bg-panel/95 px-2.5 py-2 text-xs shadow-xl backdrop-blur-sm"
          style={{
            transform: `translate(${hx + m.left > w / 2 ? hx + m.left - 12 : hx + m.left + 12}px, ${m.top}px) translateX(${hx + m.left > w / 2 ? '-100%' : '0'})`,
            transition: 'transform 90ms cubic-bezier(0.22, 1, 0.36, 1)',
          }}
        >
          <div className="mb-1 font-semibold text-muted">{tooltipTitle ? tooltipTitle(lead.x, lead) : xFormat(lead.x)}</div>
          {series.map((s, i) => {
            const p = hoverPts[i];
            if (!p || p.y === null) return null;
            return (
              <div key={s.id} className="flex items-center gap-2 whitespace-nowrap">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: typeof s.dots === 'function' ? s.dots(p) : s.color }} />
                {series.length > 1 && <span className="text-muted">{s.label}</span>}
                <span className="ml-auto font-mono font-semibold tabular text-fg">{(s.format ?? yFormat)(p.y)}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
