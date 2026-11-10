# Storm Arrival Check Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A two-step radar mode: select a ProbSevere storm outline, select a location, and get a Likely coming / Possible / Unlikely / Already here / Can't tell answer with its reasons, what to expect, and alerts.

**Architecture:** A new server route trims ProbSevere files into storm objects with past centers. Pure modules slide the outline along two tracks and turn the results into a level. `usePointCheck` tracks the selected object by ID, and `Radar.tsx` runs the two-step mode over new outline layers in `controller.ts`.

**Tech Stack:** Next.js 16 route handler, React 19, TypeScript, MapLibre, Vitest in node env with no DOM test library.

**Spec:** `docs/superpowers/specs/2026-11-07-storm-arrival-check-design.md`

## Global Constraints

- The project is not a git repository. Do not run `git init`. There are no commit steps; the controller snapshots each task for review.
- Every value traces to a source value. Unknowns show as Unavailable. No smoothing, gap-filling or guessed successors. No arrival percentages.
- Flat design: no shadows or depth effects. Existing radar colors. Desktop only.
- Lookahead is 60 minutes. Tracks slower than 1 mph cannot hit. Observed tracks need at least 20 minutes of history.
- Times round to 5 minutes, distances to the nearest mile.
- Required card copy: "This level is Sky Peek's own rule from reported and observed storm motion, not a forecast. Storms can turn, split or weaken."
- Run single files with `npx vitest run <path>`, everything with `npm test`, and types with `npx tsc --noEmit`.

## Review Focus

1. The selected storm disappears between step 1 and step 2: the prompt must say it's no longer tracked and offer picking again, not wait for a click that can't answer. Pinned in Task 6.
2. One malformed feature in a file must drop only that feature, not the whole list. Pinned in Task 2.
3. The feed stalls and its newest file is over 20 minutes old: treat it as a failed fetch rather than advancing old outlines a long way. Pinned in Task 4.
4. A merge or split moves an ID's center far between files: an observed speed above 100 mph is discarded, leaving no observed track. Pinned in Task 1.
5. A spot outside the file's outline but inside the outline as advanced to now must read Already here. Pinned in Task 3.

---

### Task 1: Storm path geometry

**Files:**
- Create: `src/radar/stormPath.ts`
- Test: `src/radar/stormPath.test.ts`

**Interfaces:**
- Consumes: `offset(fromLat, fromLon, lat, lon): [eastMi, northMi]` from `./proximity`, `degToCompass` from `@/weather/units`, `MapPoint` from `./tools`.
- Produces:
```ts
export type Ring = [number, number][]; // [lon, lat], closed
export type Drift = { eastMps: number; northMps: number };
export type Sweep = { kind: 'still' } | { kind: 'hit'; at: number } | { kind: 'miss'; miles: number; side: string };
export function areaCentroid(ring: Ring): MapPoint;
export function observedDrift(center: MapPoint, at: number, past: { at: number; center: MapPoint }[]): Drift | null;
export function insideNow(ring: Ring, drift: Drift | null, at: number, spot: MapPoint, now: number): boolean;
export function sweep(ring: Ring, drift: Drift, at: number, spot: MapPoint, now: number): Sweep;
```

- [ ] **Step 1: Write the failing tests**

Build rings with a helper `square(spot, eastMi, northMi, halfMi)` using the inverse of `offset`. Spot is `{ lat: 40, lon: -90 }`, `MPS_30 = 13.41` (30 mph). `NOW` is any fixed time, and `at = NOW` unless stated.

```ts
it('hits at first contact', () => {
  const s = sweep(square(spot, -30, 0, 5), { eastMps: MPS_30, northMps: 0 }, NOW, spot, NOW);
  expect(s.kind).toBe('hit');
  expect(((s as { at: number }).at - NOW) / 60_000).toBeCloseTo(50, 0);
});
it('hits from each direction', () => { /* same geometry from east, north and south, with drift reversed */ });
it('advances the outline by the file age', () => {
  const s = sweep(square(spot, -30, 0, 5), { eastMps: MPS_30, northMps: 0 }, NOW - 10 * 60_000, spot, NOW);
  expect(((s as { at: number }).at - NOW) / 60_000).toBeCloseTo(40, 0);
});
it('hits at exactly 60 minutes and misses just beyond', () => {
  expect(sweep(square(spot, -35, 0, 5), { eastMps: MPS_30, northMps: 0 }, NOW, spot, NOW).kind).toBe('hit');
  expect(sweep(square(spot, -36, 0, 5), { eastMps: MPS_30, northMps: 0 }, NOW, spot, NOW).kind).toBe('miss');
});
it('reports the closest miss and the side the storm passes', () => {
  const s = sweep(square(spot, -30, -17, 5), { eastMps: MPS_30, northMps: 0 }, NOW, spot, NOW);
  expect(s).toMatchObject({ kind: 'miss', side: 'S' });
  expect((s as { miles: number }).miles).toBeCloseTo(12, 0);
});
it('treats a concave outline by its edges, not its hull', () => { /* a U opening toward the spot: the spot sits in the notch and the track misses the arms */ });
it('is still under 1 mph', () => {
  expect(sweep(square(spot, -30, 0, 5), { eastMps: 0.4, northMps: 0 }, NOW, spot, NOW)).toEqual({ kind: 'still' });
});
it('finds the area centroid of a lopsided ring', () => { /* an L shape whose centroid differs from the vertex average */ });
it('needs 20 minutes of history', () => {
  expect(observedDrift(c, NOW, [{ at: NOW - 19 * 60_000, center: c0 }])).toBeNull();
  expect(observedDrift(c, NOW, [{ at: NOW - 20 * 60_000, center: c0 }])).not.toBeNull();
});
it('uses the oldest past center', () => { /* past at 10, 20 and 30 minutes: the result matches the 30-minute displacement */ });
it('discards an observed speed above 100 mph', () => {
  expect(observedDrift(c, NOW, [{ at: NOW - 20 * 60_000, center: centerFiftyMilesWest }])).toBeNull();
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/radar/stormPath.test.ts`
Expected: FAIL, cannot resolve `./stormPath`.

- [ ] **Step 3: Implement `src/radar/stormPath.ts`**

Work in miles relative to the spot using `offset`, advancing the ring by `(now - at)` first. A sliding outline hitting the spot is the same test as the spot's reversed path, a straight segment from the origin to `-v * 60`, meeting the polygon: `hit` when the origin is inside at t=0 (`at: now`) or at the earliest segment-edge intersection. For `miss`, take the shortest distance between that segment and the polygon edges. `side` is `degToCompass` of the vector from the path point to the ring point at that moment. Convert with 1 m/s = 0.03728 mi/min. Speed under 1 mph (0.447 m/s) is `still`. `insideNow` advances by `drift` when there is one; otherwise it tests the file's ring.

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run src/radar/stormPath.test.ts`
Expected: PASS.

### Task 2: ProbSevere feed and route

**Files:**
- Create: `src/lib/probSevere.ts`, `src/lib/probSevere.test.ts`, `src/lib/probSevere.fixture.json`, `src/app/api/storm-objects/route.ts`
- Modify: `src/api/budget.ts` (`SourceId`, `SOURCES`)

**Interfaces:**
- Consumes: `areaCentroid`, `Ring` from Task 1.
- Produces:
```ts
export type StormObject = {
  id: string; at: number; ring: Ring; center: MapPoint; sizeKm2: number | null;
  drift: Drift | null; // reported, MOTION_EAST and -MOTION_SOUTH
  dbz: number | null; vil: number | null;
  probSevere: number | null; probHail: number | null; probWind: number | null; probTor: number | null;
  past: { at: number; center: MapPoint }[];
};
export type StormFeed = { at: number; storms: StormObject[] };
export function parseIndex(html: string): { name: string; at: number }[];
export function pickFiles(files: { name: string; at: number }[]): { name: string; at: number }[];
export function parseFile(json: unknown, at: number): StormObject[];
export function joinHistory(newest: StormObject[], older: StormObject[][]): StormObject[];
```
- Route: `GET /api/storm-objects` returns `StormFeed`, or 503 `{ error: 'Storm outlines unavailable' }`.
- Budget: source id `'probsevere'`, name `NOAA ProbSevere`, `perHour: 60, perDay: 600, free: true`.

- [ ] **Step 1: Confirm units from NOAA documentation**

Search for the ProbSevere product documentation. Record what it says for `MESH`, `MOTION_EAST`, `MOTION_SOUTH` and the probability window in the task report. If `MESH` units are not confirmed, leave hail size out of `StormObject`. Do not guess.

- [ ] **Step 2: Capture the fixture**

Save 3 real features from a live file as `src/lib/probSevere.fixture.json`, keeping every field and the file's metadata.

- [ ] **Step 3: Write the failing tests**

```ts
it('reads file names and times from the index', () => {
  expect(parseIndex('<a href="MRMS_PROBSEVERE_20261107_044239.json">x</a>')).toEqual([{ name: 'MRMS_PROBSEVERE_20261107_044239.json', at: Date.UTC(2026, 10, 7, 4, 42, 39) }]);
});
it('ignores names that do not match the pattern', () => {
  expect(parseIndex('<a href="../evil.json">x</a><a href="MRMS_PROBSEVERE_x.json">y</a>')).toEqual([]);
});
it('picks the newest file and the nearest to 10, 20 and 30 minutes back', () => { /* files every 2 minutes for 40 minutes: 4 names */ });
it('skips a history slot with no file within 3 minutes', () => { /* a gap around 20 minutes: 3 names */ });
it('parses the real fixture', () => { /* numbers from strings, drift.northMps = -MOTION_SOUTH, center inside the ring */ });
it('turns non-numeric fields into null', () => { /* VIL "n/a" gives vil null; a missing MOTION_EAST gives drift null */ });
it('drops only the malformed feature', () => {
  const file = { features: [good, { properties: { ID: 'x' }, geometry: { type: 'Polygon', coordinates: [[[0, 0]]] } }, { properties: {}, geometry: null }, good2] };
  expect(parseFile(file, NOW).map(s => s.id)).toEqual([good.properties.ID, good2.properties.ID]);
});
it('returns nothing for a file with no feature list', () => { expect(parseFile({}, NOW)).toEqual([]); });
it('joins past centers by ID, oldest first', () => { /* an ID in two older files gets 2 past entries; an ID in none gets [] */ });
```

- [ ] **Step 4: Run to verify they fail**

Run: `npx vitest run src/lib/probSevere.test.ts`
Expected: FAIL, cannot resolve `./probSevere`.

- [ ] **Step 5: Implement `src/lib/probSevere.ts` and the route**

Index names must match `/^MRMS_PROBSEVERE_\d{8}_\d{6}\.json$/`, and the route builds URLs only from those names under `https://mrms.ncep.noaa.gov/ProbSevere/PROBSEVERE/`. Use the `/api/radar-warnings` style: `runtime = 'nodejs'`, a 15 s timeout on each fetch, `cache-control: public, max-age=60`. Keep parsed files in a module `Map` by name, at most 8 entries. The newest file failing returns 503. A history file failing is left out, so only the observed track is affected. Add the budget source.

- [ ] **Step 6: Run to verify they pass**

Run: `npx vitest run src/lib/probSevere.test.ts && npx tsc --noEmit`
Expected: PASS, no type errors.

### Task 3: Result rule

**Files:**
- Create: `src/radar/arrival.ts`, `src/radar/arrival.test.ts`

**Interfaces:**
- Consumes: `Sweep`, `Drift`, `sweep`, `insideNow`, `observedDrift` from Task 1; `StormObject` from Task 2; `insideGeometry` from `./approach`; `WeatherAlert`.
- Produces:
```ts
export type WarningCheck = { state: 'confirmed'; title: string } | { state: 'none' } | { state: 'unavailable' };
export type Level = 'here' | 'cant-tell' | 'likely' | 'possible' | 'unlikely';
export type Arrival = { level: Level; headline: string; reported: string; observed: string; warning: string; earliest: number | null };
export function confirmingWarning(alerts: WeatherAlert[] | null, center: MapPoint, spot: MapPoint): WarningCheck; // null = lookup failed
export function decide(inside: boolean, reported: Sweep | null, observed: Sweep | null, warning: WarningCheck): Arrival;
export function checkArrival(storm: StormObject, alerts: WeatherAlert[] | null, spot: MapPoint, now: number): Arrival;
```

- [ ] **Step 1: Write the failing tests**

`hit(min)` builds a hit at `NOW + min` minutes. `miss(mi)` builds `{ kind: 'miss', miles: mi, side: 'SE' }`. `W` is `{ state: 'confirmed', title: 'Tornado Warning' }`.

```ts
it.each([
  ['inside beats everything', true, hit(5), hit(5), W, 'here'],
  ['nothing moving', false, { kind: 'still' }, null, NONE, 'cant-tell'],
  ['no motion at all', false, null, null, NONE, 'cant-tell'],
  ['both hit', false, hit(20), hit(30), NONE, 'likely'],
  ['one hit with a warning', false, hit(20), miss(5), W, 'likely'],
  ['one hit, too new, with a warning', false, hit(20), null, W, 'likely'],
  ['one hit', false, hit(20), miss(5), NONE, 'possible'],
  ['one hit, too new', false, hit(20), null, NONE, 'possible'],
  ['reported still, observed hits', false, { kind: 'still' }, hit(20), NONE, 'possible'],
  ['warning lookup failed cannot raise', false, hit(20), miss(5), { state: 'unavailable' }, 'possible'],
  ['no hit with a warning', false, miss(5), miss(9), W, 'unlikely'],
  ['no hit', false, miss(5), miss(9), NONE, 'unlikely'],
])('%s', (_n, inside, r, o, w, level) => { expect(decide(inside, r, o, w).level).toBe(level); });

it('shows a range when both hit and the rounded times differ', () => { expect(decide(false, hit(20), hit(30), NONE).headline).toMatch(/^Likely coming, around .+–.+$/); });
it('shows one time when both round to the same 5 minutes', () => { expect(decide(false, hit(20), hit(20.5), NONE).headline).not.toContain('–'); });
it('names the nearer miss', () => { expect(decide(false, miss(12), miss(30), NONE).headline).toBe('Unlikely, closest about 12 mi SE'); });
it('says why it cannot tell', () => {
  expect(decide(false, { kind: 'still' }, null, NONE).headline).toBe("Can't tell, storm isn't moving");
  expect(decide(false, null, null, NONE).headline).toBe("Can't tell, motion unavailable");
});
it('explains a storm too new for a track', () => { expect(decide(false, hit(20), null, NONE).observed).toBe('Storm too new to show a track'); });
it('explains warning status', () => {
  expect(decide(false, hit(20), null, NONE).warning).toBe('No warning covers both');
  expect(decide(false, hit(20), null, { state: 'unavailable' }).warning).toBe('Warning status unavailable');
});
it('confirms only severe thunderstorm and tornado warnings covering both', () => { /* a Flash Flood Warning covering both gives none; a Tornado Warning covering only the spot gives none; one covering both gives confirmed */ });
it('reports unavailable for a failed lookup', () => { expect(confirmingWarning(null, c, spot)).toEqual({ state: 'unavailable' }); });
it('reads Already here from the outline advanced to now', () => { /* outline 10 mi west of the spot in a file 20 minutes old, moving 30 mph east: checkArrival gives level here */ });
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/radar/arrival.test.ts`
Expected: FAIL, cannot resolve `./arrival`.

- [ ] **Step 3: Implement `src/radar/arrival.ts`**

`decide` follows the spec's level table in order. `earliest` is the first hit time, or null. Use a 5-minute rounding clock, and the existing `Math.round(m) < 1 ? 'under 1 mi' : 'about N mi'` phrase. `confirmingWarning` matches `title` of `Severe Thunderstorm Warning` or `Tornado Warning`, with `insideGeometry` true for both points. `checkArrival` calls `insideNow` with the reported drift, then `sweep` for the reported and observed drifts, using null for a missing drift.

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run src/radar/arrival.test.ts`
Expected: PASS.

### Task 4: Client feed and hook

**Files:**
- Create: `src/api/stormObjects.ts`, `src/api/stormObjects.test.ts`
- Modify: `src/radar/usePointCheck.ts`, `src/radar/usePointCheck.test.ts`, `src/api/weather.ts:105-112`

**Interfaces:**
- Consumes: `StormFeed`, `StormObject` from Task 2; `checkArrival`, `Arrival` from Task 3.
- Produces:
```ts
// src/api/stormObjects.ts
export const MAX_FEED_AGE_MS = 20 * 60_000;
export function validFeed(json: unknown, now: number): StormFeed; // throws when malformed or too old
export async function getStormObjects(now?: number): Promise<StormFeed>; // spends 'probsevere'
// src/radar/usePointCheck.ts
export type CheckSource = { kind: 'storm'; id: string } | { kind: 'warning'; id: string } | { kind: 'none' } | { kind: 'pick-storm'; from?: MapPoint };
export type StormTrack =
  | { state: 'tracking'; storm: StormObject; arrival: Arrival; stale: boolean }
  | { state: 'gone'; storm: StormObject; asOf: number };
export function resolveStormObject(id: string, last: StormObject, feed: StormFeed | null, fresh: boolean, seenAt: number, goneAt: number | null, alerts: WeatherAlert[] | null, spot: MapPoint, now: number): StormTrack;
export function useStormObjects(open: boolean, tick: number): { feed: StormFeed | null; fresh: boolean; failed: boolean };
```
- `PointCheck` gains `arrivalHour: Section<PointHour> | null`. `getPointHour(lat, lon, at = Date.now())`.
- `resolveStorm`, `startCell`, `reports`, `stormsFresh` and `stormsAt` leave the hook. `approach` stays for warnings.

- [ ] **Step 1: Write the failing tests**

```ts
it('rejects a feed older than 20 minutes', () => { expect(() => validFeed({ at: NOW - 21 * 60_000, storms: [] }, NOW)).toThrow(); });
it('accepts a feed exactly 20 minutes old', () => { expect(validFeed({ at: NOW - 20 * 60_000, storms: [] }, NOW).storms).toEqual([]); });
it('rejects a feed with no storm list', () => { expect(() => validFeed({ at: NOW }, NOW)).toThrow(); });
```
Replace the `resolveStorm` tests in `usePointCheck.test.ts` with:
```ts
it('tracks the newest object for the ID', () => { /* state tracking, storm from the feed, stale false */ });
it('is gone when a good newer feed lacks the ID', () => { /* state gone, asOf feed.at */ });
it('keeps the last object as stale when the fetch fails', () => { /* fresh false, goneAt null: tracking, stale true */ });
it('stays gone when a later fetch fails', () => { /* fresh false, goneAt set: gone, asOf goneAt */ });
it('tracks again when a good feed lists the ID', () => { /* goneAt set, ID present: tracking */ });
it('is not gone before a newer feed arrives', () => { /* feed.at === seenAt, ID missing: tracking */ });
it('passes failed warnings through as unavailable', () => { /* alerts null: arrival.warning 'Warning status unavailable' */ });
```
Keep the `resolveWarning`, `loadSpotData` and `shouldStartLoad` tests unchanged.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/api/stormObjects.test.ts src/radar/usePointCheck.test.ts`
Expected: FAIL on the new tests.

- [ ] **Step 3: Implement**

`getPointHour`: use `at` in the existing `find` rule in place of `Date.now()`. `useStormObjects` fetches when `open` turns true and on each `tick`, keeps the last feed on failure, and aborts on close. In `usePointCheck`, `last` stays a ref holding `{ id, object, seenAt, goneAt }`, as the storm-cell logic does today. Alerts come from the `warnings` section: `ready` gives its value, and anything else gives null. Load `arrivalHour` when `arrival.earliest` changes hour, by calling `getPointHour(spot.lat, spot.lon, earliest)` under the same abort pattern as the spot load, and leave it null when there is no earliest time.

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run src/api/stormObjects.test.ts src/radar/usePointCheck.test.ts`
Expected: PASS. `tsc` errors in `Radar.tsx` and `PointCheckCard.tsx` are expected until Task 6.

### Task 5: Map outlines and storm clicks

**Files:**
- Modify: `src/radar/controller.ts`
- Create: `src/radar/stormOutlines.ts`, `src/radar/stormOutlines.test.ts`

**Interfaces:**
- Consumes: `StormObject` from Task 2.
- Produces:
```ts
export function outlineFeatures(storms: StormObject[], selectedId: string | null): Feature<Polygon>[]; // properties { id, selected }
```
- `RadarState` gains `stormOutlines?: StormObject[]`, `selectedOutlineId?: string | null`, `pickingStorm?: boolean`.
- Controller constructor option `onStormObject?: (id: string) => void`, kept in a ref like `onMapPoint`.

- [ ] **Step 1: Write the failing test**

```ts
it('maps storms to polygons and marks the selected one', () => {
  const [a, b] = outlineFeatures([storm('1'), storm('2')], '2');
  expect(a.properties).toEqual({ id: '1', selected: false });
  expect(b.properties).toEqual({ id: '2', selected: true });
  expect(a.geometry.coordinates[0]).toEqual(storm('1').ring);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/radar/stormOutlines.test.ts`
Expected: FAIL, cannot resolve `./stormOutlines`.

- [ ] **Step 3: Implement**

Add source `storm-outlines` to `SOURCES`, with layers `storm-outlines-fill` (fill opacity 0.15) and `storm-outlines-line` (2 px, 3 px when selected), both using `#111`, below `point-check-line`. Update the data with the same key-change pattern as `point-check`. In the map click handler, before the `mapPicking` check:

```ts
if (this.last?.pickingStorm) {
  const hit = this.map.queryRenderedFeatures(e.point, { layers: ['storm-outlines-fill'] })[0];
  if (hit) onStormObject?.(String(hit.properties.id));
  return;
}
```

Lightning and storm marker click handlers return at once while `pickingStorm` is true. Use a crosshair cursor while `mapPicking` or `pickingStorm` is true, and a pointer on `storm-outlines-fill` during step 1.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/radar/stormOutlines.test.ts`
Expected: PASS.

### Task 6: Mode and card

**Files:**
- Create: `src/radar/checkMode.ts`, `src/radar/checkMode.test.ts`
- Modify: `src/screens/Radar.tsx`, `src/screens/PointCheckCard.tsx`, `src/app/globals.css`, `README.md`

**Interfaces:**
- Consumes: everything above.
- Produces:
```ts
export type CheckPrompt = { text: string; skip: boolean; again: boolean };
export function checkPrompt(input: { picking: boolean; hasSpot: boolean; failed: boolean; loaded: boolean; count: number; noOutline: boolean; track: StormTrack | null }): CheckPrompt | null;
export function outlineAt(storms: StormObject[], point: MapPoint): StormObject | null;
export function nearestStep(steps: { at: number; dbz: number | null }[], at: number): { at: number; dbz: number | null } | null; // within 7.5 minutes
```

- [ ] **Step 1: Write the failing tests**

```ts
it('prompts for a storm', () => { expect(checkPrompt(base)).toEqual({ text: 'Click a storm', skip: true, again: false }); });
it('says when outlines are loading', () => { expect(checkPrompt({ ...base, loaded: false, count: 0 })).toEqual({ text: 'Loading storm outlines…', skip: true, again: false }); });
it('reports an empty feed', () => { expect(checkPrompt({ ...base, count: 0 })?.text).toBe('No storms reported right now'); });
it('reports a failed feed', () => { expect(checkPrompt({ ...base, failed: true, count: 0 })?.text).toBe('Storm outlines unavailable'); });
it('notes a storm card with no outline', () => { expect(checkPrompt({ ...base, noOutline: true })?.text).toBe('No outline for this storm. Click a storm'); });
it('prompts for a location after selecting', () => { expect(checkPrompt({ ...base, picking: false, track: tracking })?.text).toBe('Click a location'); });
it('offers picking again when the storm is lost before a pin', () => {
  const p = checkPrompt({ ...base, picking: false, track: gone });
  expect(p?.text).toMatch(/^No longer tracked as of /);
  expect(p?.again).toBe(true);
});
it('shows nothing once a pin is down', () => { expect(checkPrompt({ ...base, picking: false, hasSpot: true, track: tracking })).toBeNull(); });
it('finds the outline containing a point', () => { /* inside gives the storm, outside gives null */ });
it('finds the nearest forecast step within 7.5 minutes', () => { /* 7 minutes away is found, 8 minutes away is null */ });
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/radar/checkMode.test.ts`
Expected: FAIL, cannot resolve `./checkMode`.

- [ ] **Step 3: Implement `src/radar/checkMode.ts`**

- [ ] **Step 4: Wire `Radar.tsx`**

- The dock button calls `startCheck({ kind: 'pick-storm' })`. The feed is open while the source is `pick-storm` or `storm`.
- The storm card button calls `startCheck({ kind: 'pick-storm', from: { lat: cell.lat, lon: cell.lon } })`. When the feed loads, an effect uses `outlineAt`: on a match the source becomes `{ kind: 'storm', id }`, otherwise `from` is cleared and `noOutline` is set.
- `onStormObject` sets `{ kind: 'storm', id }`. The prompt's skip link sets `{ kind: 'none' }`, and its Pick a storm again button sets `{ kind: 'pick-storm' }` and clears the spot.
- Pass the controller `pickingStorm`, and `mapPicking` for every other non-null check. During `pick-storm`, `stormOutlines` is the whole feed and `storms` is `[]`, which hides the markers. During `storm`, `stormOutlines` is only the selected object. `checkFrom` is the selected storm's center.
- Keep Measure's mutual exclusion and Escape as they are. Render the prompt where `Click a spot on the map` is today, and keep that text for `warning` and `none`.

- [ ] **Step 5: Update `PointCheckCard.tsx`**

Replace the storm branch:
- Tracking: `arrival.headline` in `storm-motion`, the reported, observed and warning lines, a Model line from `nearestStep` ("Model shows echo at this spot around 3:40 PM", "Model shows no echo…" or "Model value unavailable"), the required rule copy from Global Constraints, the storm's age, and "Storm status unavailable" when stale.
- For `likely` and `possible`, an "If it gets there" section with: "Simulated radar at this spot" and the step value, labeled "HRRR model output for this spot, not a forecast of this storm"; the NWS rows from `arrivalHour`; and "At the storm now" with Reflectivity, VIL, ProbSevere, Hail, Wind and Tornado rows, each `NA` when null.
- Gone: "No longer tracked as of {time}" with a Pick a storm again button, passed in as `onPickAgain`.

The warning and `none` branches, the HRRR strip and the warnings list stay as they are. Add CSS only for what's new, with no shadows.

- [ ] **Step 6: Update `README.md`**

Add ProbSevere next to the storm history notes: the source, the route, the 5-minute cycle while the mode is open, and the fact that levels are the app's own rule.

- [ ] **Step 7: Run all checks**

Run: `npm test && npx tsc --noEmit && npm run build`
Expected: all pass.

### Task 7: Replay and live check

**Files:**
- Create in the scratchpad only: `replay.py`. Nothing goes in the project.

- [ ] **Step 1: Run the replay**

Download the archived files at 10-minute spacing with a 1-second pause between requests. For each storm in each file old enough to have a 60-minute future, sample spots 5 to 30 miles along and to either side of its reported track. Apply the level rule with no warning input. Then check whether a later outline with the same ID, or any overlapping outline, touched the spot within 60 minutes.

Expected output: a table of level, count and share touched, plus the highest ProbSevere in the window. Report it as a measure of tonight's weather, not as a promise.

- [ ] **Step 2: Live check in the app**

With `preview_start`, on real storms: enter the mode, confirm outlines draw and markers hide, select one, pin spots that give different levels, and compare the card by hand with the outline and motion values. Check Escape, Measure, the storm card entry, the warning check and the skip link. Follow one storm across at least two 5-minute refreshes. If no storms are active, say so rather than claiming the check ran.
