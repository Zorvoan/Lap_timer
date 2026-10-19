/**
 * The driver's rating on the Me page: an overall score on a gauge, a tile per skill (braking,
 * corners, acceleration, consistency), progress since the first drive, the days driven this week
 * and the rating drive by drive.
 */
import { useRef } from 'react';
import { formatSpeed, speedLabel, type SpeedUnit } from '@laptimer/core';
import { LineChart } from '../charts/LineChart';
import { Rolling } from '../ui/Rolling';
import { useSeen } from '../../hooks/useSeen';
import { ratingLabel, type DriverRating, type Skill, type SkillKey } from '../../lib/driverRating';

const SKILLS: { key: SkillKey; label: string }[] = [
  { key: 'braking', label: 'Braking' },
  { key: 'corners', label: 'Corners' },
  { key: 'accel', label: 'Acceleration' },
  { key: 'consistency', label: 'Consistency' },
];

const DAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function detail(key: SkillKey, s: Skill | null, unit: SpeedUnit): string {
  if (!s) return key === 'consistency' ? 'Drive a road 3 times' : 'Not enough data yet';
  if (key === 'corners') return `${formatSpeed(s.value, unit)} ${speedLabel(unit)} at the apex`;
  if (key === 'consistency') return `±${s.value.toFixed(1)}% lap to lap`;
  return `${s.value.toFixed(2)} g on average`;
}

function Change({ value }: { value: number | null }) {
  if (value === null || Math.abs(value) < 0.05) return null;
  const up = value > 0;
  return (
    <span className={`font-mono text-xs font-bold tabular ${up ? 'text-gain' : 'text-loss'}`}>
      {up ? '↑' : '↓'} {up ? '+' : '−'}
      {Math.abs(value).toFixed(1)}
    </span>
  );
}

/** A half-circle gauge whose arc fills to the score once it is scrolled into view. */
function Gauge({ score }: { score: number }) {
  const ref = useRef<SVGSVGElement>(null);
  const seen = useSeen(ref);
  const arc = 'M -90 0 A 90 90 0 0 1 90 0';
  return (
    <svg ref={ref} viewBox="-104 -100 208 108" className="block w-full overflow-visible" aria-hidden="true">
      <defs>
        <linearGradient id="gauge-fill" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0%" stopColor="#7a0f0b" />
          <stop offset="100%" stopColor="rgb(var(--c-accent))" />
        </linearGradient>
      </defs>
      <path d={arc} fill="none" stroke="rgb(var(--c-raised))" strokeWidth={14} strokeLinecap="round" />
      <path
        d={arc}
        pathLength={1}
        fill="none"
        stroke="url(#gauge-fill)"
        strokeWidth={14}
        strokeLinecap="round"
        strokeDasharray="1 1"
        strokeDashoffset={seen ? 1 - score / 100 : 1}
        className="gauge-fill"
        style={{ filter: 'drop-shadow(0 0 8px rgb(var(--c-accent) / 0.45))' }}
      />
    </svg>
  );
}

export function DriverCard({ rating, speedUnit }: { rating: DriverRating; speedUnit: SpeedUnit }) {
  const scored = SKILLS.map((s) => ({ ...s, skill: rating.skills[s.key] }));
  const strongest = scored.reduce<(typeof scored)[number] | null>((b, s) => (s.skill && (!b?.skill || s.skill.score > b.skill.score) ? s : b), null);
  const top = rating.topShare !== null ? Math.max(1, Math.ceil((rating.topShare * 100) / 5) * 5) : null;
  const last = rating.history[rating.history.length - 1];

  return (
    <div className="space-y-3 px-4">
      <section className="rounded-2xl border border-line bg-panel px-5 pb-5 pt-4" aria-label={`Driver rating ${rating.overall.toFixed(1)} of 100`}>
        <div className="flex items-center justify-between">
          <span className="label">Driver rating</span>
          {rating.change !== null && (
            <span className="flex items-center gap-1.5">
              <span className="label">Last drive</span>
              <Change value={rating.change} />
            </span>
          )}
        </div>
        <div className="relative mx-auto mt-2 max-w-[18rem]">
          <Gauge score={rating.overall} />
          <div className="absolute inset-x-0 bottom-0 text-center">
            <div className="font-display text-[3.4rem] font-black leading-none tracking-tight tabular">
              <Rolling text={rating.overall.toFixed(1)} from delay={150} />
            </div>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap justify-center gap-1.5">
          <span className="rounded-full border border-line bg-raised px-3 py-1 text-xs font-bold">{ratingLabel(rating.overall)}</span>
          {top !== null && <span className="rounded-full border border-line bg-raised px-3 py-1 text-xs font-bold">Top {top}%</span>}
          {rating.pace !== null && <span className="rounded-full border border-line bg-raised px-3 py-1 text-xs font-bold">Pace {Math.round(rating.pace)}</span>}
        </div>
      </section>

      <div className="grid grid-cols-2 gap-3">
        {scored.map(({ key, label, skill }) => {
          const lit = strongest?.key === key;
          return (
            <section key={key} className={`rounded-2xl border bg-panel p-4 ${lit ? 'border-accent/60' : 'border-line'}`}>
              <div className="label">{label}</div>
              <div className="mt-2 font-display text-[2.4rem] font-black leading-none tabular">{skill ? <Rolling text={String(Math.round(skill.score))} from delay={250} /> : '—'}</div>
              <div className="mt-1.5 text-xs text-muted">{detail(key, skill, speedUnit)}</div>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-raised">
                <Bar value={skill?.score ?? 0} color="rgb(var(--c-accent))" />
              </div>
            </section>
          );
        })}

        <section className="rounded-2xl border border-line bg-panel p-4">
          <div className="label">Progress</div>
          <div className="mt-2 font-display text-[2.4rem] font-black leading-none tabular">
            {rating.progressPct !== null ? <Rolling text={`${rating.progressPct >= 0 ? '+' : '−'}${Math.abs(rating.progressPct).toFixed(1)}%`} from delay={250} /> : '—'}
          </div>
          <div className="mt-1.5 text-xs text-muted">{rating.progressPct !== null ? 'Faster than your first drive' : 'Drive a road again'}</div>
        </section>

        <section className="rounded-2xl border border-line bg-panel p-4">
          <div className="label">This week</div>
          <div className="mt-3 grid grid-cols-7 gap-1">
            {rating.days.map((d, i) => (
              <div key={i} className="flex flex-col items-center gap-1">
                <span
                  className={`aspect-square w-full rounded-[4px] ${d.drove ? 'bg-accent' : 'bg-raised'} ${i === 6 ? 'ring-1 ring-fg/60 ring-offset-1 ring-offset-panel' : ''}`}
                  title={d.date.toLocaleDateString()}
                />
                <span className="text-[10px] text-muted">{DAY_LETTERS[d.date.getDay()]}</span>
              </div>
            ))}
          </div>
          <div className="mt-2 text-xs text-muted">
            {rating.days.filter((d) => d.drove).length} of 7 days driven
          </div>
        </section>
      </div>

      {rating.history.length >= 2 && (
        <section className="rounded-2xl border border-line bg-panel px-2 pb-2 pt-4">
          <div className="flex items-center justify-between px-3">
            <span className="label">Last drives</span>
            <span className="flex items-center gap-2">
              <Change value={rating.change} />
              {last && <span className="font-mono text-xs tabular text-muted">{last.score.toFixed(1)}</span>}
            </span>
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
                  format: (v) => v.toFixed(1),
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

/** A skill's bar, growing to its score once it is scrolled into view. */
function Bar({ value, color }: { value: number; color: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const seen = useSeen(ref);
  return <div ref={ref} className="gauge-bar h-full rounded-full" style={{ width: `${seen ? value : 0}%`, background: color }} />;
}
