import { Fragment, useMemo } from 'react';
import { Polyline } from 'react-leaflet';
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

/**
 * Every circuit drawn in its colour. With `onSelect` the tracks are clickable (a wide invisible
 * line makes them easy to hit with a finger); the selected one is drawn on top with direction
 * arrows and its timing lines.
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
  onSelect?: (id: string) => void;
}) {
  const selected = circuits.find((c) => c.id === selectedId) ?? null;
  const latLngs = useMemo(() => new Map(circuits.map((c) => [c.id, toLatLngs(c)])), [circuits]);
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
            eventHandlers={{ click: () => onSelect(c.id) }}
          />
        ))}
    </>
  );
}
