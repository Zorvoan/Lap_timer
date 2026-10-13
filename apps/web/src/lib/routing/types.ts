import type { LonLat } from '@laptimer/core';

export type RoutingErrorCode =
  | 'offline'
  | 'unavailable'
  | 'rate_limited'
  | 'invalid_waypoints'
  | 'no_route'
  | 'bad_geometry'
  | 'aborted';

export class RoutingError extends Error {
  constructor(
    readonly code: RoutingErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'RoutingError';
  }
}

export interface RouteRequest {
  waypoints: LonLat[];
  /** Return to the first waypoint to form a closed circuit. */
  closed: boolean;
  signal?: AbortSignal;
}

export interface SnappedWaypoint {
  input: LonLat;
  snapped: LonLat;
  /** Distance from the requested point to the road, metres. */
  offsetM: number;
}

export interface RouteResult {
  /** Full road-following geometry as returned by the provider. Never synthesised. */
  geometry: LonLat[];
  distanceM: number;
  waypoints: SnappedWaypoint[];
  /** Places where the route may not match what the user intended. */
  warnings: string[];
  provider: string;
  profile: string;
}

/** Any service that returns road-following geometry for a list of waypoints. */
export interface RoutingProvider {
  readonly name: string;
  readonly profile: string;
  route(req: RouteRequest): Promise<RouteResult>;
}
