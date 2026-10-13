import L from 'leaflet';
import { Marker, Polyline, Tooltip } from 'react-leaflet';
import { LocalFrame, type LatLon, type TimingLine } from '@laptimer/core';

const handleIcon = L.divIcon({ className: 'lt-divicon', iconSize: [14, 14], iconAnchor: [7, 7], html: '<div class="lt-handle"></div>' });

const dirIcon = (deg: number, color: string) =>
  L.divIcon({
    className: 'lt-divicon',
    iconSize: [22, 22],
    iconAnchor: [11, 11],
    html: `<div style="transform: rotate(${deg}deg); color:${color}; font-size:18px; line-height:22px; text-align:center; text-shadow:0 0 3px #000">➜</div>`,
  });

/** Bearing (degrees) of the valid crossing direction for a timing line. */
export function crossingBearing(line: TimingLine): number {
  const f = new LocalFrame(line.a);
  const b = f.toXY(line.b);
  // direction +1: travel is the left normal of a→b (rotate +90°); −1: right normal.
  const tx = line.direction === 1 ? -b.y : b.y;
  const ty = line.direction === 1 ? b.x : -b.x;
  // Arrow glyph points east at 0°, so bearing-from-north minus 90.
  return ((Math.atan2(tx, ty) * 180) / Math.PI + 360 - 90) % 360;
}

function mid(a: LatLon, b: LatLon): [number, number] {
  return [(a.lat + b.lat) / 2, (a.lon + b.lon) / 2];
}

export function TimingLineView({
  line,
  kind,
  label,
  editable = false,
  onChange,
}: {
  line: TimingLine;
  kind: 'start' | 'finish' | 'sector';
  label: string;
  editable?: boolean;
  onChange?: (line: TimingLine) => void;
}) {
  const pts: [number, number][] = [
    [line.a.lat, line.a.lon],
    [line.b.lat, line.b.lon],
  ];
  const color = kind === 'sector' ? '#f5b414' : '#ffffff';
  return (
    <>
      <Polyline positions={pts} pathOptions={{ color: '#000', weight: 9, opacity: 0.9 }} interactive={false} />
      <Polyline positions={pts} pathOptions={{ color, weight: 5, dashArray: kind === 'sector' ? undefined : '4 4' }} interactive={false} />
      <Marker position={mid(line.a, line.b)} icon={dirIcon(crossingBearing(line), color)} interactive={!editable} keyboard={false}>
        <Tooltip direction="top" offset={[0, -10]}>
          {label}
        </Tooltip>
      </Marker>
      {editable &&
        (['a', 'b'] as const).map((end) => (
          <Marker
            key={end}
            position={[line[end].lat, line[end].lon]}
            icon={handleIcon}
            draggable
            eventHandlers={{
              dragend: (e) => {
                const ll = (e.target as L.Marker).getLatLng();
                onChange?.({ ...line, [end]: { lat: ll.lat, lon: ll.lng } });
              },
            }}
          />
        ))}
    </>
  );
}
