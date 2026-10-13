import type { GpsSample } from '@laptimer/core';

export interface GpsAssessment {
  level: 'unknown' | 'good' | 'marginal' | 'unsuitable';
  message: string | null;
  medianAccuracyM: number | null;
  rateHz: number | null;
}

/**
 * Judges from recent fixes whether the device has a usable GPS receiver. Desktop browsers
 * usually position by Wi-Fi or IP, which reports accuracies of tens to thousands of metres.
 */
export function assessGps(samples: readonly GpsSample[]): GpsAssessment {
  const recent = samples.slice(-20);
  if (recent.length < 3) return { level: 'unknown', message: null, medianAccuracyM: null, rateHz: null };
  const accs = recent.map((s) => s.accuracy).sort((a, b) => a - b);
  const median = accs[Math.floor(accs.length / 2)];
  const span = (recent[recent.length - 1].t - recent[0].t) / 1000;
  const rate = span > 0 ? (recent.length - 1) / span : null;
  if (median > 100) {
    return {
      level: 'unsuitable',
      medianAccuracyM: median,
      rateHz: rate,
      message: `Position accuracy is about ${Math.round(median)} m. This device appears to locate itself by Wi-Fi or network rather than GPS. Lap timing needs a phone or receiver with GPS and a clear view of the sky.`,
    };
  }
  if (median > 20 || (rate !== null && rate < 0.5)) {
    return {
      level: 'marginal',
      medianAccuracyM: median,
      rateHz: rate,
      message: `GPS quality is marginal (about ${Math.round(median)} m${rate !== null ? `, ${rate.toFixed(1)} Hz` : ''}). Times and delta will be less precise.`,
    };
  }
  return { level: 'good', message: null, medianAccuracyM: median, rateHz: rate };
}
