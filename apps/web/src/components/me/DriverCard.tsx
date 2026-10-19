/**
 * The driver's rating on the Me page: pace against the record on a gauge, skills against the
 * fastest driver on the same roads, where time is lost, progress, totals and the rating drive by
 * drive.
 */
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { convertDistance, convertSpeed, speedLabel, type DistanceUnit, type SpeedUnit } from '@laptimer/core';
import { LineChart } from '../charts/LineChart';
import { Rolling } from '../ui/Rolling';
import { IconChevronRight } from '../ui/icons';
import { useSeen } from '../../hooks/useSeen';
import { ratingLabel, type DriverRating, type Skill, type SkillKey } from '../../lib/driverRating';

const SKILLS: { key: SkillKey; label: string }[] = [
  { key: 'braking', label: 'Braking' },
  { key: 'corners', label: 'Corners' },
  { key: 'accel', label: 'Acceleration' },
  { key: 'consistency', label: 'Consistency' },
];

const signed = (v: number, digits: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(digits)}`;

function detail(key: SkillKey, s: Skill | null, unit: SpeedUnit): string {
  if (!s) return key === 'consistency' ? 'Drive a road 3 times' : 'Needs a leaderboard lap to compare';
  if (key === 'consistency') return `±${s.value.toFixed(1)}% over your last laps`;
  if (key === 'corners') return `${signed(convertSpeed(s.value, unit), 0)} ${speedLabel(unit)} vs fastest`;
  return `${signed(s.value, 2)} g vs fastest`;
}

function Change({ value }: { value: number | null }) {
  if (value === null || Math.abs(value) < 0.5) return null;
  const up = value > 0;
  return (
    <span className={`font-mono text-xs font-bold tabular ${up ? 'text-gain' : 'text-loss'}`}>
      {up ? '↑' : '↓'} {signed(value, 0)}
    </span>
  );
}

/**
 * Counts from 0 (or the last value) up to `target` once `run` is true, slow at the end. The number
 * and its arc or bar read the same value, so they arrive together.
 */
function useCountUp(target: number | null, run: boolean, ms = 1400): number {
  const [value, setValue] = useState(0);
  const current = useRef(0);
  useEffect(() => {
    if (!run || target === null) return;
    if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) {
      current.current = target;
      setValue(target);
      return;
    }
    const from = current.current;
    const t0 = performance.now();
    let raf = requestAnimationFrame(function tick(now) {
      const k = Math.min(1, (now - t0) / ms);
      const v = from + (target - from) * (1 - (1 - k) ** 4);
      current.current = v;
      setValue(v);
      if (k < 1) raf = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(raf);
  }, [target, run, ms]);
  return value;
}

/** A half-circle gauge filled to `score` (0–100). */
function Gauge({ score }: { score: number }) {
  const arc = 'M -90 0 A 90 90 0 0 1 90 0';
  return (
    <svg viewBox="-104 -100 208 108" className="block w-full overflow-visible" aria-hidden="true">
      <defs>
        <linearGradient id="gauge-fill" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0%" stopColor="#7a0f0b" />
          <stop offset="100%" stopColor="rgb(var(--c-accent))" />
        </linearGradient>
      </defs>
      <path d={arc} fill="none" stroke="rgb(var(--c-raised))" strokeWidth={14} strokeLinecap="round" />
      {score > 0 && (
        <path
          d={arc}
          pathLength={1}
          fill="none"
          stroke="url(#gauge-fill)"
          strokeWidth={14}
          strokeLinecap="round"
          strokeDasharray="1 1"
          strokeDashoffset={1 - score / 100}
          style={{ filter: 'drop-shadow(0 0 8px rgb(var(--c-accent) / 0.45))' }}
        />
      )}
    </svg>
  );
}

const Pill = ({ children }: { children: React.ReactNode }) => <span className="rounded-full border border-line bg-raised px-3 py-1 text-xs font-bold">{children}</span>;

export function DriverCard({ rating, speedUnit, distanceUnit }: { rating: DriverRating; speedUnit: SpeedUnit; distanceUnit: DistanceUnit }) {
  const scored = SKILLS.map((s) => ({ ...s, skill: rating.skills[s.key] }));
  const strongest = scored.reduce<(typeof scored)[number] | null>((b, s) => (s.skill && (!b?.skill || s.skill.score > b.skill.score) ? s : b), null);
  const top = rating.topShare !== null ? Math.max(1, Math.ceil((rating.topShare * 100) / 5) * 5) : null;
  const overall = rating.overall === null ? null : Math.round(rating.overall);
  const card = useRef<HTMLElement>(null);
  const seen = useSeen(card);
  const shown = useCountUp(overall, seen);
  const dist = (m: number) => convertDistance(m, distanceUnit).toFixed(distanceUnit === 'km' ? 1 : 2);

  return (
    <div className="space-y-3 px-4">
      <section ref={card} className="rounded-2xl border border-line bg-panel px-5 pb-5 pt-4" aria-label={overall === null ? 'Driver rating not available yet' : `Driver rating ${overall} of 100`}>
        <div className="flex items-center justify-between">
          <span className="label">Driver rating</span>
          {rating.change !== null && Math.abs(rating.change) >= 0.5 && (
            <span className="flex items-center gap-1.5">
              <span className="label">Last drive</span>
              <Change value={rating.change} />
            </span>
          )}
        </div>
        <div className="relative mx-auto mt-2 max-w-[18rem]">
          <Gauge score={shown} />
          <div className="absolute inset-x-0 bottom-0 text-center">
            <div className="font-display text-[3.6rem] font-black leading-none tracking-tight tabular">{overall === null ? '—' : Math.round(shown)}</div>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap justify-center gap-1.5">
          {overall === null ? (
            <span className="text-sm text-muted">Drive a road with a leaderboard to get your rating</span>
          ) : (
            <>
              <Pill>{ratingLabel(overall)}</Pill>
              {top !== null && <Pill>Top {top}%</Pill>}
              {rating.provisional && <Pill>Provisional</Pill>}
            </>
          )}
        </div>
      </section>

      <div className="grid grid-cols-2 gap-3">
        {scored.map(({ key, label, skill }) => (
          <SkillTile key={key} label={label} skill={skill} detail={detail(key, skill, speedUnit)} lit={strongest?.key === key} />
        ))}

        <section className="rounded-2xl border border-line bg-panel p-4">
          <div className="label">Progress</div>
          <div className="mt-2 font-display text-[2.4rem] font-black leading-none tabular">
            {rating.progressPct !== null ? <Rolling text={`${signed(rating.progressPct, 1)}%`} from delay={250} /> : '—'}
          </div>
          <div className="mt-1.5 text-xs text-muted">{rating.progressPct !== null ? 'Faster than your first drive' : 'Drive a road again'}</div>
        </section>

        <section className="rounded-2xl border border-line bg-panel p-4">
          <div className="label">Driven</div>
          <div className="mt-2 font-display text-[2.4rem] font-black leading-none tabular">
            <Rolling text={String(Math.round(convertDistance(rating.totals.km * 1000, distanceUnit)))} from delay={250} />
            <span className="ml-1 text-base font-bold text-muted">{distanceUnit}</span>
          </div>
          <div className="mt-1.5 text-xs text-muted">
            {rating.totals.laps} lap{rating.totals.laps === 1 ? '' : 's'} · {rating.totals.roads} road{rating.totals.roads === 1 ? '' : 's'}
          </div>
        </section>
      </div>

      {rating.losses.length > 0 && (
        <section className="overflow-hidden rounded-2xl border border-line bg-panel">
          <div className="label px-4 pb-2 pt-4">Where you lose time</div>
          <ul>
            {rating.losses.map((l, i) => (
              <li key={i} className="border-t border-line">
                <Link
                  to={`/leaderboard/${l.circuitId}/compare?a=${encodeURIComponent(`me:${l.sessionId}#${l.lap}`)}&b=${encodeURIComponent(`lb:${l.refUid}`)}`}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-raised active:bg-raised"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{l.name}</span>
                    <span className="block truncate text-xs text-muted">
                      {dist(l.fromD)}–{dist(l.toD)} {distanceUnit} · vs {l.refName}
                    </span>
                  </span>
                  <span className="font-mono text-sm font-bold tabular text-loss">+{(l.lossMs / 1000).toFixed(1)} s</span>
                  <IconChevronRight width={18} height={18} className="text-muted" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {rating.history.length >= 2 && (
        <section className="rounded-2xl border border-line bg-panel px-2 pb-2 pt-4">
          <div className="flex items-center justify-between px-3">
            <span className="label">Last drives</span>
            <Change value={rating.change} />
          </div>
          <div className="h-36">
            <LineChart
              ariaLabel="Rating drive by drive"
              integerX
              yPad={0.25}
              series={[
                {
                  id: 'rating',
                  label: 'Rating',
                  color: 'rgb(var(--c-accent))',
                  width: 2,
                  area: 'gradient',
                  points: rating.history.map((h, i) => ({ x: i + 1, y: h.score })),
                  format: (v) => String(Math.round(v)),
                },
              ]}
              xFormat={(x) => String(x)}
              yFormat={(v) => String(Math.round(v))}
              pillLabel={(x) => `Drive ${x}`}
              tooltipTitle={(x) => new Date(rating.history[x - 1]?.t ?? 0).toLocaleDateString(undefined, { day: 'numeric', month: 'numeric', year: 'numeric' })}
            />
          </div>
        </section>
      )}
    </div>
  );
}

/** A skill: its score counts up and its bar grows with it once the tile is scrolled into view. */
function SkillTile({ label, skill, detail, lit }: { label: string; skill: Skill | null; detail: string; lit: boolean }) {
  const ref = useRef<HTMLElement>(null);
  const seen = useSeen(ref);
  const score = skill ? Math.round(skill.score) : null;
  const shown = useCountUp(score, seen, 1100);
  return (
    <section ref={ref} className={`rounded-2xl border bg-panel p-4 ${lit ? 'border-accent/60' : 'border-line'}`}>
      <div className="label">{label}</div>
      <div className="mt-2 font-display text-[2.4rem] font-black leading-none tabular">{score === null ? '—' : Math.round(shown)}</div>
      <div className="mt-1.5 text-xs text-muted">{detail}</div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-raised">
        <div className="h-full rounded-full bg-accent" style={{ width: `${shown}%` }} />
      </div>
    </section>
  );
}
