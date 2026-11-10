# Radar Point Check Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pick a storm, a warning, or nothing on the radar, pick a spot on the map, and see what the data says about that spot for the next hour.

**Architecture:** Pure units do the geometry and parsing. The HRRR worker gains a single-point `sample` request that shares the tile painter's grid lookup. A hook gathers each source independently, and one card renders the result. Everything runs in the browser.

**Tech Stack:** Next.js, React 19, TypeScript, MapLibre, Vitest (node environment, no DOM test library).

**Spec:** `docs/superpowers/specs/2026-11-06-radar-point-check-design.md`

## Global Constraints

- Every number traces back to a source value. Unknowns show as Unavailable. No smoothing, gap-filling or invented motion.
- Never state an arrival forecast, a probability or a yes/no answer.
- Browser-only. No new dependencies or services. Requests count against the existing `hrrr`, `nws`, `nwsalerts` and `iem` budgets.
- Flat design, existing radar colors and `radar-card` styles. Desktop only.
- Storm track horizon is 60 minutes. HRRR strip is 2 hours, at most 8 values.
- Times round to 5 minutes. Distances round to the nearest mile.
- This folder is not a git repository, so tasks have no commit step. Do not run `git init`.
- Run tests with `npx vitest run <path>`. After every task, `npx tsc --noEmit` must pass.

## Review Focus

1. **A warning is updated while the card is open.** NWS replaced 141 of 257 sampled warnings. The card must follow the newest version and never say it ended. Test: Task 2.
2. **The map is panned away from a warning.** The warning leaves the map's list, but the card must keep tracking it. Test: Task 6 (`resolveWarning` never reads the map list).
3. **A neighboring radar reports the same storm more strongly.** Duplicate removal hides the selected ID, which must not read as "no longer reported". Test: Task 2.
4. **The map has been panned across the date line, or longitude arrives as 0–360.** Clicks and HRRR's grid use different ranges, and both must land on the same cell. Test: Task 4.
5. **The pin is moved quickly.** A slow result for the old spot must not overwrite the new one. Test: Task 6.

---

### Task 1: Approach geometry

**Files:**
- Create: `src/radar/approach.ts`, `src/radar/approach.test.ts`
- Modify: `src/radar/proximity.ts` (export `offset`)

**Interfaces:**
- Consumes: `offset(fromLat, fromLon, lat, lon): [east, north]`, `MapPoint` from `tools.ts`, `degToCompass` from `@/weather/units`.
- Produces:

```ts
export type Motion = { heading: number; mph: number; at: number }; // heading: degrees toward; at: report time, ms
export type Approach =
  | { kind: 'unknown'; miles: number }
  | { kind: 'stationary'; miles: number }
  | { kind: 'away'; miles: number }
  | { kind: 'beyond'; miles: number }
  | { kind: 'closest'; miles: number; side: string; at: number }
  | { kind: 'crossing'; at: number };
export function approach(points: MapPoint[], motion: Motion | null, spot: MapPoint, now: number): Approach;
export function approachPhrase(a: Approach): string;
export function insideGeometry(spot: MapPoint, geometry: Geometry | null): boolean;
```

- [ ] **Step 1: Write the failing tests in `approach.test.ts`**

Use a helper that places a point a given number of miles east and north of the spot with `spot = { lat: 40, lon: -90 }`, and `now = 1_000_000_000`.

```ts
it('finds the closest point ahead', () => {
  const a = approach([east(-20)], { heading: 90, mph: 40, at: now }, spot, now);
  expect(a).toMatchObject({ kind: 'closest', side: expect.any(String) });
  if (a.kind === 'closest') { expect(a.miles).toBeCloseTo(0, 3); expect(a.at).toBeCloseTo(now + 30 * 60_000, -3); }
});
it('names the side the center passes on', () => {
  const a = approach([at(-20, 2)], { heading: 90, mph: 40, at: now }, spot, now);
  expect(a).toMatchObject({ kind: 'closest', side: 'N' });
  expect((a as { miles: number }).miles).toBeCloseTo(2, 2);
});
it.each([[0, 'S'], [90, 'W'], [180, 'N'], [270, 'E']])('tracks a storm heading %i', (heading, from) => {
  const start = { S: at(0, -20), W: at(-20, 0), N: at(0, 20), E: at(20, 0) }[from as 'S' | 'W' | 'N' | 'E'];
  expect(approach([start], { heading, mph: 40, at: now }, spot, now).kind).toBe('closest');
});
it('advances the track by the age of the report', () => {
  const a = approach([east(-20)], { heading: 90, mph: 40, at: now - 15 * 60_000 }, spot, now);
  if (a.kind !== 'closest') throw new Error(a.kind);
  expect(a.at).toBeCloseTo(now + 15 * 60_000, -3);
});
it('reports moving away once the closest point has passed', () => {
  const a = approach([east(12)], { heading: 90, mph: 40, at: now }, spot, now);
  expect(a).toMatchObject({ kind: 'away' });
  expect((a as { miles: number }).miles).toBeCloseTo(12, 2);
});
it('stops at 60 minutes', () => {
  const a = approach([east(-70)], { heading: 90, mph: 40, at: now }, spot, now);
  expect(a).toMatchObject({ kind: 'beyond' });
  expect((a as { miles: number }).miles).toBeCloseTo(30, 2);
});
it('treats under 1 mph as stationary and null motion as unknown', () => {
  expect(approach([east(8)], { heading: 90, mph: 0.5, at: now }, spot, now).kind).toBe('stationary');
  expect(approach([east(8)], null, spot, now).kind).toBe('unknown');
});
it('finds when a moving line crosses the spot', () => {
  const a = approach([at(-20, -10), at(-20, 10)], { heading: 90, mph: 40, at: now }, spot, now);
  if (a.kind !== 'crossing') throw new Error(a.kind);
  expect(a.at).toBeCloseTo(now + 30 * 60_000, -3);
});
it('measures to the end of a line that misses', () => {
  const a = approach([at(-20, 3), at(-20, 10)], { heading: 90, mph: 40, at: now }, spot, now);
  expect(a).toMatchObject({ kind: 'closest', side: 'N' });
  expect((a as { miles: number }).miles).toBeCloseTo(3, 2);
});
it('words every case as the spec does', () => {
  const t = new Date(2026, 10, 6, 16, 18).getTime();
  expect(approachPhrase({ kind: 'closest', miles: 2.2, side: 'N', at: t })).toBe('Closest about 2 mi N, around 4:20 PM');
  expect(approachPhrase({ kind: 'closest', miles: 0.2, side: 'N', at: t })).toBe('Closest under 1 mi, around 4:20 PM');
  expect(approachPhrase({ kind: 'crossing', at: t })).toBe('Line reaches this spot around 4:20 PM');
  expect(approachPhrase({ kind: 'beyond', miles: 30 })).toBe('Still about 30 mi away after 60 minutes');
  expect(approachPhrase({ kind: 'away', miles: 12 })).toBe('Moving away, about 12 mi now');
  expect(approachPhrase({ kind: 'stationary', miles: 8 })).toBe('Stationary, about 8 mi away');
  expect(approachPhrase({ kind: 'unknown', miles: 8 })).toBe('Motion unavailable, about 8 mi away');
});
it('handles polygon holes and MultiPolygons', () => {
  expect(insideGeometry({ lat: 0.5, lon: 0.5 }, square(0, 1))).toBe(true);
  expect(insideGeometry({ lat: 0.5, lon: 0.5 }, squareWithHole(0, 1, 0.4, 0.6))).toBe(false);
  expect(insideGeometry({ lat: 5.5, lon: 5.5 }, multi(square(0, 1), square(5, 6)))).toBe(true);
  expect(insideGeometry({ lat: 0, lon: 0 }, null)).toBe(false);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/radar/approach.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `approach.ts`**

Work in flat miles around the spot using `offset`, with each point advanced by `(now - motion.at)`. With velocity `v` in miles per minute:

1. `motion === null` gives `unknown`. `mph < 1` gives `stationary`. Both use the distance to the nearest part of the line at `now`.
2. For lines with two or more points, intersect the ray from the spot in direction `-v` with each segment. The smallest `t` in `[0, 60]` gives `crossing`.
3. Otherwise evaluate the minimum over `t` in `[0, 60]`. Candidates are each vertex's own closest time clipped to the range, and the whole line at `t = 0` and `t = 60`. Interior segment distance changes linearly, so these candidates are sufficient.
4. Best `t` of 0 gives `away`, 60 gives `beyond`, otherwise `closest`. `side` is `degToCompass` of the bearing from the spot to the nearest point at that time.

Round `at` to 5 minutes inside `approachPhrase`. Format with `toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })`. Below 0.5 mi rounded, use the "under 1 mi" wording, including `Moving away, under 1 mi now`.

Keep `stormArrival` unchanged.

- [ ] **Step 4: Run them to verify they pass**

Run: `npx vitest run src/radar/approach.test.ts`
Expected: PASS.

### Task 2: Warning motion and data lookups

**Files:**
- Create: `src/radar/warningMotion.ts`, `src/radar/warningMotion.test.ts`
- Modify: `src/lib/alerts.ts`, `src/lib/types.ts`, `src/api/layers.ts`, `src/api/weather.ts`, `src/screens/Radar.tsx:7,76,174`
- Test: `src/api/layers.test.ts`, `src/api/weather.test.ts`, and the `mapAlert` tests beside `alerts.ts` (create `src/lib/alerts.test.ts` if absent)

**Interfaces:**
- Consumes: `Motion` from Task 1.
- Produces:

```ts
// warningMotion.ts
export type WarningMotion = Motion & { points: MapPoint[] };
export function parseWarningMotion(text: string | undefined): WarningMotion | null;
// types.ts, on WeatherAlert
motionText?: string; endsAt?: number | null; cancelled?: boolean;
// layers.ts
export function mapStormReports(features: IemFeature[], now?: number): StormCell[]; // no duplicate removal
export function dedupeCells(cells: StormCell[]): StormCell[];
export async function getStormReports(): Promise<StormCell[]>; // replaces getStormCells
export async function followWarning(id: string, signal?: AbortSignal): Promise<WeatherAlert>; // newest version
// weather.ts
export type PointHour = { startTime: string; tempF: number; wind: string; rainPct: number | null; condition: string };
export async function getPointHour(lat: number, lon: number): Promise<PointHour>;
```

- [ ] **Step 1: Write the failing tests**

```ts
// warningMotion.test.ts: strings are real NWS values captured on 2026-11-06
const ONE = '2026-11-06T20:19:00-00:00...storm...236DEG...14KT...32.04,-109.85';
const LINE = '2026-11-03T19:31:00-00:00...storm...236DEG...21KT...32.42,-93.38 32.41,-93.34 32.37,-93.29 32.3,-93.3 32.23,-93.34';
const LATER = '2026-11-03T20:00:00-00:00...storm...236DEG...21KT...32.52,-93.21 32.51,-93.17 32.46,-93.12 32.4,-93.13 32.32,-93.17';

it('parses one point', () => expect(parseWarningMotion(ONE)).toMatchObject({ heading: 56, points: [{ lat: 32.04, lon: -109.85 }], at: Date.parse('2026-11-06T20:19:00Z') }));
it('converts knots to mph', () => expect(parseWarningMotion(ONE)!.mph).toBeCloseTo(16.11, 2));
it('parses a line', () => expect(parseWarningMotion(LINE)!.points).toHaveLength(5));
it('points the heading where the storm went', () => {
  // The same storm 29 minutes later sits along the flipped heading, which proves 236DEG means "from".
  const a = parseWarningMotion(LINE)!, b = parseWarningMotion(LATER)!;
  const north = b.points[0].lat - a.points[0].lat, east = (b.points[0].lon - a.points[0].lon) * Math.cos(32.4 * Math.PI / 180);
  expect(Math.abs((Math.atan2(east, north) * 180 / Math.PI + 360) % 360 - a.heading)).toBeLessThan(10);
});
it.each([undefined, '', 'nonsense', '2026-11-06T20:19:00-00:00...storm...236DEG...14KT...', 'bad-date...storm...236DEG...14KT...32.04,-109.85', '2026-11-06T20:19:00-00:00...storm...236DEG...14KT...95.0,-109.85'])
  ('refuses %s', text => expect(parseWarningMotion(text)).toBeNull());

// layers.test.ts
it('keeps every report while the map removes duplicates', () => {
  const near = [iemFeature({ nexrad: 'KLOT', storm_id: 'A1', max_dbz: 50 }, [-88, 41]), iemFeature({ nexrad: 'KILX', storm_id: 'B2', max_dbz: 60 }, [-88, 41])];
  const all = mapStormReports(near, NOW);
  expect(all.map(c => c.id)).toEqual(['KLOT-A1', 'KILX-B2']);
  expect(dedupeCells(all).map(c => c.id)).toEqual(['KILX-B2']);
});
it('mapStormCells output is unchanged by the split', () => {
  expect(dedupeCells(mapStormReports(features, NOW))).toEqual(mapStormCells(features, NOW));
});
it('follows replacedBy to the newest warning', async () => {
  stubFetch({ 'urn:a': alertBody('urn:a', { replacedBy: 'https://api.weather.gov/alerts/urn:b' }), 'urn:b': alertBody('urn:b', {}) });
  expect((await followWarning('urn:a')).id).toBe('urn:b');
});
it('marks a cancellation', async () => {
  stubFetch({ 'urn:a': alertBody('urn:a', { messageType: 'Cancel' }) });
  expect((await followWarning('urn:a')).cancelled).toBe(true);
});
it('gives up after 10 replacements', async () => { /* each alert points to the next */ await expect(followWarning('urn:0')).rejects.toThrow(); });

// alerts: mapAlert
it('keeps the motion text and end time', () => {
  const a = mapAlert(feature({ parameters: { eventMotionDescription: [ONE] }, ends: null, expires: '2026-11-06T21:00:00Z' }), 'UTC');
  expect(a).toMatchObject({ motionText: ONE, endsAt: Date.parse('2026-11-06T21:00:00Z') });
});

// weather.test.ts
it('reads the coming hour without saving the point', async () => {
  stubNws({ temperature: 71, windSpeed: '12 mph', shortForecast: 'Showers', probabilityOfPrecipitation: { value: 60 } });
  expect(await getPointHour(41.1, -88.2)).toMatchObject({ tempF: 71, wind: '12 mph', rainPct: 60, condition: 'Showers' });
  expect(setItem).not.toHaveBeenCalled(); // a stubbed localStorage.setItem
});
it('keeps a missing rain chance blank', async () => { /* value: null gives rainPct null */ });
it('refuses an impossible temperature', async () => { /* temperature: 400 rejects */ });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/radar/warningMotion.test.ts src/api/layers.test.ts src/api/weather.test.ts`
Expected: FAIL on the new tests.

- [ ] **Step 3: Implement**

- `warningMotion.ts`: match `^(.+?)\.\.\.\S+\.\.\.(\d+)DEG\.\.\.(\d+)KT\.\.\.(.+)$`. Every point must parse with latitude within ±90 and longitude within ±180. `heading = (deg + 180) % 360`. `mph = kt * 1.15078`.
- `alerts.ts`: add `parameters?: { eventMotionDescription?: string[] }` and `replacedBy?: string` to `NwsAlertFeature`. `mapAlert` sets `motionText` from the first entry, `endsAt` from `endIso` and `cancelled` from `messageType === 'Cancel'`.
- `layers.ts`: `mapStormReports` holds the validation and mapping. `dedupeCells` keeps the strongest `dbz` per `DEDUPE_DEG` cell, matching today's tie behavior (first seen wins). Keep `mapStormCells` as their composition, as its tests rely on it. Rename `getStormCells` to `getStormReports`.
- `layers.ts` `followWarning`: `GET https://api.weather.gov/alerts/{id}` with `accept: application/geo+json`, throw when `remaining('nwsalerts') < 1`, `spend('nwsalerts')` each request. Take the next ID from the last path segment of `replacedBy`. Stop after 10 hops with an error.
- `weather.ts` `getPointHour`: `cachedJson` on `${NWS}/points/${lat.toFixed(4)},${lon.toFixed(4)}` and on `forecastHourly`, both 10-minute TTL with source `'nws'`. Use `mapHours`' rule for the hour in progress. Reject temperatures that fail `inLimits('tempC', …)` as `getPlaceNow` does.
- `Radar.tsx`: hold `reports` in state, add `stormsAt` (time of the last successful fetch), and derive `storms = useMemo(() => dedupeCells(reports), [reports])`. Map behavior does not change.

- [ ] **Step 4: Run tests and the type check**

Run: `npx vitest run src/radar src/api src/lib && npx tsc --noEmit`
Expected: PASS.

### Task 3: Point sampling in the forecast worker

**Files:**
- Modify: `src/radar/forecastRender.ts`, `src/radar/fieldStore.ts`, `src/radar/hrrrWorker.ts`, `src/radar/forecastTiles.ts`, `src/radar/flat.ts`
- Test: `src/radar/forecastRender.test.ts`, `src/radar/forecastTiles.test.ts`, `src/radar/flat.test.ts`

**Interfaces:**
- Consumes: `GribField`, `fieldValue`, `createLambert`.
- Produces:

```ts
// forecastRender.ts
export function gridIndex(ni: number, nj: number, at: Float64Array): number; // -1 outside the grid
export function sampleField(field: GribField, lat: number, lon: number): number | null; // dBZ, null outside
// fieldStore.ts
| { id: number; type: 'sample'; key: FieldKey; lat: number; lon: number; canFetch: boolean } // ForecastRequest
| { id: number; sample: number | null } // ForecastReply
// forecastTiles.ts
export function sampleForecast(frame: RadarFrame, lat: number, lon: number, signal: AbortSignal): Promise<number | null>;
// flat.ts
export function reflectivityColor(dbz: number): string | null; // CSS hex, null at no reflectivity
```

- [ ] **Step 1: Write the failing tests**

```ts
// forecastRender.test.ts, on the real fixture
const field = decodeGrib2(new Uint8Array(readFileSync(FIXTURE)));
it.each(golden.samples)('matches ecCodes at $i', s => {
  expect(sampleField(field, s.lat, s.lon)).toBeCloseTo(s.v, 6);
});
it('reads the same cell with either longitude range', () => {
  for (const s of golden.samples) expect(sampleField(field, s.lat, s.lon - 360)).toBe(sampleField(field, s.lat, s.lon));
});
it('matches the color the tile painter uses', () => {
  const s = golden.samples.find(x => x.v > 0)!;
  const lut = reflectivityLut(field);
  const { z, x, y, px, py } = pixelOver(s.lat, s.lon, 11, 256);
  const painted = paintForecastTile(field, lut, z, x, y, 256);
  expect(colorAt(painted, px, py)).toBe(lut[field.values[s.i]]);
});
it('is null outside the grid', () => expect(sampleField(field, 0, 0)).toBeNull());

// flat.test.ts
it('colors a value with the radar scale', () => expect(reflectivityColor(45)).toMatch(/^#[0-9a-f]{6}$/i));
it('has no color at -10 dBZ', () => expect(reflectivityColor(-10)).toBeNull());
it('agrees with the tile palette', () => { /* a one-value field's lut entry equals hex(reflectivityColor(v)) */ });

// forecastTiles.test.ts, following the file's existing fake worker
it('resolves a sample and keeps null', async () => { /* post, reply { id, sample: null }, resolves null */ });
it('rejects a sample that the worker refuses', async () => { /* reply { id, error } rejects */ });
it('cancels the worker on abort', async () => { /* posts { type: 'cancel' } */ });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/radar/forecastRender.test.ts src/radar/forecastTiles.test.ts src/radar/flat.test.ts`
Expected: FAIL on the new tests.

- [ ] **Step 3: Implement**

- `forecastRender.ts`: move the `Math.round` and bounds check into `gridIndex`, and use it in `paintForecastTile`. `sampleField` projects with `createLambert(field.grid)` and returns `fieldValue(field, field.values[index])`.
- `hrrrWorker.ts`: on `sample`, `store.get(m.key, signal, m.canFetch)`, then post `{ id, sample: sampleField(field, m.lat, m.lon) }`. Failures reuse the existing error reply and diagnostic path.
- `forecastTiles.ts`: widen `Pending.resolve` to accept `number | null`. `handle` checks `'sample' in reply`. `sampleForecast` follows `loadForecastTile`'s abort handling and uses `keyOf(new URL(frame.url))` and `canFetch: remaining('hrrr') >= 1`.
- `flat.ts`: extract the scale lookup from `reflectivityLut` so `reflectivityColor` and the lut share it.

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/radar`
Expected: PASS, including the existing painter and grib2 tests.

### Task 4: HRRR values at a point

**Files:**
- Create: `src/radar/pointForecast.ts`, `src/radar/pointForecast.test.ts`

**Interfaces:**
- Consumes: `getForecastFrames` from `hrrr.ts`, `sampleForecast` from Task 3.
- Produces:

```ts
export const HRRR_GRID: LambertGrid;
export function insideHrrr(lat: number, lon: number): boolean;
export type PointStep = { at: number; dbz: number | null }; // null is a gap
export type PointForecast = { run: number; steps: PointStep[] };
export async function loadPointForecast(spot: MapPoint, latestScanAt: number, now: number, signal: AbortSignal,
  deps?: { frames?: typeof getForecastFrames; sample?: typeof sampleForecast }): Promise<PointForecast>;
```

- [ ] **Step 1: Write the failing tests**

```ts
it('matches the real file grid', () => {
  expect(decodeGrib2(new Uint8Array(readFileSync(FIXTURE))).grid).toEqual(HRRR_GRID);
});
it('knows the lower 48 and nowhere else', () => {
  expect(insideHrrr(41.8, -87.6)).toBe(true);
  expect(insideHrrr(41.8, 272.4)).toBe(true);
  expect(insideHrrr(21.3, -157.9)).toBe(false); // Honolulu
  expect(insideHrrr(61.2, -149.9)).toBe(false); // Anchorage
});
it('asks for 2 hours and returns each value', async () => {
  const frames = vi.fn(async () => [frame(15), frame(30)]);
  const f = await loadPointForecast(spot, SCAN, NOW, never, { frames, sample: async () => 42 });
  expect(frames).toHaveBeenCalledWith(SCAN, 2, NOW, never);
  expect(f).toEqual({ run: RUN, steps: [{ at: atOf(15), dbz: 42 }, { at: atOf(30), dbz: 42 }] });
});
it('shows one failed step as a gap', async () => {
  const sample = vi.fn().mockResolvedValueOnce(40).mockRejectedValueOnce(new Error('refused'));
  const f = await loadPointForecast(spot, SCAN, NOW, never, { frames: async () => [frame(15), frame(30)], sample });
  expect(f.steps.map(s => s.dbz)).toEqual([40, null]);
});
it('fails when every step fails', async () => { /* rejects with the first error */ });
it('fails when no run is published', async () => { /* frames: [] rejects 'No HRRR run available' */ });
it('makes no request outside the grid', async () => {
  const frames = vi.fn();
  await expect(loadPointForecast({ lat: 21.3, lon: -157.9 }, SCAN, NOW, never, { frames })).rejects.toThrow('Outside HRRR coverage');
  expect(frames).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/radar/pointForecast.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `pointForecast.ts`**

`HRRR_GRID = { ni: 1799, nj: 1059, lat1: 21.138123, lon1: 237.280472, lov: 262.5, latin1: 38.5, latin2: 38.5, dx: 3000, dy: 3000, radius: 6371229 }`. If the fixture test reports a different value, use the file's value. Abort errors propagate; they are never gaps. Samples run concurrently, as the worker already limits downloads.

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/radar/pointForecast.test.ts`
Expected: PASS.

### Task 5: Map pick mode and pin

**Files:**
- Modify: `src/radar/controller.ts:107-110,124,137,162,187,298-299,389-397,436,486`, `src/screens/Radar.tsx:155,295`

**Interfaces:**
- Consumes: `MapPoint`.
- Produces:

```ts
// RadarState: rulerActive is renamed
mapPicking?: boolean;
pointCheck?: { from: MapPoint | null; spot: MapPoint } | null;
// RadarController constructor: onMeasure is renamed onMapPoint
```

No DOM test setup exists for the controller, so this task verifies through the type check and the running app.

- [ ] **Step 1: Generalize the pick state**

Rename `rulerActive` to `mapPicking` and `measurePoint` to `mapPoint` at every use, including the strike and storm marker click handlers. Use `e.lngLat.wrap()` in the map click, so spots are always within ±180.

- [ ] **Step 2: Route picks in `Radar.tsx`**

Pass `p => onMapPoint.current(p)` to the constructor, since it is created once. Add `onMapPoint`, a ref updated each render, that sends the point to the ruler or to the point check. Pass `mapPicking: ruler || check !== null`.

- [ ] **Step 3: Draw the pin and line**

Add a `'point-check'` source to `SOURCES`, plus `point-check-line` and `point-check-pin` layers beside the ruler layers, using the ruler's flat paint values with a solid line. Set it in `drawTools`, extending `toolKey`. Draw the line only when `from` is set.

- [ ] **Step 4: Verify types and tests**

Run: `npx tsc --noEmit && npx vitest run src/radar`
Expected: PASS, with no `rulerActive` left: `grep -rn rulerActive src` prints nothing.

### Task 6: Point check hook

**Files:**
- Create: `src/radar/usePointCheck.ts`, `src/radar/usePointCheck.test.ts`

**Interfaces:**
- Consumes: Tasks 1, 2 and 4, `getPointAlerts`, `remaining`.
- Produces:

```ts
export type CheckSource = { kind: 'storm'; id: string } | { kind: 'warning'; id: string } | { kind: 'none' };
export type Section<T> = { state: 'loading' } | { state: 'ready'; value: T } | { state: 'unavailable'; reason: string };
export type StormTrack =
  | { state: 'tracking'; cell: StormCell; approach: Approach; stale: boolean }
  | { state: 'gone'; cell: StormCell; asOf: number };
export type WarningTrack =
  | { state: 'active'; alert: WeatherAlert; inside: boolean; approach: Approach | null; afterEnd: boolean; stale: boolean }
  | { state: 'ended'; alert: WeatherAlert };
export function resolveStorm(id: string, last: StormCell, reports: StormCell[], fresh: boolean, stormsAt: number, spot: MapPoint, now: number): StormTrack;
export function resolveWarning(alert: WeatherAlert, stale: boolean, spot: MapPoint, now: number): WarningTrack;
export async function loadSpotData(spot: MapPoint, latestScanAt: number, now: number, signal: AbortSignal, deps?: SpotDeps):
  Promise<{ forecast: Section<PointForecast>; hour: Section<PointHour>; warnings: Section<WeatherAlert[]> }>;
export function usePointCheck(args: { source: CheckSource; startCell?: StormCell; startWarning?: WeatherAlert; spot: MapPoint | null;
  reports: StormCell[]; stormsFresh: boolean; stormsAt: number; latestScanAt: number | undefined; tick: number }): PointCheck;
export type PointCheck = { storm: StormTrack | null; warning: Section<WarningTrack> | null; forecast: Section<PointForecast>; hour: Section<PointHour>; warnings: Section<WeatherAlert[]>; asOf: number };
```

- [ ] **Step 1: Write the failing tests**

```ts
it('tracks the latest report for the ID', () => {
  const t = resolveStorm('KLOT-A1', old, [newer], true, NOW, spot, NOW);
  expect(t).toMatchObject({ state: 'tracking', cell: newer, stale: false });
});
it('finds a storm the map hid as a duplicate', () => {
  const reports = [{ ...newer, id: 'KLOT-A1', dbz: 40 }, { ...newer, id: 'KILX-B2', dbz: 60 }];
  expect(resolveStorm('KLOT-A1', old, reports, true, NOW, spot, NOW).state).toBe('tracking');
});
it('says gone only after a good refresh', () => {
  expect(resolveStorm('KLOT-A1', old, [], true, NOW, spot, NOW)).toMatchObject({ state: 'gone', asOf: NOW });
  expect(resolveStorm('KLOT-A1', old, [], false, NOW, spot, NOW)).toMatchObject({ state: 'tracking', cell: old, stale: true });
});
it('uses unknown motion when the feed has none', () => {
  const c = { ...newer, motionKnown: false };
  expect(resolveStorm(c.id, c, [c], true, NOW, spot, NOW)).toMatchObject({ approach: { kind: 'unknown' } });
});
it('reports inside and end from the warning alone', () => {
  expect(resolveWarning(warning({ endsAt: NOW + HOUR, geometry: covering(spot) }), false, spot, NOW)).toMatchObject({ state: 'active', inside: true });
});
it('ends on cancellation or a passed end time', () => {
  expect(resolveWarning(warning({ cancelled: true }), false, spot, NOW).state).toBe('ended');
  expect(resolveWarning(warning({ endsAt: NOW - 1 }), false, spot, NOW).state).toBe('ended');
});
it('never ends a warning because a lookup failed', () => {
  expect(resolveWarning(warning({ endsAt: NOW + HOUR }), true, spot, NOW)).toMatchObject({ state: 'active', stale: true });
});
it('notes a crossing after the warning ends', () => {
  const w = warning({ endsAt: NOW + 10 * MIN, motionText: lineHeadingAtSpot20MinAway });
  expect(resolveWarning(w, false, spot, NOW)).toMatchObject({ afterEnd: true });
});
it('keeps official facts when motion will not parse', () => {
  expect(resolveWarning(warning({ motionText: 'nonsense', endsAt: NOW + HOUR }), false, spot, NOW)).toMatchObject({ state: 'active', approach: null });
});
it('keeps each section apart', async () => {
  const r = await loadSpotData(spot, SCAN, NOW, never, { forecast: fails('HRRR down'), hour: ok(hour), alerts: ok([]) });
  expect(r.forecast).toEqual({ state: 'unavailable', reason: 'HRRR down' });
  expect(r.hour.state).toBe('ready');
});
it('says warning status is unavailable, never none', async () => {
  const r = await loadSpotData(spot, SCAN, NOW, never, { forecast: ok(f), hour: ok(hour), alerts: fails('down') });
  expect(r.warnings).toEqual({ state: 'unavailable', reason: 'Warning status unavailable' });
});
it('lists warnings only', async () => { /* an Advisory from getPointAlerts is dropped */ });
it('reports the alert budget', async () => { /* remaining 0 gives a reason and no alerts call */ });
it('rejects when aborted so an old pin cannot win', async () => {
  const abort = new AbortController(); const load = loadSpotData(spot, SCAN, NOW, abort.signal, { forecast: pending, hour: pending, alerts: pending });
  abort.abort();
  await expect(load).rejects.toThrow();
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/radar/usePointCheck.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

- `resolveStorm`: motion is null when `motionKnown === false`. Stale when `fresh` is false.
- `resolveWarning`: use `parseWarningMotion` for motion, else null, in which case `approach` is null. `afterEnd` is true when a `crossing` or `closest` time is past `endsAt`. Take points and motion only from the alert it receives, never the map list.
- `loadSpotData`: runs all three independently, and rejects with an `AbortError` when the signal aborts, so a stale call can't apply.
- `usePointCheck`: one effect on `[spot, latestScanAt, tick]` with an `AbortController` runs `loadSpotData`. A second effect on `[source, tick]` runs `followWarning`, keeping the last alert and marking it stale on failure. Storm results are a `useMemo`. `latestScanAt ?? tick` is the window start. Follow the `loadForecast` pattern: logic stays in the exported functions, and the hook only stores results.

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/radar/usePointCheck.test.ts`
Expected: PASS.

### Task 7: Card and radar wiring

**Files:**
- Create: `src/screens/PointCheckCard.tsx`
- Modify: `src/screens/RadarInfo.tsx`, `src/screens/Radar.tsx`, `src/app/globals.css`, `README.md`

**Interfaces:**
- Consumes: `usePointCheck`, `approachPhrase`, `reflectivityColor`, `temp`, `Card`, `Row` (export both from `RadarInfo.tsx`).
- Produces: `PointCheckCard({ check, source, spot, units, nav?, onClose })`, and `onCheck?: () => void` on `StormCard` and `WarningCard`.

- [ ] **Step 1: Add the entry points**

`canCheck = !simulated && !view.historical && !view.forecast`. Pass `onCheck` to both cards only when `canCheck`, rendered as a **Check a location** button. Add a `DockTool` labeled "Check a location" with the lucide `MapPin` icon and `tone="tool-ruler"` beside Measure, hidden unless `canCheck`, which clears `pick` and starts with `{ kind: 'none' }`.

State: `check: { source: CheckSource; cell?: StormCell; warning?: WeatherAlert; spot: MapPoint | null } | null`. Starting a check turns off the ruler, and turning on the ruler clears the check. Close the source card when picking starts, and show the "Click a spot on the map" prompt in the status area. Escape and the card's close clear `check`. `selectFrame` and `jumpLatest` leave it alone.

Pass `pointCheck: check?.spot ? { from, spot } : null`, where `from` is the tracked cell's position for storms and null otherwise, per the spec.

- [ ] **Step 2: Build `PointCheckCard.tsx` with the exact copy**

| Source | Kicker | Title |
|---|---|---|
| Storm | `Storm tracks · {id}` | `Storm to this spot` |
| Warning | `NWS warning` | warning title |
| None | `HRRR and NWS` | `Forecast at this point` |

Sections, in order, using the `storm-metrics` card width and `storm-note` footnote:

- Storm: `approachPhrase`, then `Motion reported {n} min ago`, then the note `Distance is to the storm's center. The feed gives no storm size.` Under the label `At the storm now`, show hail, reflectivity, echo top and VIL with today's `Unavailable` handling. Add `Storm status unavailable` when stale. For `gone`, show only `No longer reported as of {time}`.
- Warning: `Inside this warning now` or `Outside this warning`, then `Until {time}`, then the track, `After this warning ends` when `afterEnd`, or `Motion unavailable`. Add `Warning status unavailable` when stale. For `ended`, show `This warning has ended`.
- HRRR: heading `Simulated radar at this spot`, footnote `HRRR model output · Run {time}`. One flat block per step with its time and dBZ, background from `reflectivityColor`, `No echo` for `-10`, and an empty outlined block for a gap. Show `Unavailable: {reason}` when unavailable.
- NWS: `Next hour` row with `temp()`, wind and rain chance. A null rain chance reads `Unavailable`.
- Warnings at this spot: titles, or `None active`, or `Warning status unavailable`.

Add only the CSS for the strip. No shadows or gradients.

- [ ] **Step 3: Update `README.md`**

Add a **Point check** bullet under Radar analysis tools that covers the sources, the 60-minute and 2-hour limits, and that results are distance from reported motion and model values, not arrival predictions.

- [ ] **Step 4: Run all tests and the build**

Run: `npm test && npx tsc --noEmit && npm run build`
Expected: all pass.

- [ ] **Step 5: Verify in the running app**

Start the dev server with `preview_start`. Check, against live data:

1. A storm: the card's closest point agrees with the map, and survives a refresh and a pan away.
2. A warning: inside and outside spots both read correctly, and the track uses a line when the warning has several points.
3. No selection: the card never mentions arrival.
4. Moving the pin and pressing Escape work, the button hides on past and forecast frames, and Measure still works.
5. Over-budget and failed HRRR: block `noaa-hrrr-bdp-pds.s3.amazonaws.com` in the browser and confirm the strip alone shows Unavailable.
6. No console errors.

If no storms are active, report which checks ran on what data rather than marking them passed.
