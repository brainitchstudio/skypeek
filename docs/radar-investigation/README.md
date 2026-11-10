# NOAA OpenGeo investigation

Checked November 5, 2026, around 11:18 AM America/Chicago (17:18 UTC).

## Conclusion

OpenGeo is a credible source for an initial personal US radar implementation in Sky Peek. Live tests successfully retrieved transparent PNG imagery for national MRMS base reflectivity and Chicago (KLOT) single-site super-resolution reflectivity and radial velocity, including historical frames. No app behavior or provider defaults were changed.

## Evidence

Run `python3 scripts/probe-opengeo.py` from the project folder to refresh the evidence. It makes eight sequential requests, with a 30-second timeout per request; no load or rate-limit testing. Raw capabilities, sample PNGs, response headers, timings, URLs and SHA-256 hashes are stored alongside this report in `probe-results.json`. Subsequent runs overwrite the evidence.

| Test | Result at sample time |
| --- | --- |
| KLOT capabilities | HTTP 200; five products: reflectivity, velocity, classification, one-hour and storm-total accumulation |
| KLOT reflectivity / velocity | Each advertised 14 explicit timestamps covering 15:11:59–17:08:56 UTC; approximately nine-minute spacing |
| CONUS base reflectivity | 60 timestamps covering 15:18:13–17:16:19 UTC; approximately two-minute spacing |
| Image retrieval | Six of six HTTP 200 PNG responses; 512×512, EPSG:3857; historical and latest content had different hashes |
| Empty imagery check | Latest national, KLOT reflectivity and KLOT velocity images all contained nontransparent pixels |
| Browser access headers | Capabilities and PNGs returned Access-Control-Allow-Origin: * when sent a localhost Origin |
| Observed timings | Capabilities 0.37–0.47 seconds; images 0.55–1.04 seconds. One short sequential sample, not a performance guarantee |
| Cache behavior | Capabilities max-age 12–15 seconds; timestamped PNGs max-age 9000 seconds |
| Freshness | National latest timestamp about two minutes behind response Date; KLOT about ten minutes behind. This combines scan cadence and delivery delay, not a measured ingestion latency |

KLOT capabilities advertised only a time dimension, with nearestValue=1. No elevation dimension was advertised. Do not infer full volume access or selectable tilts. A timestamp may be snapped to a nearby available frame: use exact advertised timestamps, and validate decoded imagery, not HTTP status alone.

The velocity PNG was visually inspected and contains a red/green radial field. Its presence does not establish storm-relative velocity, quantitative pixel accuracy, or tornado detection.

## Fit with this project

- Next.js / React app; MapLibre rendering in `src/radar/controller.ts`.
- Current imagery sources are RainViewer and optional OpenWeather/Tomorrow.io, with a simulated mode.
- `src/api/weather.ts` supplies `RadarFrame` objects containing a label and tile URL. It currently calls the latest frame “Now”; NOAA frames should retain an explicit observation timestamp and visible age instead.
- `src/radar/flat.ts` decodes existing precipitation images into four generic intensity bands. Do not send NOAA velocity, classification, or accumulation through that pipeline. Initially preserve NOAA native colors and provide the matching product legend. Reflectivity should also retain its native scale until a validated decoder is justified.
- The existing raster source accepts a WMS GetMap template using EPSG:3857 and `{bbox-epsg-3857}`. Select explicit TIME values and use native PNG tiles with nearest-neighbor resampling. No application server relay appears necessary from the tested CORS headers; actual browser rendering remains untested.
- Existing alert handling preserves official alerts on failures. Keep it authoritative rather than changing alert sources as part of the radar investigation.
- Existing budget accounting covers the current sources. NOAA metadata requests and actual tile requests need their own conservative internal accounting; no provider entitlement was verified.

## Recommended first integration

1. Add NOAA national reflectivity as an optional source; leave existing defaults intact during evaluation.
2. Parse WMS capabilities, cache metadata, retain exact frame timestamps, and select a bounded subset for playback (for example 12 frames spanning the advertised history). Use timestamps in image URLs for safe cache reuse.
3. Add a radar-station picker and separate reflectivity / radial velocity product choices. Do not label velocity as wind at the ground or storm-relative velocity.
4. Preserve native imagery, add legends and acquisition time, show stale/unavailable states, and retain the last valid frame on transient failures.
5. Cache frames, limit simultaneous downloads and retained map layers, fetch only while visible, cancel outdated work, and back off on 429/5xx. Do not prefetch every station or all 60 national frames.
6. Validate playback, panning, CORS in the browser, actual request counts, source transitions and failure recovery before making NOAA the default.

## Unknowns / limitations

No published unlimited-request allowance, rate-limit policy, uptime guarantee or service SLA was established. No stress tests were performed. These eight successful requests do not establish reliability during severe weather.

The checked service provides rendered products; it does not establish access to raw Level II volumes, arbitrary elevation tilts, correlation coefficient, 3D cross sections, or partial live sweeps. Those requirements may still justify a raw feed, public or paid.

Only KLOT and one CONUS layer were tested. Other stations/products, projected zoom quality, legends, warning WFS output and sustained freshness remain untested. No claims about other stations' cadence or two-hour history are made.

No current source-specific terms or attribution policy were verified beyond the public NOAA directory. Keep NOAA credited and verify applicable terms before distributing the app.

## Official source

https://opengeo.ncep.noaa.gov/geoserver/www/index.html
