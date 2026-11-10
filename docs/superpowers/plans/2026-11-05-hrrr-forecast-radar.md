# HRRR Forecast Radar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend NOAA National radar playback past the latest real scan with HRRR `REFD` forecast frames, decoded from GRIB2 in the browser and drawn with the radar's own color scale.

**Architecture:** Pure units (GRIB decoder, Lambert projection, tile painter, field store, inventory) are tested without a browser. A Web Worker runs fetch, decode and tile painting. A MapLibre protocol handler connects it to the existing raster frame layers, and a typed timeline replaces every "last frame is latest" assumption.

**Tech Stack:** TypeScript, Next.js 16, React 19, MapLibre GL 6, Vitest 5. Python 3 with ecCodes, numpy and Pillow for dev-only fixture generation.

**Spec:** `docs/superpowers/specs/2026-11-05-hrrr-forecast-radar-design.md`

## Global Constraints

- Every painted pixel shows a value from the file. No bilinear blending, smoothing, gap filling, cutoffs chosen by feel, or frames between model steps.
- Field: `REFD:1000 m above ground`, from `wrfsubhf` files, 15-minute steps. Not `REFC`.
- Bucket: `https://noaa-hrrr-bdp-pds.s3.amazonaws.com/`. Path: `hrrr.YYYYMMDD/conus/hrrr.tHHz.wrfsubhfNN.grib2`, plus `.idx`.
- Range selector: 2, 6 or 18 hours. Default 6. Maximum 18.
- Forecast frames on NOAA National only (`src === 4`). All other sources behave exactly as they do today.
- Unsupported or inconsistent data is an error and shows as unavailable. Never a best guess.
- Runs are never mixed on one timeline.
- Observed radar never waits on forecast data.
- No backend, no paid key, no new runtime npm dependencies.
- Flat design: no shadows or depth effects. Desktop only: no phone layouts.
- Labels call these frames simulated.
- This folder is not a git repository, so tasks have no commit steps. Do not run `git init` unless the user asks.

## Review Focus

1. A server answering a byte-range request with `200` instead of `206`: stop rather than download a 220 MB file. Test in Task 5.
2. A refresh arriving while a forecast frame is selected: stay at the same clock time, with no jump to an observed frame. Test in Task 6, wired in Task 7.
3. A run across UTC midnight: use the previous date in the path. Test in Task 4.
4. An `.idx` file or byte range that returns a different step from the one requested: reject it, so the wrong time is never drawn. Tests in Tasks 4 and 5.
5. Changing source while forecast data is loading: drop the late result and clear forecast frames. Test in Task 7.

---

### Task 1: GRIB2 decoder and golden fixture

**Files:**
- Create: `src/radar/grib2.ts`
- Create: `scripts/capture-hrrr-fixture.sh`, `scripts/generate-grib-golden.py`, `scripts/requirements-dev.txt` (`eccodes`, `eccodeslib`, `numpy`, `pillow`)
- Create: `src/radar/__fixtures__/refd.grib2`, `src/radar/__fixtures__/refd-golden.json`
- Modify: `.gitignore` (add `.venv`)
- Test: `src/radar/grib2.test.ts`

**Interfaces:**
- Produces:

```ts
export type LambertGrid = { ni: number; nj: number; lat1: number; lon1: number; lov: number; latin1: number; latin2: number; dx: number; dy: number; radius: number };
export type GribField = { grid: LambertGrid; values: Uint16Array; maxX: number; r: number; e: number; d: number; refTime: number; leadMin: number };
export type GribErrorCode = 'not-grib' | 'truncated' | 'wrong-field' | 'unsupported-grid' | 'unsupported-packing' | 'bad-data';
export class GribError extends Error { constructor(public code: GribErrorCode, message: string) }
export function decodeGrib2(bytes: Uint8Array): GribField;
export const fieldValue: (f: Pick<GribField, 'r' | 'e' | 'd'>, x: number) => number; // (r + x * 2 ** e) / 10 ** d
```

`values` is row-major from the south-west corner. `refTime` is UTC ms from Section 1. `dx`, `dy` are metres. `lat1`, `lon1`, `lov`, `latin1`, `latin2` are degrees as stored.

- [ ] **Step 1: Capture the fixture and golden**

`capture-hrrr-fixture.sh` takes run date, hour and file number, reads the `.idx`, and uses `curl -r` to save the `REFD:1000 m above ground` message as `src/radar/__fixtures__/refd.grib2`.

`generate-grib-golden.py <grib> <out.json>` uses ecCodes to write:

```json
{ "sha256": "<of values as Int16LE, round(v * 16)>", "count": 1905141,
  "refTime": 0, "leadMin": 0,
  "samples": [{ "i": 0, "v": -10 }],
  "points": [{ "i": 0, "j": 0, "lat": 0, "lon": 0 }] }
```

`samples` holds the 200 strongest points plus every 50,000th. `points` holds the four corners plus every 200th column of every 200th row, from `latitudes` and `longitudes`.

Run with `python3 -m venv .venv && .venv/bin/pip install -r scripts/requirements-dev.txt`. Keep a dense stormy field as a second fixture only if one is available when this task runs.

Expected: `count` is 1905141.

- [ ] **Step 2: Write the failing tests**

```ts
it('matches ecCodes on all grid points', () => {
  const f = decodeGrib2(new Uint8Array(readFileSync(FIXTURE)));
  const out = new Int16Array(f.values.length);
  f.values.forEach((x, i) => { out[i] = Math.round(fieldValue(f, x) * 16); });
  expect(sha256(out)).toBe(golden.sha256);
  for (const s of golden.samples) expect(fieldValue(f, f.values[s.i])).toBeCloseTo(s.v, 6);
});
it('reads the grid from the header', () => {
  expect(decodeGrib2(bytes).grid).toMatchObject({ ni: 1799, nj: 1059, lat1: 21.138123, lon1: 237.280472, lov: 262.5, latin1: 38.5, latin2: 38.5, dx: 3000, dy: 3000, radius: 6371229 });
});
it('reads the run time and lead', () => {
  expect(decodeGrib2(bytes)).toMatchObject({ refTime: golden.refTime, leadMin: golden.leadMin });
});
```

Add `it.each` rejection tests that alter one byte of the fixture and expect the listed code:

| Change | Code |
|---|---|
| Magic not `GRIB` | `not-grib` |
| Edition 1 | `not-grib` |
| Cut the end, or remove `7777` | `truncated` |
| Parameter number 196 | `wrong-field` |
| Height 2000 | `wrong-field` |
| Grid template 0 | `unsupported-grid` |
| Scanning mode 0 | `unsupported-grid` |
| Earth shape 1 | `unsupported-grid` |
| Point count off by one | `bad-data` |
| Data template 0 | `unsupported-packing` |
| Missing-value management 1 | `unsupported-packing` |
| Spatial order 1 | `unsupported-packing` |
| Bitmap indicator 0 | `unsupported-packing` |

Add hand-built messages using a small bit writer in the test file. Each has a 4×3 grid and known results, covering zero-width groups, negative differences (`hmin < 0`), a final group whose length comes from the true-last-length field, and a value that does not fit `Uint16Array` (`bad-data`).

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/radar/grib2.test.ts`
Expected: FAIL, `decodeGrib2` not defined.

- [ ] **Step 4: Implement `decodeGrib2`**

Header octets (1-based, within each section):

| Section | Octets |
|---|---|
| Indicator | 1–4 `GRIB`, 7 discipline (must be 0), 8 edition (must be 2), 9–16 total length |
| 1 | 13–19 reference year (2 octets), month, day, hour, minute, second |
| 3 | 7–10 point count, 13–14 template (30), 15 shape (6), 31–38 Ni, Nj, 39–42 La1, 43–46 Lo1, 52–55 LoV, 56–63 Dx, Dy (mm), 65 scanning mode (64), 66–73 Latin1, Latin2 |
| 4 | 10 category (16), 11 number (195), 18 time unit (0 = minutes), 19–22 lead, 23 surface type (103), 24 scale (0), 25–28 height (1000) |
| 5 | 6–9 point count, 10–11 template (3), 12–15 R (IEEE float), 16–17 E, 18–19 D, 20 reference bits, 22 group split (1), 23 missing management (0), 32–35 NG, 36 width reference, 37 width bits, 38–41 length reference, 42 length increment, 43–46 true last length, 47 length bits, 48 order (2), 49 extra octets (2) |
| 6 | 6 bitmap indicator (255) |

Latitude and longitude are micro-degrees. E, D and the Section 7 extras are sign-magnitude, not two's complement.

Section 7, from octet 6:

```text
h1, h2, hmin: 2 octets each (sign-magnitude)
NG group references, each `reference bits` wide; align to a byte
NG group widths; add width reference; align to a byte
NG scaled lengths; length = reference + increment * scaled; last = true last length; align to a byte
For each group: `length` values, each `width` bits, plus the group reference.
Width 0 means every value equals the reference.

Undo differencing:
X[0] = h1; X[1] = h2
for n >= 2: X[n] = packed[n] + hmin + 2 * X[n-1] - X[n-2]
```

Reject group lengths that do not sum to the point count, reads past the section end, and results outside 0–65535. Keep `maxX`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/radar/grib2.test.ts`
Expected: PASS, including the SHA-256 match.

---

### Task 2: Lambert projection

**Files:**
- Create: `src/radar/lambert.ts`
- Test: `src/radar/lambert.test.ts`

**Interfaces:**
- Consumes: `LambertGrid`
- Produces: `createLambert(grid: LambertGrid): (lat: number, lon: number, out: Float64Array) => void`. It writes fractional column to `out[0]` and row to `out[1]`, with no allocation per call. Cell centers fall on whole numbers.

- [ ] **Step 1: Write the failing tests**

```ts
it('returns each golden point at its own grid position', () => {
  for (const p of golden.points) {
    project(p.lat, p.lon, out);
    expect(Math.abs(out[0] - p.i)).toBeLessThan(0.001);
    expect(Math.abs(out[1] - p.j)).toBeLessThan(0.001);
  }
});
it('treats -97.5 and 262.5 as the same longitude', () => {
  project(38.5, -97.5, a); project(38.5, 262.5, b);
  expect(a[0]).toBeCloseTo(b[0], 9);
});
it('puts a point west of the grid outside it', () => {
  project(38.5, -150, out);
  expect(out[0]).toBeLessThan(-0.5);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/radar/lambert.test.ts`
Expected: FAIL, `createLambert` not defined.

- [ ] **Step 3: Implement `createLambert`**

Spherical Lambert conformal, using the secant formula for `n` and `n = sin(latin1)` when the two latitudes are equal. Normalize `lon - lov` to [-180, 180]. Compute `lat1`, `lon1` once as the grid origin.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/radar/lambert.test.ts`
Expected: PASS.

---

### Task 3: Reflectivity scale, tile painter and speed check

**Files:**
- Create: `scripts/generate-reflectivity-scale.py`, `src/radar/reflectivityScale.json`
- Create: `src/radar/forecastRender.ts`
- Modify: `src/radar/flat.ts`
- Test: `src/radar/flat.test.ts`, `src/radar/forecastRender.test.ts`

**Interfaces:**
- Consumes: `GribField`, `fieldValue`, `createLambert`
- Produces:
  - `reflectivityLut(f: Pick<GribField, 'r' | 'e' | 'd' | 'maxX'>): Uint32Array` in `flat.ts`. It is indexed by raw integer and holds little-endian RGBA, with 0 for no echo.
  - `paintForecastTile(field: GribField, lut: Uint32Array, z: number, x: number, y: number, size = 512): Uint8ClampedArray` in `forecastRender.ts`.

- [ ] **Step 1: Generate the scale**

`generate-reflectivity-scale.py` fetches the legend from `https://opengeo.ncep.noaa.gov/geoserver/conus/conus_bref_qcd/ows?service=WMS&version=1.3.0&request=GetLegendGraphic&format=image/png&layer=conus_bref_qcd`.

It reads the bar at row 5. It finds the bright label glyph clusters in rows 11–29, fits their centers to the labels -20 to 70 in tens, and asserts a slope of 5 ±0.05 pixels per dBZ.

It writes:

```json
{ "source": "<url>", "retrieved": "<date>", "minDbz": 0, "stepDbz": 0.2, "colors": ["#rrggbb"], "scanCheck": { "pixels": 0, "offScale": 0 } }
```

`scanCheck` compares `docs/radar-investigation/conus_bref_qcd-latest.png` with the table using the same tolerance as the spec's check (sum of channel differences over 12). The script exits non-zero if more than 1% of pixels are off scale.

Run: `.venv/bin/python scripts/generate-reflectivity-scale.py`
Expected: exits 0 with about 500 colors.

- [ ] **Step 2: Write the failing tests**

In `flat.test.ts`:

```ts
const lut = reflectivityLut({ r: -10, e: -4, d: 0, maxX: 1600 });
const at = (dbz: number) => lut[(dbz + 10) * 16];
it('leaves no echo transparent', () => expect(at(-10)).toBe(0));
it('paints weak values above no echo', () => expect(at(-9.9375) >>> 24).toBe(255));
it('uses the top color past the scale', () => expect(at(90)).toBe(top));
it('uses the scale colors', () => {
  expect(hexOf(at(20))).toBe('#30d65b');
  expect(hexOf(at(50))).toBe('#d10809');
});
it('recorded a passing scan check', () => {
  expect(scale.scanCheck.offScale / scale.scanCheck.pixels).toBeLessThanOrEqual(0.01);
});
```

Compare the two named colors with a tolerance of 6 per channel if the fitted position differs by one pixel.

In `forecastRender.test.ts`, with a fake 3×3 `GribField` on a small grid:

- A tile pixel inside a cell gets exactly that cell's color, and every painted color exists in the LUT for a value in the field. This is the no-blending check.
- A tile pixel outside the grid has alpha 0.
- Two neighboring cells with different values produce no third color along their edge.
- Using the real fixture, a tile over the strongest golden point paints that point's color at the matching pixel.

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/radar/flat.test.ts src/radar/forecastRender.test.ts`
Expected: FAIL, functions not defined.

- [ ] **Step 4: Implement `reflectivityLut` and `paintForecastTile`**

For each output pixel: take the Web Mercator pixel center, convert to lat/lon, project, and round to the nearest cell. Treat a rounded position outside 0..ni-1 or 0..nj-1 as transparent. Precompute latitude per row and longitude per column.

Do not call `paintBands`, because it blends values.

`flat.ts` already imports `@/api/budget`. Keep the LUT safe in a worker by not calling anything from the ledger.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/radar/flat.test.ts src/radar/forecastRender.test.ts`
Expected: PASS.

- [ ] **Step 6: Run the speed check (stop point)**

The decoder must exist before it can be timed, so this check sits here rather than first. It still comes before any UI work.

Run a throwaway Vitest file from the scratchpad, not kept in the repo, that times `decodeGrib2` five times on the fixture, and `paintForecastTile` on 20 tiles at zoom 6.

Expected: median decode at or under 1.5 seconds, median tile at or under 100 ms.

If either limit is missed, stop and bring the numbers back to the user. Do not start Task 4.

---

### Task 4: Run selection and frame inventory

**Files:**
- Create: `src/radar/hrrr.ts`
- Modify: `src/api/budget.ts` (`SourceId`, `SOURCES`), `src/api/weather.ts` (`RadarFrame`)
- Test: `src/radar/hrrr.test.ts`, with saved `.idx` text in `src/radar/__fixtures__/`

**Interfaces:**
- Produces:

```ts
// weather.ts
export type RadarFrame = { label: string; url: string | null; maxZoom?: number; at?: number; kind?: 'observed' | 'forecast'; run?: number; leadMin?: number };

// hrrr.ts
export const FORECAST_SCHEME = 'hrrr-forecast';
export const FORECAST_HOURS = [2, 6, 18] as const;
export type ForecastStep = { url: string; start: number; end: number; run: number; leadMin: number };
export function runUrl(run: number, hour: number): string;
export function parseIdx(text: string, run: number, url: string): ForecastStep[];
export function forecastTileUrl(step: ForecastStep): string; // hrrr-forecast://tile/{z}/{x}/{y}?u=&s=&e=&r=&l=
export function getForecastFrames(latestScanAt: number, hours: number, now: number, signal?: AbortSignal): Promise<RadarFrame[]>;
```

`budget.ts`: `hrrr: { name: 'NOAA HRRR forecast', perHour: 1500, perDay: 12000, perMinute: 300, free: true }`, marked as internal ceilings like the others.

- [ ] **Step 1: Write the failing tests**

```ts
it('finds REFD steps and their byte ranges', () => {
  expect(parseIdx(IDX_F02, RUN, URL).map(s => s.leadMin)).toEqual([75, 90, 105, 120]);
  expect(parseIdx(IDX_F02, RUN, URL)[0]).toMatchObject({ start: 2560317 });
});
it('never picks REFC or another REFD level', () => {
  expect(parseIdx(IDX_WITH_REFD_4000M_AND_REFC, RUN, URL).every(s => s.start !== REFC_OFFSET && s.start !== REFD_4000_OFFSET)).toBe(true);
});
it('rejects an idx from a different run', () => {
  expect(parseIdx(IDX_F02, RUN + 3_600_000, URL)).toEqual([]);
});
it('builds paths across UTC midnight', () => {
  expect(runUrl(Date.UTC(2026, 10, 5, 23), 2)).toContain('hrrr.20261105/conus/hrrr.t23z.wrfsubhf02.grib2');
  expect(runUrl(Date.UTC(2026, 10, 6, 0), 2)).toContain('hrrr.20261106/conus/hrrr.t00z');
});
```

Using a fake fetch for `getForecastFrames`:

- Only steps after `latestScanAt` and at or before `latestScanAt + hours` are returned, in time order, with `kind: 'forecast'`.
- A newer run is skipped when any needed file is a 404, and the next run back is used.
- The newest qualifying run is used, and all frames share one `run`.
- Nothing past lead 1080 minutes. An older run yields a shorter list rather than padding.
- Six failed runs return `[]`, with no thrown error.
- The furthest file is requested first, so an unpublished run costs one request.
- A published `.idx` is fetched once per session. A 404 is retried on the next call.
- Each request charges `hrrr`. A 429 or 5xx benches it for 60 seconds.
- `remaining('hrrr') < 1` returns `[]` with no network request.
- An aborted signal rejects without charging further requests.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/radar/hrrr.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `src/radar/hrrr.ts`**

The file for a step is `Math.ceil(leadMin / 60)`. Match `.idx` lines on exactly `:REFD:1000 m above ground:` and `:<n> min fcst:`, and compare `d=YYYYMMDDHH` with the run. The end of a range is the next line's offset minus one. Drop a line with no next line.

Labels use `toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })`, as NOAA frames do. Frames set `maxZoom: 11`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/radar/hrrr.test.ts src/api/budget.test.ts`
Expected: PASS.

---

### Task 5: Field store, worker and tile protocol

**Files:**
- Create: `src/radar/fieldStore.ts`, `src/radar/hrrrWorker.ts`, `src/radar/forecastTiles.ts`
- Modify: `src/radar/controller.ts:16-17` (register protocol)
- Test: `src/radar/fieldStore.test.ts`, `src/radar/forecastTiles.test.ts`

**Interfaces:**
- Consumes: `decodeGrib2`, `paintForecastTile`, `reflectivityLut`, `forecastTileUrl`, `FORECAST_SCHEME`
- Produces:

```ts
// fieldStore.ts
export type FieldKey = { url: string; start: number; end: number; run: number; leadMin: number };
export type FetchRange = (key: FieldKey, signal: AbortSignal) => Promise<Uint8Array>;
export function createFieldStore(opts: { fetchRange: FetchRange; decode: (b: Uint8Array) => GribField; max?: number; concurrency?: number }): {
  get(key: FieldKey, signal: AbortSignal): Promise<GribField>;
  size(): number;
};
export async function fetchRange(key: FieldKey, signal: AbortSignal, report: (kind: 'charge' | 'bench') => void): Promise<Uint8Array>;

// forecastTiles.ts
export function startForecastWorker(): boolean;
export function loadForecastTile(params: { url: string }, abort: AbortController): Promise<{ data: ArrayBuffer }>;
export function prefetchForecast(frames: RadarFrame[]): void;
export function onForecastWorkerFailed(listener: () => void): () => void;
```

Worker messages: requests `{ id, type: 'tile', key, z, x, y }`, `{ id, type: 'prefetch', key }`, `{ id, type: 'cancel' }`. Replies `{ id, data: ArrayBuffer }` (transferred), `{ id, error, code }`, `{ type: 'charge' }`, `{ type: 'bench' }`.

Workers have their own `localStorage`-less ledger, so the worker only reports `charge` and `bench`. The main thread applies them with `spend('hrrr')` and `bench('hrrr', 60_000)`, and checks `remaining('hrrr')` before sending a request.

- [ ] **Step 1: Write the failing tests**

`fieldStore.test.ts`, using fakes:

- Two gets for one key decode once.
- A 13th field evicts the least recently used. `size()` stays at 12.
- Recently read keys survive eviction.
- At most two fetches run at once.
- A failed get is not cached, and the next get retries.
- Aborting one waiter does not cancel a fetch another waiter still needs. Aborting the only waiter cancels it.
- A field whose `leadMin` or `refTime` differs from the key rejects with code `bad-data`, and is not cached.

`fetchRange`, using a fake global fetch:

- Sends `Range: bytes=<start>-<end>`.
- A `200` response rejects and cancels its body, without reading it.
- A `206` with the wrong `Content-Range` rejects.
- 429 and 5xx report `bench`. Every dispatched request reports `charge`.
- Times out at 30 seconds, checked with fake timers.

`forecastTiles.test.ts`, using a fake `Worker` global:

- Parses the tile URL into a key and z/x/y.
- Rejects when `remaining('hrrr') < 1`, without posting.
- `abort` posts `cancel` and rejects with `AbortError`.
- A worker `charge` message calls `spend('hrrr')`.
- A worker `error` event rejects pending tiles and calls the failure listener.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/radar/fieldStore.test.ts src/radar/forecastTiles.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement the store, worker and handler**

After decoding, the store compares `field.refTime` with `key.run` and `field.leadMin` with `key.leadMin`. Defaults are `max: 12` and `concurrency: 2`.

The worker holds one store, and one LUT per `(r, e, d, maxX)`. It paints with `paintForecastTile`, encodes with `OffscreenCanvas.convertToBlob({ type: 'image/png' })`, and transfers the buffer. The size is 512, as flat tiles use.

Create the worker lazily with `new Worker(new URL('./hrrrWorker.ts', import.meta.url), { type: 'module' })`. `startForecastWorker` returns `false` if construction throws.

Add `addProtocol(FORECAST_SCHEME, loadForecastTile)` beside the two existing registrations.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/radar/fieldStore.test.ts src/radar/forecastTiles.test.ts`
Expected: PASS.

- [ ] **Step 5: Confirm the worker builds**

Run: `npx tsc --noEmit && npm run build`
Expected: both succeed, and the build output includes the worker chunk.

---

### Task 6: Timeline helpers

**Files:**
- Modify: `src/radar/tools.ts`
- Test: `src/radar/tools.test.ts`

**Interfaces:**
- Consumes: `RadarFrame`
- Produces:

```ts
export function latestObservedIndex(frames: Pick<RadarFrame, 'kind'>[]): number; // -1 if none
export function isForecast(frame?: Pick<RadarFrame, 'kind'>): boolean;
export function mergeTimeline(observed: RadarFrame[], forecast: RadarFrame[]): RadarFrame[];
export function forecastBanner(frame: RadarFrame): string;
```

`frameAfterRefresh` keeps its signature, and following live now means the latest observed frame.

- [ ] **Step 1: Write the failing tests**

```ts
const timeline = [obs(1), obs(2), cast(3), cast(4)];
it('finds the latest scan, not the last frame', () => expect(latestObservedIndex(timeline)).toBe(1));
it('treats a frame with no kind as observed', () => expect(latestObservedIndex([{}, {}])).toBe(1));
it('follows the latest scan', () => expect(frameAfterRefresh(timeline, undefined, true)).toBe(1));
it('keeps a forecast clock time across refresh', () => expect(frameAfterRefresh(timeline, 3, false)).toBe(2));
it('drops forecast frames at or before the latest scan', () => {
  expect(mergeTimeline([obs(5)], [cast(5), cast(6)]).map(f => f.at)).toEqual([5, 6]);
});
it('describes a frame', () => {
  expect(forecastBanner(cast3pmPlus135)).toBe('HRRR simulated radar · Run 3 PM · +2 h 15 min');
});
```

Use a `run` built in local time so the banner test does not depend on the test machine's time zone.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/radar/tools.test.ts`
Expected: FAIL on the new tests.

- [ ] **Step 3: Implement the helpers and update `frameAfterRefresh`**

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/radar/tools.test.ts`
Expected: PASS, including existing tests unchanged.

---

### Task 7: Radar screen integration

**Files:**
- Modify: `src/screens/Radar.tsx`, `src/screens/radarDock.css`, `src/lib/settings.tsx:32-34`
- Create: `src/radar/useForecastFrames.ts`, `src/radar/forecastTimeline.ts`
- Test: `src/radar/forecastTimeline.test.ts`, `src/radar/useForecastFrames.test.ts`

**Interfaces:**
- Consumes: `getForecastFrames`, `startForecastWorker`, `onForecastWorkerFailed`, `prefetchForecast`, `mergeTimeline`, `latestObservedIndex`, `isForecast`, `forecastBanner`, `frameAfterRefresh`
- Produces:

```ts
// settings.tsx DEFAULTS
radarForecastHours: 6,

// useForecastFrames.ts
export function loadForecast(args: { enabled: boolean; latestScanAt?: number; hours: number; now: number; signal: AbortSignal }): Promise<{ frames: RadarFrame[]; failed: boolean }>;
export function useForecastFrames(args: { enabled: boolean; latestScanAt?: number; hours: number; tick: number }): { frames: RadarFrame[]; failed: boolean };

// forecastTimeline.ts
export function timelineState(frames: RadarFrame[], frame: number): { latest: number; historical: boolean; forecast: boolean; nowPct: number | null };
```

`nowPct` is the Now marker's rail position, or `null` with no forecast frames.

- [ ] **Step 1: Write the failing tests**

`forecastTimeline.test.ts`, one test for each row of the spec's timeline table:

- `latest` is the latest real scan, so Latest and follow-live land there.
- `historical` is true only before it, and false on the scan and on forecast frames.
- `forecast` is true only on forecast frames.
- Storm arrival's condition: on the latest scan, `historical` and `forecast` are both false.
- `nowPct` is `null` with no forecast frames.

`useForecastFrames.test.ts`, testing `loadForecast` with mocks:

- `enabled: false` returns no frames and makes no request.
- A missing `latestScanAt` returns no frames and makes no request.
- `startForecastWorker()` returning `false` gives `failed: true`.
- `getForecastFrames` rejecting gives `failed: true`, with no thrown error.
- An aborted signal resolves to no frames and does not report failure, so a late result after a source change is dropped.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/radar/forecastTimeline.test.ts src/radar/useForecastFrames.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement the two modules**

`useForecastFrames` runs `loadForecast` in an effect keyed on `enabled`, `latestScanAt`, `hours` and `tick`, using an `AbortController` per run. It clears frames at once when `enabled` goes false, and sets `failed` from `onForecastWorkerFailed`.

- [ ] **Step 4: Wire up `Radar.tsx`**

Make these changes:

- `const forecast = useForecastFrames({ enabled: src === 4, latestScanAt: liveFrames.at(-1)?.at, hours: s.radarForecastHours, tick })`.
- `const timeline = useMemo(() => mergeTimeline(liveFrames, forecast.frames), [...])`. Replace `liveFrames` with `timeline` wherever a frame is read, including `selectedAt` (line 166), `ctrl.update` (line 255), `labels` (line 258) and the rail.
- Remove `setFrame` from the observed request at line 119. Add one effect on `timeline` that calls `setFrame(frameAfterRefresh(timeline, selectedTime.current, followLatest.current))`. This is what keeps a forecast selection in place across refreshes.
- `jumpLatest` uses `timelineState(...).latest`.
- `historical` and the `· Historical` text at line 386 use `timelineState`. The arrival `useMemo` at line 227 becomes `!historical && !forecast`.
- On forecast frames, skip the storm history effect (line 169) and pass `storms: []` to `ctrl.update`, so no request is sent for a future time.
- On forecast frames, the status line shows run and lead, not an age, and the `radar-playback-context` banner shows `forecastBanner(frame)` plus `{liveOverlayNames.join(', ')} are live.`
- During play, call `prefetchForecast(timeline.slice(frame + 1, frame + 4).filter(isForecast))`, unless `document.hidden`.
- The Radar status panel at line 331 keeps using `liveFrames` for "Latest frame".

- [ ] **Step 5: Add the timeline UI**

- A Now marker on the rail at `nowPct`.
- Forecast part of the rail: a dashed line segment and a lighter flat fill from `nowPct` onward. No gradients or shadows.
- A `Forecast` select with 2 h, 6 h, 18 h beside `playback-speed`, shown only when forecast frames exist. Selecting calls `set({ radarForecastHours: Number(value) })`.
- When a forecast tile fails, add its `at` to a `failedForecast` set. The rail button gets `.unavailable` and `aria-label` "Forecast frame unavailable". Existing tile failure behavior stops playback.
- A notice when `forecast.failed`: `{ key: 'forecast-unavailable', text: 'HRRR forecast is unavailable. Radar is not affected.' }`.

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test && npx tsc --noEmit`
Expected: all tests PASS and no type errors.

---

### Task 8: README and browser verification

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update the README**

In the NOAA section, replace the claim that the integration supplies no future radar with a description of HRRR forecast frames: `REFD` at 1000 m, 15-minute steps, National only, simulated model output, up to 18 hours, 3 km cells, no datum shift applied between the file's sphere and map coordinates.

Keep "never invents intermediate frames" and extend it to forecast frames. Add HRRR to the source list and credit NOAA. Document `scripts/generate-reflectivity-scale.py` and `scripts/generate-grib-golden.py`, and that the Python tools are dev-only.

- [ ] **Step 2: Verify in the browser**

Start the `sky-peek` preview on NOAA National and check, using real data:

| Check | Expected |
|---|---|
| Console and network | No CORS errors. Field requests return 206 and about 250 KB, not a full file. |
| Timeline | Observed frames, Now marker, then forecast frames |
| Colors | Forecast colors match the on-screen NOAA legend, against an observed frame at the same area |
| Zoom | Solid cells past zoom 11, with no blur |
| Latest button | Goes to the latest scan |
| Playback | Runs across Now and wraps, waiting for frames |
| Selector | 2, 6 and 18 hours change the frame count, and the choice survives a reload |
| Banner | Shows run and lead, plus the live overlays |
| Storm tracks | Hidden on forecast frames, no `nexrad_attr.py` requests for future times |
| Source change | Switch to RainViewer: no forecast frames, no `hrrr` requests |
| Failure | Block the bucket in the page: notice appears, observed radar still plays |
| Speed | Time from first request to painted frame, and worker memory with 12 fields held |

Save a screenshot on a forecast frame as proof.

- [ ] **Step 3: Run the full suite**

Run: `npm test && npx tsc --noEmit && npm run build`
Expected: all pass.
