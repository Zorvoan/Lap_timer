/** One point of a lap expressed in the circuit's distance coordinate. */
export interface TracePoint {
  /** Elapsed lap time, ms. */
  t: number;
  /** Distance from the start line along the circuit, metres. */
  d: number;
}

/**
 * A lap reduced to a monotonic time-at-distance function, for comparing laps at equivalent
 * positions on the circuit instead of at equal elapsed times.
 */
export class ReferenceLap {
  private constructor(
    readonly lapTimeMs: number,
    readonly lengthM: number,
    private readonly d: Float64Array,
    private readonly t: Float64Array,
  ) {}

  /**
   * Builds the reference from a lap trace. Points are sorted by time; distance is forced to be
   * non-decreasing and only the first time each distance is reached is kept, so stops and GPS
   * jitter cannot make the function multi-valued. The lap endpoints (0, 0) and (length, lapTime)
   * are always included.
   */
  static fromTrace(trace: TracePoint[], lapTimeMs: number, lengthM: number): ReferenceLap {
    if (!(lapTimeMs > 0) || !(lengthM > 0)) throw new Error('Reference lap needs a positive time and length.');
    const pts = trace
      .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.d) && p.t > 0 && p.t < lapTimeMs && p.d > 0 && p.d < lengthM)
      .sort((a, b) => a.t - b.t);
    const ds: number[] = [0];
    const ts: number[] = [0];
    for (const p of pts) {
      if (p.d <= ds[ds.length - 1]) continue;
      ds.push(p.d);
      ts.push(p.t);
    }
    ds.push(lengthM);
    ts.push(lapTimeMs);
    return new ReferenceLap(lapTimeMs, lengthM, Float64Array.from(ds), Float64Array.from(ts));
  }

  get pointCount(): number {
    return this.d.length;
  }

  /** Reference elapsed time when it was at distance `dM`, linearly interpolated. */
  timeAt(dM: number): number {
    const d = this.d;
    const t = this.t;
    if (dM <= 0) return 0;
    if (dM >= this.lengthM) return this.lapTimeMs;
    let lo = 0;
    let hi = d.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (d[mid] <= dM) lo = mid;
      else hi = mid;
    }
    const span = d[hi] - d[lo];
    const f = span > 0 ? (dM - d[lo]) / span : 0;
    return t[lo] + f * (t[hi] - t[lo]);
  }
}

export interface DeltaResult {
  /** Current elapsed − reference elapsed at the same distance, ms. Negative = faster. */
  deltaMs: number;
  referenceElapsedMs: number;
  /** Reference lap time + delta. An estimate, not a prediction of the finish. */
  projectedLapMs: number;
}

/** Delta against a reference at the same distance along the circuit. */
export function computeDelta(ref: ReferenceLap, elapsedMs: number, distanceM: number): DeltaResult {
  const referenceElapsedMs = ref.timeAt(distanceM);
  const deltaMs = elapsedMs - referenceElapsedMs;
  return { deltaMs, referenceElapsedMs, projectedLapMs: ref.lapTimeMs + deltaMs };
}
