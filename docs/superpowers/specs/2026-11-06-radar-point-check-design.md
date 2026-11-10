# Radar point check design

Date: 2026-11-06

The storm flow here is replaced by `2026-11-07-storm-arrival-check-design.md`.

## Goal

Pick a storm, a warning polygon, or nothing on the radar, then pick a spot on the map, and see what the data says about that spot. The main use is a next-hour decision. Longer forecast hours are secondary.

## Constraints

- Every number traces back to a source value. Unknowns show as Unavailable. No smoothing, gap-filling or invented motion.
- No source publishes an arrival forecast or an arrival probability, so the tool never states one. It reports geometry from reported motion, and model values, each labeled as what it is.
- Browser-only, within the existing request budgets. No new services.
- Flat design and the existing radar colors. Desktop only.

## Scope

Included: storm cells, NWS warning polygons, and rain or other weather with no selection (point forecast only).

Not included: saved or multiple locations, notifications, tracks past 60 minutes, cones of uncertainty, anything drawn beyond a thin straight line, and motion estimated by the app for rain shields or snow bands.

## User flow

1. Select **Check a location** on a storm card, on a warning card, or in the radar dock with nothing selected.
2. The map enters pick mode. Clicks place the spot instead of opening cards.
3. A pin drops and the result card opens. A thin straight line joins a selected storm to the pin. Clicking again moves the pin.
4. Closing the card or pressing Escape clears the pin and line. Leaving pick mode restores normal clicks.

The button appears only on the latest real scan. It is hidden on past frames, forecast frames and demo imagery. Measure and pick mode cannot run together: starting one ends the other.

The card refreshes on the radar's existing five-minute cycle. If the user then moves to a past or forecast frame, the card stays, shows latest-scan results and labels their time.

## Result card

Each section loads and fails on its own, so one failed source never blanks the card.

### Storm track

Starts from the reported position, advanced by the report's age. Looks 60 minutes ahead from now.

| Case | Headline |
|---|---|
| Closest point is within 60 minutes | "Closest about 2 mi north, around 4:20" |
| Closest point is past 60 minutes | "Still about 30 mi away after 60 minutes" |
| Closest point has passed | "Moving away, about 12 mi now" |
| Speed under 1 mph | "Stationary, about 8 mi away" |
| `motionKnown` is false | "Motion unavailable, about 8 mi away" |

Times round to 5 minutes and distances to the nearest mile. The direction names the side of the spot the storm's center passes. The motion report's age is always shown.

The card states that distance is to the storm's center, because the feed reports no storm size. It gives no yes/no answer.

Hail, reflectivity, echo top and VIL appear under "At the storm now". They are never presented as conditions on arrival.

Storms match across refreshes only by radar and storm ID, against the full report list before the map removes duplicate cells seen by neighboring radars. If a successful refresh no longer has the ID, the card says "No longer reported as of 4:12" and removes the track answer. It does not guess at a successor. If the refresh fails, the card keeps the last report, shows its age and says "Storm status unavailable".

### Warning

Leads with the official facts: whether the spot is inside the polygon now, and when the warning ends (NWS `ends`, otherwise `expires`).

The track section follows, using the warning's own motion text:

- One point uses the storm rules above.
- Several points are a moving line. The answer is when the line crosses the spot within 60 minutes, otherwise the closest approach within 60 minutes, including the line's ends.
- A crossing after the warning ends is noted as being after the warning ends.
- A warning with no motion, or motion that will not parse, keeps its official facts and shows motion unavailable.

NWS replaces a warning with a new ID each time it updates, so each refresh fetches the warning by ID and follows `replacedBy` to the newest version. The map's warning list is not used for this, because it only holds warnings in the current map view.

If the newest version is a cancellation or its end time has passed, the official facts and track are removed and the card says it ended. If the lookup fails, the card keeps the last version and says "Warning status unavailable". It never reports an ended warning because of a failed lookup.

### No selection

Titled "Forecast at this point". It never mentions arrival or a particular system.

### Shown in every case

- **HRRR strip:** the next 2 hours at 15-minute steps after the latest scan, at most 8 values. Each is the nearest grid cell's dBZ, colored with the existing reflectivity scale and labeled with its run time. `-10` dBZ shows as no reflectivity. A missing step shows as a gap and is never filled. Labeled as simulated model output.
- **NWS:** temperature, wind and rain chance for the coming hour at the spot.
- **Warnings:** active NWS warnings covering the spot.

## Architecture

| Unit | Job | Depends on |
|---|---|---|
| `src/radar/approach.ts` | Pure geometry: closest approach for a moving point or line, line crossing, point in polygon | Nothing |
| `src/radar/warningMotion.ts` | Parses NWS `eventMotionDescription` into time, direction, speed and points. Unexpected text returns null | Nothing |
| `src/radar/pointForecast.ts` | Gets the HRRR values at a point through the forecast worker | `hrrr.ts`, `forecastTiles.ts` |
| `src/radar/usePointCheck.ts` | Gathers sources and refreshes them, with an independent status per section | The units above, NWS and alert APIs |
| `src/screens/PointCheckCard.tsx` | Renders the result using existing card styles | `usePointCheck` output |

### Changes to existing code

- `src/lib/alerts.ts`: `mapAlert` keeps the raw motion text and the end time. It already keeps the polygon. `/api/radar-warnings` already returns the full NWS record, so the route does not change.
- `src/api/layers.ts`: separate the full storm report list from the map's duplicate removal, and add a warning lookup that follows `replacedBy`.
- `src/radar/fieldStore.ts`, `hrrrWorker.ts`, `forecastTiles.ts`: add a `sample` request beside `tile`. It reads the stored field and returns the dBZ from `fieldValue` for the nearest grid cell.
- `src/radar/forecastRender.ts`: extract the nearest-cell lookup so the tile painter and `sample` share it. The strip and the map cannot disagree.
- `src/radar/controller.ts`: generalize `rulerActive` into a single map-pick state used by Measure and this tool. Add the pin and line.
- `src/screens/RadarInfo.tsx` and `Radar.tsx`: add the card buttons, the dock entry beside Measure, and the result card. The storm card's existing arrival line for the saved place stays unchanged.
- `src/api/weather.ts`: add a point lookup that stays in memory. `getPoint` saves to localStorage for a week, which suits saved places but not throwaway map clicks.

### Data flow

1. Picking a spot calculates the track answer from data in memory, with no requests.
2. HRRR, NWS hourly and point alerts load separately, counted against the `hrrr`, `nws` and `nwsalerts` budgets. The HRRR strip is independent of the selected radar source. Moving the pin reuses HRRR fields already held.
3. Each five-minute refresh finds the storm by radar and ID, follows the warning to its newest version, then recalculates the track. The HRRR strip moves with the latest scan and reuses fields already held, so it downloads only for new steps or a newer run.

Storm and warning motion both give the direction a storm is moving from, so headings are flipped by 180°. `layers.ts` already does this for storms.

## Failure handling

| Situation | Result |
|---|---|
| HRRR fails, is over budget or is cooling down | Strip shows Unavailable with the reason. Real radar and the track answer are unaffected |
| Spot is outside the HRRR grid | "Outside HRRR coverage", with no request made. The check uses HRRR's fixed grid, verified against the real fixture |
| HRRR field refused by the decoder | That step is a gap, logged with the existing `radar_forecast` diagnostic |
| Spot is outside NWS coverage | NWS section shows Unavailable |
| Point warnings fail to load | "Warning status unavailable", never "no warnings" |
| Storm report is old | Age is shown and the track starts from the advanced position |

## Testing

- `approach.ts`: headings from all directions, a spot on the track, passing on each side, already past, stationary, the 60-minute limit, moving lines including their ends, polygons with holes, and MultiPolygons.
- `warningMotion.ts`: real captured NWS strings with one and several points, plus malformed text.
- Sampling: on the real HRRR fixture, sampled values match the ecCodes golden data at known grid points and match the cell the tile painter uses.
- `usePointCheck`: failures stay within their own section, storm ID matching, ended warnings.
- Regression: Measure works after the map-pick change.
- Live check: run against real storms and warnings, comparing the on-screen answer with the storm's actual position over several scans.
