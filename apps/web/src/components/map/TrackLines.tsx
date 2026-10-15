import { Fragment, useMemo } from 'react';
import { Polyline, useMap } from 'react-leaflet';
import type { LatLng } from 'leaflet';
import type { Circuit } from '@laptimer/core';
import { RouteLayer } from './RouteLayer';
import { TimingLineView } from './TimingLines';

/** Map colours: official (leaderboard) tracks in the accent red, the user's own circuits in blue. */
export const TRACK_COLORS = { official: 'rgb(225 6 0)', own: 'rgb(59 158 255)' } as const;

export function trackColor(official: boolean): string {
  return official ? TRACK_COLORS.official : TRACK_COLORS.own;
}

const toLatLngs = (c: Circuit) => c.geometry.map(([lon, lat]) => [lat, lon] as [number, number]);

/** Bounds of all given circuits, as Leaflet [[south, west], [north, east]]. */
export function boundsOf(circuits: readonly Circuit[]): [[number, number], [number, number]] | null {
  let s = 90,
    n = -90,
    w = 180,
    e = -180;
  for (const c of circuits) {
    for (const [lon, lat] of c.geometry) {
      s = Math.min(s, lat);
      n = Math.max(n, lat);
      w = Math.min(w, lon);
      e = Math.max(e, lon);
    }
  }
  return s <= n ? [[s, w], [n, e]] : null;
}

/** A finger is about this wide: tracks passing within it of a tap all count as tapped. */
const TAP_PX = 22;

function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/**
 * Every circuit drawn in its colour. With `onSelect` the tracks are clickable (a wide invisible
 * line makes them easy to hit with a finger); the selected one is drawn on top with direction
 * arrows and its timing lines. Where tracks share a road (a hill climb and its downhill), a tap
 * there hits all of them and `onSelect` gets every one, so the page can ask which.
 */
export function TrackLines({
  circuits,
  isOfficial,
  selectedId = null,
  onSelect,
}: {
  circuits: readonly Circuit[];
  isOfficial: (id: string) => boolean;
  selectedId?: string | null;
  onSelect?: (ids: string[]) => void;
}) {
  const map = useMap();
  const selected = circuits.find((c) => c.id === selectedId) ?? null;
  const latLngs = useMemo(() => new Map(circuits.map((c) => [c.id, toLatLngs(c)])), [circuits]);

  /** Every track passing within a finger's width of where the map was tapped. */
  function tapped(at: LatLng, hit: string): string[] {
    const p = map.latLngToContainerPoint(at);
    const near = circuits.filter((c) => {
      const pts = (latLngs.get(c.id) ?? []).map((ll) => map.latLngToContainerPoint(ll));
      for (let i = 1; i < pts.length; i++) if (distToSegment(p.x, p.y, pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y) <= TAP_PX) return true;
      return pts.length === 1 && Math.hypot(p.x - pts[0].x, p.y - pts[0].y) <= TAP_PX;
    });
    return near.length ? near.map((c) => c.id) : [hit];
  }
  return (
    <>
      {circuits
        .filter((c) => c.id !== selectedId)
        .map((c) => {
          const positions = latLngs.get(c.id) ?? [];
          const color = trackColor(isOfficial(c.id));
          return (
            <Fragment key={c.id}>
              <Polyline positions={positions} pathOptions={{ color: '#000', weight: 7, opacity: selected ? 0.3 : 0.5 }} interactive={false} />
              <Polyline positions={positions} pathOptions={{ color, weight: 4, opacity: selected ? 0.6 : 1 }} interactive={false} />
            </Fragment>
          );
        })}
      {selected && (
        <>
          <RouteLayer geometry={selected.geometry} closed={selected.kind === 'closed'} color={trackColor(isOfficial(selected.id))} weight={6} />
          <TimingLineView line={selected.startLine} kind="start" label={selected.kind === 'closed' ? 'Start / finish' : 'Start'} />
          {selected.finishLine && <TimingLineView line={selected.finishLine} kind="finish" label="Finish" />}
          {selected.sectors.map((s, i) => (
            <TimingLineView key={i} line={s} kind="sector" label={`Sector ${i + 1} end`} />
          ))}
        </>
      )}
      {onSelect &&
        circuits.map((c) => (
          <Polyline
            key={`hit-${c.id}`}
            positions={latLngs.get(c.id) ?? []}
            pathOptions={{ color: '#000', weight: 22, opacity: 0, bubblingMouseEvents: false }}
            eventHandlers={{ click: (e) => onSelect(tapped(e.latlng, c.id)) }}
          />
        ))}
    </>
  );
}
