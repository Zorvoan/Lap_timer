import type { ReferenceLap } from './delta';

/** One finished sector of the lap in progress. */
export interface SectorSplit {
  /** 0-based sector index. */
  sector: number;
  timeMs: number;
  /** Against the same sector of the reference lap; null without a reference. */
  refDeltaMs: number | null;
  /** Faster than the driver's best time for this sector so far (a "purple" sector). */
  personalBest: boolean;
}

/**
 * Splits the lap in progress into `n` equal-distance sectors as it is driven, the same split
 * points the analysis uses (thirds by default). Feed it the lap's elapsed time and distance on
 * every fix; it reports each sector as its end is passed, interpolating the crossing time between
 * fixes, and the last one when the lap is completed.
 */
export class LiveSectors {
  private readonly bounds: number[];
  private times: number[] = [];
  private last: { t: number; d: number } | null = null;

  constructor(
    private readonly lapLengthM: number,
    private reference: ReferenceLap | null,
    private best: number[],
    private readonly n = 3,
  ) {
    this.bounds = Array.from({ length: n }, (_, i) => (lapLengthM * (i + 1)) / n);
  }

  setReference(ref: ReferenceLap | null): void {
    this.reference = ref;
  }

  /** Personal best per sector, as used for "purple" sectors. */
  get bestSectorsMs(): readonly number[] {
    return this.best;
  }

  /** Starts a new lap. */
  reset(): void {
    this.times = [];
    this.last = { t: 0, d: 0 };
  }

  /** A fix of the lap in progress. Returns the sectors whose end it passed (not the last). */
  update(elapsedMs: number, distanceM: number): SectorSplit[] {
    const out: SectorSplit[] = [];
    const prev = this.last ?? { t: 0, d: 0 };
    if (distanceM > prev.d) {
      while (this.times.length < this.n - 1 && distanceM >= this.bounds[this.times.length]) {
        const b = this.bounds[this.times.length];
        const f = (b - prev.d) / (distanceM - prev.d);
        out.push(this.close(prev.t + f * (elapsedMs - prev.t)));
      }
      this.last = { t: elapsedMs, d: distanceM };
    }
    return out;
  }

  /** The lap was completed at `lapTimeMs`: returns the last sector, or null if one was missed. */
  finish(lapTimeMs: number): SectorSplit | null {
    if (this.times.length !== this.n - 1) return null;
    return this.close(lapTimeMs);
  }

  private close(atMs: number): SectorSplit {
    const k = this.times.length;
    const startMs = k === 0 ? 0 : this.times[k - 1];
    this.times.push(atMs);
    const timeMs = atMs - startMs;
    let refDeltaMs: number | null = null;
    if (this.reference) {
      const scale = this.reference.lengthM / this.lapLengthM;
      const from = k === 0 ? 0 : this.reference.timeAt(this.bounds[k - 1] * scale);
      const to = k === this.n - 1 ? this.reference.lapTimeMs : this.reference.timeAt(this.bounds[k] * scale);
      refDeltaMs = timeMs - (to - from);
    }
    const personalBest = !(this.best[k] <= timeMs);
    if (personalBest) this.best = Object.assign([...this.best], { [k]: timeMs });
    return { sector: k, timeMs, refDeltaMs, personalBest };
  }
}
