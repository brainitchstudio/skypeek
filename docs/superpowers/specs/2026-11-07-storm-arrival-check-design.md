# Storm arrival check design

Date: 2026-11-07

Revises `2026-11-06-radar-point-check-design.md`. That spec still governs the warning check, the spot-only forecast, the HRRR strip and the failure rules unless this one says otherwise. This spec replaces its storm flow and its "no yes/no answer" rule.

## Goal

A radar mode with two steps. First select a whole storm on the map. Then select a location. The card says whether the storm is likely to reach that location, what to expect if it does, and what alerts apply there.

## Constraints

- No source publishes an arrival forecast or probability. The result levels are the app's own rule, built from real source values, and the card says so.
- No percentages for arrival. No smoothing, gap-filling or guessed successors. Unknowns show as Unavailable.
- Flat design and existing radar colors. Desktop only.
- One new server route, in the same style as `/api/radar-warnings`. No new service, database or stored data.

## Data: ProbSevere

Source: NOAA MRMS ProbSevere 3.0, `https://mrms.ncep.noaa.gov/ProbSevere/PROBSEVERE/`, one GeoJSON file about every 2 minutes, kept for 24 hours. The feed sends no cross-origin header, so the browser cannot read it directly.

Checked against live files on 2026-11-06, using 9 files across 80 minutes. All storms were weak (top ProbSevere 4%), so these numbers are not proven on severe storms.

| Fact | Finding |
|---|---|
| Geometry | Always a single Polygon |
| `SIZE` | Polygon area in km² |
| `MOTION_EAST`, `MOTION_SOUTH` | Treated as m/s, with south positive. Direction is confirmed by storm movement. The unit is undocumented but fits the data |
| Reported vs actual motion | Storms moved about 25% faster than reported. Over 30 minutes, direction was off by 13° typically and 40° at the 90th percentile |
| ID stability | 55–60% of IDs were still present 10 minutes later |

## User flow

1. Select **SpotCheck** in the radar dock. Storm outlines appear and the prompt reads "Click a storm". Only outlines respond to clicks.
2. Clicking inside an outline selects it and highlights it. The prompt reads "Click a location".
3. Clicking the map drops a pin, draws a thin straight line from the storm's center to the pin, and opens the card. Clicking again moves the pin.
4. Closing the card, pressing Escape or selecting the dock button again exits the mode.

**Skip, just check a spot** in step 1 goes to the spot-only forecast from the earlier spec.

**SpotCheck** on a storm card selects the outline containing that cell and starts at step 2. If no outline contains it, the mode starts at step 1 and says "No outline for this storm".

**SpotCheck** on a warning card keeps the existing warning check.

The button appears only on the latest real scan. Outlines are drawn only while the mode is open. Measure and this mode cannot run together. Existing storm markers are hidden during step 1 and return afterward.

If the feed has no storms, step 1 says "No storms reported right now". If the feed fails, it says "Storm outlines unavailable". Both still offer the skip link.

## The answer

### Two tracks and a widened path

- **Reported track:** the storm's `MOTION_EAST` and `MOTION_SOUTH`.
- **Observed track:** the movement of the same ID's outline center from its oldest available file, 20 to 30 minutes back, to the newest file. A storm without a file at least 20 minutes old has no observed track. An observed speed above 100 mph is treated as an ID jump from a merge or split, and also gives no observed track.

The center is the polygon's area centroid. Tracks start from the newest outline advanced by the file's age, and look 3 hours ahead from now. A track slower than 1 mph doesn't count as moving.

The **widened path** is a fan of headings covering the arc between the two tracks, plus 15° on each side, in 5° steps. With one moving track it is that heading ± 15°. Every heading uses the faster track's speed, which gives the earliest arrival. The 15° and the 3 hours are Sky Peek's own rules, not source values. A heading **hits** when the outline, slid along it with its shape and size unchanged, touches the spot.

These replaced a 60-minute limit and exact-line hits. Replaying 24 hours of files showed spots 30 miles straight ahead read Unlikely 81% of the time, because a typical 18 mph storm can't get there inside an hour. Reported speed also ran below observed speed, and direction differed by a typical 19°.

### Result levels

Evaluated in this order:

| Level | Rule |
|---|---|
| **Already here** | The spot is inside the outline now |
| **Can't tell** | No track moves at 1 mph or more |
| **Likely coming** | The path hits within 60 minutes, and either both track headings hit within 60 minutes at the faster speed, or a confirming warning exists |
| **Possible** | The path hits within 60 minutes |
| **On its path** | The path hits after 60 minutes and within 3 hours |
| **On its path, more than 3 hours away** | The path only reaches the spot past 3 hours |
| **Unlikely** | The path never reaches the spot: the storm is heading elsewhere |

A **confirming warning** is an active Severe Thunderstorm or Tornado Warning whose polygon contains both the spot and the storm's center. HRRR never changes the level. A failed or missing warning lookup cannot raise the level, and the reasons say warning status is unavailable.

### Headline and reasons

| Level | Example |
|---|---|
| Likely coming | "Likely coming, around 3:40–3:50 PM" |
| Possible | "Possible, around 3:40 PM" |
| On its path | "On its path, about 2 hours away" |
| More than 3 hours | "On its path, more than 3 hours away" |
| Unlikely | "Unlikely, closest about 12 mi SE" |
| Already here | "Already here" |
| Can't tell | "Can't tell, storm isn't moving" or "Can't tell, motion unavailable" |

Times round to 5 minutes and distances to the nearest mile. "About N hours away" rounds to 15 minutes. The first time is the path's earliest hit and the second is the latest hit of the two tracks at their own speeds. The closest miss is the shortest distance across the path.

Below the headline, one line each:

- Reported track: hits at a time, or misses by a distance, at its own speed
- Observed track: the same, "Storm too new to show a track", or "Observed track unavailable"
- Path: whether the spot is inside the widened path
- Warning: the confirming warning's name, "No warning covers both", or "Warning status unavailable"
- Forecast: "Forecast: HRRR shows storms here around 4:15 PM" for the first step of 35 dBZ or more in the next 3 hours, otherwise "Forecast: HRRR shows no storms here in the next 3 hours". This covers any storm, not just the selected one. The 35 dBZ cutoff is Sky Peek's own rule

The card always states: "This level is Sky Peek's own rule from reported and observed storm motion, not a forecast. Storms can turn, split or weaken." On its path also states: "Past 60 minutes this is a straight-line estimate."

### If it gets there

Shown for Likely coming, Possible and On its path, using the earliest hit time.

- **Simulated radar at this spot:** the HRRR value for the 15-minute step nearest that time, labeled as model output for the spot, not a forecast of this storm. A missing step shows Unavailable.
- **NWS forecast for that hour:** temperature, wind and rain chance for the period containing that time.
- **At the storm now:** composite reflectivity, VIL and the ProbSevere values, labeled as current. Hail size is shown only if its unit is confirmed from NOAA documentation during implementation.

### Shown in every case

Alerts at the spot and the HRRR strip, now 3 hours at 15-minute steps, at most 12 values.

## Refresh and failure

The mode fetches when it opens and on the radar's five-minute cycle. It does not fetch while closed.

| Situation | Result |
|---|---|
| Newest file no longer has the ID | "No longer tracked as of 3:42 PM", the answer is removed, and **Pick a storm again** returns to step 1. No successor is guessed |
| Newest file is over 20 minutes old | Treated as a failed fetch |
| Later fetch fails | The last answer stays, shows its age and says "Storm status unavailable". It never reads as lost |
| A lost storm and a later fetch fails | Stays lost |
| A lost ID returns in a later good file | Tracks again |
| History file missing | Observed track falls back to the oldest file available. Under 20 minutes means no observed track |
| Spot outside HRRR or NWS coverage | That section says so, and the answer is unaffected |

## Architecture

| Unit | Job |
|---|---|
| `src/app/api/storm-objects/route.ts` | Reads the file index, gets the newest file and the files nearest 10, 20 and 30 minutes back, and returns trimmed storm objects. Builds URLs only from index names matching the `MRMS_PROBSEVERE_` pattern, never from caller input. Caches parsed files in memory by name |
| `src/api/stormObjects.ts` | Client fetch and validation. Non-numeric fields become null. Counted against a new request budget |
| `src/radar/stormPath.ts` | Pure geometry: area centroid, observed motion, outline sweep, hit time, closest miss |
| `src/radar/arrival.ts` | Pure result rule: tracks and warning in, level and reasons out |
| `src/radar/usePointCheck.ts` | Tracks the selected storm object by ID, replacing the IEM cell tracking for this flow |
| `src/radar/controller.ts` | Outline layers, highlight and two-step clicks |
| `src/screens/Radar.tsx`, `PointCheckCard.tsx` | Mode state, prompts, headline, reasons and the "If it gets there" section |
| `src/api/weather.ts` | Point hour lookup for a given time |

## Testing

- `stormPath`: hits and misses from each direction, concave outlines, a spot on the 60-minute limit, advancing by file age, observed motion with and without enough history.
- `arrival`: every row of the level table, in order, including warning lookup failure and a warning that covers only the spot.
- Route: index parsing, rejected names, missing history files, malformed files, trimming.
- Client: string fields, nulls, a storm lost and returning, a lost storm through a failed fetch.
- Regression: Measure, storm cards, warning checks and the spot-only forecast.
- **Replay:** a throwaway script runs the rule over the archived 24 hours. For sampled spots it records each level, then checks whether a real later outline touched the spot within 60 minutes. The result is reported to the user. It is not part of the app, and it means little if the window has no severe storms.
- Live check: run in the app against real storms, following at least one across several refreshes.
