/** Build-time configuration. See `.env.example` for documentation of each variable. */
const env = import.meta.env;

function str(v: unknown, fallback: string): string {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : fallback;
}

export const config = {
  /** Map tiles, one set per map style ({s} subdomain, {r} "@2x" on sharp screens). */
  tiles: {
    dark: str(env.VITE_TILE_URL_DARK, 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'),
    light: str(env.VITE_TILE_URL, 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png'),
  },
  tileSubdomains: str(env.VITE_TILE_SUBDOMAINS, 'abcd'),
  tileAttribution: str(
    env.VITE_TILE_ATTRIBUTION,
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
  ),
  osrmUrl: str(env.VITE_OSRM_URL, 'https://router.project-osrm.org').replace(/\/+$/, ''),
  osrmProfile: str(env.VITE_OSRM_PROFILE, 'driving'),
  geocoderUrl: str(env.VITE_GEOCODER_URL, 'https://nominatim.openstreetmap.org').replace(/\/+$/, ''),
  elevationUrl: str(env.VITE_ELEVATION_URL, 'https://api.open-meteo.com/v1/elevation'),
  syncUrl: str(env.VITE_SYNC_URL, '').replace(/\/+$/, ''),
  /** Firebase project for accounts and cloud sync. Empty apiKey = accounts disabled (local-only). */
  firebase: {
    apiKey: str(env.VITE_FIREBASE_API_KEY, ''),
    authDomain: str(env.VITE_FIREBASE_AUTH_DOMAIN, ''),
    projectId: str(env.VITE_FIREBASE_PROJECT_ID, ''),
    appId: str(env.VITE_FIREBASE_APP_ID, ''),
    /** Needed for push notifications (Firebase Cloud Messaging). */
    messagingSenderId: str(env.VITE_FIREBASE_MESSAGING_SENDER_ID, ''),
    /** Use the local Firebase emulators (development only). */
    emulators: env.VITE_FIREBASE_EMULATORS === 'true',
  },
  simulatorEnabled: env.VITE_ENABLE_SIMULATOR !== undefined ? env.VITE_ENABLE_SIMULATOR === 'true' : Boolean(env.DEV),
} as const;
