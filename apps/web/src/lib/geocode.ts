import { config } from './config';

export interface Place {
  name: string;
  lat: number;
  lon: number;
  /** [south, north, west, east] */
  bbox: [number, number, number, number] | null;
}

let lastRequest = 0;

/**
 * Place search via Nominatim. Called only on explicit submit (no autocomplete) and limited to
 * one request per second, as required by the Nominatim usage policy.
 */
export async function searchPlaces(query: string, signal?: AbortSignal): Promise<Place[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  if (q.length > 200) throw new Error('Search text is too long.');
  if (navigator.onLine === false) throw new Error('You are offline. Place search needs a network connection.');
  const wait = lastRequest + 1000 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequest = Date.now();
  const params = new URLSearchParams({ q, format: 'jsonv2', limit: '8', addressdetails: '0' });
  let res: Response;
  try {
    res = await fetch(`${config.geocoderUrl}/search?${params}`, { signal, headers: { 'Accept-Language': navigator.language } });
  } catch {
    if (signal?.aborted) return [];
    throw new Error('Could not reach the place search service.');
  }
  if (res.status === 429) throw new Error('Place search is rate limited. Try again shortly.');
  if (!res.ok) throw new Error(`Place search failed (HTTP ${res.status}).`);
  const data = (await res.json()) as { display_name: string; lat: string; lon: string; boundingbox?: string[] }[];
  return data
    .map((d) => ({
      name: d.display_name,
      lat: Number(d.lat),
      lon: Number(d.lon),
      bbox: d.boundingbox && d.boundingbox.length === 4 ? (d.boundingbox.map(Number) as [number, number, number, number]) : null,
    }))
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));
}
