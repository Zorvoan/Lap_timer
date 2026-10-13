import { useMemo } from 'react';
import L from 'leaflet';
import { Marker, Polyline } from 'react-leaflet';
import { TrackModel, bearingDeg, type LonLat } from '@laptimer/core';

const arrowIcon = (deg: number, color: string) =>
  L.divIcon({
    className: 'lt-divicon',
    iconSize: [16, 16],
    iconAnchor: [8, 8],
    html: `<div class="lt-arrow" style="transform: rotate(${deg}deg); color:${color}">▲</div>`,
  });

/**
 * Draws the complete road geometry (every vertex returned by the router or recorded by GPS)
 * plus direction-of-travel arrows spaced along it.
 */
export function RouteLayer({
  geometry,
  closed,
  color = 'rgb(225 6 0)',
  weight = 5,
  arrows = true,
  opacity = 1,
  dashed = false,
}: {
  geometry: LonLat[];
  closed: boolean;
  color?: string;
  weight?: number;
  arrows?: boolean;
  opacity?: number;
  dashed?: boolean;
}) {
  const positions = useMemo(() => geometry.map(([lon, lat]) => [lat, lon] as [number, number]), [geometry]);
  const arrowMarks = useMemo(() => {
    if (!arrows || geometry.length < 2) return [];
    let track: TrackModel;
    try {
      track = TrackModel.fromCoordinates(geometry, closed, { minLengthM: 1 });
    } catch {
      return [];
    }
    const spacing = Math.max(120, track.length / 14);
    const out: { pos: [number, number]; deg: number }[] = [];
    for (let d = spacing / 2; d < track.length; d += spacing) {
      const a = track.latLonAt(d);
      const b = track.latLonAt(Math.min(track.length, d + 3));
      out.push({ pos: [a.lat, a.lon], deg: bearingDeg(a, b) });
    }
    return out;
  }, [geometry, closed, arrows]);

  if (positions.length < 2) return null;
  return (
    <>
      <Polyline positions={positions} pathOptions={{ color: '#000', weight: weight + 3, opacity: 0.55 * opacity }} interactive={false} />
      <Polyline positions={positions} pathOptions={{ color, weight, opacity, dashArray: dashed ? '6 8' : undefined }} interactive={false} />
      {arrowMarks.map((m, i) => (
        <Marker key={i} position={m.pos} icon={arrowIcon(m.deg, '#fff')} interactive={false} keyboard={false} />
      ))}
    </>
  );
}
