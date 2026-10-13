import type { LonLat } from './geo';
import type { GpsSample } from './gps';
import type { TimingLine } from './lines';

export type CircuitKind = 'closed' | 'sprint';
export type CircuitOrigin = 'routed' | 'recorded' | 'imported';

/** Geometry and timing lines: everything the timing engine needs. */
export interface CircuitDefinition {
  kind: CircuitKind;
  /** Full road-following centreline, GeoJSON [lon, lat] order. */
  geometry: LonLat[];
  startLine: TimingLine;
  /** Only for sprint routes; closed circuits use the start line as finish. */
  finishLine: TimingLine | null;
  sectors: TimingLine[];
}

export interface ElevationPoint {
  d: number;
  elevation: number;
}

export interface Circuit extends CircuitDefinition {
  id: string;
  name: string;
  origin: CircuitOrigin;
  /** Waypoints used to request the routed geometry (empty for recorded circuits). */
  waypoints: LonLat[];
  routing: { provider: string; profile: string; warnings: string[] } | null;
  lengthM: number;
  elevation: ElevationPoint[] | null;
  createdAt: number;
  updatedAt: number;
}

export type LapFlag =
  | 'poor_gps'
  | 'signal_gap'
  | 'tracking_lost'
  | 'distance_mismatch'
  | 'crossing_interpolated_over_gap'
  | 'simulated';

export interface LapTracePoint {
  /** Elapsed lap time, ms. */
  t: number;
  /** Distance from the start line along the circuit, m. */
  d: number;
  /** Speed, m/s (null when unknown). */
  v: number | null;
  lat: number;
  lon: number;
  accuracy: number;
}

export interface LapGpsQuality {
  samples: number;
  poorSamples: number;
  meanAccuracyM: number;
  maxGapMs: number;
  meanRateHz: number;
}

export interface LapRecord {
  /** 1-based lap number within the session. */
  lap: number;
  startT: number;
  endT: number;
  timeMs: number;
  /** Sector durations (empty when the circuit has no sectors or one was missed). */
  sectorTimesMs: number[];
  distanceM: number;
  avgSpeedMs: number;
  maxSpeedMs: number | null;
  valid: boolean;
  flags: LapFlag[];
  gps: LapGpsQuality;
  trace: LapTracePoint[];
}

export type SessionSource = 'gps' | 'simulated';

export interface SessionMark {
  type: 'pause' | 'resume';
  t: number;
}

export interface Session {
  id: string;
  circuitId: string;
  circuitName: string;
  source: SessionSource;
  startedAt: number;
  endedAt: number | null;
  laps: LapRecord[];
  marks: SessionMark[];
  /** Lap used as live-delta reference, if any. */
  reference: ReferenceSelection | null;
  updatedAt: number;
}

export interface ReferenceSelection {
  sessionId: string;
  lap: number;
}

/** Raw samples are stored separately from sessions; they can be large. */
export interface SessionSamples {
  sessionId: string;
  samples: GpsSample[];
}
