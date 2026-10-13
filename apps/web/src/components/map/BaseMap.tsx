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
}) {
  const { settings } = useSettings();
  const initial = center ? { center, zoom } : lastView ?? { center: DEFAULT_CENTER, zoom };
  return (
    <MapContainer
      center={initial.center}
      zoom={initial.zoom}
      zoomControl={false}
      scrollWheelZoom={interactive && scrollWheelZoom}
      dragging={interactive}
      touchZoom={interactive}
      doubleClickZoom={interactive}
      boxZoom={interactive}
      keyboard={interactive}
      className={`isolate h-full w-full ${settings.mapStyle === 'dark' ? 'map-dark' : ''} ${className}`}
      attributionControl
    >
      <TileLayer url={config.tileUrl} attribution={config.tileAttribution} maxZoom={19} />
      {interactive && <ZoomControl position="bottomright" />}
      {interactive && <RememberView />}
      {children}
    </MapContainer>
  );
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
export function FitBounds({ bounds, fitKey, maxZoom = 17 }: { bounds: LatLngBoundsExpression | null; fitKey: string; maxZoom?: number }) {
  const map = useMap();
  useEffect(() => {
    if (!bounds) return;
    // The container may still be laying out (lazy pages, flex panels): refit once it has its size.
    const fit = () => {
      try {
        map.invalidateSize();
        map.fitBounds(bounds, { padding: [40, 40], maxZoom, animate: false });
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
