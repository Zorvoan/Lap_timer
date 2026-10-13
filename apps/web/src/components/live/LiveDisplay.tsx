import { formatDelta, formatLapTime, type GpsState, type LapState, type LiveDelta } from '@laptimer/core';

/**
 * The delta readout. Colour is backed by a symbol and a word (GAINING / LOSING) so the meaning
 * does not depend on colour vision. Unreliable values are not shown with false precision.
 */
export function DeltaDisplay({ delta, hasReference, referenceLabel }: { delta: LiveDelta | null; hasReference: boolean; referenceLabel: string | null }) {
  let body: JSX.Element;
  if (!hasReference) {
    body = (
      <div className="text-center">
        <div className="font-mono text-[clamp(2.5rem,12vw,7rem)] font-bold leading-none text-muted tabular">-.---</div>
        <div className="mt-2 text-sm font-semibold uppercase tracking-widest text-muted">No reference lap yet</div>
      </div>
    );
  } else if (!delta) {
    body = (
      <div className="text-center">
        <div className="font-mono text-[clamp(2.5rem,12vw,7rem)] font-bold leading-none text-muted tabular">-.---</div>
        <div className="mt-2 text-sm font-semibold uppercase tracking-widest text-muted">Delta starts after the line</div>
      </div>
    );
  } else if (!delta.reliable) {
    body = (
      <div className="text-center" aria-live="off">
        <div className="font-mono text-[clamp(2.5rem,12vw,7rem)] font-bold leading-none text-muted/60 tabular">≈ {formatDelta(delta.deltaMs, 1)}</div>
        <div className="mt-2 text-sm font-semibold uppercase tracking-widest text-warn">Delta unreliable · position uncertain</div>
      </div>
    );
  } else {
    const gaining = delta.deltaMs < 0;
    const even = Math.abs(delta.deltaMs) < 5;
    const tone = even ? 'text-fg' : gaining ? 'text-gain' : 'text-loss';
    body = (
      <div className="text-center">
        <div className={`flex items-center justify-center gap-3 font-mono text-[clamp(3rem,15vw,9rem)] font-bold leading-none tabular ${tone}`}>
          <span aria-hidden="true" className="text-[0.45em]">
            {even ? '■' : gaining ? '▼' : '▲'}
          </span>
          <span>{formatDelta(delta.deltaMs)}</span>
        </div>
        <div className={`mt-2 text-sm font-bold uppercase tracking-[0.25em] ${tone}`}>{even ? 'Even' : gaining ? 'Gaining' : 'Losing'}</div>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-center">
      <div className="label mb-2">Delta{referenceLabel ? ` · vs ${referenceLabel}` : ''}</div>
      {body}
    </div>
  );
}

const lapStateText: Record<LapState, string> = {
  waiting_start: 'Waiting for start',
  in_lap: 'Lap in progress',
  lap_completed: 'Lap completed',
  paused: 'Paused',
};

export function StatusChip({ lapState, gpsState }: { lapState: LapState; gpsState: GpsState }) {
  if (gpsState === 'lost' || gpsState === 'no_fix' || gpsState === 'weak') {
    const text = gpsState === 'no_fix' ? 'Waiting for GPS' : gpsState === 'lost' ? 'GPS signal lost' : 'GPS signal weak';
    return (
      <span className="inline-flex items-center gap-2 rounded-sm bg-warn px-2.5 py-1 text-xs font-bold uppercase tracking-wider text-black" role="status">
        <span aria-hidden="true">!</span> {text}
      </span>
    );
  }
  const cls =
    lapState === 'lap_completed' ? 'bg-fg text-bg' : lapState === 'in_lap' ? 'bg-accent text-white' : lapState === 'paused' ? 'bg-raised text-fg border border-line' : 'border border-line text-fg';
  return (
    <span className={`inline-flex items-center gap-2 rounded-sm px-2.5 py-1 text-xs font-bold uppercase tracking-wider ${cls}`} role="status">
      {lapState === 'in_lap' && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" aria-hidden="true" />}
      {lapStateText[lapState]}
    </span>
  );
}

export function GpsIndicator({ state, accuracy, rateHz }: { state: GpsState; accuracy: number | null; rateHz: number | null }) {
  const bars = state === 'good' ? (accuracy !== null && accuracy <= 5 ? 4 : accuracy !== null && accuracy <= 10 ? 3 : 2) : state === 'weak' ? 1 : 0;
  return (
    <span className="inline-flex items-center gap-2 text-xs text-muted" title="GPS quality">
      <span className="flex items-end gap-0.5" aria-hidden="true">
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className={`w-1 rounded-sm ${i < bars ? (bars <= 1 ? 'bg-warn' : 'bg-fg') : 'bg-line'}`} style={{ height: 5 + i * 3 }} />
        ))}
      </span>
      <span className="font-mono tabular">
        GPS {accuracy !== null ? `±${Math.round(accuracy)} m` : '—'}
        {rateHz !== null ? ` · ${rateHz.toFixed(1)} Hz` : ''}
      </span>
      <span className="sr-only">GPS status {state}</span>
    </span>
  );
}

export function BigTime({ ms, label }: { ms: number | null; label: string }) {
  return (
    <div className="text-center">
      <div className="label">{label}</div>
      <div className="font-mono text-[clamp(2.25rem,10vw,5.5rem)] font-semibold leading-tight tabular">{formatLapTime(ms)}</div>
    </div>
  );
}
