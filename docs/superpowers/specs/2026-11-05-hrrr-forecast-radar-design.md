# HRRR forecast radar: design

Date: November 5, 2026. Status: awaiting review.

## Goal

Radar playback continues past the latest real scan into forecast frames, so you can see where systems may move. Frames come from NOAA HRRR GRIB2 files, decoded in the browser and drawn through Sky Peek's radar color engine.

"Accurate" here means an accurate representation of the data. Every painted pixel shows a value that exists in the source file, and nothing is smoothed, filled in or invented. It does not mean the weather prediction is right. HRRR can be wrong, so frames are labeled as simulated.

## Decisions

| Topic | Decision |
|---|---|
| Decoding location | Web Worker in the browser. No backend, no paid key. |
| Field | `REFD:1000 m above ground`, not `REFC`. `REFC` is a column maximum and would read stronger than base reflectivity at the handoff. |
| Time step | 15 minutes, from `wrfsubhf` files. Only real model steps; no frames between them. |
| Range | Selector of 2, 6 or 18 hours. Default 6. Maximum 18, because the 15-minute file series ends there. |
| First source | NOAA National only. Other sources show no forecast frames. |
| Colors | The same dBZ-to-color scale as NOAA National radar, held in the `flat.ts` style engine. The on-screen legend does not change. |
| Sampling | Nearest grid cell. No bilinear blending. |

### Why NOAA National only

RainViewer draws snow in separate colors, but the table available for forecast use is its rain scale. Forecast snow would appear in rain colors. HRRR's `CSNOW` flag could support this later. Station products are also excluded: their color scales have not been compared with the national scale, and velocity, classification and rainfall are not reflectivity.

## Verified facts

Measured on the 20z run of November 5, 2026 (sample of one run; stormy days will produce larger fields).

| Fact | Value |
|---|---|
| Bucket | `https://noaa-hrrr-bdp-pds.s3.amazonaws.com/` |
| File path | `hrrr.YYYYMMDD/conus/hrrr.tHHz.wrfsubhfNN.grib2`, plus `.idx` |
| Browser access | GET, byte-range requests and the `range` preflight all allow any origin. `.idx` files allow it too. |
| `REFD` field size | 227–264 KB per step |
| File contents | `f00` holds the analysis; every later hour file holds four steps (for example `f02` holds 75, 90, 105, 120 minutes) |
| Publish delay | `f00` at +51 min, `f01` +53, `f06` +71, `f12` +83, `f18` +85 after run time |
| Grid | Lambert conformal, 1799×1059, 3 km, LoV 262.5°, both latitudes 38.5°, first point 21.138123°N 237.280472°E, sphere radius 6,371,229 m, scanning mode 64 (south to north) |
| Packing | Template 5.3: complex packing with spatial differencing, order 2 with 2 extra octets, 11-bit, no bitmap |
| Scaling | R = -10, E = -4, D = 0, so values step by 1/16 dBZ |
| No-echo share | 93.38% of points were exactly -10 |
| Weak values | 1.03% in (-10, -5], 1.12% in (-5, 0] |
| Reference decoder | ecCodes 2.43.0 reads these files |
| NOAA legend | PNG only, 499 colors across about -27 to 73 dBZ. JSON legend has no color data. |
| Legend check | 8 of 12,700 pixels in a real national scan were off the legend colors |
| RainViewer | Feed returned 13 past frames and 0 forecast frames |

## Architecture

Pure units are kept separate from the map so they can be tested without a browser.

| Unit | Responsibility | Depends on |
|---|---|---|
| `src/radar/grib2.ts` | Parse sections, validate the supported profile, unpack template 5.3 to integers | Nothing |
| `src/radar/lambert.ts` | Convert lat/lon to fractional grid position, from header values | Nothing |
| `src/radar/hrrr.ts` | Choose the run, read `.idx` files, resolve byte ranges, build forecast frames | `budget.ts` |
| `src/radar/hrrrWorker.ts` | Fetch, decode, hold fields, render tile pixels off the main thread | `grib2.ts`, `lambert.ts`, palette |
| `src/radar/forecastTiles.ts` | MapLibre protocol handler that calls the worker | Worker |
| `src/radar/flat.ts` | Gains the reflectivity palette and value-to-color lookup | Generated scale |
| `src/radar/reflectivityScale.json` | Generated color table, kept in the repo like `stations.json` | None at runtime |
| `src/radar/tools.ts` | Latest-observed and forecast frame helpers | Nothing |
| `src/screens/Radar.tsx`, `src/radar/controller.ts`, `radarDock.css` | Timeline, banner, range selector, protocol registration | Above |
| `src/api/budget.ts` | New `hrrr` ledger source | Nothing |

### Data flow

1. Radar refreshes observed frames on the existing five-minute cycle.
2. `hrrr.ts` picks a run and lists steps valid after the latest scan, up to the selected range.
3. Each step becomes a `RadarFrame` with a forecast tile URL.
4. When a frame is shown, MapLibre requests tiles and the handler asks the worker.
5. The worker makes sure the field is decoded, then paints each tile pixel from its grid cell.
6. MapLibre displays the tile through the existing raster frame layers, under warnings and labels.

## Decoding

`grib2.ts` supports the HRRR profile only, and reads grid values from the header of each message.

It must confirm: GRIB edition 2, reflectivity at 1000 m, grid template 30, data template 5.3, scanning mode 64, spherical Earth shape 6, no bitmap, and a point count equal to Ni×Nj. It must also confirm that the sections are complete and the message ends in `7777`.

Any mismatch throws a named error and the frame shows as unavailable. The decoder never falls back to a best guess.

Values are kept as raw packed integers in `Uint16Array`, with R, E and D stored beside them. This is lossless, and a field takes about 3.8 MB against 7.6 MB for `Float32Array`. The real value is `(R + X × 2^E) / 10^D`. A reconstructed integer that does not fit is a decode error.

## Map placement

For each tile pixel, take its Web Mercator center, convert to lat/lon, and convert to the Lambert grid position with the file's parameters. Round to the nearest cell. If the position is outside the grid, the pixel is transparent. The projection uses the file's sphere radius. No datum shift is applied between that sphere and the map's coordinates, which follows normal HRRR practice and is noted in the README.

Tile size is the largest power of two at or under 181 × device pixel ratio, 256 on a Retina display and 128 on a standard one. MapLibre's `nearest` setting only covers enlarging, and it always blends when shrinking, so a tile must never be shrunk on screen. Past tile zoom 11, MapLibre enlarges them with nearest-neighbor resampling, so 3 km cells show as solid blocks. At low zoom a pixel covers several cells and shows one of them, so small cells can drop out. Every pixel is still a real value. No maximum or average is taken, because the result would no longer match any single cell.

## Color

`scripts/generate-reflectivity-scale.py` reads NOAA's legend PNG, finds the color bar, calibrates dBZ position from its tick labels, and writes `reflectivityScale.json`. The table records its source URL and date.

`flat.ts` looks up each value's nearest table entry and paints it opaque. Values above -10 dBZ are painted, including weak values, because NOAA's scale goes below zero and real scans show echoes down to about -5 dBZ. Values at or below -10 are no echo and stay transparent. Values above the top of the table use its top color.

NOAA does not publish a machine-readable table for this layer, so the legend image is the source. Its resolution is about 0.2 dBZ. A test measures generated colors against a saved real scan. Only the legend's colors are used, so forecast frames add no new visual style.

## Choosing the run and frames

- A newer run is adopted only when every file needed for the selected range has been published. Until then, the previous run stays in use.
- The search walks back from the current UTC hour, up to six runs. A 404 on an `.idx` file means not published.
- One timeline uses one run. Runs are never mixed.
- Frames must be valid after the latest real scan. The last frame is the earliest of the selected range end and the run's last step. Run age can therefore shorten the timeline; for example, an 18-hour selection may show about 16.5 hours.
- A published `.idx` file is cached for the session. Missing ones are retried on the next five-minute cycle.
- The field's line is matched by name and step in the `.idx` file, and the next line's offset gives the end of the range.
- When a run is replaced, `frameAfterRefresh` keeps the nearest clock time.

## Timeline behavior

`RadarFrame` gains `kind: 'observed' | 'forecast'` and, for forecast frames, `run` and `leadMin`. A missing `kind` means observed, so existing sources do not change.

A helper returns the index of the latest observed frame. These places move to it:

| Place | Current behavior | New behavior |
|---|---|---|
| Latest button (`jumpLatest`) | Last frame | Latest real scan |
| Follow live (`frameAfterRefresh`) | Last frame | Latest real scan |
| Storm arrival | Hidden unless on the last frame | Shown on the latest real scan |
| `historical` flag | Before the last frame | Before the latest real scan |
| Status text | Historical unless on the last frame | Forecast frames show run and lead, not an age |

The rail shows observed frames, a Now marker, then forecast frames in a distinct flat treatment. A range selector (2, 6, 18 hours) sits with the playback controls and appears only when forecast frames are available. The choice is saved in this browser.

Forecast frames show a banner in the style of the Historical one, for example: "HRRR simulated radar · Run 3 PM · +2 h 15 min", plus which overlays are live.

Playback runs through observed and forecast frames, then wraps to the first frame, as it does today.

### Overlays on forecast frames

Storm cells and arrival estimates are hidden, because no reports exist for the future. No storm history request is sent for a forecast time. Warnings, lightning, wind, temperature and spot readings stay visible and are named as live in the banner.

## Loading and limits

- Fields load on demand, plus up to three ahead during playback.
- Up to 12 decoded fields stay in the worker, with the least recently used dropped first. Compressed bytes are kept for up to 84 fields, so a dropped field is rebuilt without another download.
- Up to 24 forecast map layers are kept. A dropped layer repaints from the worker on its next visit.
- Failed frames retry on their next visit, and their mark clears when they load.
- Worker tile rendering is cancelled when MapLibre aborts a tile.
- At most two field downloads run at once. Each has a 30-second timeout.
- Every `.idx` and field request is charged to a new free `hrrr` ledger source. A 429 or 5xx pauses downloads for a minute. Held fields keep working during a pause.
- Nothing is fetched while the radar screen is hidden, or on sources other than NOAA National.

## Failures

| Situation | Result |
|---|---|
| No usable run | No forecast section. Observed radar is unaffected. A small notice says the forecast is unavailable. |
| Field download or decode fails | That frame is marked unavailable and playback stops, as for a failed tile. Other frames stay usable. |
| Unsupported GRIB | Same as a decode failure. Also recorded with `recordDiagnostic`. |
| Worker fails to start | No forecast section, plus the same notice. |
| Location outside HRRR's grid | Transparent. HRRR covers the lower 48 only. |

Observed radar never waits on forecast data.

## Testing

Decoder tests use saved real data, not synthetic values.

- **Fixture:** a real `REFD` message in `src/radar/__fixtures__`, with a dense stormy field added if one can be captured.
- **Values:** `scripts/generate-grib-golden.py` uses ecCodes to record a SHA-256 of all 1,905,141 values in 1/16 dBZ units, plus samples for readable failures. The decoder must match the hash exactly.
- **Positions:** ecCodes latitude and longitude for the corners and a regular sample of points. `lambert.ts` must return each point's own grid position to within 0.001 cell.
- **Rejections:** altered headers for each profile check must throw, and a truncated file must throw.
- **Hand-built GRIB edge cases:** a small message covering group splitting, zero-width groups and negative differences.
- **Color:** no-echo stays transparent, the top value clamps, and generated colors are checked against a saved scan.
- **Inventory:** `.idx` parsing, step selection, run adoption and range limits, with saved `.idx` text.
- **Timeline:** every row of the table above, using forecast and observed frames together.
- **Regression:** sources without forecast frames behave exactly as before. A failed `hrrr` request never touches observed frames.
- **Browser:** using the dev server, confirm real CORS behavior, playback across Now, Latest, the selector and frame-failure handling, then check for console errors.

## First implementation check

Decode time, tile time and worker memory have not been measured. The plan starts with a throwaway measurement on real fields. If a field takes more than 1.5 seconds to decode on this machine, or one tile takes more than 100 ms, the design returns for review before the UI work begins.

## Documentation

The README's NOAA section says the integration supplies no future radar, and that playback never invents intermediate frames. The first is updated to describe HRRR frames. The second still holds and is extended to forecast frames.

## Out of scope

- RainViewer, OpenWeather, Tomorrow.io and station-mode forecast frames.
- Precipitation-type coloring, including `CSNOW`.
- Hourly files beyond 18 hours.
- `REFC` or any other HRRR field.
- Storm-track projection and extrapolated radar.
- Time interpolation, motion smoothing or blending at the Now boundary.
- Forecast verification scoring.
- Any server-side processing.

## Known limits

- Radar and model will often disagree at Now, so a storm may appear to jump between frames. This is what the data shows and is not corrected.
- Field sizes and publish delays come from one run. Stormy-day sizes are unknown.
- NOAA publishes no availability guarantee for this data, and source terms have not been checked beyond public access. Credit NOAA in the app.
- Native HRRR resolution is 3 km, which is coarser than NOAA National radar at high zoom.
