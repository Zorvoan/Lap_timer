# Lap Timer

GPS lap timer for phones and desktop browsers: build a circuit on real roads, time laps from
start/finish line crossings, and see a live delta against a reference lap, compared at the same
position on the circuit.

- **Circuits that follow real roads.** Place waypoints and the app requests the full road
  geometry from an OSRM routing service, or record the route by driving it. Routing never falls
  back to straight lines: when it fails you get an error.
- **Line-crossing lap detection.** Start/finish and sector lines are two-point lines. Crossings
  are direction-checked, interpolated between fixes for sub-sample timing, de-duplicated
  (cooldown + re-arm distance) and filtered by minimum lap time.
- **Live delta by distance.** Each fix is map-matched onto the circuit with forward-progress
  constraints. Delta = current elapsed − reference elapsed *at the same distance along the
  circuit*. When GPS can't place you reliably, the delta is marked unreliable instead of being
  shown with false precision.
- **Analysis.** Lap table with sectors and GPS quality, lap-time progression, speed vs distance and
  vs time, delta vs distance, a gain/loss map and lap replay, with laps aligned by distance.
- **Local-first PWA.** Everything is stored in IndexedDB and works offline once loaded. Sessions
  survive reloads and crashes and can be resumed. JSON and CSV export/import. Optional sync server.

## Quick start

Requires Node.js 20+.

```bash
npm install
```

```bash
npm run dev
```

Open http://localhost:5180. No API keys are needed: the defaults use OpenStreetMap tiles, the
public OSRM demo router, Nominatim search and the Open-Meteo elevation API (see
[External services](#external-services) for their limits).

| Command | What it does |
|---|---|
| `npm run dev` | Web app dev server (port 5180) |
| `npm test` | All tests (core timing/geo, web persistence/routing, server API) |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript, all workspaces |
| `npm run build` | Production build: web PWA → `apps/web/dist`, server → `apps/server/dist` |
| `npm run dev:server:memory` | Sync server without a database (data is lost on restart) |
| `npm run dev:server` | Sync server with PostgreSQL/PostGIS |

### Using it on a phone

Browsers only give location access to secure origins (HTTPS or `localhost`):

- **Android + Chrome:** connect by USB, open `chrome://inspect` on the desktop, enable *Port
  forwarding* `5180 → localhost:5180`, then open `http://localhost:5180` on the phone.
- **Any phone:** deploy `apps/web/dist` to any static HTTPS host (SPA fallback to `index.html`),
  then *Add to Home Screen* to install the PWA.

### Firebase Hosting

The PWA is deployed to Firebase project `laptimer-okwph` (https://laptimer-okwph.web.app).
To redeploy:

```bash
npm run deploy:firebase
```

GitHub Actions also deploys on every push to `main`
(`.github/workflows/firebase-deploy.yml`, repository secret `FIREBASE_SERVICE_ACCOUNT` with a
service account key that has the Firebase Hosting Admin and API Keys Viewer roles).

`npm run deploy:firebase` builds with `--mode firebase` (`apps/web/.env.firebase`, which keeps the labelled simulator
on) and deploys `apps/web/dist` using `firebase.json` (SPA rewrite, long-cache hashed assets,
no-cache service worker). Only the static app is hosted. The optional sync server is not
deployed, and data lives in each browser's own storage.

Keep the screen on and the app in front while timing (the app requests a screen wake lock).
A standard PWA cannot promise background GPS: iOS and Android browsers may pause location
updates when the screen is off or the app is backgrounded. Laps affected by gaps are flagged.

## How to use

1. **Circuits → New**: search for a place or press locate, then click along the roads. Each
   change re-routes; the red line is exactly what will be timed (arrows show direction). Switch
   to *Start/finish* and click the route to place the line, and optionally add *Sector* lines.
   Drag line ends to adjust. Check the warnings (U-turns, waypoints far from roads, detours).
   *Reverse direction* flips the route and lines.
   — or **Circuits → Record**: drive the route once, then clean up the recording (accuracy
   filter, smoothing, simplification, trim, loop extraction) and place the start line.
2. **Live**: choose the circuit and a reference (personal best, best of this session, or a
   specific lap), then start. Timing begins at the first start-line crossing in the right
   direction. The screen shows delta, lap time, speed, reference time at your position, a
   projected lap time (estimate) and distance. Pause discards the lap in progress. Stop saves.
3. **Sessions**: pick laps A and B to compare. Charts are aligned by distance; the map colours
   where A gained (green) or lost (red) time, and *Play* replays the lap.

Only drive on closed courses or legally. The live screen is designed to be read at a glance and
needs no interaction while moving.

## Architecture

```
packages/core     Pure TypeScript, no I/O, fully unit-tested
  geo.ts          Turf-based distances, local tangent-plane maths, segment intersection
  track.ts        TrackModel: centreline, cumulative distance, projection; geometry validation
  progress.ts     ProgressTracker: map-matching with forward-progress constraints
  lines.ts        Timing lines: crossing detection with direction, perpendicular placement
  timing.ts       LapTimer: start/finish/sector state machine, interpolation, cooldown, re-arm
  gps.ts          GpsFilter: validation, poor-accuracy flag, jump rejection/re-anchoring, speed
  delta.ts        ReferenceLap (time-at-distance) and computeDelta
  session.ts      SessionEngine: filter → tracker → timer → laps + live snapshot; replay()
  analysis.ts     Distance-aligned lap comparison, gain/loss segments, session summary
  recording.ts    Clean-up of GPS-recorded circuits
  sim.ts          DEVELOPMENT SIMULATOR: physics-based speed profile and synthetic fixes
  format.ts       Display formatting (kept separate from timing maths)

apps/web          React + Vite + Tailwind + Leaflet + Recharts PWA
  lib/routing     RoutingProvider interface; OSRM implementation; route analysis
  lib/gps         Geolocation source, simulated source, GPS capability assessment
  lib/liveController.ts   One live session: source → engine → UI state, persistence, recovery
  lib/db.ts, repo.ts      IndexedDB (idb) storage
  lib/exportImport.ts     JSON (zod-validated) and CSV
  pages/          Dashboard, Circuits, CircuitEditor, RecordCircuit, Live, Sessions, SessionDetail, Settings

apps/server       Fastify + Prisma + PostgreSQL/PostGIS sync API
  src/app.ts      /health, /api/devices, /api/sync, /api/circuits/near
  src/repo/       SyncRepository interface; Prisma (PostGIS) and in-memory implementations
  prisma/         Schema and SQL migrations
```

### Timing pipeline

1. **Filter** (`GpsFilter`): rejects invalid, out-of-order and physically impossible fixes
   (implied speed above the limit after allowing for both accuracy radii); consistent runs of
   "jumped" fixes re-anchor the filter (e.g. after a tunnel). Fixes worse than the accuracy
   threshold (Settings) are recorded but not used for timing. Speed comes from the receiver
   (Doppler) when valid; otherwise from smoothed distance/time.
2. **Map-match** (`ProgressTracker`): only track positions reachable from the previous match
   (given elapsed time and speed) are candidates, scored by lateral offset and deviation from
   the expected advance. This keeps the match on the right section where two parts of a circuit
   run side by side, which globally-nearest matching gets wrong. Progress never moves backwards
   on jitter, and the lock is dropped and re-acquired (using direction of travel) after signal loss.
3. **Lines** (`LapTimer`): the segment between consecutive usable fixes is intersected with each
   line; the crossing time is interpolated along that segment. Crossings must match the line's
   direction, respect a cooldown and re-arm distance, and complete laps no shorter than the
   minimum lap time. Placing a line never counts as a crossing.
4. **Lap distance** is anchored exactly at the start line, so every lap shares one distance
   coordinate. A completed lap whose distance differs from the circuit by more than about −15/+20 %
   is marked invalid (missed or spurious crossing).
5. **Delta** (`ReferenceLap`): the reference lap's trace becomes a monotonic time-at-distance
   function; the live delta is the current elapsed time minus the interpolated reference time
   at the current lap distance. It is flagged unreliable when the match is uncertain or GPS is
   weak or lost.

`SessionEngine` is deterministic: replaying stored samples (`replay`) reproduces the same laps.
That is how sessions are recovered after the app is closed mid-session, and how the tests run
complete sessions from fixtures.

### Development simulator

In dev builds (or with `VITE_ENABLE_SIMULATOR=true`) the Live screen offers a **Simulator**
source that drives the circuit with a curvature-based speed profile, configurable noise and
lap-to-lap pace variation, at 1–10× speed. A banner reads "SIMULATION — NOT REAL GPS"; sessions
are stored with `source: "simulated"`, badged everywhere, and excluded from personal bests
unless enabled in Settings. It is never used as a fallback for real GPS.

## Configuration

Web (`apps/web/.env`, see `apps/web/.env.example`):

| Variable | Default | Purpose |
|---|---|---|
| `VITE_TILE_URL` | OSM standard tiles | Raster tile URL template |
| `VITE_TILE_ATTRIBUTION` | © OpenStreetMap contributors | |
| `VITE_OSRM_URL` | `https://router.project-osrm.org` | OSRM-compatible routing service |
| `VITE_OSRM_PROFILE` | `driving` | Routing profile |
| `VITE_GEOCODER_URL` | `https://nominatim.openstreetmap.org` | Place search |
| `VITE_ELEVATION_URL` | `https://api.open-meteo.com/v1/elevation` | Elevation profile |
| `VITE_SYNC_URL` | empty | Default sync server URL (users can also set it in Settings) |
| `VITE_ENABLE_SIMULATOR` | on in dev, off in builds | Development GPS simulator |

Server (`apps/server/.env`, see `apps/server/.env.example`): `DATABASE_URL`, `STORAGE`
(`prisma` or `memory`), `PORT` (8787), `HOST`, `CORS_ORIGIN`, `BODY_LIMIT`.

To use another routing service, implement `RoutingProvider` (`apps/web/src/lib/routing/types.ts`)
and return it from `getRoutingProvider()`. It must return the full route geometry.

## External services

None need an API key, but all have usage policies. They're fine for development, not for
production traffic:

| Service | Policy |
|---|---|
| OpenStreetMap tiles | [Tile usage policy](https://operations.osmfoundation.org/policies/tiles/): no heavy use, no bulk prefetching. The PWA only caches tiles you have viewed. For production use your own tile server or a commercial provider via `VITE_TILE_URL` |
| OSRM demo server | Demo only: no SLA, rate limited. The client sends at most 1 request/s and debounces edits. For production [run OSRM yourself](https://github.com/Project-OSRM/osrm-backend) |
| Nominatim | [Usage policy](https://operations.osmfoundation.org/policies/nominatim/): max 1 request/s, no autocomplete. Search runs only on submit |
| Open-Meteo elevation | Free for non-commercial use; ~90 m terrain model |

## Accounts and cloud sync (Firebase)

Users can create an account (e-mail + password, **Account** in the sidebar or **Settings →
Account**). While signed in, circuits and sessions sync with the account, so laps driven on a
phone can be analysed on a computer.

- **Firebase Authentication** (e-mail/password, enabled via `firebase.json` → `auth`) and
  **Cloud Firestore** (database `(default)` in `eur3`, EU). The web config is in
  `apps/web/.env.firebase` / `.env.development`; it holds public identifiers only.
- Data layout: `users/{uid}/circuits/{id}`, `users/{uid}/sessions/{id}`,
  `users/{uid}/sessions/{id}/traces/{version_lap_chunk}`, `users/{uid}/tombstones/{id}`.
  `firestore.rules` allows each signed-in user to read and write only their own subtree.
- IndexedDB remains the app's source of truth (offline-first). Sync (`apps/web/src/lib/cloud`)
  pulls first, then pushes; last writer wins per record by `updatedAt`; deletions are tombstones;
  incremental pulls use the server timestamp. It runs after sign-in, a few seconds after any
  local change (e.g. stopping a session), when the device comes back online, and every 3 minutes.
- Not uploaded: the session currently being recorded (until stopped) and raw GPS fixes. Lap
  traces (positions along the circuit) are uploaded; they are what the analysis needs.
- Lap traces are JSON-encoded and chunked (4000 points per document) to respect Firestore's
  1 MiB document limit and its no-nested-arrays rule; timestamps keep full precision.
- Signing out keeps data on the device; *Sign out and remove data from this device* clears it
  (the account keeps it).

Deploy rules/auth config: `firebase deploy --only firestore,auth`.

Local testing with emulators (no real accounts; needs Java 11+ for the Firestore emulator):

```bash
npm run emulators
```

```bash
npm run dev:emulators
```

The app then runs on http://localhost:5181 against a demo project. Register any test account
there: emulator data is local and disappears when the emulators stop.

## Leaderboards (official tracks)

**Ranks** lists official tracks; each has a public leaderboard (best lap per driver). Users
still create their own circuits; only official ones have leaderboards.

- Registration requires a **nickname** (3–20 chars, unique case-insensitively, reserved in
  `nicknames/{lower}`) and a **car**. Existing accounts are asked to complete the profile.
- While signed in, after each sync the app publishes the driver's best lap on each official
  track to `leaderboards/{circuitId}/entries/{uid}` if it beats the published one, plus a
  downsampled trace (`traces/{uid}`) so others can **Race** it (live delta against that lap).
- Only valid laps timed with real GPS qualify; simulator laps are never published.
- `firestore.rules` enforce: one entry per user, written only by that user, nickname/car must
  match the profile, times can only improve, no extra fields, official tracks are read-only.
  Times are measured on the driver's phone and are not verified server-side (that would need
  Cloud Functions on the paid plan).
- Official tracks are read-only in the app so every driver is timed on the same lines.
- Times averaging more than 250 km/h over the track are refused (in the app and in the rules).
- Every lap is also split into thirds by distance (from its trace, so no sector lines are needed).
  Circuit pages show your **ideal lap** (best sectors combined); leaderboards show each driver's
  sectors, the best ones in purple, and the ideal lap of all drivers.
- After a sync the app tells you when someone has pushed you down a leaderboard.
- Rules tests run against the emulator: `npm run test:rules` (needs the Firebase CLI and Java).
  `.github/workflows/firestore-rules.yml` runs them and releases `firestore.rules` (service
  account role: Firebase Rules Admin).

Manage official tracks (uses your `firebase login` owner credentials):

```bash
node scripts/feature-circuits.mjs --list
```

```bash
node scripts/feature-circuits.mjs "Otrokovice Sprint" "Komárov" "Mladcová" "Barák" "Troják"
```

The names given become the display names, in that order; `--remove <circuitId>` unpublishes.

## Sync server (optional, self-hosted alternative)

Only offered in the UI when no Firebase project is configured.

```bash
docker compose up -d db
```

```bash
cp apps/server/.env.example apps/server/.env
```

```bash
npm run prisma:migrate -w @laptimer/server
```

```bash
npm run dev:server
```

Then in the app: **Settings → Sync → Enable**, URL `http://localhost:8787`, **Sync now**.

- Devices register anonymously (`POST /api/devices`) and get a random bearer token; only its
  SHA-256 hash is stored. Records are scoped to the device that created them.
- Sync is last-writer-wins per record by the client's `updatedAt`. A stale push is rejected and
  the server's newer copy is returned. Deletions are tombstones and don't override newer edits.
  Pulls are incremental by a server-side change sequence, so client clocks don't matter.
- Raw GPS fixes are never uploaded. Lap traces (which contain positions) are, so sync is off by
  default.
- The schema (`apps/server/prisma/schema.prisma`) has circuits (GeoJSON plus a PostGIS
  `geography` column with a GiST index), timing lines, sessions, laps, GPS samples and settings.
  Timing values are stored as double-precision epoch milliseconds.
- Request bodies are never logged (they contain location data).

## Native packaging (Capacitor)

The web app is a standard Vite SPA, so it can be wrapped with Capacitor later:

```bash
npm i -D @capacitor/cli -w @laptimer/web
```

Then `npx cap init`, `npx cap add android` / `ios`, with `webDir: dist`. For reliable
screen-off/background tracking, replace `GeolocationSource` with a source backed by a native
background-geolocation plugin. The `GpsSource` interface (`apps/web/src/lib/gps/types.ts`) is
the only seam needed.

## Accuracy and limitations

- Phone GPS typically updates at 1–10 Hz with 3–10 m accuracy. Interpolated crossings give
  roughly ±0.1 s lap times in good conditions. This is not certified transponder timing.
- Desktop browsers usually position by Wi-Fi/IP (accuracy of tens to thousands of metres). The
  app detects this and says the device is unsuitable.
- Background tracking in a browser PWA is not reliable (see above).
- The elevation profile is from a ~90 m terrain model. Receiver altitude is stored with each fix
  but not charted.
- Personal bests compare laps on the same circuit definition. Editing a circuit's start line
  changes the distance coordinate of later laps.

## Tests

`npm test` runs:

- **core** (`packages/core/test`): valid crossings, wrong direction, duplicate prevention, lap
  completion, minimum lap time, jitter near the line, sector splits, sprint routes,
  missing samples, GPS jumps and re-anchoring, poor-accuracy fixes, wrap-around at the seam,
  nearest-segment projection, two close parallel sections, delta at matching distances,
  interpolation between reference samples, faster and slower laps, invalid and incomplete
  geometry, pause/resume, deterministic replay, recorded-path clean-up. These use deterministic
  fixtures from the simulator.
- **web** (`apps/web/test`): OSRM request shape and every routing failure mode (no straight-line
  fallback), route analysis, saving/restoring circuits, sessions and raw samples in IndexedDB at
  full precision, re-processing restored samples, personal bests, settings, export/import
  round-trip and validation, CSV.
- **server** (`apps/server/test`): auth, validation, push/pull, conflicts, device isolation,
  deletions, spatial query (with the in-memory repository; the Prisma repository needs PostGIS).
