import { validateGeometry, type LonLat } from '@laptimer/core';
import { analyzeRoute } from './analyze';
import { RoutingError, type RouteRequest, type RouteResult, type RoutingProvider } from './types';

interface OsrmResponse {
  code: string;
  message?: string;
  routes?: { distance: number; geometry: { type: string; coordinates: LonLat[] } }[];
  waypoints?: { location: LonLat; distance: number; name: string }[];
}

export interface OsrmOptions {
  baseUrl: string;
  profile: string;
  /** Minimum interval between requests (the public demo allows roughly 1 request/second). */
  minIntervalMs?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

const MAX_WAYPOINTS = 100;

/**
 * OSRM `route` service client. Requests the full-resolution GeoJSON geometry
 * (`overview=full&geometries=geojson`) and never falls back to straight lines.
 */
export class OsrmProvider implements RoutingProvider {
  readonly name = 'osrm';
  readonly profile: string;
  private lastRequestAt = 0;
  private readonly opts: Required<Omit<OsrmOptions, 'fetchImpl'>> & { fetchImpl: typeof fetch };

  constructor(opts: OsrmOptions) {
    this.profile = opts.profile;
    this.opts = {
      minIntervalMs: 1100,
      timeoutMs: 15000,
      ...opts,
      fetchImpl: opts.fetchImpl ?? ((...args) => fetch(...args)),
    };
  }

  buildUrl(waypoints: LonLat[]): string {
    const coords = waypoints.map(([lon, lat]) => `${lon.toFixed(6)},${lat.toFixed(6)}`).join(';');
    const params = new URLSearchParams({ overview: 'full', geometries: 'geojson', steps: 'false', continue_straight: 'true' });
    return `${this.opts.baseUrl}/route/v1/${encodeURIComponent(this.opts.profile)}/${coords}?${params}`;
  }

  async route(req: RouteRequest): Promise<RouteResult> {
    const wps = req.waypoints;
    if (wps.length < 2) throw new RoutingError('invalid_waypoints', 'Add at least two waypoints.');
    if (wps.length > MAX_WAYPOINTS) throw new RoutingError('invalid_waypoints', `Too many waypoints (max ${MAX_WAYPOINTS}).`);
    for (const [lon, lat] of wps) {
      if (!Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
        throw new RoutingError('invalid_waypoints', 'A waypoint has invalid coordinates.');
      }
    }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      throw new RoutingError('offline', 'You are offline. Road routing needs a network connection.');
    }
    const request = req.closed ? [...wps, wps[0]] : wps;

    const wait = this.lastRequestAt + this.opts.minIntervalMs - Date.now();
    if (wait > 0) await sleep(wait, req.signal);
    this.lastRequestAt = Date.now();

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.opts.timeoutMs);
    const onAbort = () => ctrl.abort();
    req.signal?.addEventListener('abort', onAbort);
    let res: Response;
    try {
      res = await this.opts.fetchImpl(this.buildUrl(request), { signal: ctrl.signal });
    } catch {
      if (req.signal?.aborted) throw new RoutingError('aborted', 'Request cancelled.');
      if (ctrl.signal.aborted) throw new RoutingError('unavailable', 'The routing service did not respond in time.');
      throw new RoutingError('unavailable', 'Could not reach the routing service. Check your connection or the configured OSRM URL.');
    } finally {
      clearTimeout(timer);
      req.signal?.removeEventListener('abort', onAbort);
    }

    if (res.status === 429) throw new RoutingError('rate_limited', 'The routing service is rate limiting requests. Wait a moment and try again.');
    let body: OsrmResponse | null = null;
    try {
      body = (await res.json()) as OsrmResponse;
    } catch {
      body = null;
    }
    if (!res.ok || !body || body.code !== 'Ok') {
      const code = body?.code;
      if (code === 'NoRoute') throw new RoutingError('no_route', 'No drivable route connects these waypoints.');
      if (code === 'NoSegment') throw new RoutingError('invalid_waypoints', 'A waypoint is too far from any road. Move it onto a road.');
      if (code === 'InvalidQuery' || code === 'InvalidValue' || code === 'InvalidInput' || code === 'TooBig') {
        throw new RoutingError('invalid_waypoints', `The routing service rejected the waypoints (${code}).`);
      }
      if (res.status >= 500 || !body) throw new RoutingError('unavailable', `The routing service is unavailable (HTTP ${res.status}).`);
      throw new RoutingError('unavailable', body.message ?? `Routing failed (${code ?? res.status}).`);
    }

    const route = body.routes?.[0];
    const geometry = route?.geometry?.coordinates;
    if (!route || route.geometry.type !== 'LineString' || !Array.isArray(geometry)) {
      throw new RoutingError('bad_geometry', 'The routing service returned no usable geometry.');
    }
    const issues = validateGeometry(geometry, { minLengthM: 50 });
    const errors = issues.filter((i) => i.severity === 'error');
    if (errors.length) throw new RoutingError('bad_geometry', `Unusable route geometry: ${errors.map((e) => e.message).join(' ')}`);

    const snapped = (body.waypoints ?? []).slice(0, wps.length).map((w, i) => ({ input: wps[i], snapped: w.location, offsetM: w.distance }));
    const warnings = [...issues.filter((i) => i.severity === 'warning').map((i) => i.message), ...analyzeRoute(geometry, snapped, req.closed)];
    return { geometry, distanceM: route.distance, waypoints: snapped, warnings, provider: this.name, profile: this.profile };
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      reject(new RoutingError('aborted', 'Request cancelled.'));
    });
  });
}
