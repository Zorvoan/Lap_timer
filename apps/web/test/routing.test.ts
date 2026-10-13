import { describe, expect, it, vi } from 'vitest';
import { OsrmProvider } from '../src/lib/routing/osrm';
import { RoutingError } from '../src/lib/routing/types';
import { analyzeRoute } from '../src/lib/routing/analyze';
import type { LonLat } from '@laptimer/core';

// A road-like geometry ~1.2 km with curves (many vertices), as OSRM would return.
const curvy: LonLat[] = Array.from({ length: 60 }, (_, i) => [14.42 + i * 0.0002, 50.08 + Math.sin(i / 6) * 0.0008]);

function response(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));
}

function provider(fetchImpl: typeof fetch) {
  return new OsrmProvider({ baseUrl: 'https://osrm.test', profile: 'driving', minIntervalMs: 0, fetchImpl });
}

const wps: LonLat[] = [
  [14.42, 50.08],
  [14.432, 50.0805],
];

describe('OsrmProvider', () => {
  it('requests full GeoJSON geometry and returns every vertex unchanged', async () => {
    const fetchImpl = vi.fn(() =>
      response({
        code: 'Ok',
        routes: [{ distance: 1234, geometry: { type: 'LineString', coordinates: curvy } }],
        waypoints: [
          { location: wps[0], distance: 3, name: 'a' },
          { location: wps[1], distance: 2, name: 'b' },
        ],
      }),
    );
    const r = await provider(fetchImpl as unknown as typeof fetch).route({ waypoints: wps, closed: false });
    const url = String((fetchImpl.mock.calls[0] as unknown[])[0]);
    expect(url).toContain('/route/v1/driving/');
    expect(url).toContain('overview=full');
    expect(url).toContain('geometries=geojson');
    expect(r.geometry).toEqual(curvy);
    expect(r.geometry.length).toBe(60);
    expect(r.distanceM).toBe(1234);
  });

  it('closes circuits by routing back to the first waypoint', async () => {
    const fetchImpl = vi.fn(() => response({ code: 'Ok', routes: [{ distance: 1, geometry: { type: 'LineString', coordinates: curvy } }], waypoints: [] }));
    await provider(fetchImpl as unknown as typeof fetch).route({ waypoints: wps, closed: true });
    const url = String((fetchImpl.mock.calls[0] as unknown[])[0]);
    const coords = url.split('/driving/')[1].split('?')[0].split(';');
    expect(coords).toHaveLength(3);
    expect(coords[0]).toBe(coords[2]);
  });

  const cases: [string, () => Promise<Response>, RoutingError['code']][] = [
    ['service unavailable (network)', () => Promise.reject(new TypeError('fetch failed')), 'unavailable'],
    ['server error', () => response({ code: 'Error' }, 502), 'unavailable'],
    ['rate limit', () => response({ message: 'Too Many Requests' }, 429), 'rate_limited'],
    ['unroutable', () => response({ code: 'NoRoute', message: 'Impossible route' }, 400), 'no_route'],
    ['waypoint off-road', () => response({ code: 'NoSegment' }, 400), 'invalid_waypoints'],
    ['missing geometry', () => response({ code: 'Ok', routes: [] }), 'bad_geometry'],
    ['degenerate geometry', () => response({ code: 'Ok', routes: [{ distance: 0, geometry: { type: 'LineString', coordinates: [[14.42, 50.08]] } }] }), 'bad_geometry'],
  ];
  for (const [name, impl, code] of cases) {
    it(`reports ${name} as ${code} — never a straight-line fallback`, async () => {
      const p = provider(vi.fn(impl) as unknown as typeof fetch);
      await expect(p.route({ waypoints: wps, closed: false })).rejects.toMatchObject({ code });
    });
  }

  it('validates waypoints before calling the service', async () => {
    const fetchImpl = vi.fn();
    const p = provider(fetchImpl as unknown as typeof fetch);
    await expect(p.route({ waypoints: [wps[0]], closed: false })).rejects.toMatchObject({ code: 'invalid_waypoints' });
    await expect(p.route({ waypoints: [wps[0], [500, 50]], closed: false })).rejects.toMatchObject({ code: 'invalid_waypoints' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('analyzeRoute', () => {
  it('flags waypoints far from roads', () => {
    const w = analyzeRoute(curvy, [{ input: wps[0], snapped: wps[0], offsetM: 120 }], false);
    expect(w[0]).toMatch(/Waypoint 1 is 120 m/);
  });

  it('flags U-turns', () => {
    const out: LonLat[] = Array.from({ length: 20 }, (_, i) => [14.42 + i * 0.0003, 50.08]);
    const back: LonLat[] = Array.from({ length: 20 }, (_, i) => [14.42 + (19 - i) * 0.0003, 50.08001]);
    const w = analyzeRoute([...out, ...back], [], false);
    expect(w.some((x) => x.includes('turns back'))).toBe(true);
    expect(analyzeRoute(curvy, [], false)).toEqual([]);
  });
});
