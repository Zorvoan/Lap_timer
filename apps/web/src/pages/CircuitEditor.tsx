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
import { Button, ConfirmButton, Field, Input, Notice, Spinner } from '../components/ui/primitives';
import { IconSwap, IconTrash, IconUndo, IconX } from '../components/ui/icons';
import { ElevationChart } from '../components/charts/Charts';
import { useSettings } from '../hooks/useSettings';
import { useAccount } from '../hooks/useData';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { autoLines } from '../lib/autoLines';
import { getRoutingProvider, RoutingError, type RouteResult } from '../lib/routing';
import { getCircuit, saveCircuit } from '../lib/repo';
import { fetchElevationProfile } from '../lib/elevation';
import { newId, log } from '../lib/log';

type Tool = 'waypoints' | 'start' | 'finish' | 'none';
type Step = 'basics' | 'route' | 'save';

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
   * True while a loaded circuit's own lines still belong to its unchanged route. Any change to
   * the route clears it, and the lines are then placed automatically where the driver tapped.
   */
  const savedLines = useRef(false);
  /** The guided steps: what it is and its name → the route → start/finish lines → save. */
  const [step, setStep] = useState<Step>(id ? 'route' : 'basics');
  /** Map taps add route points on the route step; elsewhere they do nothing. */
  const tool: Tool = step === 'route' ? 'waypoints' : 'none';
  const desktop = useMediaQuery('(min-width: 768px) and (min-height: 560px)');
  /** Earlier waypoint lists, for Undo. */
  const history = useRef<LonLat[][]>([]);
  const editWaypoints = (next: (w: LonLat[]) => LonLat[]) =>
    setWaypoints((w) => {
      savedLines.current = false;
      history.current.push(w);
      return next(w);
    });
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
      savedLines.current = true;
      setStartLine(c.startLine);
      setFinishLine(c.finishLine);
      setElevation(c.elevation);
      if (c.origin === 'routed' && c.waypoints.length >= 2) {
        skipRouteKey.current = routeKey(c.waypoints, c.kind);
        setRoute({ geometry: c.geometry, distanceM: c.lengthM, waypoints: [], warnings: c.routing?.warnings ?? [], provider: c.routing?.provider ?? 'osrm', profile: c.routing?.profile ?? '' });
      } else {
        setFixedGeometry(c.geometry);
      }
      setStep('route');
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

  // Start/finish lines follow the route: where the first and last points were tapped.
  useEffect(() => {
    if (!track) return;
    const fits = (l: TimingLine | null) => l !== null && lineAlong(track, l) !== null;
    if (savedLines.current && fits(startLine) && (kind === 'closed' || fits(finishLine))) return;
    savedLines.current = false;
    const lines = autoLines(track, kind, origin === 'routed' ? waypoints : []);
    setStartLine(lines.start);
    setFinishLine(lines.finish);
    // Lines depend on the route and layout only; waypoints are read for where they were tapped.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track, kind]);

  useEffect(() => {
    if (geometry && fitKey === 'init') setFitKey('geometry');
  }, [geometry, fitKey]);

  const issues = useMemo(() => validateDraft(track, kind, startLine, finishLine), [track, kind, startLine, finishLine]);

  function onMapClick(lat: number, lon: number) {
    const p: LonLat = [lon, lat];
    if (tool === 'none') return;
    if (tool === 'waypoints') {
      if (origin !== 'routed') return;
      editWaypoints((w) => insertWaypoint(w, p, track, kind === 'closed'));
    }
  }

  function reverse() {
    savedLines.current = false;
    if (origin === 'routed') editWaypoints((w) => (kind === 'closed' && w.length ? [w[0], ...w.slice(1).reverse()] : [...w].reverse()));
    else setFixedGeometry((g) => (g ? [...g].reverse() : g));
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
      // Every track is split into three equal parts by distance; no sector lines to place.
      sectors: [],
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
      navigate(`/tracks/${circuit.id}`);
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

  const steps: { id: Step; label: string }[] = [
    { id: 'basics', label: 'Type & name' },
    { id: 'route', label: 'Route' },
    { id: 'save', label: 'Save' },
  ];
  const stepIndex = steps.findIndex((x) => x.id === step);
  const routeReady = !!track && routing !== 'loading';
  /** Why the user cannot go on from a step yet (null = can continue). */
  const blocker = (st: Step): string | null => {
    if (st === 'basics') return name.trim() ? null : 'Give it a name first.';
    if (st === 'route') return routeReady ? null : origin === 'routed' ? (waypoints.length < 2 ? 'Tap at least two points on the road.' : 'Waiting for the route…') : 'No route.';
    return null;
  };
  const canOpen = (target: Step) => steps.slice(0, steps.findIndex((x) => x.id === target)).every((x) => !blocker(x.id));
  const [showBlocker, setShowBlocker] = useState(false);
  useEffect(() => setShowBlocker(false), [step, name, waypoints.length, track]);

  function next() {
    if (blocker(step)) return setShowBlocker(true);
    if (step === 'save') return void save();
    setStep(steps[stepIndex + 1].id);
  }
  function back() {
    if (stepIndex === 0) return navigate(-1);
    setStep(steps[stepIndex - 1].id);
  }
  function undo() {
    const prev = history.current.pop();
    if (prev) setWaypoints(prev);
  }

  const tap = desktop ? 'Click' : 'Tap';
  const instruction =
    step === 'route'
      ? origin !== 'routed'
        ? 'This is the route from your GPS recording.'
        : waypoints.length === 0
          ? kind === 'sprint'
            ? `${tap} the road where the sprint starts.`
            : `${tap} the road where the circuit starts.`
          : waypoints.length === 1
            ? kind === 'sprint'
              ? `Now ${tap.toLowerCase()} the road where it ends. The route follows the roads.`
              : `${tap} the next point around the loop. It closes back to point 1 by itself.`
            : `${tap} more points to shape the route. Drag a numbered point to move it.`
      : null;

  const title = existing ? 'Edit circuit' : origin === 'recorded' ? 'New circuit from GPS' : 'New circuit';

  const stepper = (
    <ol className="grid grid-cols-3 gap-1" aria-label="Steps">
      {steps.map((x, i) => {
        const active = x.id === step;
        const done = i < stepIndex;
        const open = canOpen(x.id);
        return (
          <li key={x.id}>
            <button
              type="button"
              disabled={!open}
              onClick={() => setStep(x.id)}
              aria-current={active ? 'step' : undefined}
              className="flex w-full flex-col items-center gap-1 rounded py-1 text-center disabled:opacity-40"
            >
              <span
                className={`flex h-7 w-7 items-center justify-center rounded-full border-2 text-xs font-bold ${
                  active ? 'border-accent bg-accent text-white' : done ? 'border-accent text-accent' : 'border-line text-muted'
                }`}
              >
                {done ? '✓' : i + 1}
              </span>
              <span className={`text-[11px] font-semibold leading-tight ${active ? 'text-fg' : 'text-muted'}`}>{x.label}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );

  const content = !loaded ? (
    <Spinner />
  ) : step === 'basics' ? (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-bold">What are you creating?</h2>
        <div className="mt-3 grid grid-cols-2 gap-3" role="radiogroup" aria-label="Layout">
          {(['closed', 'sprint'] as const).map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={kind === k}
              onClick={() => setKind(k)}
              className={`flex flex-col items-center gap-2 rounded border-2 p-4 text-center ${kind === k ? 'border-accent bg-accent/10' : 'border-line hover:border-muted'}`}
            >
              {k === 'closed' ? <LoopPicture /> : <SprintPicture />}
              <span className="font-bold">{k === 'closed' ? 'Circuit' : 'Sprint'}</span>
              <span className="text-xs text-muted">{k === 'closed' ? 'A loop: start and finish at the same line' : 'From A to B: separate start and finish'}</span>
            </button>
          ))}
        </div>
      </div>
      <Field label="Name">
        <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder={kind === 'closed' ? 'e.g. Hill loop' : 'e.g. Halenkovice hill climb'} className="h-12 text-base" />
      </Field>
    </div>
  ) : step === 'route' ? (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className="label">Distance</div>
          <div className="font-mono text-xl tabular">{track ? formatDistance(track.length, settings.distanceUnit) : '—'}</div>
        </div>
        <div>
          <div className="label">{origin === 'routed' ? 'Points' : 'GPS points'}</div>
          <div className="font-mono text-xl tabular">{origin === 'routed' ? waypoints.length : geometry?.length ?? 0}</div>
        </div>
      </div>
      {origin === 'routed' && routing === 'loading' && <Spinner label="Finding the road…" />}
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
          {routeError.message}
        </Notice>
      )}
      {route?.warnings.map((w, i) => (
        <Notice key={i} tone="warn" title="Check the route">
          {w}
        </Notice>
      ))}
      <div className="flex flex-wrap gap-2">
        {origin === 'routed' && (
          <Button onClick={undo} disabled={!history.current.length}>
            <IconUndo width={16} height={16} /> Undo
          </Button>
        )}
        <Button onClick={reverse} disabled={!geometry && waypoints.length < 2}>
          <IconSwap width={16} height={16} /> Reverse
        </Button>
        {origin === 'routed' && waypoints.length > 0 && (
          <ConfirmButton variant="ghost" className="text-loss" onConfirm={() => editWaypoints(() => [])} confirmLabel="Tap again to clear">
            <IconTrash width={16} height={16} /> Clear
          </ConfirmButton>
        )}
      </div>
    </div>
  ) : (
    <div className="space-y-4">
      <dl className="divide-y divide-line rounded border border-line">
        <SummaryRow label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
        </SummaryRow>
        <SummaryRow label="Type">{kind === 'closed' ? 'Circuit (loop)' : 'Sprint A→B'}</SummaryRow>
        <SummaryRow label="Distance">{track ? formatDistance(track.length, settings.distanceUnit) : '—'}</SummaryRow>
        <SummaryRow label="Timing">{kind === 'closed' ? 'Start/finish at point 1' : 'Start at point 1, finish at the last point'}</SummaryRow>
        <SummaryRow label="Parts">3 equal parts, set automatically</SummaryRow>
      </dl>
      {issues.map((i, k) => (
        <Notice key={k} tone={i.severity === 'error' ? 'error' : 'warn'}>
          {i.message}
        </Notice>
      ))}
      <div>
        <div className="flex items-center justify-between">
          <span className="label">Elevation (optional)</span>
          <Button size="sm" onClick={() => void loadElevation()} disabled={!geometry}>
            {elevation ? 'Reload' : 'Load profile'}
          </Button>
        </div>
        {elevationError && <p className="mt-1 text-xs text-loss">{elevationError}</p>}
        {elevation && elevation.length > 1 && (
          <div className="mt-2 h-24">
            <ElevationChart points={elevation} distanceUnit={settings.distanceUnit} />
          </div>
        )}
      </div>
    </div>
  );

  const footer = (
    <div className="border-t border-line p-3">
      {(saveError || (showBlocker && blocker(step))) && (
        <p role="alert" className="mb-2 text-sm text-loss">
          {saveError ?? blocker(step)}
        </p>
      )}
      <div className="grid grid-cols-[auto_1fr] gap-2">
        <Button size="lg" onClick={back}>
          {stepIndex === 0 ? 'Cancel' : 'Back'}
        </Button>
        <Button variant="primary" size="lg" onClick={next} disabled={saving} aria-disabled={!!blocker(step)} className={blocker(step) ? 'opacity-60' : ''}>
          {step === 'save' ? (saving ? 'Saving…' : 'Save circuit') : `Next: ${steps[stepIndex + 1].label}`}
        </Button>
      </div>
    </div>
  );

  return (
    <div className="flex h-full flex-col md:flex-row">
      {/* Phone header: title and steps */}
      <div className="border-b border-line bg-panel px-3 pb-2 pt-3 md:hidden">
        <div className="mb-2 flex items-center justify-between">
          <h1 className="text-lg font-bold">{title}</h1>
          <Button size="sm" variant="ghost" aria-label="Cancel" onClick={() => navigate(-1)}>
            <IconX width={18} height={18} />
          </Button>
        </div>
        {stepper}
      </div>

      <div className={`relative min-h-0 flex-1 ${step === 'basics' ? 'hidden md:block' : ''}`}>
        <BaseMap>
          <MapClick onClick={onMapClick} />
          <SearchControl />
          <LocateControl />
          {instruction && (
            <MapOverlay className="bottom-3 left-3 right-14 md:left-1/2 md:right-auto md:w-[28rem] md:-translate-x-1/2">
              <div className="rounded border-l-4 border-accent bg-panel px-3 py-2 text-sm font-medium shadow-lg">{instruction}</div>
            </MapOverlay>
          )}
          {geometry && <RouteLayer geometry={geometry} closed={kind === 'closed'} opacity={step === 'basics' ? 0.6 : 1} />}
          {origin === 'routed' &&
            step === 'route' &&
            waypoints.map((w, i) => (
              <Marker
                key={`${i}-${w[0]}-${w[1]}`}
                position={[w[1], w[0]]}
                icon={waypointIcon(i + 1)}
                draggable
                eventHandlers={{
                  dragend: (e) => {
                    const ll = (e.target as L.Marker).getLatLng();
                    editWaypoints((ws) => ws.map((x, j) => (j === i ? [ll.lng, ll.lat] : x)));
                  },
                }}
              >
                <Popup>
                  <button type="button" className="text-sm font-semibold text-red-600" onClick={() => editWaypoints((ws) => ws.filter((_, j) => j !== i))}>
                    Remove point {i + 1}
                  </button>
                </Popup>
              </Marker>
            ))}
          {step !== 'route' && startLine && (
            <TimingLineView line={startLine} kind="start" label={kind === 'closed' ? 'Start / finish' : 'Start'} />
          )}
          {step !== 'route' && kind === 'sprint' && finishLine && <TimingLineView line={finishLine} kind="finish" label="Finish" />}
          <FitBounds bounds={bounds} fitKey={fitKey} />
        </BaseMap>
      </div>

      <aside className={`flex min-h-0 flex-col bg-panel md:w-96 md:flex-none md:border-l md:border-line ${step === 'basics' ? 'flex-1' : 'max-h-[45vh] border-t border-line md:max-h-none'}`}>
        <div className="hidden items-center justify-between border-b border-line px-4 py-3 md:flex">
          <h1 className="text-lg font-bold">{title}</h1>
          <Button size="sm" variant="ghost" aria-label="Cancel" onClick={() => navigate(-1)}>
            <IconX width={16} height={16} />
          </Button>
        </div>
        <div className="hidden border-b border-line px-3 py-2 md:block">{stepper}</div>
        <div className="min-h-0 flex-1 overflow-auto p-4">{content}</div>
        {footer}
      </aside>
    </div>
  );
}

function SummaryRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2.5">
      <dt className="label shrink-0">{label}</dt>
      <dd className="min-w-0 text-right text-sm font-medium">{children}</dd>
    </div>
  );
}

function LoopPicture() {
  return (
    <svg viewBox="0 0 64 40" width="64" height="40" aria-hidden="true" className="text-accent">
      <path d="M14 20c0-8 8-13 18-13s18 5 18 13-8 13-18 13S14 28 14 20z" fill="none" stroke="currentColor" strokeWidth="3" />
      <path d="M32 2v10" stroke="rgb(var(--c-fg))" strokeWidth="3" />
      <path d="M42 30l6-2-1 6" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SprintPicture() {
  return (
    <svg viewBox="0 0 64 40" width="64" height="40" aria-hidden="true" className="text-accent">
      <path d="M8 30c10 0 12-20 24-20s14 12 24 12" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      <circle cx="8" cy="30" r="4" fill="rgb(var(--c-fg))" />
      <circle cx="56" cy="22" r="4" fill="rgb(var(--c-fg))" />
      <text x="4" y="14" fontSize="10" fontWeight="700" fill="rgb(var(--c-muted))">A</text>
      <text x="52" y="12" fontSize="10" fontWeight="700" fill="rgb(var(--c-muted))">B</text>
    </svg>
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

function validateDraft(track: TrackModel | null, kind: CircuitKind, start: TimingLine | null, finish: TimingLine | null): DraftIssue[] {
  if (!track || !start) return [];
  const out: DraftIssue[] = [];
  const sAlong = lineAlong(track, start);
  if (sAlong === null) out.push({ severity: 'error', message: 'The start line does not cross the route.' });
  else {
    const travel = track.tangentAt(sAlong);
    if (directionFor(lineToXY(track, start), travel) !== start.direction) {
      out.push({ severity: 'warning', message: 'The start line expects travel opposite to the route arrows.' });
    }
  }
  if (kind === 'sprint') {
    const fAlong = finish ? lineAlong(track, finish) : null;
    if (fAlong === null) out.push({ severity: 'error', message: 'Place a finish line across the route.' });
    else if (sAlong !== null && fAlong <= sAlong) out.push({ severity: 'error', message: 'The finish line must come after the start line.' });
  }
  return out;
}
