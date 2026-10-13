import {
  DEFAULT_ENGINE_CONFIG,
  ReferenceLap,
  LiveSectors,
  SessionEngine,
  distanceMeters,
  idealLap,
  splitTimes,
  type Circuit,
  type EngineConfig,
  type GpsSample,
  type LapRecord,
  type LatLon,
  type LiveSnapshot,
  type SectorSplit,
  type SessionSource,
  type ReferenceSelection,
  type Session,
  type TimingEvent,
} from '@laptimer/core';
import { announceLap, announceSector, beepLap, beepStart } from './audio';
import { getDb, type ActiveSessionInfo } from './db';
import { assessGps, type GpsAssessment } from './gps/capability';
import type { GpsError, GpsSource } from './gps/types';
import { log, newId } from './log';
import { deleteSamples, getSamples, listSessions, putSampleChunk, saveSession, setActiveSession } from './repo';
import { lapsDrivenBefore } from './lapNumbers';
import type { Settings } from './settings';
import { ScreenWakeLock } from './wakeLock';

export type LiveStatus = 'idle' | 'running' | 'paused' | 'saving' | 'error';

export interface ActiveReference {
  ref: ReferenceLap;
  selection: ReferenceSelection;
  label: string;
  /** 'best' references are replaced when a faster valid lap is set during the session. */
  policy: 'fixed' | 'best';
}

export interface LapFlash {
  lap: number;
  timeMs: number;
  /** Against the reference that was active when the lap started; null without one. */
  deltaMs: number | null;
  valid: boolean;
  newBest: boolean;
  at: number;
}

export interface LiveState {
  status: LiveStatus;
  sessionId: string | null;
  circuit: Circuit | null;
  source: 'gps' | 'simulated' | null;
  snapshot: LiveSnapshot | null;
  error: GpsError | null;
  assessment: GpsAssessment;
  reference: { label: string; lapTimeMs: number; selection: ReferenceSelection } | null;
  wakeLockActive: boolean;
  trail: LatLon[];
  lastLap: LapFlash | null;
  /** Sectors (thirds by distance) finished in the lap in progress, or in the lap just completed. */
  sectors: SectorSplit[];
  /** Session lap number (without the circuit offset) that `sectors` belong to. */
  sectorsLap: number;
  /** The sector just finished, for a few seconds' flash on the live screen. */
  sectorFlash: (SectorSplit & { at: number }) | null;
  /** Laps already driven on this circuit in earlier sessions; display lap = offset + session lap. */
  lapOffset: number;
  lastEvent: TimingEvent | null;
  /** Current time on the source clock; used to tick the lap timer between fixes. */
  clock: () => number;
}

const FLUSH_INTERVAL_MS = 5000;
const TRAIL_LENGTH = 400;

const initialState = (): LiveState => ({
  status: 'idle',
  sessionId: null,
  circuit: null,
  source: null,
  snapshot: null,
  error: null,
  assessment: { level: 'unknown', message: null, medianAccuracyM: null, rateHz: null },
  reference: null,
  wakeLockActive: false,
  trail: [],
  lastLap: null,
  sectors: [],
  sectorsLap: 0,
  sectorFlash: null,
  lapOffset: 0,
  lastEvent: null,
  clock: () => Date.now(),
});

export function engineConfigFrom(settings: Settings): Partial<EngineConfig> {
  return {
    gps: { ...DEFAULT_ENGINE_CONFIG.gps, maxAccuracyM: settings.gpsMaxAccuracyM },
    timing: { ...DEFAULT_ENGINE_CONFIG.timing, minLapMs: settings.minLapSeconds * 1000 },
  };
}

export function referenceFromLap(lap: LapRecord, lapLengthM: number): ReferenceLap {
  return ReferenceLap.fromTrace(lap.trace, lap.timeMs, lapLengthM);
}

/**
 * Owns one live timing session: GPS source → SessionEngine → UI state, with periodic
 * persistence of raw samples so the session can be recovered if the app is interrupted.
 */
export class LiveController {
  private state: LiveState = initialState();
  private readonly listeners = new Set<() => void>();
  private engine: SessionEngine | null = null;
  private source: GpsSource | null = null;
  private session: Session | null = null;
  private settings: Settings | null = null;
  private reference: ActiveReference | null = null;
  private pending: GpsSample[] = [];
  private allSamples: GpsSample[] = [];
  private chunk = 0;
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private readonly wakeLock = new ScreenWakeLock();
  private lapOffset = 0;
  /** Splits the lap in progress into thirds as it is driven. */
  private liveSectors: LiveSectors | null = null;
  private sectorLap = -1;
  /** Best time per third on this circuit before this session (for "purple" sectors). */
  private bestSectorsBefore: number[] = [];
  /** Sample clock − source clock. GPS timestamps can differ from the system clock on some devices. */
  private clockOffset = 0;

  private now(): number {
    return (this.source?.now() ?? Date.now()) + this.clockOffset;
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getState = (): LiveState => this.state;

  private set(patch: Partial<LiveState>) {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }

  /** Starts a new session. */
  async start(circuit: Circuit, source: GpsSource, reference: ActiveReference | null, settings: Settings): Promise<void> {
    if (this.state.status === 'running' || this.state.status === 'paused') throw new Error('A session is already running.');
    const engine = new SessionEngine(circuit, engineConfigFrom(settings), reference?.ref ?? null);
    const now = Date.now();
    const session: Session = {
      id: newId(),
      circuitId: circuit.id,
      circuitName: circuit.name,
      source: source.kind,
      startedAt: now,
      endedAt: null,
      laps: [],
      marks: [],
      reference: reference?.selection ?? null,
      updatedAt: now,
    };
    const history = await listSessions(circuit.id);
    this.lapOffset = lapsDrivenBefore(history, source.kind, session.id);
    this.bestSectorsBefore = bestSectorsOf(history, source.kind, session.id, engine.lapLengthM);
    await saveSession(session);
    await this.begin(circuit, source, reference, settings, engine, session, 0, []);
    beepStart();
  }

  /** Resumes a session interrupted by a reload or crash by replaying its stored samples. */
  async recover(active: ActiveSessionInfo, circuit: Circuit, session: Session, source: GpsSource, reference: ActiveReference | null, settings: Settings): Promise<void> {
    const samples = await getSamples(active.sessionId);
    const history = await listSessions(circuit.id);
    this.lapOffset = lapsDrivenBefore(history, source.kind, session.id);
    const engine = new SessionEngine(circuit, engineConfigFrom(settings), reference?.ref ?? null);
    this.bestSectorsBefore = bestSectorsOf(history, source.kind, session.id, engine.lapLengthM);
    engine.replay(samples, active.marks);
    // Time passed while the app was not running: the lap in progress can't be trusted.
    if (!engine.paused) engine.pause(Date.now());
    engine.resume(Date.now());
    const chunk = await this.countChunks(active.sessionId);
    await this.begin(circuit, source, reference, settings, engine, session, chunk, samples);
    log.debug('session recovered', { samples: samples.length, laps: engine.laps.length });
  }

  private async countChunks(sessionId: string): Promise<number> {
    const keys = await (await getDb()).getAllKeysFromIndex('samples', 'sessionId', sessionId);
    return keys.length ? Math.max(...keys.map((k) => k[1])) + 1 : 0;
  }

  private async begin(
    circuit: Circuit,
    source: GpsSource,
    reference: ActiveReference | null,
    settings: Settings,
    engine: SessionEngine,
    session: Session,
    chunk: number,
    priorSamples: GpsSample[],
  ): Promise<void> {
    this.engine = engine;
    this.source = source;
    this.session = session;
    this.settings = settings;
    this.reference = reference;
    this.chunk = chunk;
    this.pending = [];
    this.allSamples = [...priorSamples];
    this.liveSectors = new LiveSectors(engine.lapLengthM, reference?.ref ?? null, this.bestSectorsBefore);
    this.sectorLap = -1;
    await this.persistActive();

    this.set({
      ...initialState(),
      status: 'running',
      sessionId: session.id,
      circuit,
      source: source.kind,
      snapshot: engine.snapshot(source.now()),
      reference: reference ? { label: reference.label, lapTimeMs: reference.ref.lapTimeMs, selection: reference.selection } : null,
      clock: () => this.now(),
      lapOffset: this.lapOffset,
    });

    if (settings.keepScreenOn) this.set({ wakeLockActive: await this.wakeLock.enable() });
    source.start(
      (s) => this.onSample(s),
      (e) => this.onError(e),
    );
    this.flushTimer = setInterval(() => void this.flush(), FLUSH_INTERVAL_MS);
    // Re-evaluate state between fixes so signal loss is shown even when no fixes arrive.
    this.tickTimer = setInterval(() => {
      if (this.engine && this.source) this.set({ snapshot: this.engine.snapshot(this.now()) });
    }, 1000);
  }

  private onSample(s: GpsSample) {
    const engine = this.engine;
    const source = this.source;
    if (!engine || !source) return;
    this.pending.push(s);
    this.allSamples.push(s);
    this.clockOffset = s.t - source.now();
    const lapsBefore = engine.laps.length;
    const events = engine.push(s);
    const snapshot = engine.snapshot(this.now());
    // The trail follows the road where the fix matches the circuit, the raw fix otherwise.
    const here = snapshot.trackPosition ?? { lat: s.lat, lon: s.lon };
    const prevPos = this.state.trail[this.state.trail.length - 1];
    // Start a new trail after a big jump (signal loss, sprint restart) instead of drawing a chord.
    const jumped = prevPos && distanceMeters(prevPos, here) > 300;
    const trail = jumped ? [] : this.state.trail.length >= TRAIL_LENGTH ? this.state.trail.slice(-TRAIL_LENGTH + 1) : this.state.trail.slice();
    trail.push(here);
    const patch: Partial<LiveState> = {
      snapshot,
      trail,
      error: null,
      assessment: this.allSamples.length % 5 === 0 || this.allSamples.length < 10 ? assessGps(this.allSamples) : this.state.assessment,
    };
    if (events.length) patch.lastEvent = events[events.length - 1];
    if (engine.laps.length > lapsBefore) {
      for (const lap of engine.laps.slice(lapsBefore)) {
        const last = this.liveSectors?.finish(lap.timeMs) ?? null;
        if (last) {
          patch.sectors = [...(this.state.sectorsLap === lap.lap ? this.state.sectors : []), last];
          patch.sectorsLap = lap.lap;
        }
        patch.lastLap = this.onLapCompleted(lap);
      }
      void this.saveProgress();
    }
    this.trackSectors(snapshot, s.t, patch);
    this.set(patch);
  }

  /** Feeds the lap in progress to the sector splitter and flashes each third as it ends. */
  private trackSectors(snap: LiveSnapshot, t: number, patch: Partial<LiveState>) {
    const ls = this.liveSectors;
    if (!ls) return;
    if (snap.lap !== this.sectorLap) {
      this.sectorLap = snap.lap;
      ls.reset();
    }
    if (snap.lapState !== 'in_lap' || snap.lapDistanceM === null || snap.lapStartT === null) return;
    const done = ls.update(t - snap.lapStartT, snap.lapDistanceM);
    if (!done.length) return;
    const latest = done[done.length - 1];
    patch.sectors = [...(this.state.sectorsLap === snap.lap ? this.state.sectors : []), ...done];
    patch.sectorsLap = snap.lap;
    patch.sectorFlash = { ...latest, at: Date.now() };
    if (this.settings?.voiceAnnouncements) announceSector(latest.sector + 1, latest.refDeltaMs);
  }

  private onLapCompleted(lap: LapRecord): LapFlash {
    const engine = this.engine as SessionEngine;
    const ref = this.reference;
    const deltaMs = ref ? lap.timeMs - ref.ref.lapTimeMs : null;
    const prevBest = engine.laps.filter((l) => l !== lap && l.valid).reduce<number | null>((m, l) => (m === null || l.timeMs < m ? l.timeMs : m), null);
    const newBest = lap.valid && (prevBest === null || lap.timeMs < prevBest);
    if (lap.valid && (!ref || ref.policy === 'best') && (!ref || lap.timeMs < ref.ref.lapTimeMs) && this.session) {
      try {
        const next: ActiveReference = {
          ref: referenceFromLap(lap, engine.lapLengthM),
          selection: { sessionId: this.session.id, lap: lap.lap },
          label: `Lap ${this.lapOffset + lap.lap} (this session)`,
          policy: 'best',
        };
        this.reference = next;
        engine.setReference(next.ref);
        this.liveSectors?.setReference(next.ref);
        this.set({ reference: { label: next.label, lapTimeMs: next.ref.lapTimeMs, selection: next.selection } });
      } catch (e) {
        log.warn('could not use lap as reference', { lap: lap.lap, error: String(e) });
      }
    }
    if (this.settings?.audioLapBeep) beepLap(deltaMs !== null ? deltaMs < 0 : newBest);
    if (this.settings?.voiceAnnouncements) announceLap(this.lapOffset + lap.lap, lap.timeMs, deltaMs);
    return { lap: this.lapOffset + lap.lap, timeMs: lap.timeMs, deltaMs, valid: lap.valid, newBest, at: Date.now() };
  }

  private onError(e: GpsError) {
    log.warn('gps error', { code: e.code });
    this.set({ error: e, status: e.fatal ? 'error' : this.state.status });
  }

  pause(): void {
    if (!this.engine || !this.source || this.state.status !== 'running') return;
    this.engine.pause(this.now());
    this.set({ status: 'paused', snapshot: this.engine.snapshot(this.now()) });
    void this.persistActive();
  }

  resume(): void {
    if (!this.engine || !this.source || this.state.status !== 'paused') return;
    this.engine.resume(this.now());
    this.set({ status: 'running', snapshot: this.engine.snapshot(this.now()) });
    void this.persistActive();
  }

  /** Stops recording and saves the session. Returns its id. */
  async stop(): Promise<string | null> {
    const sessionId = this.session?.id ?? null;
    if (!this.engine || !this.session) {
      this.teardown();
      return sessionId;
    }
    this.set({ status: 'saving' });
    this.source?.stop();
    try {
      await this.flush();
      const keepRaw = this.settings?.storeRawSamples ?? true;
      await saveSession(this.buildSession(Date.now()));
      if (!keepRaw) await deleteSamples(this.session.id);
      await setActiveSession(null);
    } catch (e) {
      // Leave the active-session pointer in place so the recovery banner can save it later.
      log.error('saving the session failed', e);
    } finally {
      this.teardown();
    }
    return sessionId;
  }

  private buildSession(endedAt: number | null): Session {
    const s = this.session as Session;
    const engine = this.engine as SessionEngine;
    return { ...s, laps: [...engine.laps], marks: [...engine.marks], endedAt, reference: this.reference?.selection ?? s.reference };
  }

  private async saveProgress() {
    if (!this.engine || !this.session) return;
    try {
      this.session = await saveSession(this.buildSession(null));
      await this.persistActive();
    } catch (e) {
      log.error('saving session progress failed', e);
    }
  }

  private async persistActive() {
    if (!this.session || !this.engine) return;
    await setActiveSession({
      sessionId: this.session.id,
      circuitId: this.session.circuitId,
      source: this.session.source,
      startedAt: this.session.startedAt,
      marks: [...this.engine.marks],
      reference: this.reference?.selection ?? null,
      updatedAt: Date.now(),
    });
  }

  private async flush() {
    if (!this.session || !this.pending.length) return;
    const batch = this.pending;
    this.pending = [];
    try {
      await putSampleChunk(this.session.id, this.chunk++, batch);
    } catch (e) {
      this.pending = batch.concat(this.pending);
      log.error('storing samples failed', e);
    }
  }

  private teardown() {
    this.source?.stop();
    if (this.flushTimer) clearInterval(this.flushTimer);
    if (this.tickTimer) clearInterval(this.tickTimer);
    this.flushTimer = this.tickTimer = null;
    void this.wakeLock.disable();
    this.engine = null;
    this.source = null;
    this.session = null;
    this.reference = null;
    this.pending = [];
    this.allSamples = [];
    this.clockOffset = 0;
    this.set(initialState());
  }
}

/** Best time per third of the lap across earlier valid laps of the same kind (GPS or simulated). */
function bestSectorsOf(history: readonly Session[], source: SessionSource, excludeId: string, lapLengthM: number): number[] {
  const splits = history
    .filter((s) => s.source === source && s.id !== excludeId)
    .flatMap((s) => s.laps.filter((l) => l.valid).map((l) => splitTimes(l.trace, l.timeMs, lapLengthM, 3)));
  return idealLap(splits)?.sectorsMs ?? [];
}

export const liveController = new LiveController();
