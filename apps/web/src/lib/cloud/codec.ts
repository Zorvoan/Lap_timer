/**
 * Encoding of circuits and sessions as Firestore documents.
 *
 * Firestore forbids nested arrays and caps documents at 1 MiB, so coordinate lists and lap
 * traces are stored as JSON strings (full double precision, nothing rounded), and long lap
 * traces are split into chunk documents. Chunks carry the session version they belong to, so a
 * reader never mixes chunks from two different uploads of the same session.
 */
import type { Circuit, LapRecord, LapTracePoint, Session } from '@laptimer/core';
import { circuitSchema, sessionSchema } from '../exportImport';

export const CLOUD_SCHEMA = 1;
/** Trace points per chunk document (~75 bytes each as JSON → well under the 1 MiB limit). */
export const TRACE_CHUNK_POINTS = 4000;

const json = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === 'number' && !Number.isFinite(x) ? null : x));

export interface CircuitDoc {
  schema: number;
  id: string;
  name: string;
  kind: Circuit['kind'];
  origin: Circuit['origin'];
  lengthM: number;
  createdAt: number;
  updatedAt: number;
  routing: Circuit['routing'];
  startLine: Circuit['startLine'];
  finishLine: Circuit['finishLine'];
  sectors: Circuit['sectors'];
  /** JSON: [lon, lat][] */
  geometry: string;
  /** JSON: [lon, lat][] */
  waypoints: string;
  /** JSON: {d, elevation}[] | null */
  elevation: string;
}

export interface SessionDoc {
  schema: number;
  id: string;
  circuitId: string;
  circuitName: string;
  source: Session['source'];
  startedAt: number;
  endedAt: number | null;
  updatedAt: number;
  marks: Session['marks'];
  reference: Session['reference'];
  /** JSON: laps without their traces (traces are in chunk documents). */
  laps: string;
  /** Version of the trace chunks that belong to this document (= updatedAt at upload). */
  traceVersion: number;
  traceChunks: number;
}

export interface TraceChunkDoc {
  /** Document id: `${version}_${lap}_${chunk}`. */
  id: string;
  version: number;
  lap: number;
  chunk: number;
  /** JSON: columnar {t, d, v, lat, lon, acc} arrays. */
  data: string;
}

interface Columns {
  t: number[];
  d: number[];
  v: (number | null)[];
  lat: number[];
  lon: number[];
  acc: (number | null)[];
}

export function encodeCircuit(c: Circuit): CircuitDoc {
  return {
    schema: CLOUD_SCHEMA,
    id: c.id,
    name: c.name,
    kind: c.kind,
    origin: c.origin,
    lengthM: c.lengthM,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    routing: c.routing,
    startLine: c.startLine,
    finishLine: c.finishLine,
    sectors: c.sectors,
    geometry: json(c.geometry),
    waypoints: json(c.waypoints),
    elevation: json(c.elevation),
  };
}

export function decodeCircuit(doc: CircuitDoc): Circuit {
  const raw = {
    id: doc.id,
    name: doc.name,
    kind: doc.kind,
    origin: doc.origin,
    lengthM: doc.lengthM,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    routing: doc.routing ?? null,
    startLine: doc.startLine,
    finishLine: doc.finishLine ?? null,
    sectors: doc.sectors ?? [],
    geometry: JSON.parse(doc.geometry),
    waypoints: JSON.parse(doc.waypoints),
    elevation: JSON.parse(doc.elevation),
  };
  return circuitSchema.parse(raw) as Circuit;
}

export function encodeSession(s: Session): { doc: SessionDoc; chunks: TraceChunkDoc[] } {
  const version = s.updatedAt;
  const chunks: TraceChunkDoc[] = [];
  for (const lap of s.laps) {
    for (let i = 0, chunk = 0; i < Math.max(1, lap.trace.length); i += TRACE_CHUNK_POINTS, chunk++) {
      const part = lap.trace.slice(i, i + TRACE_CHUNK_POINTS);
      const cols: Columns = { t: [], d: [], v: [], lat: [], lon: [], acc: [] };
      for (const p of part) {
        cols.t.push(p.t);
        cols.d.push(p.d);
        cols.v.push(p.v);
        cols.lat.push(p.lat);
        cols.lon.push(p.lon);
        cols.acc.push(Number.isFinite(p.accuracy) ? p.accuracy : null);
      }
      chunks.push({ id: `${version}_${lap.lap}_${chunk}`, version, lap: lap.lap, chunk, data: json(cols) });
    }
  }
  const lapsNoTrace = s.laps.map(({ trace: _trace, ...rest }) => rest);
  return {
    doc: {
      schema: CLOUD_SCHEMA,
      id: s.id,
      circuitId: s.circuitId,
      circuitName: s.circuitName,
      source: s.source,
      startedAt: s.startedAt,
      endedAt: s.endedAt,
      updatedAt: s.updatedAt,
      marks: s.marks,
      reference: s.reference,
      laps: json(lapsNoTrace),
      traceVersion: version,
      traceChunks: chunks.length,
    },
    chunks,
  };
}

export class IncompleteSessionError extends Error {}

export function decodeSession(doc: SessionDoc, chunks: readonly TraceChunkDoc[]): Session {
  const mine = chunks.filter((c) => c.version === doc.traceVersion);
  if (mine.length !== doc.traceChunks) {
    throw new IncompleteSessionError(`Session ${doc.id}: expected ${doc.traceChunks} trace chunks, got ${mine.length}.`);
  }
  const traces = new Map<number, LapTracePoint[]>();
  for (const c of [...mine].sort((a, b) => a.lap - b.lap || a.chunk - b.chunk)) {
    const cols = JSON.parse(c.data) as Columns;
    const list = traces.get(c.lap) ?? [];
    for (let i = 0; i < cols.t.length; i++) {
      list.push({ t: cols.t[i], d: cols.d[i], v: cols.v[i], lat: cols.lat[i], lon: cols.lon[i], accuracy: cols.acc[i] ?? Number.NaN });
    }
    traces.set(c.lap, list);
  }
  const laps = (JSON.parse(doc.laps) as Omit<LapRecord, 'trace'>[]).map((l) => ({ ...l, trace: traces.get(l.lap) ?? [] }));
  const raw = {
    id: doc.id,
    circuitId: doc.circuitId,
    circuitName: doc.circuitName,
    source: doc.source,
    startedAt: doc.startedAt,
    endedAt: doc.endedAt ?? null,
    updatedAt: doc.updatedAt,
    marks: doc.marks ?? [],
    reference: doc.reference ?? null,
    laps,
  };
  // The schema turns null accuracies back into NaN (unknown), matching local records.
  return sessionSchema.parse(JSON.parse(json(raw))) as Session;
}
