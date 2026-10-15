import { useEffect, useState } from 'react';
import type { Circuit, ElevationPoint } from '@laptimer/core';
import { fetchElevationProfile } from './elevation';
import { getKv, setKv } from './repo';

/** Changes smaller than this are terrain-model noise, not hills. */
const NOISE_M = 3;

/** Total climb and descent along a profile, ignoring ripples under NOISE_M. */
export function climbOf(e: readonly ElevationPoint[] | null | undefined): { up: number; down: number; net: number } | null {
  if (!e || e.length < 2) return null;
  let up = 0;
  let down = 0;
  let ref = e[0].elevation;
  for (const p of e) {
    const dz = p.elevation - ref;
    if (dz >= NOISE_M) {
      up += dz;
      ref = p.elevation;
    } else if (dz <= -NOISE_M) {
      down -= dz;
      ref = p.elevation;
    }
  }
  return { up, down, net: e[e.length - 1].elevation - e[0].elevation };
}

/** "+130 m climb", "130 m descent", "85 m up, 60 m down" or "Flat". */
export function climbText(e: readonly ElevationPoint[] | null | undefined): string | null {
  const c = climbOf(e);
  if (!c) return null;
  const r = (m: number) => Math.round(m / 5) * 5;
  if (c.up < 15 && c.down < 15) return 'Flat';
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
