/**
 * A radar chart in the style of Bklit UI's (MIT, github.com/bklit/bklit-ui): the web of levels
 * scales out ring by ring, the axis labels fly out from the centre, then each series grows out of
 * the centre in turn. Hovering a series lifts it (stronger fill, glow) and fades the others;
 * hovering near an axis lights it and shows every series' value there.
 */
import { useEffect, useRef, useState } from 'react';
import { useSeen } from '../../hooks/useSeen';
import { useRevisit } from '../../hooks/useRevisit';

export interface RadarMetric {
  key: string;
  label: string;
  /** Shorter name around the web (narrow screens), `\n` for a second line; the tooltip uses `label`. */
  short?: string;
}

export interface RadarSeries {
  id: string;
  label: string;
  color: string;
  /** 0–100 per metric key: how far out the point sits. */
  scores: Record<string, number>;
  /** What the tooltip says per metric key. */
  display: Record<string, string>;
  /**
   * What the series shows (e.g. which lap). When it changes the series grows out of the centre
   * again; when only its scores change (the scale moved) it eases to its new shape.
   */
  dataKey?: string;
}

/** How long a series takes to ease to a new shape when only the scale moved. */
const MORPH_MS = 450;

interface SeriesMotion {
  dataKey: string;
  from: Record<string, number>;
  to: Record<string, number>;
  /** Initial entrance (on the shared clock), growing again (new data), or easing to a new shape. */
  mode: 'enter' | 'grow' | 'morph';
  t0: number;
}

const LEVELS = 5;
const ENTER_MS = 1100;
const MUTED = 'rgb(var(--c-muted))';
const LINE = 'rgb(var(--c-line))';

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
/** Overshoots a little and settles, like a spring. */
const easeBack = (t: number) => {
  const c = 1.4;
  return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2);
};

/** Milliseconds since `start` turned true, ticking until every entrance has finished. */
function useEnterClock(total: number, start: boolean): number {
  const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const [ms, setMs] = useState(reduce ? total : 0);
  useEffect(() => {
    if (reduce || !start) return;
    const t0 = performance.now();
    let raf = requestAnimationFrame(function tick(now) {
      const e = now - t0;
      setMs(Math.min(total, e));
      if (e < total) raf = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(raf);
  }, [total, reduce, start]);
  return ms;
}

const phase = (ms: number, delay: number, dur: number) => Math.min(1, Math.max(0, (ms - delay) / dur));

export function RadarChart({ metrics, series, ariaLabel }: { metrics: readonly RadarMetric[]; series: readonly RadarSeries[]; ariaLabel: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState(0);
  const [boxW, setBoxW] = useState(0);
  const card = useRef<HTMLDivElement>(null);
  const [hoverSeries, setHoverSeries] = useState<number | null>(null);
  const [hoverMetric, setHoverMetric] = useState<number | null>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      setSize(Math.round(Math.min(e.contentRect.width, e.contentRect.height)));
      setBoxW(Math.round(e.contentRect.width));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const gridStagger = 80;
  const areaStart = LEVELS * gridStagger + 200;
  // The web and the areas grow once the user scrolls to the chart.
  const seen = useSeen(box);
  // Back on a page seen before, the web is simply there.
  const revisit = useRevisit();
  const total = areaStart + series.length * 150 + ENTER_MS;
  const entering = useEnterClock(total, seen && !revisit);
  const ms = revisit ? total : entering;

  // Each series' own motion: the first entrance runs on the shared clock; afterwards a series
  // whose data changed grows again on its own, and one whose scale moved eases to its new shape.
  const motions = useRef(new Map<string, SeriesMotion>());
  const [, setTick] = useState(0);
  const now = performance.now();
  const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const scoresOf = (m: SeriesMotion, si: number, key: string): number => {
    const target = m.to[key] ?? 0;
    if (m.mode === 'enter') return target * easeBack(phase(ms, areaStart + si * 150, ENTER_MS * 0.8));
    const k = reduce ? 1 : Math.min(1, (now - m.t0) / (m.mode === 'grow' ? ENTER_MS * 0.8 : MORPH_MS));
    if (m.mode === 'grow') return target * easeBack(k);
    const from = m.from[key] ?? target;
    return from + (target - from) * easeOut(k);
  };
  const motionOf = (s: RadarSeries, si: number) => {
    const key = s.dataKey ?? s.id;
    let m = motions.current.get(s.id);
    if (!m) {
      m = { dataKey: key, from: {}, to: s.scores, mode: 'enter', t0: now };
      motions.current.set(s.id, m);
    } else if (m.dataKey !== key) {
      Object.assign(m, { dataKey: key, from: {}, to: s.scores, mode: 'grow', t0: now });
    } else if (m.to !== s.scores && metrics.some((x) => m!.to[x.key] !== s.scores[x.key])) {
      const current = Object.fromEntries(metrics.map((x) => [x.key, scoresOf(m!, si, x.key)]));
      Object.assign(m, { from: current, to: s.scores, mode: 'morph', t0: now });
    }
    const mm = m;
    const opacity =
      reduce || mm.mode === 'morph'
        ? 1
        : mm.mode === 'enter'
          ? Math.min(1, easeBack(phase(ms, areaStart + si * 150, ENTER_MS * 0.8)) * 2)
          : Math.min(1, (now - mm.t0) / (ENTER_MS * 0.4));
    return { score: (k: string) => scoresOf(mm, si, k), opacity };
  };
  // Keep drawing while a series is still growing or easing.
  useEffect(() => {
    const busy = [...motions.current.values()].some((m) => m.mode !== 'enter' && performance.now() - m.t0 < (m.mode === 'grow' ? ENTER_MS * 0.8 : MORPH_MS));
    if (!busy || reduce) return;
    const raf = requestAnimationFrame(() => setTick((x) => x + 1));
    return () => cancelAnimationFrame(raf);
  });

  const n = metrics.length;
  const r = Math.max(0, size / 2 - 70);
  const angle = (i: number) => -Math.PI / 2 + (i * 2 * Math.PI) / n;
  const at = (i: number, score: number) => {
    const k = (Math.max(0, Math.min(100, score)) / 100) * r;
    return [Math.cos(angle(i)) * k, Math.sin(angle(i)) * k] as const;
  };
  const poly = (pts: (readonly [number, number])[]) => pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(2)},${p[1].toFixed(2)}`).join('') + 'Z';

  function onMove(e: React.PointerEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left - rect.width / 2;
    const y = e.clientY - rect.top - rect.height / 2;
    if (Math.hypot(x, y) > r * 1.35) return setHoverMetric(null);
    const a = Math.atan2(y, x);
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < n; i++) {
      const d = Math.abs(Math.atan2(Math.sin(a - angle(i)), Math.cos(a - angle(i))));
      if (d < bestD) [best, bestD] = [i, d];
    }
    setHoverMetric(best);
  }

  const hm = hoverMetric;
  // The card sits just outside the hovered axis, kept inside the chart's box.
  const tipAt = hm !== null ? at(hm, 120) : null;
  const cw = card.current?.offsetWidth ?? 150;
  const tip = tipAt ? [Math.min(boxW / 2 - cw / 2, Math.max(-boxW / 2 + cw / 2, tipAt[0])), tipAt[1]] : null;
  return (
    <div ref={box} className="relative h-full w-full select-none" role="img" aria-label={ariaLabel}>
      {size > 0 && (
        <svg
          width="100%"
          height="100%"
          viewBox={`${-size / 2} ${-size / 2} ${size} ${size}`}
          className="block overflow-visible"
          style={{ touchAction: 'pan-y' }}
          onPointerMove={onMove}
          onPointerDown={onMove}
          onPointerLeave={(e) => e.pointerType === 'mouse' && (setHoverMetric(null), setHoverSeries(null))}
        >
          {/* The web: rings scale out from the centre one after another, then their values fade in. */}
          {Array.from({ length: LEVELS }, (_, l) => {
            const t = easeBack(phase(ms, l * gridStagger, 500));
            const score = ((l + 1) / LEVELS) * 100;
            return (
              <g key={l} opacity={phase(ms, l * gridStagger, 300)}>
                <path d={poly(metrics.map((_, i) => at(i, score * t)))} fill="none" stroke={LINE} strokeWidth={1} />
                <text x={4} y={-((l + 1) / LEVELS) * r} dy="0.32em" fontSize={10} fill={MUTED} opacity={phase(ms, LEVELS * gridStagger + l * 60, 300)}>
                  {score}
                </text>
              </g>
            );
          })}
          {metrics.map((_, i) => {
            const [x, y] = at(i, 100 * easeOut(phase(ms, 0, 600)));
            return <line key={i} x1={0} y1={0} x2={x} y2={y} stroke={hm === i ? 'rgb(var(--c-fg))' : LINE} strokeOpacity={hm === i ? 0.6 : 1} style={{ transition: 'stroke 150ms ease' }} />;
          })}
          {/* Axis labels fly out from the centre. */}
          {metrics.map((m, i) => {
            const t = easeOut(phase(ms, 150 + i * 80, 500));
            const [x, y] = at(i, 100);
            const lx = (x / (r || 1)) * (r + 20) * t;
            const ly = (y / (r || 1)) * (r + 20) * t;
            const anchor = Math.abs(x) < 4 ? 'middle' : x > 0 ? 'start' : 'end';
            const lines = (m.short ?? m.label).split('\n');
            return (
              <text
                key={m.key}
                x={lx}
                y={ly}
                textAnchor={anchor}
                fontSize={12}
                fontWeight={hm === i ? 700 : 500}
                fill={hm === i ? 'rgb(var(--c-fg))' : MUTED}
                opacity={t}
                style={{ transition: 'fill 150ms ease' }}
              >
                {lines.map((line, k) => (
                  <tspan key={k} x={lx} dy={k === 0 ? `${0.35 - (lines.length - 1) * 0.6}em` : '1.2em'}>
                    {line}
                  </tspan>
                ))}
              </text>
            );
          })}
          {/* Series grow out of the centre in turn; the hovered one lifts, the rest step back. */}
          {series.map((s, si) => {
            const { score, opacity: t } = motionOf(s, si);
            const pts = metrics.map((m, i) => at(i, score(m.key)));
            const lifted = hoverSeries === si;
            const dimmed = hoverSeries !== null && !lifted;
            return (
              <g
                key={s.id}
                opacity={dimmed ? 0.3 : Math.min(1, t * 2)}
                style={{ transition: 'opacity 150ms ease' }}
                onPointerEnter={() => setHoverSeries(si)}
                onPointerLeave={() => setHoverSeries(null)}
              >
                <path
                  d={poly(pts)}
                  fill={s.color}
                  fillOpacity={lifted ? 0.35 : 0.15}
                  stroke={s.color}
                  strokeWidth={lifted ? 3 : 2}
                  strokeLinejoin="round"
                  style={{ transition: 'fill-opacity 200ms ease, stroke-width 200ms ease', filter: lifted ? `drop-shadow(0 0 12px ${s.color})` : 'none' }}
                />
                {pts.map(([x, y], i) => (
                  <circle
                    key={i}
                    cx={x}
                    cy={y}
                    r={4}
                    fill={s.color}
                    stroke="rgb(var(--c-panel))"
                    strokeWidth={2}
                    style={{
                      transformBox: 'fill-box',
                      transformOrigin: 'center',
                      transform: `scale(${lifted || hm === i ? 1.5 : 1})`,
                      transition: 'transform 260ms cubic-bezier(0.34, 1.56, 0.64, 1)',
                    }}
                  />
                ))}
              </g>
            );
          })}
        </svg>
      )}
      {hm !== null && tip && (
        <div
          ref={card}
          className="pointer-events-none absolute left-1/2 top-1/2 z-10 min-w-[9rem] overflow-hidden rounded-xl border border-line bg-panel/90 text-sm shadow-xl backdrop-blur-md"
          style={{
            transform: `translate(calc(${tip[0]}px - 50%), calc(${tip[1]}px - 50%))`,
            transition: 'transform 220ms cubic-bezier(0.22, 1, 0.36, 1)',
          }}
        >
          <div className="border-b border-line px-3 py-1.5 font-medium">{metrics[hm].label}</div>
          <div className="space-y-1 px-3 py-2">
            {series.map((s) => (
              <div key={s.id} className="flex items-center justify-between gap-4 whitespace-nowrap">
                <span className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
                  <span className="text-muted">{s.label}</span>
                </span>
                <span className="font-mono font-semibold tabular">{s.display[metrics[hm].key]}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
