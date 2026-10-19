import { useEffect, useRef, type ReactNode } from 'react';
import L, { type LatLngBoundsExpression } from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { MapContainer, TileLayer, ZoomControl, useMap, useMapEvents } from 'react-leaflet';
import { config } from '../../lib/config';
import { useSettings } from '../../hooks/useSettings';

const DEFAULT_CENTER: [number, number] = [50.0755, 14.4378];
const VIEW_KEY = 'laptimer:mapView';

interface MapView {
  center: [number, number];
  zoom: number;
}

/**
 * Where the user last looked on an interactive map. A new map without an explicit centre
 * (e.g. building a new circuit from the Circuits map) opens there instead of a fixed city.
 * Kept in localStorage so it survives restarts; storage may be unavailable, which is fine.
 */
let lastView: MapView | null = (() => {
  try {
    const v = JSON.parse(localStorage.getItem(VIEW_KEY) ?? 'null') as MapView | null;
    return v && Array.isArray(v.center) && v.center.every(Number.isFinite) && Number.isFinite(v.zoom) ? v : null;
  } catch {
    return null;
  }
})();

/**
 * Keeps Leaflet's idea of the map size in step with its container. A map created while hidden
 * (e.g. an earlier step of the circuit editor) otherwise loads tiles for a zero-sized box and
 * stays mostly grey once it is shown.
 */
function TrackSize() {
  const map = useMap();
  useEffect(() => {
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(map.getContainer());
    return () => ro.disconnect();
  }, [map]);
  return null;
}

function RememberView() {
  useMapEvents({
    moveend(e) {
      // A hidden map (e.g. the phone list view) has no size and no meaningful view.
      if (e.target.getSize().x === 0) return;
      const c = e.target.getCenter();
      lastView = { center: [c.lat, c.lng], zoom: e.target.getZoom() };
      try {
        localStorage.setItem(VIEW_KEY, JSON.stringify(lastView));
      } catch {
        /* storage unavailable */
      }
    },
  });
  return null;
}

export function BaseMap({
  children,
  className = '',
  center,
  zoom = 13,
  scrollWheelZoom = true,
  interactive = true,
  zoomSnap = 1,
}: {
  children?: ReactNode;
  className?: string;
  /** Initial centre; without one the map opens at the last viewed place. */
  center?: [number, number];
  zoom?: number;
  /** Disable for maps embedded in scrolling pages, so scrolling the page doesn't zoom the map. */
  scrollWheelZoom?: boolean;
  /** False for static previews: no panning, zooming or zoom buttons. */
  interactive?: boolean;
  /** Zoom steps the map settles on; fractions let a fitted route fill the map instead of the next whole level out. */
  zoomSnap?: number;
}) {
  const { settings } = useSettings();
  const initial = center ? { center, zoom } : lastView ?? { center: DEFAULT_CENTER, zoom };
  return (
    <MapContainer
      center={initial.center}
      zoom={initial.zoom}
      zoomSnap={zoomSnap}
      zoomControl={false}
      scrollWheelZoom={interactive && scrollWheelZoom}
      dragging={interactive}
      touchZoom={interactive}
      doubleClickZoom={interactive}
      boxZoom={interactive}
      keyboard={interactive}
      className={`isolate h-full w-full ${settings.mapStyle === 'dark' ? 'map-dark' : 'map-light'} ${className}`}
      attributionControl
    >
      {/* Extra rows of tiles kept around the view, so panning never shows a blank edge. */}
      <TileLayer key={settings.mapStyle} url={tileTemplate(settings.mapStyle)} subdomains={config.tileSubdomains} attribution={config.tileAttribution} maxZoom={20} keepBuffer={4} />
      {interactive && <ZoomControl position="bottomright" />}
      {interactive && <RememberView />}
      <TrackSize />
      {children}
    </MapContainer>
  );
}

const tileTemplate = (style: string) => (style === 'dark' ? config.tiles.dark : config.tiles.light);

/** The tile URL Leaflet itself would request, so a prefetched tile is a cache hit later. */
function tileUrl(style: string, z: number, x: number, y: number): string {
  const subs = config.tileSubdomains;
  return tileTemplate(style)
    .replace('{s}', subs ? subs[Math.abs(x + y) % subs.length] : '')
    .replace('{z}', String(z))
    .replace('{x}', String(x))
    .replace('{y}', String(y))
    .replace('{r}', L.Browser.retina ? '@2x' : '');
}

/**
 * Loads the tiles along a route at the zooms given, ahead of a replay that follows the car, so the
 * map never waits for the next stretch of road. At most `max` tiles; already cached ones are free.
 */
export function PrefetchRoute({ points, zooms, active, max = 240 }: { points: readonly [number, number][]; zooms: readonly number[]; active: boolean; max?: number }) {
  const map = useMap();
  const { settings } = useSettings();
  useEffect(() => {
    if (!active || points.length < 2) return;
    const want = new Set<string>();
    for (const z of zooms) {
      for (const [lat, lon] of points) {
        const p = map.project([lat, lon], z).divideBy(256).floor();
        for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) want.add(`${z}/${p.x + dx}/${p.y + dy}`);
        if (want.size >= max) break;
      }
    }
    for (const k of [...want].slice(0, max)) {
      const [z, x, y] = k.split('/').map(Number);
      new Image().src = tileUrl(settings.mapStyle, z, x, y);
    }
  }, [active, points, zooms, max, map, settings.mapStyle]);
  return null;
}

/** HTML overlay inside the map that does not pass clicks or scrolls through to the map. */
export function MapOverlay({ children, className }: { children: ReactNode; className: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    L.DomEvent.disableClickPropagation(ref.current);
    L.DomEvent.disableScrollPropagation(ref.current);
  }, []);
  return (
    <div ref={ref} className={`absolute z-[1000] ${className}`}>
      {children}
    </div>
  );
}

/** Fits the map to bounds whenever `fitKey` changes. */
export function FitBounds({
  bounds,
  fitKey,
  maxZoom = 17,
  padding = 40,
}: {
  bounds: LatLngBoundsExpression | null;
  fitKey: string;
  maxZoom?: number;
  /** Space kept between the bounds and the map edge, px. */
  padding?: number;
}) {
  const map = useMap();
  useEffect(() => {
    if (!bounds) return;
    // The container may still be laying out (lazy pages, flex panels): refit once it has its size.
    const fit = () => {
      try {
        map.invalidateSize();
        map.fitBounds(bounds, { padding: [padding, padding], maxZoom, animate: false });
      } catch {
        /* empty bounds */
      }
    };
    fit();
    // Refit when the container gets its real size (e.g. it was in a background tab or hidden
    // panel), unless the user has already moved the map.
    let userMoved = false;
    const onUserMove = () => (userMoved = true);
    map.on('dragstart', onUserMove);
    const ro = new ResizeObserver(() => {
      if (!userMoved) fit();
    });
    ro.observe(map.getContainer());
    return () => {
      ro.disconnect();
      map.off('dragstart', onUserMove);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey, map]);
  return null;
}

/** Calls back with clicked map coordinates. */
export function MapClick({ onClick }: { onClick: (lat: number, lon: number) => void }) {
  const map = useMap();
  const cb = useRef(onClick);
  cb.current = onClick;
  useEffect(() => {
    // A click on a popup button that removes its own marker (e.g. "Remove waypoint") reaches the
    // map as a click on the bare container, because the button is gone by then. Clicks right
    // after a popup closes, or that only dismiss an open popup, are therefore not map clicks.
    let popupClosedAt = 0;
    const onPopupClose = () => (popupClosedAt = performance.now());
    const h = (e: L.LeafletMouseEvent) => {
      if (performance.now() - popupClosedAt < 400) return;
      const target = e.originalEvent.target as Element | null;
      if (target?.closest?.('.leaflet-popup, .leaflet-control')) return;
      cb.current(e.latlng.lat, e.latlng.lng);
    };
    map.on('click', h);
    map.on('popupclose', onPopupClose);
    return () => {
      map.off('click', h);
      map.off('popupclose', onPopupClose);
    };
  }, [map]);
  return null;
}

/** Keeps a marker centred while following a moving position. */
export function FollowPosition({ position, enabled }: { position: [number, number] | null; enabled: boolean }) {
  const map = useMap();
  useEffect(() => {
    if (enabled && position) map.panTo(position, { animate: true, duration: 0.5 });
  }, [enabled, position, map]);
  return null;
}
