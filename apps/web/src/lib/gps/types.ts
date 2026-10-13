import type { GpsSample } from '@laptimer/core';

export type GpsErrorCode = 'unsupported' | 'insecure_context' | 'permission_denied' | 'position_unavailable' | 'timeout';

export interface GpsError {
  code: GpsErrorCode;
  message: string;
  /** Fatal errors stop the source; others are transient (e.g. a timeout while indoors). */
  fatal: boolean;
}

export interface GpsSource {
  readonly kind: 'gps' | 'simulated';
  start(onSample: (s: GpsSample) => void, onError: (e: GpsError) => void): void;
  stop(): void;
  /** Current time on the same clock as sample timestamps (simulations may run faster than real time). */
  now(): number;
}
