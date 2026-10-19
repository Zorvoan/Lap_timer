/**
 * One small line chart for the whole app, styled after Bklit UI's charts (MIT,
 * github.com/bklit/bklit-ui): smooth curves revealed left to right on a dotted field, and a hover
 * that glides: a fading crosshair, a haloed dot on every line, a tooltip card that trails behind on
 * a softer spring, and a pill under the axis whose label rolls as it changes. With more than one
 * line, a legend lifts the line under the finger and fades the others.
 */
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { area as d3area, curveMonotoneX, line as d3line } from 'd3-shape';
import { scaleLinear } from 'd3-scale';
import { useSeen } from '../../hooks/useSeen';

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
  /** Text of the pill under the axis while hovering; default: xFormat. */
  pillLabel?: (x: number) => string;
  yDomain?: [number, number];
  /** The y axis never goes below this (speeds: 0). */
  yMin?: number;
  /** Extra room above and below the data, as a share of its range. */
  yPad?: number;
  /** Whole-number x ticks only (lap numbers). */
  integerX?: boolean;
  zeroLine?: boolean;
  markers?: readonly ChartMarker[];
  bands?: readonly ChartBand[];
  /** No axes, field or tooltip: a sparkline-like preview. */
  compact?: boolean;
  /** Tapping a point of the first series. */
  onSelect?: (p: ChartPoint) => void;
  /** The x under the finger or pointer as it moves; null when it leaves. */
  onHover?: (x: number | null) => void;
  ariaLabel: string;
}

/** Bklit's reveal: the plot uncovers left to right over 1.1 s, slow at both ends. */
const REVEAL_MS = 1100;
const revealEase = bezier(0.85, 0, 0.15, 1);

/** A CSS cubic-bezier timing function as a function of progress 0–1. */
function bezier(x1: number, y1: number, x2: number, y2: number) {
  const at = (a: number, b: number, t: number) => 3 * a * t * (1 - t) ** 2 + 3 * b * t * t * (1 - t) + t ** 3;
  return (x: number) => {
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (at(x1, x2, mid) < x) lo = mid;
      else hi = mid;
    }
    return at(y1, y2, (lo + hi) / 2);
  };
}

/**
 * Animates a clip rect's width from 0 to `width` whenever `epoch` changes (new data), once the
 * chart has been scrolled into view, and follows `width` directly when the chart is only resized.
 */
function useReveal(width: number, epoch: string, seen: boolean) {
  const rect = useRef<SVGRectElement>(null);
  const done = useRef<string | null>(null);
  const target = useRef(width);
  target.current = width;
  useEffect(() => {
    const el = rect.current;
    if (!el || width <= 0 || !seen) return;
    if (done.current === epoch || matchMedia('(prefers-reduced-motion: reduce)').matches) {
      done.current = epoch;
      el.setAttribute('width', String(width));
      return;
    }
    done.current = epoch;
    const t0 = performance.now();
    let raf = requestAnimationFrame(function tick(now) {
      const k = Math.min(1, (now - t0) / REVEAL_MS);
      el.setAttribute('width', String(target.current * revealEase(k)));
      if (k < 1) raf = requestAnimationFrame(tick);
    });
    return () => {
      cancelAnimationFrame(raf);
      el.setAttribute('width', String(target.current));
    };
  }, [width, epoch, seen]);
  return rect;
}

const MUTED = 'rgb(var(--c-muted))';
const LINE = 'rgb(var(--c-line))';
/** Bklit's springs: the crosshair and dots follow tightly, the card trails, the pill in between. */
const FOLLOW = { stiffness: 300, damping: 30 };
const CARD = { stiffness: 100, damping: 20 };
const PILL = { stiffness: 400, damping: 35 };

export function useSize<T extends HTMLElement>() {
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

function reducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

interface Spring {
  v: number;
  vel: number;
  to: number;
  k: number;
  c: number;
}

/**
 * Damped springs that write straight to the DOM every frame (no React re-render while gliding).
 * `set` moves a spring's target; `jump` places it there without animating.
 */
function useSprings(apply: (v: Record<string, number>) => void) {
  const state = useRef<Record<string, Spring>>({});
  const raf = useRef(0);
  const applyRef = useRef(apply);
  applyRef.current = apply;
  useEffect(() => () => cancelAnimationFrame(raf.current), []);
  const api = useRef({
    set(key: string, to: number, cfg: { stiffness: number; damping: number }, jump = false) {
      const s = state.current[key];
      if (!s || jump || reducedMotion()) state.current[key] = { v: to, vel: 0, to, k: cfg.stiffness, c: cfg.damping };
      else s.to = to;
      if (!raf.current) loop(performance.now());
    },
  });
  function loop(last: number) {
    raf.current = requestAnimationFrame((now) => {
      const dt = Math.min(0.032, (now - last) / 1000);
      let moving = false;
      const out: Record<string, number> = {};
      for (const [key, s] of Object.entries(state.current)) {
        // Semi-implicit Euler in small steps keeps the stiff springs stable.
        for (let t = 0; t < dt; t += 0.004) {
          const h = Math.min(0.004, dt - t);
          s.vel += (-s.k * (s.v - s.to) - s.c * s.vel) * h;
          s.v += s.vel * h;
        }
        if (Math.abs(s.v - s.to) < 0.05 && Math.abs(s.vel) < 0.05) {
          s.v = s.to;
          s.vel = 0;
        } else moving = true;
        out[key] = s.v;
      }
      applyRef.current(out);
      raf.current = 0;
      if (moving) loop(now);
    });
  }
  return api.current;
}

/** The point nearest to x among those with a value. */
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
  pillLabel,
  yDomain,
  yMin,
  yPad = 0.08,
  integerX = false,
  zeroLine = false,
  markers = [],
  bands = [],
  compact = false,
  onSelect,
  onHover,
  ariaLabel,
}: LineChartProps) {
  const uid = useId().replace(/:/g, '');
  const [box, { w, h }] = useSize<HTMLDivElement>();
  // Nothing plays until the user scrolls to the chart.
  const seen = useSeen(box);
  const [hoverX, setHoverX] = useState<number | null>(null);
  // Legend: the series under the finger (or tapped on a phone) is lifted, the rest fade.
  const [focus, setFocus] = useState<number | null>(null);
  const legend = !compact && series.length > 1;
  const hoverCb = useRef(onHover);
  hoverCb.current = onHover;
  useEffect(() => hoverCb.current?.(hoverX), [hoverX]);

  // On a phone the tooltip gets its own strip above the plot instead of covering the lines.
  // (Short charts, e.g. the editor's elevation strip, keep the floating card: no room for a strip.)
  const narrow = w > 0 && w < 560 && h >= 170;
  const strip = narrow ? 42 : 0;
  const legendRow = legend && !narrow ? 26 : 0;
  const m = compact ? { top: 2, right: 2, bottom: 2, left: 2 } : { top: (markers.length ? 32 : 12) + strip + legendRow, right: 12, bottom: 34, left: 46 };
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
    const inset = series.some((s) => s.dots) ? 14 : 0;
    const xs = scaleLinear().domain([x0, x1]).range([inset, Math.max(inset, iw - inset)]);
    const ys = scaleLinear()
      .domain(yDomain ?? [yMin !== undefined ? Math.max(yMin, y0 - pad) : y0 - pad, y1 + pad])
      .range([ih, 0]);
    if (!yDomain && !compact) ys.nice(4);
    return { x: xs, y: ys };
  }, [series, iw, ih, yDomain, yMin, yPad, zeroLine, compact]);

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
  const zero = y(0);

  // A new set of lines plays the reveal again; a resize only stretches it.
  const epoch = series.map((s) => `${s.id}:${s.points.length}:${s.points[0]?.x ?? ''}:${s.points[s.points.length - 1]?.y ?? ''}`).join('|');
  const revealRect = useReveal(iw + 8, epoch, seen);
  const faded = (i: number) => focus !== null && focus !== i;

  function toX(e: React.PointerEvent | React.MouseEvent): number {
    const r = (e.currentTarget as Element).getBoundingClientRect();
    return x.invert(Math.min(iw, Math.max(0, e.clientX - r.left)));
  }

  return (
    <div ref={box} className="relative h-full w-full select-none" role="img" aria-label={ariaLabel}>
      {w > 0 && h > 0 && (
        <svg width={w} height={h} className="block overflow-visible">
          <defs>
            {series.map((s, i) =>
              s.area === 'split' ? (
                <linearGradient key={i} id={`${uid}-a${i}`} gradientUnits="userSpaceOnUse" x1="0" y1={0} x2="0" y2={ih}>
                  <stop offset={0} stopColor="rgb(var(--c-loss))" stopOpacity={0.45} />
                  <stop offset={Math.min(1, Math.max(0, zero / ih))} stopColor="rgb(var(--c-loss))" stopOpacity={0.1} />
                  <stop offset={Math.min(1, Math.max(0, zero / ih))} stopColor="rgb(var(--c-gain))" stopOpacity={0.1} />
                  <stop offset={1} stopColor="rgb(var(--c-gain))" stopOpacity={0.45} />
                </linearGradient>
              ) : (
                <linearGradient key={i} id={`${uid}-a${i}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={s.color} stopOpacity={0.26} />
                  <stop offset="100%" stopColor={s.color} stopOpacity={0} />
                </linearGradient>
              ),
            )}
            {/* The dotted field, fading out towards the sides. */}
            <pattern id={`${uid}-dots`} width={14} height={14} patternUnits="userSpaceOnUse">
              <circle cx={1} cy={1} r={1} fill={MUTED} opacity={0.35} />
            </pattern>
            <linearGradient id={`${uid}-fadeh`} gradientUnits="userSpaceOnUse" x1={0} x2={iw} y1={0} y2={0}>
              <stop offset="0%" stopColor="#fff" stopOpacity={0} />
              <stop offset="10%" stopColor="#fff" stopOpacity={1} />
              <stop offset="90%" stopColor="#fff" stopOpacity={1} />
              <stop offset="100%" stopColor="#fff" stopOpacity={0} />
            </linearGradient>
            <mask id={`${uid}-fieldmask`}>
              <rect width={iw} height={ih} fill={`url(#${uid}-fadeh)`} />
            </mask>
            {/* Lines soften at the very ends, like Bklit's. */}
            <linearGradient id={`${uid}-fadel`} gradientUnits="userSpaceOnUse" x1={0} x2={iw} y1={0} y2={0}>
              <stop offset="0%" stopColor="#fff" stopOpacity={0.2} />
              <stop offset="4%" stopColor="#fff" stopOpacity={1} />
              <stop offset="96%" stopColor="#fff" stopOpacity={1} />
              <stop offset="100%" stopColor="#fff" stopOpacity={0.2} />
            </linearGradient>
            <mask id={`${uid}-linemask`}>
              <rect x={-10} y={-10} width={iw + 20} height={ih + 20} fill={`url(#${uid}-fadel)`} />
            </mask>
            <linearGradient id={`${uid}-xh`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="rgb(var(--c-fg))" stopOpacity={0} />
              <stop offset="18%" stopColor="rgb(var(--c-fg))" stopOpacity={0.55} />
              <stop offset="82%" stopColor="rgb(var(--c-fg))" stopOpacity={0.55} />
              <stop offset="100%" stopColor="rgb(var(--c-fg))" stopOpacity={0} />
            </linearGradient>
            <clipPath id={`${uid}-clip`}>
              <rect ref={revealRect} x={-4} y={-6} width={0} height={ih + 12} />
            </clipPath>
          </defs>
          <g transform={`translate(${m.left},${m.top})`}>
            {!compact && <rect width={iw} height={ih} fill={`url(#${uid}-dots)`} mask={`url(#${uid}-fieldmask)`} />}
            {yTicks.map((t) => (
              <text key={t} x={-10} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill={MUTED} className="tabular">
                {yFormat(t)}
              </text>
            ))}
            {xTicks.map((t) => (
              <text key={t} x={x(t)} y={ih + 20} textAnchor="middle" fontSize={11} fill={MUTED} className="tabular" style={{ opacity: lead ? 0.2 : 1, transition: 'opacity 150ms ease' }}>
                {xFormat(t)}
              </text>
            ))}
            {zeroLine && <line x1={0} x2={iw} y1={zero} y2={zero} stroke={MUTED} strokeOpacity={0.6} strokeDasharray="3 4" />}
            {bands.map((b, i) => (
              <g key={i}>
                <rect x={x(b.from)} width={Math.max(1, x(b.to) - x(b.from))} y={0} height={ih} fill={MUTED} opacity={0.12} rx={3} />
                {b.label && !compact && (
                  <text x={(x(b.from) + x(b.to)) / 2} y={10} textAnchor="middle" fontSize={10} fill={MUTED}>
                    {b.label}
                  </text>
                )}
              </g>
            ))}
            {!compact &&
              seen &&
              markers.map((mk, i) => (
                <g key={i} className="chart-fade" style={{ animationDelay: `${500 + i * 80}ms` }}>
                  <title>{mk.title ?? mk.label}</title>
                  <line x1={x(mk.x)} x2={x(mk.x)} y1={-6} y2={ih} stroke={MUTED} strokeOpacity={0.5} strokeDasharray="3 4" />
                  <circle cx={x(mk.x)} cy={-18} r={11} fill="rgb(var(--c-raised))" stroke={mk.color ?? LINE} strokeWidth={1.5} />
                  <text x={x(mk.x)} y={-18} dy="0.35em" textAnchor="middle" fontSize={mk.label.length > 1 ? 9 : 11} fontWeight={800} fill={mk.color ?? 'rgb(var(--c-fg))'}>
                    {mk.label}
                  </text>
                </g>
              ))}
            <g clipPath={`url(#${uid}-clip)`} mask={compact ? undefined : `url(#${uid}-linemask)`}>
              {series.map((_s, i) =>
                paths[i].area ? (
                  <path key={`a${i}`} d={paths[i].area!} fill={`url(#${uid}-a${i})`} opacity={faded(i) ? 0.15 : 1} style={{ transition: 'opacity 150ms ease' }} />
                ) : null,
              )}
              {series.map((s, i) => (
                <path
                  key={`l${i}`}
                  d={paths[i].line}
                  pathLength={1}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={(s.width ?? 2) + (focus === i ? 1 : 0)}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  opacity={faded(i) ? 0.2 : 1}
                  style={{ transition: 'opacity 150ms ease, stroke-width 150ms ease', filter: focus === i ? `drop-shadow(0 0 6px ${s.color})` : undefined }}
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
                          r={3.5}
                          fill={typeof s.dots === 'function' ? s.dots(p) : s.color}
                          stroke="rgb(var(--c-panel))"
                          strokeWidth={2}
                          opacity={faded(i) ? 0.2 : 1}
                        />
                      ),
                    )
                  : null,
              )}
            </g>
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
      {legend && !(narrow && lead) && (
        <div className={`chart-fade absolute inset-x-0 top-1.5 flex flex-wrap justify-center gap-1.5 px-2 ${narrow ? '' : 'sm:justify-end'}`} role="group" aria-label="Lines">
          {series.map((s, i) => (
            <button
              key={s.id}
              type="button"
              aria-pressed={focus === i}
              onPointerEnter={(e) => e.pointerType === 'mouse' && setFocus(i)}
              onPointerLeave={(e) => e.pointerType === 'mouse' && setFocus(null)}
              onClick={() => setFocus((f) => (f === i ? null : i))}
              className="flex max-w-[48%] items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-xs"
              style={{ opacity: faded(i) ? 0.4 : 1, transition: 'opacity 150ms ease, border-color 150ms ease', borderColor: focus === i ? s.color : undefined }}
            >
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: s.color, boxShadow: focus === i ? `0 0 8px ${s.color}` : undefined }} />
              <span className="truncate">{s.label}</span>
            </button>
          ))}
        </div>
      )}
      {narrow && !compact && !lead && !legend && (
        <p className="chart-fade pointer-events-none absolute inset-x-0 top-2.5 text-center text-xs text-muted/70">Slide a finger across the chart</p>
      )}
      {!compact && w > 0 && (
        <Hover
          uid={uid}
          series={series}
          points={hoverPts}
          lead={lead}
          px={x}
          py={y}
          left={m.left}
          top={m.top}
          width={w}
          narrow={narrow}
          iw={iw}
          ih={ih}
          title={lead ? (tooltipTitle ? tooltipTitle(lead.x, lead) : xFormat(lead.x)) : null}
          pill={lead ? (pillLabel ?? xFormat)(lead.x) : ''}
          yFormat={yFormat}
        />
      )}
    </div>
  );
}

/**
 * The hover layer: crosshair, haloed dots, the trailing tooltip card and the axis pill. Positions
 * run on springs written straight to the DOM, so everything glides from point to point.
 */
function Hover({
  uid,
  series,
  points,
  lead,
  px,
  py,
  left,
  top,
  width,
  narrow,
  iw,
  ih,
  title,
  pill,
  yFormat,
}: {
  uid: string;
  series: readonly ChartSeries[];
  points: (ChartPoint | null)[];
  lead: ChartPoint | null;
  px: (x: number) => number;
  py: (y: number) => number;
  left: number;
  top: number;
  width: number;
  narrow: boolean;
  iw: number;
  ih: number;
  title: ReactNode;
  pill: string;
  yFormat: (y: number) => string;
}) {
  const cross = useRef<SVGGElement>(null);
  const dots = useRef<(SVGGElement | null)[]>([]);
  const card = useRef<HTMLDivElement>(null);
  const pillEl = useRef<HTMLDivElement>(null);
  const shown = useRef(false);
  const springs = useSprings((v) => {
    if (cross.current && v.x !== undefined) cross.current.setAttribute('transform', `translate(${v.x},0)`);
    dots.current.forEach((d, i) => {
      if (d && v[`y${i}`] !== undefined && v[`x${i}`] !== undefined) d.setAttribute('transform', `translate(${v[`x${i}`]},${v[`y${i}`]})`);
    });
    if (card.current && v.card !== undefined) card.current.style.transform = `translate(${v.card}px, ${narrow ? 2 : top + 6}px)`;
    if (pillEl.current && v.pill !== undefined) pillEl.current.style.transform = `translate(${v.pill}px, ${top + ih + 8}px) translateX(-50%)`;
  });

  const visible = lead !== null;
  const hx = lead ? px(lead.x) : 0;
  useLayoutEffect(() => {
    if (!lead) {
      shown.current = false;
      return;
    }
    const jump = !shown.current;
    shown.current = true;
    springs.set('x', hx, FOLLOW, jump);
    points.forEach((p, i) => {
      if (!p || p.y === null) return;
      springs.set(`x${i}`, px(p.x), FOLLOW, jump);
      springs.set(`y${i}`, py(p.y), FOLLOW, jump);
    });
    // The card sits beside the crosshair, on whichever side has room (switching sides glides);
    // on a phone it rides the strip above the plot, centred on the crosshair.
    const cw = card.current?.offsetWidth ?? 160;
    const right = hx + left + 20;
    const cardX = narrow ? Math.min(width - cw, Math.max(0, hx + left - cw / 2)) : right + cw <= left + iw + 8 ? right : hx + left - 20 - cw;
    springs.set('card', Math.max(0, cardX), CARD, jump);
    springs.set('pill', Math.min(left + iw, Math.max(left, hx + left)), PILL, jump);
  });

  return (
    <>
      <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" aria-hidden="true">
        <g transform={`translate(${left},${top})`} style={{ opacity: visible ? 1 : 0, transition: 'opacity 160ms ease' }}>
          <g ref={cross}>
            <rect x={-0.75} width={1.5} y={0} height={ih} fill={`url(#${uid}-xh)`} />
          </g>
          {series.map((s, i) => {
            const p = points[i];
            const on = !!p && p.y !== null;
            const color = typeof s.dots === 'function' && p ? s.dots(p) : s.color;
            return (
              <g key={s.id} ref={(el) => (dots.current[i] = el)} style={{ opacity: on ? 1 : 0, transition: 'opacity 120ms ease' }}>
                <circle r={13} fill={color} opacity={0.3} className={on ? 'chart-halo' : ''} />
                <circle r={5} fill={color} stroke="rgb(var(--c-panel))" strokeWidth={1.5} className={on ? 'chart-halo' : ''} />
              </g>
            );
          })}
        </g>
      </svg>
      <div
        ref={card}
        className={`pointer-events-none absolute left-0 top-0 z-10 overflow-hidden border border-line bg-panel/90 shadow-xl backdrop-blur-md ${narrow ? 'flex items-center gap-3 rounded-full px-3 py-1.5 text-xs' : 'min-w-[10rem] rounded-xl text-sm'}`}
        style={{ opacity: visible ? 1 : 0, transition: 'opacity 160ms ease' }}
      >
        {narrow ? (
          <>
            <span className="whitespace-nowrap font-medium">{title}</span>
            {series.map((s, i) => {
              const p = points[i];
              if (!p || p.y === null) return null;
              return (
                <span key={s.id} className="flex items-center gap-1.5 whitespace-nowrap">
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: typeof s.dots === 'function' ? s.dots(p) : s.color }} />
                  <span className="font-mono font-semibold tabular">{(s.format ?? yFormat)(p.y)}</span>
                </span>
              );
            })}
          </>
        ) : (
          <>
            <div className="border-b border-line px-3.5 py-2 font-medium">{title}</div>
            <div className="space-y-1.5 px-3.5 py-2.5">
              {series.map((s, i) => {
                const p = points[i];
                if (!p || p.y === null) return null;
                return (
                  <div key={s.id} className="flex items-center justify-between gap-6 whitespace-nowrap">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: typeof s.dots === 'function' ? s.dots(p) : s.color }} />
                      <span className="truncate text-muted">{s.label}</span>
                    </span>
                    <span className="font-mono font-semibold tabular">{(s.format ?? yFormat)(p.y)}</span>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
      <div
        ref={pillEl}
        className="pointer-events-none absolute left-0 top-0 z-10 overflow-hidden rounded-full bg-fg px-3 py-0.5 text-xs font-semibold text-bg shadow-lg"
        style={{ opacity: visible ? 1 : 0, transition: 'opacity 160ms ease' }}
      >
        {/* The label rolls up when it changes. */}
        <span key={pill} className="chart-roll block whitespace-nowrap tabular">
          {pill}
        </span>
      </div>
    </>
  );
}
