# Lap Timer data formats

## JSON export (`laptimer-export`, version 1)

Produced by **Settings → Export**, **Circuits → export**, and **Session → JSON**. Imported by
**Settings → Import**, which validates the whole file before writing anything and merges record
by record (a record replaces a local one only when its `updatedAt` is newer).

```jsonc
{
  "format": "laptimer-export",
  "version": 1,
  "exportedAt": "2026-10-12T09:00:00.000Z",
  "circuits": [Circuit],
  "sessions": [Session],
  "samples": [{ "sessionId": "…", "samples": [GpsSample] }]   // optional raw fixes
}
```

Units: distances in metres, speeds in m/s, times in milliseconds. Timestamps are Unix epoch
milliseconds and may be fractional (interpolated line crossings); they are never rounded.
Coordinates are WGS84. Unknown numeric values (e.g. accuracy at an interpolated lap boundary)
are written as `null`.

### Circuit

| Field | Type | Notes |
|---|---|---|
| `id` | string | Client-generated UUID |
| `name` | string | 1–120 chars |
| `kind` | `"closed"` \| `"sprint"` | Closed: one start/finish line. Sprint: separate start and finish lines |
| `origin` | `"routed"` \| `"recorded"` \| `"imported"` | How the geometry was created |
| `geometry` | `[lon, lat][]` | Full centreline (GeoJSON order). For routed circuits this is the complete road geometry returned by the router; for recorded circuits the cleaned GPS path |
| `waypoints` | `[lon, lat][]` | Waypoints used to request the route (empty for recorded) |
| `routing` | `{provider, profile, warnings[]}` \| null | |
| `startLine` | TimingLine | |
| `finishLine` | TimingLine \| null | Sprint only |
| `sectors` | TimingLine[] | Sector boundary lines, in driving order |
| `lengthM` | number | Length of `geometry` |
| `elevation` | `{d, elevation}[]` \| null | Optional profile (distance along route, metres above sea level) |
| `createdAt`, `updatedAt` | number | Epoch ms |

**TimingLine** — `{ "a": {lat, lon}, "b": {lat, lon}, "direction": 1 | -1 }`. A crossing is valid
when the sign of `cross(b − a, travel)` equals `direction` (computed in a local east/north plane):
`+1` means travel goes from the right-hand side of a→b to its left-hand side.

### Session

| Field | Type | Notes |
|---|---|---|
| `id`, `circuitId`, `circuitName` | string | The name is kept so sessions survive circuit deletion |
| `source` | `"gps"` \| `"simulated"` | Simulated sessions come from the development simulator |
| `startedAt`, `endedAt` | number, number \| null | `endedAt` null = interrupted |
| `laps` | Lap[] | Completed laps only |
| `marks` | `{type: "pause" \| "resume", t}[]` | Needed to re-process raw samples identically |
| `reference` | `{sessionId, lap}` \| null | Reference lap used for live delta |
| `updatedAt` | number | |

### Lap

| Field | Notes |
|---|---|
| `lap` | 1-based lap number in the session |
| `startT`, `endT`, `timeMs` | Interpolated line crossings and their difference |
| `sectorTimesMs` | Sector durations (empty when the circuit has no sectors or one was missed) |
| `distanceM`, `avgSpeedMs`, `maxSpeedMs` | |
| `valid` | False when the driven distance does not match the circuit (missed/spurious crossing) |
| `flags` | `poor_gps`, `signal_gap`, `tracking_lost`, `distance_mismatch`, `crossing_interpolated_over_gap`, `simulated` |
| `gps` | `{samples, poorSamples, meanAccuracyM, maxGapMs, meanRateHz}` |
| `trace` | `{t, d, v, lat, lon, accuracy}[]` — elapsed lap time, distance from the start line along the circuit, speed, position. Begins at `(0, 0)` and ends at `(timeMs, lapLength)`. Used as the reference for live delta and for distance-aligned comparison |

### GpsSample

`{ t, lat, lon, accuracy, speed, heading, altitude, altitudeAccuracy }` — exactly as delivered by
the Geolocation API (`speed`, `heading`, `altitude*` may be null).

## CSV

**Laps CSV** (`…-laps.csv`): one row per trace point.

```
session_id,lap,lap_valid,elapsed_ms,distance_m,speed_ms,lat,lon,accuracy_m
```

**GPS CSV** (`…-gps.csv`): one row per raw fix.

```
session_id,timestamp_ms,iso_time,lat,lon,accuracy_m,speed_ms,heading_deg,altitude_m
```
