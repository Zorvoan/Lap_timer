import { useState, type FormEvent } from 'react';
import { Circle, CircleMarker, useMap } from 'react-leaflet';
import { searchPlaces, type Place } from '../../lib/geocode';
import { IconCrosshair, IconSearch, IconX } from '../ui/icons';
import { MapOverlay } from './BaseMap';

/** Place search (submit-only, per Nominatim policy). */
export function SearchControl({ className = 'left-3 top-3' }: { className?: string }) {
  const map = useMap();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Place[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await searchPlaces(q);
      setResults(r);
      if (!r.length) setError('No places found.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed.');
      setResults(null);
    } finally {
      setBusy(false);
    }
  }

  function go(p: Place) {
    if (p.bbox) map.fitBounds([[p.bbox[0], p.bbox[2]], [p.bbox[1], p.bbox[3]]], { maxZoom: 16 });
    else map.setView([p.lat, p.lon], 15);
    setResults(null);
  }

  return (
    <MapOverlay className={`${className} w-[min(22rem,calc(100%-5rem))]`}>
      <form onSubmit={submit} role="search" className="flex h-10 items-center rounded border border-line bg-panel shadow-lg">
        <label htmlFor="place-search" className="sr-only">
          Search for a place or address
        </label>
        <input
          id="place-search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search place or address"
          className="h-full min-w-0 flex-1 bg-transparent px-3 text-sm text-fg placeholder:text-muted focus:outline-none"
          maxLength={200}
        />
        {q && (
          <button type="button" aria-label="Clear search" className="px-2 text-muted hover:text-fg" onClick={() => (setQ(''), setResults(null), setError(null))}>
            <IconX width={16} height={16} />
          </button>
        )}
        <button type="submit" disabled={busy || q.trim().length < 2} aria-label="Search" className="flex h-full w-10 items-center justify-center border-l border-line text-fg disabled:opacity-40">
          <IconSearch width={18} height={18} />
        </button>
      </form>
      {busy && <div className="mt-1 rounded border border-line bg-panel px-3 py-2 text-xs text-muted">Searching…</div>}
      {error && !busy && <div className="mt-1 rounded border border-line bg-panel px-3 py-2 text-xs text-muted">{error}</div>}
      {results && results.length > 0 && (
        <ul className="mt-1 max-h-72 overflow-auto rounded border border-line bg-panel text-sm shadow-lg">
          {results.map((r, i) => (
            <li key={i}>
              <button type="button" className="w-full px-3 py-2 text-left hover:bg-raised active:bg-raised" onClick={() => go(r)}>
                {r.name}
              </button>
            </li>
          ))}
          <li className="px-3 py-1 text-[10px] text-muted">Search by Nominatim / OpenStreetMap</li>
        </ul>
      )}
    </MapOverlay>
  );
}

/** Centres the map on the device position (one-shot, high accuracy). */
export function LocateControl({ className = 'right-3 top-3' }: { className?: string }) {
  const map = useMap();
  const [pos, setPos] = useState<{ lat: number; lon: number; acc: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function locate() {
    if (!('geolocation' in navigator)) {
      setError('Location is not available in this browser.');
      return;
    }
    setBusy(true);
    setError(null);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setBusy(false);
        const next = { lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy };
        setPos(next);
        map.setView([next.lat, next.lon], Math.max(map.getZoom(), next.acc > 500 ? 13 : 16));
      },
      (e) => {
        setBusy(false);
        setError(e.code === e.PERMISSION_DENIED ? 'Location permission denied.' : 'Could not determine your location.');
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 },
    );
  }

  return (
    <>
      <MapOverlay className={className}>
        <button
          type="button"
          onClick={locate}
          disabled={busy}
          aria-label="Go to my location"
          title="Go to my location"
          className="flex h-10 w-10 items-center justify-center rounded border border-line bg-panel text-fg shadow-lg hover:border-muted disabled:opacity-50"
        >
          <IconCrosshair className={busy ? 'animate-pulse' : ''} />
        </button>
        {error && <div className="mt-1 max-w-48 rounded border border-line bg-panel px-2 py-1 text-xs text-muted">{error}</div>}
        {pos && pos.acc > 100 && (
          <div className="mt-1 max-w-48 rounded border border-line bg-panel px-2 py-1 text-xs text-muted">
            Approximate position (±{Math.round(pos.acc)} m)
          </div>
        )}
      </MapOverlay>
      {pos && (
        <>
          <Circle center={[pos.lat, pos.lon]} radius={pos.acc} pathOptions={{ color: '#3b82f6', weight: 1, fillOpacity: 0.08 }} interactive={false} />
          <CircleMarker center={[pos.lat, pos.lon]} radius={6} pathOptions={{ color: '#fff', weight: 2, fillColor: '#3b82f6', fillOpacity: 1 }} interactive={false} />
        </>
      )}
    </>
  );
}
