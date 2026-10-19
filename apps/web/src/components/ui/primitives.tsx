import { useEffect, useState, type ButtonHTMLAttributes, type ReactNode, type InputHTMLAttributes, type SelectHTMLAttributes } from 'react';
import { Rolling } from './Rolling';
import { Link, type LinkProps } from 'react-router-dom';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg' | 'xl';

const variants: Record<Variant, string> = {
  primary: 'bg-accent text-white hover:brightness-110 border border-accent',
  secondary: 'bg-raised text-fg border border-line hover:border-muted',
  ghost: 'bg-transparent text-fg border border-transparent hover:bg-raised active:bg-raised',
  danger: 'bg-transparent text-loss border border-loss/50 hover:bg-loss/10',
};

const sizes: Record<Size, string> = {
  sm: 'h-8 px-3 text-xs gap-1.5',
  md: 'h-10 px-4 text-sm gap-2',
  lg: 'h-12 px-5 text-base gap-2',
  xl: 'h-16 px-6 text-lg gap-3',
};

export function buttonClass(variant: Variant = 'secondary', size: Size = 'md', extra = ''): string {
  return `inline-flex select-none items-center justify-center rounded font-semibold tracking-wide press disabled:cursor-not-allowed disabled:opacity-40 ${variants[variant]} ${sizes[size]} ${extra}`;
}

export function Button({
  variant = 'secondary',
  size = 'md',
  className = '',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }) {
  return <button type="button" className={buttonClass(variant, size, className)} {...rest} />;
}

/**
 * Two-step button for destructive actions: the first press arms it, the second within a few
 * seconds runs the action. Used instead of window.confirm, which embedded browsers and some
 * installed PWAs suppress (it then returns false and the action silently never happens).
 */
export function ConfirmButton({
  onConfirm,
  confirmLabel,
  children,
  variant = 'danger',
  size = 'md',
  className = '',
  disabled,
  ...rest
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'> & {
  onConfirm: () => void | Promise<void>;
  confirmLabel: ReactNode;
  variant?: Variant;
  size?: Size;
}) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <button
      type="button"
      disabled={disabled}
      aria-live="polite"
      className={buttonClass(armed ? 'primary' : variant, size, `${armed ? 'ring-2 ring-fg' : ''} ${className}`)}
      onClick={() => {
        if (!armed) return setArmed(true);
        setArmed(false);
        void onConfirm();
      }}
      {...rest}
    >
      {armed ? confirmLabel : children}
    </button>
  );
}

export function LinkButton({ variant = 'secondary', size = 'md', className = '', ...rest }: LinkProps & { variant?: Variant; size?: Size }) {
  return <Link className={buttonClass(variant, size, className)} {...rest} />;
}

export function Panel({ title, actions, children, className = '', bodyClass = 'p-4' }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; bodyClass?: string }) {
  return (
    <section className={`rounded border border-line bg-panel ${className}`}>
      {(title || actions) && (
        <header className="flex min-h-11 items-center justify-between gap-3 border-b border-line px-4 py-2">
          {title && <h2 className="label">{title}</h2>}
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={bodyClass}>{children}</div>
    </section>
  );
}

export function Stat({ label, value, unit, hint, className = '' }: { label: string; value: ReactNode; unit?: string; hint?: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <div className="label">{label}</div>
      <div className="mt-1 font-mono text-xl tabular">
        {typeof value === 'string' ? <Rolling text={value} /> : value}
        {unit && <span className="ml-1 text-xs text-muted">{unit}</span>}
      </div>
      {hint && <div className="mt-0.5 text-xs text-muted">{hint}</div>}
    </div>
  );
}

type Tone = 'neutral' | 'accent' | 'gain' | 'loss' | 'warn';
const tones: Record<Tone, string> = {
  neutral: 'border-line text-muted',
  accent: 'border-accent text-accent',
  gain: 'border-gain/60 text-gain',
  loss: 'border-loss/60 text-loss',
  warn: 'border-warn/60 text-warn',
};

export function Badge({ tone = 'neutral', children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return (
    <span title={title} className={`inline-flex items-center rounded-sm border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${tones[tone]}`}>
      {children}
    </span>
  );
}

export function SimBadge() {
  return (
    <Badge tone="warn" title="Recorded with the development GPS simulator, not real GPS">
      Simulated
    </Badge>
  );
}

export function Notice({ tone = 'info', title, children, action }: { tone?: 'info' | 'warn' | 'error'; title?: string; children: ReactNode; action?: ReactNode }) {
  const t = tone === 'error' ? 'border-loss/60' : tone === 'warn' ? 'border-warn/60' : 'border-line';
  const bar = tone === 'error' ? 'bg-loss' : tone === 'warn' ? 'bg-warn' : 'bg-muted';
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={`relative flex gap-3 rounded border bg-panel p-3 pl-4 text-sm ${t}`}>
      <span className={`absolute inset-y-0 left-0 w-1 rounded-l ${bar}`} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        {title && <div className="mb-0.5 font-semibold">{title}</div>}
        <div className="text-muted">{children}</div>
      </div>
      {action}
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      <div className="mt-1.5">{children}</div>
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

const inputClass = 'h-10 w-full rounded border border-line bg-raised px-3 text-sm text-fg placeholder:text-muted focus:border-muted focus:outline-none';

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${inputClass} ${props.className ?? ''}`} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`${inputClass} ${props.className ?? ''}`} />;
}

export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4 py-2">
      <span>
        <span className="text-sm">{label}</span>
        {hint && <span className="mt-0.5 block text-xs text-muted">{hint}</span>}
      </span>
      <input type="checkbox" className="peer sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span
        aria-hidden="true"
        className="relative mt-0.5 h-6 w-11 shrink-0 rounded-full border border-line bg-raised transition-colors after:absolute after:left-0.5 after:top-0.5 after:h-[18px] after:w-[18px] after:rounded-full after:bg-muted after:transition-transform motion-reduce:after:transition-none peer-checked:border-accent peer-checked:bg-accent peer-checked:after:translate-x-5 peer-checked:after:bg-white peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-accent"
      />
    </label>
  );
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-3 rounded border border-dashed border-line p-6">
      <div className="font-semibold">{title}</div>
      {children && <div className="text-sm text-muted">{children}</div>}
      {action}
    </div>
  );
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm text-muted" role="status">
      <span className="h-3 w-3 animate-spin rounded-full border-2 border-muted border-t-transparent" aria-hidden="true" />
      {label}
    </span>
  );
}

/**
 * Two or three choices in one control (List / Map, Leaderboard / My laps). The highlight slides
 * to the chosen one, so it is clear what changed.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  className = '',
  itemClass = 'h-9',
}: {
  options: { value: T; label: ReactNode }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
  className?: string;
  itemClass?: string;
}) {
  const i = Math.max(0, options.findIndex((o) => o.value === value));
  return (
    <div role="tablist" aria-label={label} className={`relative grid rounded border border-line bg-raised p-1 text-sm font-semibold ${className}`} style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      <span
        aria-hidden="true"
        className="absolute bottom-1 left-1 top-1 rounded bg-panel shadow transition-transform duration-[250ms] ease-[cubic-bezier(0.25,1,0.5,1)] motion-reduce:transition-none"
        style={{ width: `calc((100% - 0.5rem) / ${options.length})`, transform: `translateX(${i * 100}%)` }}
      />
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={o.value === value}
          onClick={() => onChange(o.value)}
          className={`relative rounded px-2 transition-colors duration-200 [touch-action:manipulation] ${itemClass} ${o.value === value ? 'text-fg' : 'text-muted hover:text-fg'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Keeps something mounted for `exitMs` after `open` turns false, so it can animate out. */
export function usePresence(open: boolean, exitMs = 200): { mounted: boolean; closing: boolean } {
  const [mounted, setMounted] = useState(open);
  useEffect(() => {
    if (open) return setMounted(true);
    const t = setTimeout(() => setMounted(false), exitMs);
    return () => clearTimeout(t);
  }, [open, exitMs]);
  return { mounted: open || mounted, closing: !open && mounted };
}

/** A sheet that slides up from the bottom (a centred dialog on desktop with `center`). */
export function Sheet({
  open,
  onClose,
  labelledBy,
  center = false,
  children,
}: {
  open: boolean;
  onClose: () => void;
  labelledBy: string;
  center?: boolean;
  children: ReactNode;
}) {
  const { mounted, closing } = usePresence(open);
  if (!mounted) return null;
  return (
    <div className={`fixed inset-0 z-[2000] flex items-end ${center ? 'md:items-center md:justify-center' : ''}`} onClick={closing ? undefined : onClose}>
      <div className="sheet-backdrop absolute inset-0 bg-black/60" data-closing={closing || undefined} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        data-closing={closing || undefined}
        data-center={center || undefined}
        className={`sheet relative w-full border-t border-line bg-panel p-4 pb-[max(1rem,env(safe-area-inset-bottom))] pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] ${center ? 'md:max-w-md md:rounded md:border' : ''}`}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
