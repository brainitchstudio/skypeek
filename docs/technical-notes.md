# Sky Peek

A Next.js weather app with forecasts, radar and severe weather alerts for US locations.

```bash
npm ci
npm run dev
```

Open http://localhost:3000. `npm test` runs the unit tests and `npm run build` makes a production build.

For GitHub deployment to a Hostinger subdomain, see [Hostinger deployment](docs/hostinger-deployment.md). Use Hostinger's Node.js Web App flow; the live API routes require a server. The beta gate uses server-only environment variables and can [generate expiring codes after deployment](docs/beta-code-gate-plan.md).

## Data

- Forecasts, hourly data, current observations and alerts: National Weather Service (no key)
- Forecast blending: OpenWeather, Tomorrow.io and WeatherAPI, with a verified key
- Days 8–10 and place search: Open-Meteo (no key)
- Radar: RainViewer (no key), or OpenWeather or Tomorrow.io with a verified key
- Forecast radar: NOAA HRRR GRIB2 files, read directly in the browser (no key)
- Radar layers: storm cells from NWS NEXRAD via Iowa Environmental Mesonet, lightning density from NOAA nowCOAST, wind and temperature from Open-Meteo (no keys). Individual lightning reports use an OpenWeather Lightning API entitlement on the existing OpenWeather key (50 km radius), or an optional Weather Company Recent Lightning Strikes for Region key (100-mile radius).
- Map: OpenStreetMap vector tiles from OpenFreeMap (no key), drawn with MapLibre in a flat style. Satellite imagery comes from Esri. County lines below zoom 9 come from the US Census Bureau through `us-atlas`.
- Radar place search: Open-Meteo for cities and ZIP codes; US Census Geocoding Services for submitted street addresses (no key). Street coordinates are estimates along an address range. Address results zoom into the current map style. The flat map keeps white land and black text and linework, with blue water, and draws roads, building outlines, and available house numbers from OpenFreeMap's OpenMapTiles data. Weather colors remain separate. A Flat/Satellite switch is available on the radar. Earlier saved Streets selections load as Flat. Search results can be pinned, saved, favorited, or made the main weather location. Saved places stay in this browser's localStorage.

Full data credits appear under Settings > Data source. The radar map also shows a compact attribution control with the map tile and imagery credits.

Radar imagery preserves provider colors, transparency, and precipitation types through `src/radar/imagery.ts`. RainViewer uses unblurred Universal Blue imagery with separate snow colors and a rain reflectivity legend. MapLibre uses nearest-neighbor resampling at each source’s zoom ceiling; zooming further enlarges pixels without adding detail. Flat temperature bands and lightning styling remain in `src/radar/flat.ts`. Weather imagery draws above temperature and below warning overlays and map labels.

## Weather orchestration

`src/weather` keeps forecast sources balanced. `tick()` in `service.ts` is the only way screens get weather. It runs once a minute, and most ticks fetch nothing.

- `planner.ts` picks what's worth fetching: NWS as the baseline, one primary, and connected keys as slower challengers that speed up when rain is near or sources disagree.
- `src/api/budget.ts` has the final say. Each fetch reserves capacity first. 10% of each limit is headroom, 15% of the rest is kept for urgent work, and failed attempts stay charged. Limits are set in `SOURCES`.
- `adapters.ts` turns each provider's response into canonical units, with its meaning declared, so a rain-only chance can't blend with an any-precipitation chance.
- `fusion.ts` blends comparable fields. Budget never affects trust. `config.ts` holds the starting weights, which are assumptions, not measured accuracy.
- `alertState.ts` tracks official alerts on their own budget. A failed poll never clears a warning.

`accuracy.ts` logs how each source did, and the results appear under Settings > Data source. It saves what each source and the blend said 1 to 48 hours ahead, then compares that with nearby NWS station readings. Records stay in this browser's IndexedDB. Forecasts are only saved while the app is open and on screen, and the log doesn't change the blend weights. Rain is scored against a proxy: precipitation reported by the station during the hour.

Everything is fetched from the browser. Settings, including provider API keys, are stored in that browser's localStorage, and so is the request ledger, so limits are tracked per browser rather than per API key.

The radar checks NOAA lightning density around the active location every five minutes, including when the lightning layer is hidden. Activity estimated within 10 miles shows a persistent shelter banner. Density pixels are an approximately 8 km grid, so their positions and distances are approximate. Individual strike markers appear only when a connected point-report product is available; clicking one shows its reported time, location, and available quality details. Point reports are live and independent of the selected radar playback frame. The OpenWeather documentation currently lists a `demo.openweathermap.org` endpoint for this product; live access and browser CORS behavior require testing with an entitled key.

`safeguards.ts` checks every response before it's stored. Impossible values are removed, never adjusted, so the next real source fills in or the field stays blank. A response that's more than 20% impossible temperatures is thrown out and the last good one stays. Each time a safeguard fires, it records when, why and what was done. Those records appear under Settings > Data source and in the accuracy export, and they stay in this browser in their own IndexedDB database. Limits only catch impossible values. A plausible but wrong forecast gets through, which is what the accuracy log is for.

## Icons

Interface icons come from [Lucide](https://lucide.dev) (ISC). Weather icons are the flat style of [Meteocons](https://www.npmjs.com/package/@meteocons/svg-static) by Bas Milius (MIT), copied into `public/icons/weather` with their license. The cloud color is darkened so it shows up on white.

## Experiment dashboard

Open `/lab` (also linked from Settings > Data source) for collection health, provider status, location/window/exact-lead/fusion-version filters, temperature/wind error statistics, precipitation-proxy Brier scores, daily trends, searchable safeguard outcomes, observation and forecast records, raw JSONL export, and dated local notes. Refreshing records reads storage; the normal weather service handles scheduled collection while visible.

No automatic tuning or historical import is enabled. Scores are descriptive; different-source tables can cover different cases, while the shared-case comparison uses common cases. Local notes do not sync to the project notebook. Diagnostics retain at most 200 entries in localStorage and archive health covers the current session. Missing/empty logs do not establish error-free operation. Export includes audit health and stored records; keep exports for reproducible analysis.

## Primary objective — confirmed 2026-11-05

Deliver a dependable, useful weather experience using free, openly available data within applicable usage limits. Improve accuracy where evidence supports it, while measuring request cost, freshness, coverage, and reliability together. Free access is not the same as open-source software or an open-data license; verify each source's terms, attribution, access model, and permitted use before adopting or expanding it. Configured budget ceilings are internal safeguards, not verified provider entitlements.

Prefer a strong primary source, caching, reuse, and graceful fallback. Additional sources must justify their marginal request cost through coverage, freshness, resilience, or held-out accuracy benefit. Existing optional keyed providers may remain available for comparison; success must not depend on adding paid services or polling every provider. Do not increase request frequency or add a provider merely to obtain consensus. Any consensus/median shadow experiment should reuse already-captured compatible forecasts first.

Evaluate candidate changes as tradeoffs: paired forecast error and event performance; counted request units by source and actual accounting window; 429/cooldown and budget-denial evidence; stale/missing coverage; cache reuse and latency where instrumented; and fallback outcomes. Explicitly mark uninstrumented measures as unknown. Provider accounting may count units differently from HTTP calls; the ledger is per browser, not account-wide. Alert availability and core forecast access take priority over optional experiments. A small accuracy improvement at disproportionate request cost may be a worse product outcome. No automatic tuning.

## NOAA radar sources

The Radar source button in the radar dock opens the **Radar source** menu. Switch between RainViewer, **NOAA · National radar** (CONUS MRMS base reflectivity), and **NOAA · Radar station**. Station mode selects the nearest station to the forecast location by default, or an explicit station; **View station on map** centers its coverage. Products include reflectivity, radial velocity, precipitation classification, one-hour rainfall and storm-total rainfall. Source, station and product preferences are saved in this browser. New installations default to NOAA national; existing saved source choices remain intact.

NOAA imagery retains native colors and transparency. Legends come from the same NOAA product. Playback uses up to 12 exact advertised timestamps spanning available recent history, with scan time and age displayed; it never invents intermediate frames. Radial velocity is motion toward/away from the radar, not surface wind or storm-relative velocity. Blank images may be outside station coverage. This integration does not supply Level II volumes, elevation selection or 3D. Future radar comes from HRRR; see below.

Metadata is cached for two minutes and refreshed while the radar screen is visible on the existing five-minute refresh cycle. NOAA downloads (including legends) are counted, limited to four concurrent requests, timed out after 15 seconds, and paused for a minute on 429/5xx. The NOAA ledger ceilings are conservative internal limits, not a verified service allowance. Only the selected frame layer is visible; inactive frames do not trigger tile fetches on panning. Refresh failures retain prior frames and show a notice; changing products clears the previous product. NOAA service failures never silently switch to demo data. Station coordinates in `src/radar/stations.json` were taken from NOAA's radar_sites service and filtered to the WSR-88D sites listed in its directory on November 5, 2026.

Storm tracks use clickable, keyboard-focusable markers: green rain-cloud icons for cells, blue exclamation icons for stronger radar estimates, and purple vortex icons for vortex signatures. Selection adds an outline and opens a flat data card; closing the card clears selection. The card shows motion, report time/ID, location, hail size/probabilities, echo top, reflectivity and VIL when reported. Missing or sentinel measurements display Unavailable, not zero. These are radar estimates, not verified surface reports or official warning classifications. Dated radar frames use historical cell reports within five minutes of the frame; see Radar analysis tools below.

## Forecast radar

With **NOAA · National radar**, playback continues past the latest real scan into HRRR forecast frames. A selector next to the speed control sets the range to 2, 6 or 18 hours, 6 by default. Frames are simulated model output, not radar scans, and are labeled with their run and lead time. HRRR covers the lower 48 only.

Each frame is the `REFD` field at 1000 m above ground from a `wrfsubhf` file, at the model's own 15-minute steps. A Web Worker requests just that field with a byte-range request, using the file's `.idx`, then decodes it in `src/radar/grib2.ts`, which reads only HRRR's profile (Lambert conformal grid, complex packing with second-order spatial differencing). Anything else is refused, and the frame shows as unavailable.

The rule is that every painted pixel is a value in the file. Each pixel takes the nearest 3 km grid cell, using the projection in the file's header on its sphere; no datum shift is applied between that sphere and map coordinates. No source pixels are smoothed or generated between steps, so cells show as solid blocks when zoomed in, and small cells can drop out at low zoom. Tiles are sized for the display so the GPU never shrinks them, because MapLibre blends when it shrinks a texture. Only `-10` dBZ, HRRR's no-reflectivity value, is transparent. During playback, the current complete frame stays visible while the next loads, then the two images briefly crossfade; the fade is a display transition, not an intermediate forecast.

Colors come from `src/radar/reflectivityScale.json`, generated from NOAA's own legend image, so forecast frames match the radar and its legend. NOAA publishes that legend only as an image, so the table's resolution is about 0.2 dBZ.

One timeline uses one run. A newer run replaces the old one only when every file the selected range needs is published, usually 50 to 85 minutes after run time, and only frames after the latest real scan appear. An older run can make the timeline a little shorter than the selected range. Radar and model often disagree at Now, so storms may appear to jump; that is what the data says and it is not corrected. Storm tracks and arrival estimates are hidden on forecast frames. HRRR requests are counted under their own ledger source, and a forecast failure never affects real radar.

Test data comes from dev-only Python tools (`python3 -m venv .venv && .venv/bin/pip install -r scripts/requirements-dev.txt`): `scripts/capture-hrrr-fixture.sh` saves a real field, `scripts/generate-grib-golden.py` records what ecCodes reads from it, and `scripts/generate-reflectivity-scale.py` rebuilds the color table. The decoder must match ecCodes exactly on every grid point. HRRR data is from NOAA.

## Radar analysis tools

- **Radar toolbar:** search, zoom, recenter, Layers, Radar source, SpotCheck and Measure run across the top of the map. Layers contains precipitation, storm tracks, lightning, wind, temperature and an Alerts switch. Its badge counts active alerts at the forecast place; switching Alerts on shades counties listed in active NWS warnings, watches and advisories, shows official alert polygons where available, and adds a clickable county icon with the NWS alert text. Map panning and zooming remain available while the menu is open. Radar coverage is available in the Radar source menu.
- **Ruler:** open Measure in the radar dock, check Measure on map, then click two map points. Shows great-circle distance in miles or kilometers according to unit settings and the initial bearing. Clear resets the endpoints; a third click starts a new line. Measurement clicks do not open weather cards.
- **SpotCheck:** on the latest real scan, press SpotCheck in the dock (or on a storm or warning card). Choose a storm outline, then click a map spot; the card explains whether that storm is headed there and shows the forecast and active warnings at the spot. Skip the storm selection to check only the spot forecast. Clicking again moves the pin; Escape exits. Each section fails independently and shows Unavailable.
- **Playback:** previous/next frame, ½×/1×/2× speed, play/pause and Latest. Playback waits for the selected image source to finish loading before advancing. Historical selection is retained across metadata refreshes; Latest resumes following the newest frame. Playback does not advance while the browser tab is hidden.
- **Coverage & status:** RainViewer uses its published coverage mask. NOAA shades outside the geographic product extent advertised in WMS capabilities; this bounding extent is not a guarantee of usable echoes, beam coverage or station health. NOAA station mode also displays the NWS RDA status, mode, report time and reported alarms. Missing/stale status is not labeled online or offline. Imagery acquisition time and tile/metadata failures are reported independently of hardware status.
- **Storm history:** dated frames request IEM's documented `nexrad_attr.py?valid=<UTC>` archive endpoint. Only reports within five minutes of the selected frame are drawn; no interpolation or substitution of current cells. Queries are debounced and up to 24 frame results are cached; loading and unavailable states hide mismatched markers. Undated provider images explicitly use latest reports with a timing notice. RainViewer timestamps are map-frame generation times, not simultaneous measurements across all constituent radars. Historical storm arrival estimates use the selected frame time. Warning polygons, surface weather and lightning remain current layers.
- **Map-wide NWS alerts:** the radar requests official active alerts affecting the visible map, independent of the saved weather location. The server caches the national NWS alert feed for one minute and returns polygon-based and county-coded alerts near the map view. Turning on Alerts shades listed counties and shows an icon that opens the NWS description, issuing source, time range, and instructions. Published polygons remain visible. A failed request clears the overlay and displays an unavailable notice; it does not imply there are no alerts. During historical playback, a visible context label identifies alert areas, lightning, wind, temperature, and spot readings as live overlays; storm tracks remain aligned to the selected frame when reports are available.

- **Storm arrival check:** the dock's SpotCheck tool reads NOAA MRMS ProbSevere 3.0 through `/api/storm-objects`, because the feed sends no cross-origin header. It runs only while the mode is open, on the radar's five-minute cycle. Each outline is slid along its reported motion and its observed motion over the last 20 to 30 minutes. The Likely, Possible and Unlikely levels are Sky Peek's own rule, not a published forecast.

IEM requests have a separate internal ledger, cooldown on 429, and 15-second timeouts. NOAA downloads remain bounded to four simultaneous requests. The NOAA internal burst ceiling allows a full initial animation loop; these configured ceilings are not provider entitlements.

References: https://mesonet.agron.iastate.edu/geojson/nexrad_attr.py?help and https://www.weather.gov/documentation/services-web-api
