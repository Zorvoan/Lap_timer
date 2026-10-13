import { z } from 'zod';

const finite = z.number().refine(Number.isFinite, 'must be finite');
const lonLat = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]);
const latLon = z.object({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180) });
export const timingLineSchema = z.object({ a: latLon, b: latLon, direction: z.union([z.literal(1), z.literal(-1)]) });
const id = z.string().min(1).max(100);

export const circuitSchema = z.object({
  id,
  name: z.string().min(1).max(120),
  kind: z.enum(['closed', 'sprint']),
  origin: z.enum(['routed', 'recorded', 'imported']),
  geometry: z.array(lonLat).min(2).max(100_000),
  waypoints: z.array(lonLat).max(500),
  routing: z.object({ provider: z.string().max(50), profile: z.string().max(50), warnings: z.array(z.string().max(500)).max(50) }).nullable(),
  startLine: timingLineSchema,
  finishLine: timingLineSchema.nullable(),
  sectors: z.array(timingLineSchema).max(50),
  lengthM: finite,
  elevation: z.array(z.object({ d: finite, elevation: finite })).max(1000).nullable(),
  createdAt: finite,
  updatedAt: finite,
});

const nullableNum = z.number().nullable();

export const lapSchema = z.object({
  lap: z.number().int().min(1),
  startT: finite,
  endT: finite,
  timeMs: z.number().positive(),
  sectorTimesMs: z.array(finite).max(50),
  distanceM: finite,
  avgSpeedMs: finite,
  maxSpeedMs: nullableNum,
  valid: z.boolean(),
  flags: z.array(z.string().max(50)).max(20),
  gps: z.object({ samples: z.number(), poorSamples: z.number(), meanAccuracyM: nullableNum, maxGapMs: z.number(), meanRateHz: z.number() }),
  trace: z.array(z.object({ t: finite, d: finite, v: nullableNum, lat: finite, lon: finite, accuracy: nullableNum })).max(200_000),
});

export const sessionSchema = z.object({
  id,
  circuitId: id,
  circuitName: z.string().max(120),
  source: z.enum(['gps', 'simulated']),
  startedAt: finite,
  endedAt: nullableNum,
  laps: z.array(lapSchema).max(5000),
  marks: z.array(z.object({ type: z.enum(['pause', 'resume']), t: finite })).max(10_000),
  reference: z.object({ sessionId: id, lap: z.number().int() }).nullable(),
  updatedAt: finite,
});

export const deletionSchema = z.object({ id, kind: z.enum(['circuit', 'session']), deletedAt: finite });

export const syncRequestSchema = z.object({
  /** Opaque cursor from the previous sync ('' for a full pull). */
  cursor: z.string().max(40),
  circuits: z.array(circuitSchema).max(1000),
  sessions: z.array(sessionSchema).max(1000),
  deletions: z.array(deletionSchema).max(5000),
});

export type CircuitDto = z.infer<typeof circuitSchema>;
export type SessionDto = z.infer<typeof sessionSchema>;
export type DeletionDto = z.infer<typeof deletionSchema>;
export type SyncRequest = z.infer<typeof syncRequestSchema>;
