import { lineAlong, perpendicularLine } from './lines';
import type { LonLat } from './geo';
import type { Circuit, ElevationPoint } from './model';
import { GeometryError, TrackModel } from './track';

/**
 * Shortens a sprint route so the distance from its start line to its finish line is exactly
 * `lengthM`. The start line stays where it is; the finish line is placed `lengthM` further along
 * the route, perpendicular to it. The geometry is cut `runoutM` before the start and after the
 * finish (so both lines cross it cleanly), and sector lines beyond the new finish are dropped.
 * `lengthM` of the result is the start→finish distance.
 */
export function trimSprint<C extends Circuit>(circuit: C, lengthM: number, runoutM = 15): C {
  if (circuit.kind !== 'sprint') throw new Error('Only sprint routes can be trimmed to a length.');
  const track = TrackModel.fromCoordinates(circuit.geometry, false);
  const start = lineAlong(track, circuit.startLine);
  if (start === null) throw new GeometryError([{ code: 'too_short', severity: 'error', message: 'The start line does not cross the route.' }]);
  const finish = start + lengthM;
  if (finish > track.length + 1e-6) {
    throw new GeometryError([
      { code: 'too_short', severity: 'error', message: `The route only runs ${Math.floor(track.length - start)} m past the start line; ${lengthM} m needed.` },
    ]);
  }
  const from = Math.max(0, start - runoutM);
  const to = Math.min(track.length, finish + runoutM);

  const at = (d: number): LonLat => {
    const p = track.latLonAt(d);
    return [p.lon, p.lat];
  };
  const geometry: LonLat[] = [at(from)];
  for (let i = 0; i < track.coords.length; i++) {
    if (track.cum[i] > from + 0.5 && track.cum[i] < to - 0.5) geometry.push(track.coords[i]);
  }
  geometry.push(at(to));

  const trimmed = TrackModel.fromCoordinates(geometry, false);
  const sectors = circuit.sectors.filter((s) => {
    const d = lineAlong(track, s);
    return d !== null && d > start && d < finish;
  });
  const elevation = circuit.elevation && circuit.elevation.length > 1 ? sliceProfile(circuit.elevation, from, to) : null;

  return {
    ...circuit,
    geometry,
    waypoints: [],
    finishLine: perpendicularLine(trimmed, finish - from),
    sectors,
    lengthM,
    elevation,
    routing: circuit.routing ? { ...circuit.routing, warnings: [] } : null,
  };
}

/** The part of an elevation profile between two distances, re-based to start at 0. */
function sliceProfile(profile: readonly ElevationPoint[], from: number, to: number): ElevationPoint[] {
  const at = (d: number): number => {
    if (d <= profile[0].d) return profile[0].elevation;
    for (let i = 1; i < profile.length; i++) {
      const a = profile[i - 1];
      const b = profile[i];
      if (b.d >= d) return b.d > a.d ? a.elevation + ((d - a.d) / (b.d - a.d)) * (b.elevation - a.elevation) : b.elevation;
    }
    return profile[profile.length - 1].elevation;
  };
  return [
    { d: 0, elevation: at(from) },
    ...profile.filter((e) => e.d > from && e.d < to).map((e) => ({ d: e.d - from, elevation: e.elevation })),
    { d: to - from, elevation: at(to) },
  ];
}
