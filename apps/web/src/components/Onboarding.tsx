import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { formatLapTime } from '@laptimer/core';
import { useAccount } from '../hooks/useData';
import { Button, buttonClass } from './ui/primitives';
import { IconBell, IconX } from './ui/icons';

// ---------------------------------------------------------------- open / seen

const seenKey = (uid: string) => `lt-tour-done:${uid}`;
let replay = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** Shows the tour again (Help page). */
export function openTour() {
  replay = true;
  emit();
}

function seen(uid: string): boolean {
  try {
    return localStorage.getItem(seenKey(uid)) === '1';
  } catch {
    return false;
  }
}

function markSeen(uid: string) {
  try {
    localStorage.setItem(seenKey(uid), '1');
  } catch {
    // shown again next start
  }
}

let tourOpen = false;
const setTourOpen = (v: boolean) => {
  if (tourOpen !== v) {
    tourOpen = v;
    emit();
  }
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** Whether the tour is on screen (other first-run prompts wait for it). */
export function useTourOpen(): boolean {
  return useSyncExternalStore(subscribe, () => tourOpen);
}

function useReducedMotion(): boolean {
  const [reduce, setReduce] = useState(() => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const m = matchMedia('(prefers-reduced-motion: reduce)');
    const on = () => setReduce(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return reduce;
}

// ---------------------------------------------------------------- steps

type Target = 'roads' | 'drive' | 'me' | null;

interface Step {
  kicker: string;
  title: string;
  body: string;
  target: Target;
  art: (reduce: boolean) => ReactNode;
}

const STEPS: Step[] = [
  {
    kicker: 'Welcome',
    title: 'Time your drives on real roads',
    body: "Lap Timer times a road from its start line to its finish with your phone's GPS and puts your best time on a leaderboard. Here is where everything is.",
    target: null,
    art: (reduce) => <WelcomeArt reduce={reduce} />,
  },
  {
    kicker: 'Roads',
    title: 'Pick a road',
    body: 'Official roads are red, public roads from other drivers amber, your own blue. Open one for its map, your laps and the leaderboard.',
    target: 'roads',
    art: () => <RoadsArt />,
  },
  {
    kicker: 'Drive',
    title: 'Tap Start and just drive',
    body: 'Drive finds the road nearest to you. Put the phone in a holder: the clock starts by itself at the start line and stops at the finish.',
    target: 'drive',
    art: (reduce) => <DriveArt reduce={reduce} />,
  },
  {
    kicker: 'Leaderboards',
    title: 'Race the others',
    body: 'Your best time goes on the road’s leaderboard. Race anyone’s lap live, and get a notification when someone beats you.',
    target: null,
    art: () => <BoardArt />,
  },
  {
    kicker: 'Me',
    title: 'Your drives and settings',
    body: 'Every drive with lap comparisons, your account, notifications and settings. This tour is in Me → How it works if you want it again.',
    target: 'me',
    art: () => <MeArt />,
  },
];

// ---------------------------------------------------------------- tour

/**
 * The first-run tour: five short steps, each pointing at the part of the app it explains (the
 * tab is lit through a hole in the dimmed screen). Shown once per account on this device, after
 * signing in; replayed from the Help page.
 */
export function Onboarding({ paused }: { paused: boolean }) {
  const acc = useAccount();
  const uid = acc.user?.uid;
  const ready = acc.status === 'signed_in' && !!acc.profile && !!uid;
  useSyncExternalStore(subscribe, () => replay);
  const want = ready && (replay || !seen(uid!));
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!want || paused || open) return;
    // A beat after the app appears, so the tour arrives instead of covering the first frame.
    const t = setTimeout(() => setOpen(true), 500);
    return () => clearTimeout(t);
  }, [want, paused, open]);
  useEffect(() => setTourOpen(open), [open]);

  if (!open || !uid) return null;
  return (
    <Tour
      nickname={acc.profile?.nickname ?? ''}
      onDone={() => {
        markSeen(uid);
        replay = false;
        setOpen(false);
      }}
    />
  );
}

function visible(sel: string): HTMLElement | null {
  return [...document.querySelectorAll<HTMLElement>(sel)].find((el) => el.getClientRects().length > 0) ?? null;
}

function Tour({ nickname, onDone }: { nickname: string; onDone: () => void }) {
  const reduce = useReducedMotion();
  const [i, setI] = useState(0);
  const [dir, setDir] = useState<'next' | 'back'>('next');
  const [closing, setClosing] = useState(false);
  const [spot, setSpot] = useState<DOMRect | null>(null);
  const [barTop, setBarTop] = useState<number | null>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const step = STEPS[i];
  const last = i === STEPS.length - 1;

  // Where the lit tab is, and where the bottom tab bar starts (the card sits above it).
  useLayoutEffect(() => {
    const measure = () => {
      const el = step.target ? visible(`[data-tour="${step.target}"]`) : null;
      setSpot(el ? el.getBoundingClientRect() : null);
      const bar = visible('[data-tour-bar]');
      setBarTop(bar ? bar.getBoundingClientRect().top : null);
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [step.target]);

  useEffect(() => nextRef.current?.focus({ preventScroll: true }), [i]);

  function go(to: number) {
    if (to < 0 || to >= STEPS.length || to === i) return;
    setDir(to > i ? 'next' : 'back');
    setI(to);
  }
  function finish() {
    if (closing) return;
    setClosing(true);
    setTimeout(onDone, reduce ? 0 : 220);
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') finish();
      else if (e.key === 'ArrowRight') go(i + 1);
      else if (e.key === 'ArrowLeft') go(i - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const pad = 6;
  return (
    <div className="tour fixed inset-0 z-[2100]" data-closing={closing || undefined} role="dialog" aria-modal="true" aria-labelledby="tour-title">
      {/* Dimmed screen: a plain layer, or a hole around the tab this step is about. */}
      <div className="tour-dim absolute inset-0 bg-black/75" style={{ opacity: spot ? 0 : 1 }} aria-hidden="true" />
      <div
        className="tour-spot pointer-events-none absolute left-0 top-0 rounded-2xl"
        style={{
          opacity: spot ? 1 : 0,
          width: (spot?.width ?? 0) + pad * 2,
          height: (spot?.height ?? 0) + pad * 2,
          transform: spot ? `translate(${spot.left - pad}px, ${spot.top - pad}px)` : undefined,
        }}
        aria-hidden="true"
      />

      <div
        className="absolute inset-x-0 top-0 flex items-center justify-center px-4 pt-[max(1rem,env(safe-area-inset-top))]"
        style={{ bottom: barTop !== null ? window.innerHeight - barTop + 14 : 0 }}
        onTouchStart={(e) => (touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY })}
        onTouchEnd={(e) => {
          const s = touch.current;
          touch.current = null;
          if (!s) return;
          const dx = e.changedTouches[0].clientX - s.x;
          const dy = e.changedTouches[0].clientY - s.y;
          if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) go(dx < 0 ? i + 1 : i - 1);
        }}
      >
        <div className="tour-card relative flex max-h-full w-full max-w-md flex-col overflow-hidden rounded-2xl border border-line bg-panel shadow-2xl">
          <button type="button" onClick={finish} className="press absolute right-2 top-2 z-10 flex h-9 items-center gap-1 rounded-full px-3 text-sm text-muted">
            {last ? <IconX width={16} height={16} /> : 'Skip'}
            {last && <span className="sr-only">Close</span>}
          </button>

          <div key={i} className="tour-slide min-h-0 overflow-y-auto" data-dir={dir}>
            <div className="tour-art flex h-[clamp(8.5rem,26dvh,12rem)] items-center justify-center border-b border-line bg-raised/60 px-4 pb-3 pt-10 land:hidden">{step.art(reduce)}</div>
            <div className="px-5 pb-1 pt-4 tiny:pt-3">
              <div className="label !text-[#d08a4e]">{i === 0 && nickname ? `Welcome, ${nickname}` : step.kicker}</div>
              <h2 id="tour-title" className="mt-1 font-display text-[1.45rem] font-black leading-tight tracking-tight tiny:text-xl">
                {step.title}
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-muted">{step.body}</p>
            </div>
          </div>

          <div className="flex items-center gap-3 px-5 pb-5 pt-4 tiny:pb-4 tiny:pt-3">
            <Dots count={STEPS.length} at={i} onPick={go} />
            <div className="ml-auto flex gap-2">
              {i > 0 && (
                <Button onClick={() => go(i - 1)}>Back</Button>
              )}
              <button ref={nextRef} type="button" className={buttonClass('primary', 'md', 'min-w-[5.5rem] whitespace-nowrap')} onClick={() => (last ? finish() : go(i + 1))}>
                {last ? 'Let’s go' : 'Next'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Step dots; the lit one slides to the current step. */
function Dots({ count, at, onPick }: { count: number; at: number; onPick: (i: number) => void }) {
  return (
    <div className="relative flex items-center gap-2" role="group" aria-label={`Step ${at + 1} of ${count}`}>
      {Array.from({ length: count }, (_, k) => (
        <button key={k} type="button" onClick={() => onPick(k)} aria-label={`Step ${k + 1}`} className="h-2 w-2 rounded-full bg-line" />
      ))}
      <span
        className="tour-dot pointer-events-none absolute left-0 top-1/2 h-2 w-2 rounded-full bg-accent"
        style={{ transform: `translate(${at * 16}px, -50%)` }}
        aria-hidden="true"
      />
    </div>
  );
}

// ---------------------------------------------------------------- illustrations

const ROAD = 'M18 112 C 58 112, 62 40, 108 46 S 160 112, 200 90 S 240 28, 262 30';
const RED = 'rgb(var(--c-accent))';
const AMBER = '#d08a4e';
const BLUE = '#5b8def';

/** A road drawing itself, then a car running it to the flag. */
function WelcomeArt({ reduce }: { reduce: boolean }) {
  return (
    <svg viewBox="0 0 280 140" className="h-full w-auto max-w-full" aria-hidden="true">
      <path d={ROAD} pathLength={1} fill="none" stroke="rgb(var(--c-line))" strokeWidth={14} strokeLinecap="round" className="tour-draw" />
      <path d={ROAD} pathLength={1} fill="none" stroke="rgb(var(--c-muted))" strokeWidth={1.5} strokeDasharray="0.02 0.02" opacity={0.6} />
      <g className="tour-pop" style={{ ['--d' as string]: '700ms' }}>
        <rect x={252} y={8} width={2.5} height={22} fill="rgb(var(--c-fg))" />
        {[0, 1, 2, 3].map((k) => (
          <rect key={k} x={254.5 + (k % 2) * 6} y={8 + Math.floor(k / 2) * 6} width={6} height={6} fill={k % 3 === 0 ? 'rgb(var(--c-fg))' : 'transparent'} stroke="rgb(var(--c-fg))" strokeWidth={0.6} />
        ))}
      </g>
      <circle r={7} fill={RED} stroke="rgb(var(--c-panel))" strokeWidth={2.5} cx={reduce ? 262 : 0} cy={reduce ? 30 : 0}>
        {/* Waits at the start while the road draws, runs it, pauses at the flag, again. */}
        {!reduce && <animateMotion dur="4s" repeatCount="indefinite" path={ROAD} keyPoints="0;0;1;1" keyTimes="0;0.22;0.85;1" calcMode="linear" />}
      </circle>
    </svg>
  );
}

/** Three roads, one per colour, drawing in turn with their labels. */
function RoadsArt() {
  const rows = [
    { c: RED, label: 'Official', y: 34, d: 'M24 34 C 70 14, 110 54, 160 34' },
    { c: AMBER, label: 'Community', y: 72, d: 'M24 72 C 64 92, 112 52, 160 72' },
    { c: BLUE, label: 'Yours', y: 110, d: 'M24 110 C 80 96, 104 126, 160 110' },
  ];
  return (
    <svg viewBox="0 0 280 140" className="h-full w-auto max-w-full" aria-hidden="true">
      {rows.map((r, k) => (
        <g key={r.label}>
          <path d={r.d} pathLength={1} fill="none" stroke={r.c} strokeWidth={6} strokeLinecap="round" className="tour-draw" style={{ ['--d' as string]: `${k * 160}ms` }} />
          <g className="tour-rise" style={{ ['--d' as string]: `${200 + k * 160}ms` }}>
            <rect x={176} y={r.y - 12} width={84} height={24} rx={12} fill={r.c} opacity={0.16} />
            <text x={218} y={r.y + 4} textAnchor="middle" fontSize={11} fontWeight={700} fill={r.c}>
              {r.label}
            </text>
          </g>
        </g>
      ))}
    </svg>
  );
}

/** A car crossing the start line; the clock starts the moment it does. */
function DriveArt({ reduce }: { reduce: boolean }) {
  const car = useRef<SVGGElement>(null);
  const [ms, setMs] = useState(reduce ? 72_480 : 0);
  useEffect(() => {
    if (reduce) return;
    const LOOP = 4200;
    const t0 = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const p = ((now - t0) % LOOP) / LOOP;
      const x = 20 + Math.min(1, p / 0.85) * 230;
      car.current?.setAttribute('transform', `translate(${x} 0)`);
      setMs(x < 96 ? 0 : Math.round(((x - 96) / 154) * 72_480));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [reduce]);
  return (
    <svg viewBox="0 0 280 140" className="h-full w-auto max-w-full" aria-hidden="true">
      <text x={140} y={40} textAnchor="middle" fontSize={26} fontWeight={800} fill="rgb(var(--c-fg))" className="font-mono tabular">
        {formatLapTime(ms)}
      </text>
      <rect x={10} y={82} width={260} height={34} rx={6} fill="rgb(var(--c-line))" />
      <line x1={14} y1={99} x2={266} y2={99} stroke="rgb(var(--c-muted))" strokeWidth={1.5} strokeDasharray="8 8" opacity={0.6} />
      {/* Start line, chequered. */}
      {Array.from({ length: 6 }, (_, k) => (
        <rect key={k} x={96 + (k % 2) * 5} y={82 + Math.floor(k / 2) * 11.33} width={5} height={11.33} fill={k % 2 === Math.floor(k / 2) % 2 ? 'rgb(var(--c-fg))' : 'rgb(var(--c-panel))'} />
      ))}
      <text x={101} y={130} textAnchor="middle" fontSize={9} fontWeight={700} fill="rgb(var(--c-muted))" letterSpacing="0.1em">
        START
      </text>
      <g ref={car} transform={reduce ? 'translate(200 0)' : 'translate(20 0)'}>
        <rect x={-12} y={91} width={24} height={16} rx={4} fill={RED} />
        <rect x={2} y={94} width={6} height={10} rx={1.5} fill="rgb(var(--c-panel))" opacity={0.7} />
      </g>
    </svg>
  );
}

/** Leaderboard rows rising in; "You" overtakes a place (the places stay put), then a notification drops in. */
function BoardArt() {
  const rows = [
    { name: 'Kuba', t: '3:10.87' },
    { name: 'Petr', t: '3:24.10', cls: 'tour-swap-down' },
    { name: 'You', t: '3:19.66', cls: 'tour-swap-up', you: true },
  ];
  return (
    <div className="relative w-[15.5rem] text-[12px]" aria-hidden="true">
      <div className="tour-note absolute -top-5 left-1/2 z-10 flex w-max -translate-x-1/2 items-center gap-1.5 rounded-full border border-line bg-panel px-2.5 py-1 text-[11px] font-semibold shadow-lg">
        <IconBell width={12} height={12} className="text-accent" /> You moved up to P2
      </div>
      <div className="flex gap-2">
        <div className="space-y-1">
          {[1, 2, 3].map((p) => (
            <div key={p} className="flex h-8 w-4 items-center justify-end font-mono text-muted">
              {p}
            </div>
          ))}
        </div>
        <div className="flex-1 space-y-1">
          {rows.map((r, k) => (
            <div key={r.name} className={`tour-rise ${r.cls ?? ''}`} style={{ ['--d' as string]: `${k * 90}ms` }}>
              <div className={`flex h-8 items-center gap-2 rounded-md px-2.5 ${r.you ? 'bg-accent/15 ring-1 ring-accent/50' : 'bg-panel'}`}>
                <span className="flex-1 font-semibold">{r.name}</span>
                <span className="font-mono tabular">{r.t}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** A stack of drive cards settling in, the newest in front with its lap chart drawing. */
function MeArt() {
  return (
    <div className="relative mt-6 h-[6.5rem] w-[14rem]" aria-hidden="true">
      {[2, 1, 0].map((k) => (
        <div
          key={k}
          className="tour-fan absolute inset-x-0 top-0 rounded-lg border border-line bg-panel px-3 py-2"
          style={{ ['--d' as string]: `${(2 - k) * 110}ms`, ['--y' as string]: `${-k * 12}px`, ['--s' as string]: String(1 - k * 0.07), zIndex: 3 - k }}
        >
          <div className="flex items-baseline justify-between text-[11px]">
            <span className="font-semibold">{['Barák', 'Troják', 'Komárov'][k]}</span>
            <span className="font-mono text-muted">{['3:37.66', '6:02.31', '4:48.90'][k]}</span>
          </div>
          {k === 0 && (
            <svg viewBox="0 0 200 40" className="mt-1 h-10 w-full">
              <path d="M0 30 C 20 10, 40 34, 60 22 S 100 4, 120 18 S 160 36, 200 12" pathLength={1} fill="none" stroke={RED} strokeWidth={2.5} strokeLinecap="round" className="tour-draw" style={{ ['--d' as string]: '380ms' }} />
              <path d="M0 26 C 24 18, 44 30, 64 24 S 104 14, 124 22 S 164 30, 200 20" pathLength={1} fill="none" stroke={BLUE} strokeWidth={2} strokeLinecap="round" opacity={0.8} className="tour-draw" style={{ ['--d' as string]: '520ms' }} />
            </svg>
          )}
        </div>
      ))}
    </div>
  );
}
