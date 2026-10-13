import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import L from 'leaflet';
import { Marker, Popup } from 'react-leaflet';
import {
  SessionEngine,
  TrackModel,
  directionFor,
  formatDistance,
  lineAlong,
  lineToXY,
  perpendicularLine,
  type Circuit,
  type CircuitKind,
  type ElevationPoint,
  type LonLat,
  type TimingLine,
} from '@laptimer/core';
import { BaseMap, FitBounds, MapClick, MapOverlay } from '../components/map/BaseMap';
import { RouteLayer } from '../components/map/RouteLayer';
import { TimingLineView } from '../components/map/TimingLines';
import { LocateControl, SearchControl } from '../components/map/MapControls';
import { Badge, Button, ConfirmButton, Field, Input, Notice, Spinner } from '../components/ui/primitives';
import { IconSwap, IconTrash, IconX } from '../components/ui/icons';
import { ElevationChart } from '../components/charts/Charts';
import { useSettings } from '../hooks/useSettings';
import { useAccount } from '../hooks/useData';
import { getRoutingProvider, RoutingError, type RouteResult } from '../lib/routing';
import { getCircuit, saveCircuit } from '../lib/repo';
import { fetchElevationProfile } from '../lib/elevation';
import { newId, log } from '../lib/log';
import { config } from '../lib/config';

type Tool = 'waypoints' | 'start' | 'finish' | 'sector';
const LINE_WIDTH_M = 24;

export interface RecordedDraft {
  geometry: LonLat[];
  closed: boolean;
}

const waypointIcon = (n: number) =>
  L.divIcon({ className: 'lt-divicon', iconSize: [28, 28], iconAnchor: [14, 14], html: `<div class="lt-waypoint">${n}</div>` });

export function CircuitEditor() {
  const { id } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { settings } = useSettings();
  const official = useAccount().featured.some((f) => f.id === id);
  const recorded = (location.state as { recorded?: RecordedDraft } | null)?.recorded ?? null;

  const [loaded, setLoaded] = useState(!id);
  const [existing, setExisting] = useState<Circuit | null>(null);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<CircuitKind>(recorded && !recorded.closed ? 'sprint' : 'closed');
  const [origin, setOrigin] = useState<Circuit['origin']>(recorded ? 'recorded' : 'routed');
  const [waypoints, setWaypoints] = useState<LonLat[]>([]);
  const [fixedGeometry, setFixedGeometry] = useState<LonLat[] | null>(recorded?.geometry ?? null);
  const [route, setRoute] = useState<RouteResult | null>(null);
  const [routing, setRouting] = useState<'idle' | 'loading' | 'error'>('idle');
  const [routeError, setRouteError] = useState<RoutingError | null>(null);
  const [retry, setRetry] = useState(0);
  const [startLine, setStartLine] = useState<TimingLine | null>(null);
  const [finishLine, setFinishLine] = useState<TimingLine | null>(null);
  /**
   * False while the start/finish lines are auto-placed: they then follow the route as it is
   * re-routed. Becomes true once the user places, drags or flips a line (or loads a saved circuit).
   */
  const linesManual = useRef(false);
  const setStartManual = (l: TimingLine | null) => {
    linesManual.current = true;
    setStartLine(l);
  };
  const setFinishManual = (l: TimingLine | null) => {
    linesManual.current = true;
    setFinishLine(l);
  };
  const [sectors, setSectors] = useState<TimingLine[]>([]);
  const [tool, setTool] = useState<Tool>(recorded ? 'start' : 'waypoints');
  const [elevation, setElevation] = useState<ElevationPoint[] | null>(null);
  const [elevationError, setElevationError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [fitKey, setFitKey] = useState('init');
  const skipRouteKey = useRef<string | null>(null);

  // Load an existing circuit.
  useEffect(() => {
    if (!id) return;
    void getCircuit(id).then((c) => {
      if (!c) {
        setSaveError('Circuit not found.');
        setLoaded(true);
        return;
      }
      setExisting(c);
      setName(c.name);
      setKind(c.kind);
      setOrigin(c.origin);
      setWaypoints(c.waypoints);
      linesManual.current = true;
      setStartLine(c.startLine);
      setFinishLine(c.finishLine);
      setSectors(c.sectors);
      setElevation(c.elevation);
      if (c.origin === 'routed' && c.waypoints.length >= 2) {
        skipRouteKey.current = routeKey(c.waypoints, c.kind);
        setRoute({ geometry: c.geometry, distanceM: c.lengthM, waypoints: [], warnings: c.routing?.warnings ?? [], provider: c.routing?.provider ?? 'osrm', profile: c.routing?.profile ?? '' });
      } else {
        setFixedGeometry(c.geometry);
      }
      setTool(c.origin === 'routed' ? 'waypoints' : 'start');
      setFitKey(`load-${c.id}`);
      setLoaded(true);
    });
  }, [id]);

  const geometry = origin === 'routed' ? route?.geometry ?? null : fixedGeometry;

  const track = useMemo(() => {
    if (!geometry) return null;
    try {
      return TrackModel.fromCoordinates(geometry, kind === 'closed');
    } catch {
      return null;
    }
  }, [geometry, kind]);

  // Request road geometry whenever waypoints change (debounced, cancellable).
  useEffect(() => {
    if (origin !== 'routed' || !loaded) return;
    const key = routeKey(waypoints, kind);
    if (skipRouteKey.current === key) return;
    skipRouteKey.current = null;
    if (waypoints.length < 2) {
      setRoute(null);
      setRouting('idle');
      setRouteError(null);
      return;
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      setRouting('loading');
      getRoutingProvider()
        .route({ waypoints, closed: kind === 'closed', signal: ctrl.signal })
        .then((r) => {
          setRoute(r);
          setRouting('idle');
          setRouteError(null);
        })
        .catch((e: unknown) => {
          if (e instanceof RoutingError && e.code === 'aborted') return;
          log.warn('routing failed', { code: e instanceof RoutingError ? e.code : 'unknown' });
          // No straight-line fallback: show the error and keep the waypoints for adjustment.
          setRoute(null);
          setRouting('error');
          setRouteError(e instanceof RoutingError ? e : new RoutingError('unavailable', 'Routing failed.'));
        });
    }, 650);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [waypoints, kind, origin, loaded, retry]);

  // Keep timing lines valid for the current geometry.
  useEffect(() => {
    if (!track) return;
    const L0 = track.length;
    const keep = (l: TimingLine | null) => linesManual.current && l !== null && lineAlong(track, l) !== null;
    setStartLine((s) => (keep(s) ? s : perpendicularLine(track, Math.min(20, L0 * 0.02), LINE_WIDTH_M)));
    if (kind === 'sprint') setFinishLine((f) => (keep(f) ? f : perpendicularLine(track, Math.max(0, L0 - 20), LINE_WIDTH_M)));
    setSectors((ss) => ss.filter((s) => lineAlong(track, s) !== null));
  }, [track, kind]);

  useEffect(() => {
    if (geometry && fitKey === 'init') setFitKey('geometry');
  }, [geometry, fitKey]);

  const issues = useMemo(() => validateDraft(track, kind, startLine, finishLine, sectors), [track, kind, startLine, finishLine, sectors]);

  function onMapClick(lat: number, lon: number) {
    const p: LonLat = [lon, lat];
    if (tool === 'waypoints') {
      if (origin !== 'routed') return;
      setWaypoints((w) => insertWaypoint(w, p, track, kind === 'closed'));
      return;
    }
    if (!track) return;
    const along = track.nearest(track.toXY({ lat, lon })).along;
    const line = perpendicularLine(track, along, LINE_WIDTH_M);
    if (tool === 'start') setStartManual(line);
    else if (tool === 'finish') setFinishManual(line);
    else setSectors((s) => [...s, line]);
  }

  function reverse() {
    const flip = (l: TimingLine | null): TimingLine | null => (l ? { ...l, direction: l.direction === 1 ? -1 : 1 } : null);
    if (origin === 'routed') setWaypoints((w) => (kind === 'closed' && w.length ? [w[0], ...w.slice(1).reverse()] : [...w].reverse()));
    else setFixedGeometry((g) => (g ? [...g].reverse() : g));
    if (kind === 'sprint') {
      setStartLine(flip(finishLine));
      setFinishLine(flip(startLine));
    } else setStartLine(flip(startLine));
    setSectors((s) => s.map((l) => flip(l) as TimingLine));
  }

  async function loadElevation() {
    if (!geometry) return;
    setElevationError(null);
    try {
      setElevation(await fetchElevationProfile(geometry, kind === 'closed'));
    } catch (e) {
      setElevationError(e instanceof Error ? e.message : 'Elevation unavailable.');
    }
  }

  async function save() {
    setSaveError(null);
    if (official) return setSaveError('Official leaderboard tracks cannot be edited, so every driver is timed on the same lines.');
    const trimmed = name.trim();
    if (!trimmed) return setSaveError('Give the circuit a name.');
    if (trimmed.length > 80) return setSaveError('Name is too long (max 80 characters).');
    if (!track || !geometry || !startLine) return setSaveError('The circuit needs a valid route and a start line.');
    const blocking = issues.filter((i) => i.severity === 'error');
    if (blocking.length) return setSaveError(blocking[0].message);
    const startAlong = lineAlong(track, startLine) ?? 0;
    const sortedSectors = [...sectors].sort((a, b) => track.wrap((lineAlong(track, a) ?? 0) - startAlong) - track.wrap((lineAlong(track, b) ?? 0) - startAlong));
    const now = Date.now();
    const circuit: Circuit = {
      id: existing?.id ?? newId(),
      name: trimmed,
      kind,
      origin,
      geometry,
      waypoints: origin === 'routed' ? waypoints : [],
      routing: origin === 'routed' && route ? { provider: route.provider, profile: route.profile, warnings: route.warnings } : null,
      startLine,
      finishLine: kind === 'sprint' ? finishLine : null,
      sectors: sortedSectors,
      lengthM: track.length,
      elevation,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    try {
      new SessionEngine(circuit); // full validation of geometry + lines
    } catch (e) {
      return setSaveError(e instanceof Error ? e.message : 'Invalid circuit.');
    }
    setSaving(true);
    try {
      await saveCircuit(circuit);
      navigate(`/circuits?selected=${circuit.id}`);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Saving failed.');
    } finally {
      setSaving(false);
    }
  }

  const bounds = useMemo(() => {
    const pts = geometry ?? waypoints;
    if (!pts.length) return null;
    return L.latLngBounds(pts.map(([lon, lat]) => [lat, lon] as [number, number]));
  }, [geometry, waypoints]);

  const tools: { id: Tool; label: string; show: boolean }[] = [
    { id: 'waypoints', label: 'Waypoints', show: origin === 'routed' },
    { id: 'start', label: kind === 'closed' ? 'Start/finish' : 'Start', show: true },
    { id: 'finish', label: 'Finish', show: kind === 'sprint' },
    { id: 'sector', label: 'Sector', show: true },
  ];

  const hint =
    tool === 'waypoints'
      ? waypoints.length === 0
        ? 'Click a road to place the start point.'
        : 'Click along the roads you want to drive. Drag numbered markers to adjust; click one to remove it.'
      : !track
        ? 'Create a route first.'
        : tool === 'sector'
          ? 'Click on the route to add a sector line.'
          : `Click on the route to place the ${tool === 'finish' ? 'finish' : 'start'} line. Drag its ends to adjust.`;

  return (
    <div className="flex h-full flex-col md:flex-row">
      <div className="relative min-h-[55vh] flex-1">
        <BaseMap>
          <MapClick onClick={onMapClick} />
          <SearchControl />
          <LocateControl />
          <MapOverlay className="bottom-3 left-3 right-14 flex flex-col items-start gap-2 md:left-1/2 md:right-auto md:-translate-x-1/2 md:items-center">
            <div role="radiogroup" aria-label="Editing tool" className="flex overflow-hidden rounded border border-line bg-panel shadow-lg">
              {tools
                .filter((t) => t.show)
                .map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    role="radio"
                    aria-checked={tool === t.id}
                    onClick={() => setTool(t.id)}
                    className={`h-10 px-3 text-xs font-semibold uppercase tracking-wider ${tool === t.id ? 'bg-accent text-white' : 'text-muted hover:text-fg'}`}
                  >
                    {t.label}
                  </button>
                ))}
            </div>
            <div className="rounded bg-panel/90 px-2 py-1 text-xs text-muted">{hint}</div>
          </MapOverlay>
          {geometry && <RouteLayer geometry={geometry} closed={kind === 'closed'} />}
          {origin === 'routed' &&
            waypoints.map((w, i) => (
              <Marker
                key={`${i}-${w[0]}-${w[1]}`}
                position={[w[1], w[0]]}
                icon={waypointIcon(i + 1)}
                draggable
                eventHandlers={{
                  dragend: (e) => {
                    const ll = (e.target as L.Marker).getLatLng();
                    setWaypoints((ws) => ws.map((x, j) => (j === i ? [ll.lng, ll.lat] : x)));
                  },
                }}
              >
                <Popup>
                  <button type="button" className="text-sm font-semibold text-red-600" onClick={() => setWaypoints((ws) => ws.filter((_, j) => j !== i))}>
                    Remove waypoint {i + 1}
                  </button>
                </Popup>
              </Marker>
            ))}
          {startLine && <TimingLineView line={startLine} kind="start" label={kind === 'closed' ? 'Start / finish' : 'Start'} editable onChange={setStartManual} />}
          {kind === 'sprint' && finishLine && <TimingLineView line={finishLine} kind="finish" label="Finish" editable onChange={setFinishManual} />}
          {sectors.map((s, i) => (
            <TimingLineView key={i} line={s} kind="sector" label={`Sector line ${i + 1}`} editable onChange={(l) => setSectors((ss) => ss.map((x, j) => (j === i ? l : x)))} />
          ))}
          <FitBounds bounds={bounds} fitKey={fitKey} />
        </BaseMap>
      </div>

      <aside className="flex max-h-[45vh] min-h-0 flex-col border-t border-line bg-panel md:max-h-none md:w-96 md:border-l md:border-t-0">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h1 className="label">{existing ? 'Edit circuit' : origin === 'recorded' ? 'New circuit from GPS' : 'New circuit'}</h1>
          <Button size="sm" variant="ghost" aria-label="Cancel" onClick={() => navigate(-1)}>
            <IconX width={16} height={16} />
          </Button>
        </div>
        <div className="min-h-0 flex-1 space-y-4 overflow-auto p-4">
          {!loaded ? (
            <Spinner />
          ) : (
            <>
              <Field label="Name">
                <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="e.g. Hill loop" />
              </Field>

              <div>
                <span className="label">Layout</span>
                <div className="mt-1.5 grid grid-cols-2 gap-2">
                  {(['closed', 'sprint'] as const).map((k) => (
                    <Button key={k} variant={kind === k ? 'primary' : 'secondary'} onClick={() => setKind(k)}>
                      {k === 'closed' ? 'Closed circuit' : 'Sprint (A→B)'}
                    </Button>
                  ))}
                </div>
                <p className="mt-1 text-xs text-muted">
                  {kind === 'closed' ? 'The route returns to the first waypoint; one line is start and finish.' : 'Separate start and finish lines.'}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3 rounded border border-line p-3">
                <div>
                  <div className="label">Distance</div>
                  <div className="font-mono text-lg tabular">{track ? formatDistance(track.length, settings.distanceUnit) : '—'}</div>
                </div>
                <div>
                  <div className="label">{origin === 'routed' ? 'Waypoints' : 'Points'}</div>
                  <div className="font-mono text-lg tabular">{origin === 'routed' ? waypoints.length : geometry?.length ?? 0}</div>
                </div>
                {origin === 'routed' && geometry && (
                  <div className="col-span-2 text-xs text-muted">
                    Road geometry: {geometry.length} points from {route?.provider.toUpperCase()} — the line on the map is exactly what will be timed.
                  </div>
                )}
              </div>

              {origin === 'routed' && routing === 'loading' && <Spinner label="Routing along roads…" />}
              {origin === 'routed' && routeError && (
                <Notice
                  tone="error"
                  title={routeErrorTitle(routeError.code)}
                  action={
                    routeError.code !== 'invalid_waypoints' && routeError.code !== 'no_route' ? (
                      <Button size="sm" onClick={() => setRetry((r) => r + 1)}>
                        Retry
                      </Button>
                    ) : undefined
                  }
                >
                  {routeError.message} No route is drawn until routing succeeds.
                </Notice>
              )}
              {route?.warnings.map((w, i) => (
                <Notice key={i} tone="warn" title="Check the route">
                  {w}
                </Notice>
              ))}
              {issues.map((i, k) => (
                <Notice key={k} tone={i.severity === 'error' ? 'error' : 'warn'}>
                  {i.message}
                </Notice>
              ))}

              <div className="flex flex-wrap gap-2">
                <Button onClick={reverse} disabled={!geometry && waypoints.length < 2}>
                  <IconSwap width={16} height={16} /> Reverse direction
                </Button>
                {startLine && (
                  <Button onClick={() => setStartManual({ ...startLine, direction: startLine.direction === 1 ? -1 : 1 })} title="Flip which way the start line must be crossed">
                    Flip start line
                  </Button>
                )}
                {origin === 'routed' && waypoints.length > 0 && (
                  <ConfirmButton onConfirm={() => setWaypoints([])} confirmLabel="Confirm clear">
                    <IconTrash width={16} height={16} /> Clear
                  </ConfirmButton>
                )}
              </div>

              {sectors.length > 0 && (
                <div>
                  <span className="label">Sector lines</span>
                  <ul className="mt-1.5 space-y-1">
                    {sectors.map((_, i) => (
                      <li key={i} className="flex items-center justify-between rounded border border-line px-3 py-1.5 text-sm">
                        <span>
                          <Badge tone="warn">S{i + 1}</Badge> line {i + 1}
                        </span>
                        <Button size="sm" variant="ghost" aria-label={`Remove sector line ${i + 1}`} onClick={() => setSectors((ss) => ss.filter((__, j) => j !== i))}>
                          <IconTrash width={14} height={14} />
                        </Button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div>
                <div className="flex items-center justify-between">
                  <span className="label">Elevation</span>
                  <Button size="sm" onClick={() => void loadElevation()} disabled={!geometry}>
                    {elevation ? 'Reload' : 'Load profile'}
                  </Button>
                </div>
                {elevationError && <p className="mt-1 text-xs text-loss">{elevationError}</p>}
                {elevation && elevation.length > 1 ? (
                  <div className="mt-2 h-28">
                    <ElevationChart points={elevation} distanceUnit={settings.distanceUnit} />
                  </div>
                ) : (
                  <p className="mt-1 text-xs text-muted">Optional. Fetched from Open-Meteo (90 m terrain model).</p>
                )}
              </div>

              {origin === 'routed' && (
                <p className="text-xs text-muted">
                  Routing: {config.osrmUrl.replace(/^https?:\/\//, '')} ({config.osrmProfile}). The public OSRM demo is rate limited and for light use only.
                </p>
              )}
            </>
          )}
        </div>
        <div className="border-t border-line p-3">
          {saveError && (
            <p role="alert" className="mb-2 text-sm text-loss">
              {saveError}
            </p>
          )}
          <Button variant="primary" size="lg" className="w-full" onClick={() => void save()} disabled={saving || !track}>
            {saving ? 'Saving…' : 'Save circuit'}
          </Button>
        </div>
      </aside>
    </div>
  );
}

function routeKey(w: LonLat[], kind: CircuitKind) {
  return `${kind}:${w.map((p) => p.join(',')).join(';')}`;
}

function routeErrorTitle(code: RoutingError['code']): string {
  switch (code) {
    case 'offline':
      return 'Offline';
    case 'rate_limited':
      return 'Rate limited';
    case 'no_route':
      return 'No route found';
    case 'invalid_waypoints':
      return 'Waypoint problem';
    case 'bad_geometry':
      return 'Unusable route';
    default:
      return 'Routing service unavailable';
  }
}

/** Inserts a click into the waypoint list where it falls along the existing route. */
export function insertWaypoint(waypoints: LonLat[], p: LonLat, track: TrackModel | null, closed: boolean): LonLat[] {
  if (!track || waypoints.length < 2) return [...waypoints, p];
  const xy = track.toXY({ lon: p[0], lat: p[1] });
  const hit = track.nearest(xy);
  if (hit.lateral > 40) return [...waypoints, p];
  const alongs = waypoints.map(([lon, lat]) => track.nearest(track.toXY({ lon, lat })).along);
  if (closed) alongs[0] = 0;
  for (let i = 0; i < waypoints.length - 1; i++) {
    if (hit.along >= alongs[i] && hit.along <= alongs[i + 1]) return [...waypoints.slice(0, i + 1), p, ...waypoints.slice(i + 1)];
  }
  return [...waypoints, p];
}

interface DraftIssue {
  severity: 'error' | 'warning';
  message: string;
}

function validateDraft(track: TrackModel | null, kind: CircuitKind, start: TimingLine | null, finish: TimingLine | null, sectors: TimingLine[]): DraftIssue[] {
  if (!track || !start) return [];
  const out: DraftIssue[] = [];
  const sAlong = lineAlong(track, start);
  if (sAlong === null) out.push({ severity: 'error', message: 'The start line does not cross the route.' });
  else {
    const travel = track.tangentAt(sAlong);
    if (directionFor(lineToXY(track, start), travel) !== start.direction) {
      out.push({ severity: 'warning', message: 'The start line expects travel opposite to the route arrows. Use “Flip start line” if that is not intended.' });
    }
  }
  if (kind === 'sprint') {
    const fAlong = finish ? lineAlong(track, finish) : null;
    if (fAlong === null) out.push({ severity: 'error', message: 'Place a finish line across the route.' });
    else if (sAlong !== null && fAlong <= sAlong) out.push({ severity: 'error', message: 'The finish line must come after the start line.' });
  }
  if (sectors.some((s) => lineAlong(track, s) === null)) out.push({ severity: 'error', message: 'A sector line does not cross the route.' });
  return out;
}
