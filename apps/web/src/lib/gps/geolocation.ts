import type { GpsSample } from '@laptimer/core';
import type { GpsError, GpsSource } from './types';

export function geolocationSupport(): GpsError | null {
  if (typeof window === 'undefined' || !('geolocation' in navigator)) {
    return { code: 'unsupported', message: 'This browser does not provide location access.', fatal: true };
  }
  if (!window.isSecureContext) {
    return {
      code: 'insecure_context',
      message: 'Location access needs HTTPS (or localhost). Open the app over a secure connection.',
      fatal: true,
    };
  }
  return null;
}

export function positionToSample(p: GeolocationPosition): GpsSample {
  const c = p.coords;
  const num = (v: number | null) => (v === null || !Number.isFinite(v) ? null : v);
  return {
    t: p.timestamp,
    lat: c.latitude,
    lon: c.longitude,
    accuracy: c.accuracy,
    speed: num(c.speed),
    heading: num(c.heading),
    altitude: num(c.altitude),
    altitudeAccuracy: num(c.altitudeAccuracy),
  };
}

function mapError(e: GeolocationPositionError): GpsError {
  switch (e.code) {
    case e.PERMISSION_DENIED:
      return {
        code: 'permission_denied',
        message: 'Location permission was denied. Allow precise location for this site in your browser settings.',
        fatal: true,
      };
    case e.TIMEOUT:
      return { code: 'timeout', message: 'Waiting for a GPS fix. Make sure you have a clear view of the sky.', fatal: false };
    default:
      return {
        code: 'position_unavailable',
        message: 'Position unavailable. Location services may be off, or this device has no GPS receiver.',
        fatal: false,
      };
  }
}

/** Real GPS through the Geolocation API with high-accuracy settings. */
export class GeolocationSource implements GpsSource {
  readonly kind = 'gps' as const;
  private watchId: number | null = null;

  start(onSample: (s: GpsSample) => void, onError: (e: GpsError) => void): void {
    const unsupported = geolocationSupport();
    if (unsupported) {
      onError(unsupported);
      return;
    }
    this.watchId = navigator.geolocation.watchPosition(
      (p) => onSample(positionToSample(p)),
      (e) => onError(mapError(e)),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 },
    );
  }

  stop(): void {
    if (this.watchId !== null) navigator.geolocation.clearWatch(this.watchId);
    this.watchId = null;
  }

  now(): number {
    return Date.now();
  }
}
