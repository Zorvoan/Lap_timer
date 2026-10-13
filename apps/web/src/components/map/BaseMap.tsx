import { useEffect, useRef, type ReactNode } from 'react';
import L, { type LatLngBoundsExpression } from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { MapContainer, TileLayer, ZoomControl, useMap } from 'react-leaflet';
import { config } from '../../lib/config';
import { useSettings } from '../../hooks/useSettings';

const DEFAULT_CENTER: [number, number] = [50.0755, 14.4378];

export function BaseMap({
  children,
  className = '',
  center = DEFAULT_CENTER,
  zoom = 13,
  scrollWheelZoom = true,
}: {
  children?: ReactNode;
  className?: string;
  center?: [number, number];
  zoom?: number;
  /** Disable for maps embedded in scrolling pages, so scrolling the page doesn't zoom the map. */
  scrollWheelZoom?: boolean;
}) {
  const { settings } = useSettings();
  return (
    <MapContainer
      center={center}
      zoom={zoom}
      zoomControl={false}
      scrollWheelZoom={scrollWheelZoom}
      className={`isolate h-full w-full ${settings.mapStyle === 'dark' ? 'map-dark' : ''} ${className}`}
      attributionControl
    >
      <TileLayer url={config.tileUrl} attribution={config.tileAttribution} maxZoom={19} />
      <ZoomControl position="bottomright" />
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
