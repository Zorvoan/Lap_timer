import { config } from '../config';
import { OsrmProvider } from './osrm';
import type { RoutingProvider } from './types';

export * from './types';
export { OsrmProvider } from './osrm';
export { analyzeRoute } from './analyze';

let provider: RoutingProvider | null = null;

/** The configured routing provider. Swap the implementation here to integrate another service. */
export function getRoutingProvider(): RoutingProvider {
  if (!provider) provider = new OsrmProvider({ baseUrl: config.osrmUrl, profile: config.osrmProfile });
  return provider;
}
