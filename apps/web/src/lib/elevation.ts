import { TrackModel, type ElevationPoint, type LonLat } from '@laptimer/core';
import { config } from './config';

const MAX_POINTS = 100;

/**
 * Elevation profile sampled evenly along the route from the Open-Meteo elevation API
 * (Copernicus DEM, ~90 m resolution: fine for gradients, not for kerbs).
 */
export async function fetchElevationProfile(geometry: LonLat[], closed: boolean): Promise<ElevationPoint[]> {
  const track = TrackModel.fromCoordinates(geometry, closed);
  const n = Math.min(MAX_POINTS, Math.max(2, Math.ceil(track.length / 25)));
  const ds = Array.from({ length: n }, (_, i) => (track.length * i) / (n - 1));
  const pts = ds.map((d) => track.latLonAt(Math.min(d, track.length - 1e-6)));
  const params = new URLSearchParams({
    latitude: pts.map((p) => p.lat.toFixed(5)).join(','),
    longitude: pts.map((p) => p.lon.toFixed(5)).join(','),
  });
  let res: Response;
  try {
    res = await fetch(`${config.elevationUrl}?${params}`);
  } catch {
    throw new Error('Could not reach the elevation service.');
  }
  if (!res.ok) throw new Error(`Elevation service error (HTTP ${res.status}).`);
  const body = (await res.json()) as { elevation?: number[] };
  if (!Array.isArray(body.elevation) || body.elevation.length !== n) throw new Error('Elevation service returned incomplete data.');
  return ds.map((d, i) => ({ d, elevation: body.elevation![i] })).filter((p) => Number.isFinite(p.elevation));
}
