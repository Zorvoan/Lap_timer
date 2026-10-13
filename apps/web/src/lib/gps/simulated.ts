/**
 * DEVELOPMENT SIMULATOR. Emits synthetic fixes along a circuit. Sessions recorded with it are
 * stored with source "simulated" and labelled as such everywhere in the UI.
 */
import { DriveSimulator, buildSpeedProfile, mulberry32, TrackModel, type CircuitDefinition, type GpsSample } from '@laptimer/core';
import type { GpsSource } from './types';

export interface SimulatorSettings {
  /** Playback speed multiplier (1 = real time). */
  timeScale: number;
  hz: number;
  noiseM: number;
  /** Random lap-to-lap pace variation, fraction (0.02 = ±2 %). */
  paceVariation: number;
  /** Overall pace multiplier on the physics-based speed profile. */
  pace: number;
  seed: number;
}

export const DEFAULT_SIMULATOR: SimulatorSettings = { timeScale: 1, hz: 5, noiseM: 1.5, paceVariation: 0.02, pace: 0.85, seed: 1 };

export class SimulatedSource implements GpsSource {
  readonly kind = 'simulated' as const;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly sim: DriveSimulator;
  private readonly t0: number;
  private perf0 = 0;

  constructor(
    circuit: CircuitDefinition,
    private readonly s: SimulatorSettings = DEFAULT_SIMULATOR,
  ) {
    const track = TrackModel.fromCoordinates(circuit.geometry, circuit.kind === 'closed');
    const rng = mulberry32(s.seed);
    const paceFactors = Array.from({ length: 200 }, () => s.pace * (1 + (rng() * 2 - 1) * s.paceVariation));
    this.t0 = Date.now();
    this.sim = new DriveSimulator(track, buildSpeedProfile(track), {
      startTimeMs: this.t0,
      hz: s.hz,
      noiseM: s.noiseM,
      accuracyM: Math.max(3, s.noiseM * 2),
      paceFactors,
      seed: s.seed,
      // Start 150 m before the first vertex so there is a short run-up to the line.
      startAlongM: track.closed ? track.length - 150 : 0,
      repeatSprint: true,
    });
  }

  start(onSample: (s: GpsSample) => void): void {
    this.perf0 = performance.now();
    const intervalMs = 1000 / this.s.hz / this.s.timeScale;
    this.timer = setInterval(() => {
      const s = this.sim.step();
      if (s) onSample(s);
    }, intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  now(): number {
    return this.t0 + (performance.now() - this.perf0) * this.s.timeScale;
  }
}
