import { z } from 'zod';

export const settingsSchema = z.object({
  speedUnit: z.enum(['kmh', 'mph']),
  distanceUnit: z.enum(['km', 'mi']),
  /** Fixes with a worse accuracy radius are not used for timing, metres. */
  gpsMaxAccuracyM: z.number().min(3).max(100),
  minLapSeconds: z.number().min(5).max(3600),
  referenceMode: z.enum(['personal_best', 'session_best', 'none']),
  audioLapBeep: z.boolean(),
  voiceAnnouncements: z.boolean(),
  keepScreenOn: z.boolean(),
  showLiveMap: z.boolean(),
  /** A sprint session stops and saves itself a few seconds after the finish line. */
  autoStopSprint: z.boolean(),
  theme: z.enum(['dark', 'light']),
  mapStyle: z.enum(['dark', 'standard']),
  /** Keep raw GPS samples with saved sessions (needed for re-processing and raw export). */
  storeRawSamples: z.boolean(),
  /** Include simulated sessions when computing personal bests. */
  includeSimulatedInBests: z.boolean(),
  syncEnabled: z.boolean(),
  syncUrl: z.string().max(300),
});

export type Settings = z.infer<typeof settingsSchema>;

export const DEFAULT_SETTINGS: Settings = {
  speedUnit: 'kmh',
  distanceUnit: 'km',
  gpsMaxAccuracyM: 20,
  minLapSeconds: 20,
  referenceMode: 'personal_best',
  audioLapBeep: true,
  voiceAnnouncements: false,
  keepScreenOn: true,
  showLiveMap: true,
  autoStopSprint: true,
  theme: 'dark',
  mapStyle: 'dark',
  storeRawSamples: true,
  includeSimulatedInBests: false,
  syncEnabled: false,
  syncUrl: '',
};

/** Merges stored settings over defaults, dropping anything invalid (e.g. from older versions). */
export function normalizeSettings(raw: unknown): Settings {
  const merged = { ...DEFAULT_SETTINGS, ...(typeof raw === 'object' && raw ? raw : {}) };
  const parsed = settingsSchema.safeParse(merged);
  if (parsed.success) return parsed.data;
  const out: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
    const field = settingsSchema.shape[key].safeParse((merged as Record<string, unknown>)[key]);
    if (field.success) out[key] = field.data;
  }
  return out as Settings;
}
