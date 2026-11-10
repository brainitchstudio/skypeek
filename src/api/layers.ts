import { recordDiagnostic } from '@/weather/diagnostics';
import { inLimits } from '@/weather/safeguards';
// Real data behind the radar's non-precipitation layers. All free, so they work
// with every radar source and never spend a keyed source's limited calls.

import { admit, cooldownFor429, RateLimitError, remaining, spend } from './budget';
import { mapAlert, sortAlerts, type NwsAlertFeature } from '@/lib/alerts';
import type { WeatherAlert } from '@/lib/types';
import { flatTiles } from '@/radar/flat';
import { boxAround, LIGHTNING_RANGE_MI, nearestDrawn } from '@/radar/proximity';

export type StormCell = {
  id: string; lat: number; lon: number; heading: number; mph: number; severe: boolean;
  dbz: number | null; hailPct: number | null; hailIn: number | null;
  severeHailPct?: number | null; echoTopFt?: number | null; vil?: number | null; motionKnown?: boolean; tornado: boolean; rotation: boolean;
  radar: string; at: number; // the radar that saw it, and when
};
export type GridPoint = { lat: number; lon: number; tempF: number; windMph: number; windFrom: number };
export type Bounds = { west: number; south: number; east: number; north: number };

type IemFeature = {
  properties: { nexrad: string; storm_id: string; tvs: string; meso?: string; poh: number; max_size?: number; posh?: number; top?: number; vil?: number; max_dbz: number; drct: number; sknt: number; valid: string };
  geometry: { coordinates: [number, number] };
};

const measured = (v: unknown, max: number) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max ? v : null;
const signature = (v: unknown) => typeof v === 'string' && !['', 'NONE', 'N/A', 'UNK', 'UNKNOWN', '0'].includes(v.toUpperCase());

const MAX_AGE_MS = 30 * 60_000;
const DEDUPE_DEG = 0.2; // neighboring radars report the same cell

/** NEXRAD cells as storms: fresh, valid reports only, every one kept, heading where they're going. */
export function mapStormReports(features: IemFeature[], now = Date.now()): StormCell[] {
  return features.filter(f => {
    const at = Date.parse(f.properties.valid);
    if (!Number.isFinite(at) || now - at > MAX_AGE_MS || at > now + 60_000) return false;
    const [lon, lat] = f.geometry.coordinates;
    return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
  }).map(({ properties: p, geometry }) => ({
    id: `${p.nexrad}-${p.storm_id}`,
    lat: geometry.coordinates[1],
    lon: geometry.coordinates[0],
    heading: measured(p.drct, 360) !== null ? (p.drct + 180) % 360 : 0, // reported as the direction it's moving from
    mph: measured(p.sknt, 200) !== null && measured(p.drct, 360) !== null ? p.sknt * 1.15078 : 0,
    motionKnown: measured(p.sknt, 200) !== null && measured(p.drct, 360) !== null,
    severe: signature(p.tvs) || (measured(p.poh, 100) ?? 0) >= 50 || (measured(p.max_dbz, 100) ?? 0) >= 55,
    dbz: measured(p.max_dbz, 100),
    hailPct: measured(p.poh, 100),
    hailIn: measured(p.max_size, 20),
    severeHailPct: measured(p.posh, 100),
    echoTopFt: measured(p.top, 100) === null ? null : p.top! * 1000,
    vil: measured(p.vil, 1000),
    tornado: signature(p.tvs),
    rotation: signature(p.meso),
    radar: p.nexrad,
    at: Date.parse(p.valid),
  }));
}

/** One cell per area for the map: neighboring radars report the same storm, so the strongest wins. */
export function dedupeCells(cells: StormCell[]): StormCell[] {
  const strongest = new Map<string, StormCell>();
  for (const c of cells) {
    const key = `${Math.round(c.lat / DEDUPE_DEG)},${Math.round(c.lon / DEDUPE_DEG)}`;
    const seen = strongest.get(key);
    if (!seen || (c.dbz ?? -Infinity) > (seen.dbz ?? -Infinity)) strongest.set(key, c);
  }
  return [...strongest.values()];
}

export const mapStormCells = (features: IemFeature[], now = Date.now()): StormCell[] => dedupeCells(mapStormReports(features, now));

export async function getStormReports(): Promise<StormCell[]> {
  if (!admit('iem')) throw new RateLimitError('iem');
  const r = await fetch('https://mesonet.agron.iastate.edu/geojson/nexrad_attr.geojson', { signal: AbortSignal.timeout(15000) });
  if (r.status === 429) { cooldownFor429('iem', r.headers.get('retry-after')); throw new RateLimitError('iem'); }
  if (!r.ok) throw new Error(`Storm cells failed: ${r.status}`);
  return mapStormReports(((await r.json()) as { features: IemFeature[] }).features);
}

const stormHistory = new Map<number, Promise<StormCell[]>>();
/** IEM returns the nearest actual volume scan per radar for the requested UTC time. */
export function getStormCellsAt(at: number): Promise<StormCell[]> {
  let hit = stormHistory.get(at);
  if (!hit) {
    if (!admit('iem', 1, 'optional')) return Promise.reject(new RateLimitError('iem'));
    hit = fetch(`https://mesonet.agron.iastate.edu/geojson/nexrad_attr.py?valid=${encodeURIComponent(new Date(at).toISOString())}`, { signal: AbortSignal.timeout(15000) })
      .then(async r => {
        if (r.status === 429) { cooldownFor429('iem', r.headers.get('retry-after')); throw new RateLimitError('iem'); }
        if (!r.ok) throw new Error(`Storm history failed: ${r.status}`);
        const j = await r.json() as { features: IemFeature[] };
        if (!Array.isArray(j.features)) throw new Error('Invalid storm history');
        return mapStormCells(j.features, at + 5 * 60_000).filter(c => Math.abs(c.at - at) <= 5 * 60_000);
      });
    stormHistory.set(at, hit);
    hit.catch(() => stormHistory.delete(at));
    if (stormHistory.size > 24) stormHistory.delete(stormHistory.keys().next().value!);
  }
  return hit;
}

const MAX_HOPS = 10;

/** The newest version of a warning: follows replacedBy until nothing replaces it. */
export async function followWarning(id: string, signal?: AbortSignal): Promise<WeatherAlert> {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  for (let hop = 0; hop <= MAX_HOPS; hop++) {
    if (remaining('nwsalerts') < 1) throw new Error('Warning request budget reached');
    spend('nwsalerts');
    const r = await fetch(`https://api.weather.gov/alerts/${encodeURIComponent(id)}`, { headers: { accept: 'application/geo+json' }, signal });
    if (!r.ok) throw new Error(`Warning failed: ${r.status}`);
    const f = await r.json() as NwsAlertFeature;
    const next = f.properties?.replacedBy?.split('/').pop();
    if (!next) return mapAlert(f, tz);
    id = decodeURIComponent(next);
  }
  throw new Error('Warning replaced too many times');
}

const GRID_STEPS = [0.25, 0.5, 1, 2, 3, 5, 10];
const GRID_MAX_PER_AXIS = 3;

/** Points on round coordinates, so small pans reuse the same grid. */
export function gridPoints({ west, south, east, north }: Bounds): [number, number][] {
  const span = Math.max(east - west, north - south);
  const step = GRID_STEPS.find(s => span / s <= GRID_MAX_PER_AXIS) ?? GRID_STEPS[GRID_STEPS.length - 1];
  const pts: [number, number][] = [];
  // One step past the view on each side, so the temperature bands reach its edges.
  for (let lat = Math.floor(south / step) * step; lat <= Math.ceil(north / step) * step; lat += step) {
    for (let lon = Math.floor(west / step) * step; lon <= Math.ceil(east / step) * step; lon += step) pts.push([lat, lon]);
  }
  return pts;
}

type MeteoPoint = { current: { temperature_2m: number; wind_speed_10m: number; wind_direction_10m: number } };

const gridCache = new Map<string, { at: number; points: GridPoint[] }>();
const GRID_TTL_MS = 30 * 60_000;

/** Current temperature and wind across the view. Open-Meteo takes many points in one call. */
export async function getGrid(bounds: Bounds): Promise<GridPoint[]> {
  const pts = gridPoints(bounds);
  if (!pts.length) return [];
  const lats = pts.map(p => p[0]).join(), lons = pts.map(p => p[1]).join();
  const key = `${lats}|${lons}`;
  const hit = gridCache.get(key);
  if (hit && Date.now() - hit.at < GRID_TTL_MS) return hit.points;
  if (!admit('openmeteo', pts.length, 'optional')) throw new RateLimitError('openmeteo');
  const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lons}&current=temperature_2m,wind_speed_10m,wind_direction_10m&temperature_unit=fahrenheit&wind_speed_unit=mph`);
  if (r.status === 429) { cooldownFor429('openmeteo', r.headers.get('retry-after')); throw new RateLimitError('openmeteo'); }
  if (!r.ok) throw new Error(`Grid failed: ${r.status}`);
  const j = (await r.json()) as MeteoPoint | MeteoPoint[]; // a single point isn't wrapped in an array
  const points = (Array.isArray(j) ? j : [j]).flatMap(({ current: c }, i) => {
    if (!pts[i] || !validRadarWeather(c)) { recordDiagnostic('radar_grid', 'Excluded a point with missing or out-of-range surface weather.'); return []; }
    return [{ lat: pts[i][0], lon: pts[i][1], tempF: c.temperature_2m, windMph: c.wind_speed_10m, windFrom: c.wind_direction_10m }];
  });
  gridCache.set(key, { at: Date.now(), points });
  return points;
}

/** Lightning tiles. `stamp` changes to pull fresh images. */
export const lightningTiles = (stamp: number) => flatTiles('lightning',
  `https://nowcoast.noaa.gov/geoserver/observations/lightning_detection/ows?service=WMS&version=1.3.0&request=GetMap&layers=ldn_lightning_strike_density&styles=&format=image/png&transparent=true&crs=EPSG:3857&width=256&height=256&bbox={bbox-epsg-3857}&stamp=${stamp}`, 7);

export function validRadarWeather(c: { temperature_2m: number; wind_speed_10m: number; wind_direction_10m: number }): boolean {
  return typeof c?.temperature_2m === 'number' && typeof c?.wind_speed_10m === 'number' && typeof c?.wind_direction_10m === 'number' && inLimits('tempC', (c.temperature_2m - 32) / 1.8) && inLimits('windMs', c.wind_speed_10m * 0.44704) && inLimits('windDeg', c.wind_direction_10m);
}

export type PointWeather = { tempF: number; feelsF: number; code: number; windMph: number; windFrom: number; rainPct: number | null };

/** Current conditions at any spot, plus the chance of rain over the next hour or so. */
export async function getPointWeather(lat: number, lon: number): Promise<PointWeather> {
  if (!admit('openmeteo')) throw new RateLimitError('openmeteo');
  const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(2)}&longitude=${lon.toFixed(2)}&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,wind_direction_10m&hourly=precipitation_probability&forecast_hours=2&temperature_unit=fahrenheit&wind_speed_unit=mph`);
  if (r.status === 429) { cooldownFor429('openmeteo', r.headers.get('retry-after')); throw new RateLimitError('openmeteo'); }
  if (!r.ok) throw new Error(`Point failed: ${r.status}`);
  const { current: c, hourly } = (await r.json()) as {
    current: { temperature_2m: number; apparent_temperature: number; weather_code: number; wind_speed_10m: number; wind_direction_10m: number };
    hourly?: { precipitation_probability?: (number | null)[] };
  };
  if (!validRadarWeather(c) || typeof c.apparent_temperature !== 'number' || !inLimits('tempC', (c.apparent_temperature - 32) / 1.8)) { recordDiagnostic('radar_point', 'Point weather failed validation; no values displayed.'); throw new Error('Point weather failed validation'); }
  const chances = (hourly?.precipitation_probability ?? []).filter((p): p is number => typeof p === 'number' && inLimits('pop', p / 100));
  return {
    tempF: c.temperature_2m, feelsF: c.apparent_temperature, code: c.weather_code,
    windMph: c.wind_speed_10m, windFrom: c.wind_direction_10m, rainPct: chances.length ? Math.max(...chances) : null,
  };
}

/** Real alerts in force at any US spot, not just the saved place. */
export async function getPointAlerts(lat: number, lon: number): Promise<WeatherAlert[]> {
  spend('nwsalerts');
  const r = await fetch(`https://api.weather.gov/alerts/active?point=${lat.toFixed(4)},${lon.toFixed(4)}`, { headers: { accept: 'application/geo+json' }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`Alerts failed: ${r.status}`);
  const { features } = (await r.json()) as { features: NwsAlertFeature[] };
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return sortAlerts(features.filter(f => (f.properties.status ?? 'Actual') === 'Actual' && f.properties.messageType !== 'Cancel').map(f => mapAlert(f, tz)));
}

/** Official active NWS alerts affecting the visible radar area, by polygon or county code. */
export async function getRadarWarnings(bounds: Bounds, signal?: AbortSignal): Promise<WeatherAlert[]> {
  if (remaining('nwsalerts') < 1) throw new Error('Warning request budget reached');
  spend('nwsalerts');
  const params = new URLSearchParams(Object.entries(bounds).map(([key, value]) => [key, value.toFixed(4)]));
  const r = await fetch(`/api/radar-warnings?${params}`, { signal });
  if (!r.ok) throw new Error(`Map warnings failed: ${r.status}`);
  const j = await r.json() as { features?: NwsAlertFeature[] };
  if (!Array.isArray(j.features)) throw new Error('Invalid map warnings');
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return sortAlerts(j.features.map(f => mapAlert(f, tz)));
}

const LIGHTNING_SIZE = 256;

/**
 * Miles to the nearest lightning in the last 15 minutes, or null if there's none in range.
 * NOAA publishes strike density as an image rather than strike points, so this reads the image.
 */
export async function getNearestLightning(lat: number, lon: number, stamp: number): Promise<number | null> {
  const box = boxAround(lat, lon, LIGHTNING_RANGE_MI);
  const r = await fetch(`https://nowcoast.noaa.gov/geoserver/observations/lightning_detection/ows?service=WMS&version=1.3.0&request=GetMap&layers=ldn_lightning_strike_density&styles=&format=image/png&transparent=true&crs=EPSG:4326&width=${LIGHTNING_SIZE}&height=${LIGHTNING_SIZE}&bbox=${box.south},${box.west},${box.north},${box.east}&stamp=${stamp}`);
  if (!r.ok) throw new Error(`Lightning failed: ${r.status}`);
  const bitmap = await createImageBitmap(await r.blob());
  const ctx = new OffscreenCanvas(LIGHTNING_SIZE, LIGHTNING_SIZE).getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  return nearestDrawn(ctx.getImageData(0, 0, LIGHTNING_SIZE, LIGHTNING_SIZE).data, LIGHTNING_SIZE, box, lat, lon, LIGHTNING_RANGE_MI);
}
