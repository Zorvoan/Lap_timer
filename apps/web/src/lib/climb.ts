import { useEffect, useState } from 'react';
import type { Circuit, ElevationPoint } from '@laptimer/core';
import { fetchElevationProfile } from './elevation';
import { getKv, setKv } from './repo';

/** Changes smaller than this are terrain-model noise, not hills. */
const NOISE_M = 5;
/**
 * The terrain model (~90 m cells) picks up the slopes beside a road, so the profile is averaged
 * over this distance before climbs are counted.
 */
const SMOOTH_M = 150;

/** Total climb and descent along a profile, ignoring terrain-model ripples. */
export function climbOf(e: readonly ElevationPoint[] | null | undefined): { up: number; down: number; net: number } | null {
  if (!e || e.length < 2) return null;
  // At least the neighbouring samples, however far apart they were taken.
  const step = (e[e.length - 1].d - e[0].d) / (e.length - 1);
  const half = Math.max(SMOOTH_M / 2, step * 1.01);
  const smooth = e.map((p) => {
    let sum = 0;
    let n = 0;
    for (const q of e) {
      if (Math.abs(q.d - p.d) <= half) {
        sum += q.elevation;
        n++;
      }
    }
    return sum / n;
  });
  let up = 0;
  let down = 0;
  let ref = smooth[0];
  for (const z of smooth) {
    const dz = z - ref;
    if (dz >= NOISE_M) {
      up += dz;
      ref = z;
    } else if (dz <= -NOISE_M) {
      down -= dz;
      ref = z;
    }
  }
  return { up, down, net: e[e.length - 1].elevation - e[0].elevation };
}

/** "+130 m climb", "130 m descent", "85 m up, 60 m down" or "Flat". */
export function climbText(e: readonly ElevationPoint[] | null | undefined): string | null {
  const c = climbOf(e);
  if (!c) return null;
  const r = (m: number) => Math.round(m / 5) * 5;
  if (c.up < 25 && c.down < 25) return 'Flat';
  if (c.down <= c.up * 0.25) return `+${r(Math.max(c.net, 0) || c.up)} m climb`;
  if (c.up <= c.down * 0.25) return `${r(Math.max(-c.net, 0) || c.down)} m descent`;
  return `${r(c.up)} m up, ${r(c.down)} m down`;
}

const memory = new Map<string, Promise<ElevationPoint[] | null>>();

/**
 * The road's elevation profile: its own, or one fetched once and kept on this device for roads
 * saved without one.
 */
export function useElevation(c: Pick<Circuit, 'id' | 'geometry' | 'kind' | 'elevation' | 'updatedAt'> | null): readonly ElevationPoint[] | null {
  const own = c?.elevation?.length ? c.elevation : null;
  const [fetched, setFetched] = useState<ElevationPoint[] | null>(null);
  const key = c && !own ? `elev:${c.id}:${c.updatedAt}` : null;
  useEffect(() => {
    if (!key || !c) return;
    let alive = true;
    let p = memory.get(key);
    if (!p) {
      p = (async () => {
        const cached = await getKv<ElevationPoint[]>(key).catch(() => undefined);
        if (cached?.length) return cached;
        if (c.geometry.length < 2 || !navigator.onLine) return null;
        const profile = await fetchElevationProfile([...c.geometry], c.kind === 'closed').catch(() => null);
        if (profile?.length) await setKv(key, profile).catch(() => undefined);
        return profile;
      })();
      memory.set(key, p);
    }
    void p.then((v) => alive && setFetched(v));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return own ?? fetched;
}
