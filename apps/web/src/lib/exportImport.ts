/**
 * Export / import in the documented `laptimer-export` JSON format (see docs/DATA_FORMAT.md),
 * plus CSV telemetry export.
 */
import { z } from 'zod';
import type { Circuit, GpsSample, Session } from '@laptimer/core';

export const EXPORT_FORMAT = 'laptimer-export';
export const EXPORT_VERSION = 1;

const lonLat = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]);
const latLon = z.object({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180) });
const timingLine = z.object({ a: latLon, b: latLon, direction: z.union([z.literal(1), z.literal(-1)]) });
const finite = z.number().refine(Number.isFinite, 'must be finite');
const nullableNum = z.number().nullable();
const numOrNaN = z.union([z.number(), z.null()]).transform((v) => (v === null ? Number.NaN : v));

export const circuitSchema = z.object({
  id: z.string().min(1).max(100),
  name: z.string().min(1).max(120),
  kind: z.enum(['closed', 'sprint']),
  origin: z.enum(['routed', 'recorded', 'imported']),
  geometry: z.array(lonLat).min(2).max(200_000),
  waypoints: z.array(lonLat).max(500),
  routing: z.object({ provider: z.string(), profile: z.string(), warnings: z.array(z.string()) }).nullable(),
  startLine: timingLine,
  finishLine: timingLine.nullable(),
  sectors: z.array(timingLine).max(50),
  lengthM: finite,
  elevation: z.array(z.object({ d: finite, elevation: finite })).nullable(),
  createdAt: finite,
  updatedAt: finite,
});

const tracePoint = z.object({ t: finite, d: finite, v: nullableNum, lat: finite, lon: finite, accuracy: numOrNaN });

const lapSchema = z.object({
  lap: z.number().int().min(1),
  startT: finite,
  endT: finite,
  timeMs: z.number().positive(),
  sectorTimesMs: z.array(finite),
  distanceM: finite,
  avgSpeedMs: finite,
  maxSpeedMs: nullableNum,
  valid: z.boolean(),
  flags: z.array(z.enum(['poor_gps', 'signal_gap', 'tracking_lost', 'distance_mismatch', 'crossing_interpolated_over_gap', 'simulated'])),
  gps: z.object({
    samples: z.number(),
    poorSamples: z.number(),
    meanAccuracyM: numOrNaN,
    maxGapMs: z.number(),
    meanRateHz: z.number(),
  }),
  trace: z.array(tracePoint),
});

export const sessionSchema = z.object({
  id: z.string().min(1).max(100),
  circuitId: z.string().min(1).max(100),
  circuitName: z.string().max(120),
  source: z.enum(['gps', 'simulated']),
  startedAt: finite,
  endedAt: z.number().nullable(),
  laps: z.array(lapSchema).max(10_000),
  marks: z.array(z.object({ type: z.enum(['pause', 'resume']), t: finite })),
  reference: z.object({ sessionId: z.string(), lap: z.number().int() }).nullable(),
  updatedAt: finite,
});

const sampleSchema = z.object({
  t: finite,
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  accuracy: z.number().min(0),
  speed: nullableNum,
  heading: nullableNum,
  altitude: nullableNum,
  altitudeAccuracy: nullableNum,
});

export const exportSchema = z.object({
  format: z.literal(EXPORT_FORMAT),
  version: z.literal(EXPORT_VERSION),
  exportedAt: z.string(),
  circuits: z.array(circuitSchema),
  sessions: z.array(sessionSchema),
  samples: z.array(z.object({ sessionId: z.string(), samples: z.array(sampleSchema) })),
});

export type ExportFile = z.infer<typeof exportSchema>;

export function buildExport(circuits: Circuit[], sessions: Session[], samples: { sessionId: string; samples: GpsSample[] }[]): string {
  const file = {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    circuits,
    sessions,
    samples,
  };
  // NaN (unknown accuracy at interpolated lap boundaries) is not valid JSON: write null.
  return JSON.stringify(file, (_k, v) => (typeof v === 'number' && !Number.isFinite(v) ? null : v));
}

export class ImportError extends Error {}

export function parseExport(text: string): ExportFile {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new ImportError('The file is not valid JSON.');
  }
  const r = exportSchema.safeParse(json);
  if (!r.success) {
    const first = r.error.issues[0];
    throw new ImportError(`Not a valid Lap Timer export: ${first.path.join('.') || 'root'} — ${first.message}`);
  }
  return r.data;
}

function csvEscape(v: string | number | boolean | null | undefined): string {
  if (v === null || v === undefined || (typeof v === 'number' && !Number.isFinite(v))) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Per-lap telemetry aligned to lap time and distance. Speeds in m/s. */
export function lapsToCsv(session: Session): string {
  const rows = ['session_id,lap,lap_valid,elapsed_ms,distance_m,speed_ms,lat,lon,accuracy_m'];
  for (const lap of session.laps) {
    for (const p of lap.trace) {
      rows.push([session.id, lap.lap, lap.valid, p.t.toFixed(1), p.d.toFixed(2), p.v === null ? '' : p.v.toFixed(3), p.lat, p.lon, p.accuracy].map(csvEscape).join(','));
    }
  }
  return rows.join('\n');
}

export function samplesToCsv(sessionId: string, samples: GpsSample[]): string {
  const rows = ['session_id,timestamp_ms,iso_time,lat,lon,accuracy_m,speed_ms,heading_deg,altitude_m'];
  for (const s of samples) {
    rows.push([sessionId, s.t, new Date(s.t).toISOString(), s.lat, s.lon, s.accuracy, s.speed, s.heading, s.altitude].map(csvEscape).join(','));
  }
  return rows.join('\n');
}

export function downloadText(filename: string, text: string, mime: string): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
