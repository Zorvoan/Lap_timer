/**
 * Minimal logger. Never pass coordinates or raw samples: location data stays out of logs.
 * Debug output is enabled in development builds only.
 */
const debugEnabled = Boolean(import.meta.env?.DEV);

export const log = {
  debug(msg: string, meta?: Record<string, string | number | boolean | null>) {
    if (debugEnabled) console.debug(`[laptimer] ${msg}`, meta ?? '');
  },
  warn(msg: string, meta?: Record<string, string | number | boolean | null>) {
    console.warn(`[laptimer] ${msg}`, meta ?? '');
  },
  error(msg: string, err?: unknown) {
    console.error(`[laptimer] ${msg}`, err instanceof Error ? err.message : err ?? '');
  },
};

export function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
