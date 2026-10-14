import { useEffect, useState } from 'react';
import type { LatLon } from '@laptimer/core';
import { geolocationSupport } from './geolocation';

export interface GpsPreview {
  /** off: not watching; unsupported: no usable location API; denied: permission refused. */
  state: 'off' | 'unsupported' | 'denied' | 'searching' | 'ready';
  accuracyM: number | null;
  position: LatLon | null;
  /** When the current wait for a good fix began, ms since epoch. */
  waitingSince: number;
}

/**
 * Watches the phone's position before a run starts, so the start screen can say whether GPS is
 * good enough yet. `ready` once a fix is at least `needM` accurate.
 */
export function useGpsPreview(enabled: boolean, needM: number): GpsPreview {
  const [p, setP] = useState<GpsPreview>({ state: 'off', accuracyM: null, position: null, waitingSince: Date.now() });
  useEffect(() => {
    if (!enabled) {
      setP((x) => ({ ...x, state: 'off' }));
      return;
    }
    if (geolocationSupport()) {
      setP((x) => ({ ...x, state: 'unsupported' }));
      return;
    }
    setP({ state: 'searching', accuracyM: null, position: null, waitingSince: Date.now() });
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        const acc = pos.coords.accuracy;
        setP((x) => ({
          state: acc <= needM ? 'ready' : 'searching',
          accuracyM: acc,
          position: { lat: pos.coords.latitude, lon: pos.coords.longitude },
          waitingSince: acc <= needM ? x.waitingSince : x.state === 'ready' ? Date.now() : x.waitingSince,
        }));
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) setP((x) => ({ ...x, state: 'denied' }));
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 30_000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [enabled, needM]);
  return p;
}
