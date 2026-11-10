# Sky Peek: data safeguards handoff

Written 2026-11-05 for a developer picking this up.

## Why this exists

Sky Peek blends weather data from several providers. The owner's requirement is that made-up or impossible data must never reach the screen, and that when the app can't work something out, it falls back to real sourced data or shows nothing. An audit of the first version found that it didn't meet this:

- Impossible values passed straight through. Tomorrow.io's `-9999` placeholder blended to -3326°C, and 0 K was accepted as -273.15°C.
- A 3-hour OpenWeather rain chance of 95% replaced an NWS one-hour 10%, because the heaviest source chose the rain chance's meaning.
- Missing wind became `0`. A missing daylight flag became `true`. A missing condition became a sun icon.
- A rain-only chance was shown unlabeled.
- An old cached forecast showed no warning, because `friendlyError` returned null whenever any forecast existed.
- Open-Meteo data wasn't checked, and its gap-fills weren't labeled.
- The UI barely showed where numbers came from.

The author reports fixes for those paths. Coverage and verification limitations are listed below. Safeguard logging is best effort in browser storage; a complete or permanent record is not guaranteed.

## Principles

1. Values failing guardrails are removed. Separately, supported interpolation and calculated daylight are derived estimates, not observations or substitutes for rejected values.
2. Missing stays missing. `null` means unknown and shows as "–", not 0.
3. A removed value is replaced only by another real source. If there is none, the value stays blank.
4. Source disagreement is not treated as an error. A real front can look the same, so all sources are kept and the disagreement is logged.
5. Logging can never hold up a refresh, and it never changes the blend.

## The app in brief

The app is personal, single-user and browser-only, with no backend. API keys and weather caches are in localStorage, and the logs are in IndexedDB. Everything runs from `tick()` in `src/weather/service.ts`, once a minute. Canonical units are °C, m/s and probability 0–1.

## Data flow

```
provider response
  -> adapter normalize()           throws on missing structure
  -> sanitize()                    limits check; removes values or quarantines the response
  -> storeBatch()                  immutable batch per provider and product
  -> ineligible() / fuseHour()     age rules, then the blend
  -> assemble()                    builds the snapshot; hole-fills removed hours
  -> archive()                     resolve() + audit() -> safeguard events in IndexedDB
```

## The checks

### Physical limits: `LIMITS` in `src/weather/safeguards.ts`

These are configured product guardrails for supported surface variables, not universal physical boundaries. A failure requires checking units, variable definitions, source payload, and applicable extremes; it does not alone prove fabricated data.

| Field | Limit |
|---|---|
| Temperature | -90 to 60°C |
| Dew point | -100 to 60°C |
| Wind | 0 to 115 m/s |
| Gust | 0 to 150 m/s |
| Wind direction | 0 to 360° |
| Rain chance, cloud | 0 to 1 |
| Visibility | 0 to 500 km |

`sanitize()` checks points, day highs and lows, current facts, and NWS `periods`. Periods need their own check because the NWS screens read them directly, bypassing the blend. NaN and Infinity fail. `num()` and `pct()` in `units.ts` deliberately pass out-of-range numbers through, so the sanitizer can catch and log them.

### Quarantine

If more than 20% of a response's temperatures are impossible (`QUARANTINE_SHARE`), the whole response is discarded. The last good batch stays, and the failure is recorded as `schema`. This only looks at temperatures. Other bad fields are removed one at a time, even if every value in a response is bad.

### Age and eligibility: `ineligible()` in `fusion.ts`, values in `config.ts`

| Data | Limit |
|---|---|
| Observation | 60 min, or 20 min during a weather event |
| Hourly forecast | 12 h, or 6 h during an event (NWS stays at 12 h) |
| Daily forecast | 24 h |
| No issue time | 6 h after the content first appeared |
| Future timestamp | More than 2 min ahead is rejected |

### Stations

Up to 3 stations are tried, within 40 km and 150 m of elevation difference. A station with an impossible reading, no temperature, or an old reading is skipped and the next one is tried.

### Rain chance: `fuseHour()` in `fusion.ts`

Chances blend only within one meaning. A true one-hour chance always wins. Otherwise the heaviest source's meaning is used, and the hour gets `popKind: 'rain' | '3h'` so the UI can label it.

### Accuracy log

`truthRows` applies the same limits to station readings, so bad readings can't score forecasts. Nothing from the accuracy log feeds the blend weights.

## Fallback order

| What's shown | Order |
|---|---|
| Current conditions | Nearest valid NWS station, then blended commercial current data, then the first forecast hour |
| Hourly forecast | NWS periods with the blend overlaid, then a fully blended commercial forecast if NWS is ineligible or doesn't cover the place |
| A removed NWS hour | Filled from other sources in `assemble()` if any has that temperature. Otherwise the hour is left out |
| A removed value within an hour | The remaining sources for that field, otherwise blank |
| Daily high and low | The blended high from NWS and commercial daily products, then Open-Meteo for gaps, labeled through `highFrom` |
| Days 8 to 10 | Open-Meteo, labeled as the source. Days with invalid values are dropped |
| Failed or quarantined response | The last good batch, with a warning |
| Nothing usable | An error message, never invented numbers |

Day or night is calculated by `isDaylight()` in `units.ts` when a source doesn't give it.

## What the user sees

- **Blanks:** "–" for missing wind or rain chance. `Hour.windMph` and `Day.windMph` are now `number | null`, and `parseWind('')` returns null.
- **Stale warning:** "Forecast from Thu 2:06 AM. Couldn't refresh. Try again" (`StaleNote` in `src/screens/shared.tsx`). `staleSince` is set when the primary source's last fetch failed, or its data is over 2 hours old.
- **Hourly:** a line for the selected hour lists sources and weights, plus any estimated or rain-kind note. Labeled rain chances get an asterisk in the strip.
- **10 Day:** the panel says who wrote the text and where the high came from, because the NWS sentence can quote a different high than the blend.
- **Settings > Data source > Safeguards:** the last 30 days, newest first, up to 20 rows, showing when, why and what was done.

## How logging works

Records are stored in their own IndexedDB database, `sky-peek-safeguards` v1, store `events`, indexed by `scope`. It's separate from `sky-peek-accuracy` so that adding it couldn't trigger a version upgrade blocked by an open tab. Records are pruned with the accuracy log, at 400 days. They're also included in Export data as `event_type: "safeguard"`.

### Record shape: `SafeguardEvent`

```ts
{
  id: string;          // `${scope}|${utcDay}|${rule}|${source}|${field}`
  scope: string;       // geo cell for the place
  rule: Rule;
  source: string;      // provider, 'blend', 'Open-Meteo' or 'station X'
  field: string | null;
  firstAt: number; lastAt: number;
  count: number;
  why: string;         // plain English, °F and mph
  action: string;      // what was done
  outcome: 'fallback' | 'blank' | 'kept_last_good' | 'labeled' | 'warned' | 'kept_all';
  sample: string | null; // first bad value, in stored units
}
```

The same rule, source and field on the same UTC day updates one record. `mergeEvent` raises `count`, moves `lastAt`, keeps the first `sample`, and takes the newest `why` and `action`.

`count` means two things. For `out_of_range` it adds up values removed. For audit rules it counts audit runs.

### Two ways events are created

- **As it happens:** `sanitize` and the fetch jobs push `Draft`s into a per-refresh `notes` array. `resolve()` then fills in the real outcome by re-running `fuseHour` for that hour and naming which source supplied that field, or recording that nothing could.
- **Review of what's shown:** `audit()` looks at the next 48 hours and records what shaped them. It runs only when the data changes or a new hour starts, not on every tick.

`archive()` is raced against a 4 second timeout and its errors are swallowed, so a logging failure can't stall a tick.

### Rules

| Rule | Fires when | Outcome |
|---|---|---|
| `out_of_range` | A value is past its limit | `fallback` or `blank` |
| `response_quarantined` | Over 20% impossible temperatures | `kept_last_good` |
| `unreadable_response` | The adapter threw | `kept_last_good` |
| `source_excluded` | A source is too old, has a future timestamp, or has an unknown age past the cap | `fallback` |
| `station_rejected` | A station's reading is unusable | `fallback` |
| `rain_chance_mismatch` | Chances with another meaning were left out | `fallback` |
| `rain_chance_labeled` | The only chance available was rain-only or 3-hour | `labeled` |
| `wind_unresolved` | The only wind data may be a maximum | `kept_all` |
| `dew_point_conflict` | Blended dew point is above the temperature, so it's removed | `blank` |
| `phase_disagreement` | Sources disagree on rain versus snow or ice | `labeled` |
| `source_disagreement` | Sources differ by more than 3°C. Nothing is removed | `kept_all` |
| `blank_value` | No usable wind or rain chance | `blank` |
| `stale_forecast` | `staleSince` is set | `warned` |
| `alert_feed_stale` | Alerts not checked for 3 minutes | `warned` |
| `nothing_to_show` | No usable forecast | `blank` |

Example, from the live test:

> **Why:** 96 of 96 temperatures from National Weather Service were impossible, for example 9000°F.
> **What was done:** Threw out this whole response and kept using the last good one from National Weather Service.

## Files

This folder isn't a git repository, so there's no diff to read.

| File | Change |
|---|---|
| `src/weather/safeguards.ts` | New: limits, `sanitize`, `resolve`, `audit`, `toEvent`, `mergeEvent` |
| `src/weather/safeguards.test.ts` | New: bad-data tests |
| `src/weather/service.ts` | Sanitizing, `notes`, `hourFrom`, hole-filling, `staleSince`, `archive`, `safeguardLog` |
| `src/weather/fusion.ts` | Rain chance choice, `popEvent` |
| `src/weather/units.ts` | `pct` and `num` pass values through; `isDaylight` added |
| `src/weather/accuracy.ts` | Limits on truth rows; safeguards in the export |
| `src/weather/accuracyStore.ts` | `addSafeguards`, `safeguards`, pruning |
| `src/api/weather.ts` | Open-Meteo days checked; `getPlaceNow` throws on an impossible temperature |
| `src/lib/forecast.ts`, `src/lib/types.ts` | Nullable wind, `popKind`, `source`, `highFrom`, `parseWind` returns null |
| `src/lib/format.ts`, `src/components/ui.tsx` | `none` icon for a missing condition |
| `src/lib/useWeather.ts` | Passes `staleSince` through |
| `src/screens/shared.tsx`, `Hourly.tsx`, `Days.tsx`, `Settings.tsx` | Warning, sources, blanks, Safeguards panel |
| `src/app/globals.css`, `README.md` | Styles and docs |

## Verification

- `npx tsc --noEmit`, `npx vitest run` (253 passing) and `npm run build` were all clean at handoff.
- Live test in the running app, by patching `window.fetch` to corrupt the NWS hourly response:
  - One hour at -9999°F and one at 900 mph: both removed, OpenWeather used, both logged.
  - All 96 hours at 9000°F: response quarantined, no bad number shown, warning displayed.
- After the live test, a normal refresh left 96 hours, no gaps and no warning. The real data then logged `dew_point_conflict` and `rain_chance_mismatch`.

Live testing tip: a fake `updateTime` newer than the real one makes `mergeBatch` keep your corrupted batch over real data. Delete that batch from the `sky-peek-wx:*` scope afterwards.

## Known gaps

- **Plausible but wrong data gets through.** Limits only catch impossible values. The accuracy log shows these over time, but it doesn't block them.
- **Radar tap values are unchecked.** Wind and temperature in `RadarInfo.tsx` and `radar/controller.ts` come from separate map data, with no limits and no logging.
- **Tomorrow.io and WeatherAPI** were tested only with simulated responses, not live.
- **The Export button** hasn't been clicked live. A test confirms the export includes safeguard records.
- **Some rejections aren't logged:** bad station readings in `truthRows`, and an impossible temperature in `getPlaceNow`, which just shows a dash.
- **Forged timestamps:** `mergeBatch` keeps the newest issue time, so a bad response with a falsely recent time would stay until a newer one arrives. This was seen only in testing.
- **The stale warning is sensitive.** One failed refresh shows it, even if the copy is minutes old. This was a deliberate choice and may be worth softening.
- **Dropped NWS hours:** if no other source has that hour, it's left out of the strip rather than shown blank.
- **Cause not investigated:** real data logged `dew_point_conflict` for one hour. The handling worked, but I didn't look into why the blended dew point came out above the temperature.
- **No independent code review.** The author reviewed this work.

## Audit/Lab follow-up — 2026-11-05

This section supersedes older descriptions where behavior changed. `/lab` is the local experiment dashboard. It exposes exact-lead/version filters, coverage, descriptive error metrics, trends, safeguard details, observations/forecast timestamps, raw export, operational diagnostics, and a browser-local notebook. It does not tune weights.

Changes: radar point/grid surface weather is checked before display; invalid points are excluded and diagnostics recorded. Archive exceptions/timeouts are surfaced in session health and a bounded best-effort localStorage diagnostic journal. Export includes audit health. Guard events now distinguish outcomes in their aggregation IDs and identify count units. Sampled fallback resolution uses the assembled snapshot; it does not infer field-specific contributors from temperature weights. Historical safeguard records retain their original schema. IndexedDB safeguard retention is now pruned with accuracy data.

Accuracy: wind QC rejection matches temperature QC rejection; rejected accuracy readings produce diagnostics. Hour-ending precipitation amounts are no longer assigned to hour-starting present-weather buckets. New truth rows carry `present_weather_in_hour_v2`; legacy rows with unknown policy are excluded from rain scoring. This remains a reporting proxy, not full-hour measurable precipitation verification. Reports isolate scope/version and exclude forecasts available after cutoff. Future issue timestamps cannot prevent valid cache recovery.

Limits remain: no durable backend or unattended ingestion, diagnostic persistence is best effort, session health resets on reload, full raw observation payload/QC metadata is not archived, proxy dry classifications do not prove an hour was dry, and no historical dataset or held-out tuning experiment has been run. Provider live coverage and observation schema/representativeness need further validation. Browser UI tests and automated regression results are recorded in DAILY_NOTES.md, separately from the original author's claims.
