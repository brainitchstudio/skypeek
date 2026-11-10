import type { ExtendedDay, NwsPeriod } from '@/lib/forecast';
import { iconForWmo } from '@/lib/format';
import type { LiveConditions, Place } from '@/lib/types';
import { admit, bench, cooldownFor429, remaining, spend, type SourceId } from './budget';
import { imageryTiles } from '@/radar/imagery';
import { TOMORROW_CODES } from '@/weather/adapters';
import { inLimits } from '@/weather/safeguards';

const NWS = 'https://api.weather.gov';

async function json<T>(url: string): Promise<T> {
  const r = await fetch(url, { headers: { accept: 'application/geo+json, application/json' }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw Object.assign(new Error(`${r.status}`), { status: r.status });
  return r.json();
}

const MINUTE = 60_000;
const responses = new Map<string, { at: number; value: Promise<unknown> }>();

/** One response per URL per `ttl`, so screens sharing data share a single call. */
function cachedJson<T>(url: string, ttl: number, source?: SourceId): Promise<T> {
  const hit = responses.get(url);
  if (hit && Date.now() - hit.at < ttl) return hit.value as Promise<T>;
  if (source === 'openmeteo' && !admit(source)) return Promise.reject(new Error('Extended forecast budget reached'));
  if (source && source !== 'openmeteo') spend(source);
  const value = json<T>(url).catch(error => {
    if (source === 'openmeteo' && error?.status === 429) cooldownFor429(source, null);
    throw error;
  });
  value.catch(() => responses.delete(url));
  responses.set(url, { at: Date.now(), value });
  return value;
}

export type NwsPoint = {
  forecast: string; forecastHourly: string; observationStations: string; timeZone: string;
  gridId: string; gridX: number; gridY: number;
};
const POINTS_KEY = 'sky-peek-points';
const POINT_TTL = 7 * 24 * 3_600_000;
const points = new Map<string, Promise<NwsPoint>>();

function savedPoints(): Record<string, { at: number; point: NwsPoint }> {
  try { return JSON.parse(globalThis.localStorage?.getItem(POINTS_KEY) ?? '{}'); } catch { return {}; }
}

/** The last known grid for a place, however old: enough to show cached data offline. */
export function savedPoint(lat: number, lon: number): NwsPoint | null {
  return savedPoints()[`${lat.toFixed(4)},${lon.toFixed(4)}`]?.point ?? null;
}

/** A place's NWS grid and links. They rarely change, so they're kept for a week. */
export function getPoint(lat: number, lon: number): Promise<NwsPoint> {
  const key = `${lat.toFixed(4)},${lon.toFixed(4)}`;
  let p = points.get(key);
  if (p) return p;
  const saved = savedPoints()[key];
  if (saved && Date.now() - saved.at < POINT_TTL && saved.point.observationStations) {
    p = Promise.resolve(saved.point);
  } else {
    spend('nws');
    p = json<{ properties: NwsPoint }>(`${NWS}/points/${key}`).then(j => {
      const all = savedPoints();
      all[key] = { at: Date.now(), point: j.properties };
      try { globalThis.localStorage?.setItem(POINTS_KEY, JSON.stringify(all)); } catch { /* re-resolved next time */ }
      return j.properties;
    });
    p.catch(() => points.delete(key));
  }
  points.set(key, p);
  return p;
}

export async function getExtended(lat: number, lon: number): Promise<{ days: ExtendedDay[]; timeZone: string; rejected: { date: string; why: string }[] }> {
  type R = { timezone: string; daily: {
    time: string[]; weather_code: number[]; temperature_2m_max: number[]; temperature_2m_min: number[];
    precipitation_probability_max: (number | null)[]; wind_speed_10m_max: (number | null)[];
  } };
  const j = await cachedJson<R>(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max' +
    '&temperature_unit=fahrenheit&wind_speed_unit=mph&forecast_days=11&timezone=auto', 30 * MINUTE, 'openmeteo');
  const d = j.daily;
  const f = (x: number) => ((x - 32) * 5) / 9;
  const rejected: { date: string; why: string }[] = [];
  const days = d.time.flatMap((date, i) => {
    const hiF = d.temperature_2m_max[i], loF = d.temperature_2m_min[i], code = d.weather_code[i], wind = d.wind_speed_10m_max[i];
    if (!inLimits('tempC', f(hiF)) || !inLimits('tempC', f(loF)) || hiF == null || loF == null || code == null) {
      rejected.push({ date, why: `high ${hiF}, low ${loF}, code ${code}` });
      return [];
    }
    const windOk = wind != null && inLimits('windMs', wind * 0.44704);
    return [{ date, hiF, loF, icon: iconForWmo(code), pop: d.precipitation_probability_max[i], windMph: windOk ? Math.round(wind) : null }];
  });
  return { timeZone: j.timezone, days, rejected };
}

/** Current temperature and icon for a row in the saved-places list. */
export async function getPlaceNow(place: Place) {
  const pt = await getPoint(place.lat, place.lon);
  const j = await cachedJson<{ properties: { periods: NwsPeriod[] } }>(pt.forecastHourly, 10 * MINUTE, 'nws');
  const p = j.properties.periods[0];
  if (typeof p.temperature !== 'number' || !inLimits('tempC', ((p.temperature - 32) * 5) / 9)) throw new Error('impossible temperature'); // the row shows a dash
  return { tempF: p.temperature, condition: p.shortForecast, isDaytime: p.isDaytime };
}

export type PointHour = { startTime: string; tempF: number; wind: string; rainPct: number | null; condition: string };

/** The hour in progress at any spot. Unlike getPoint, it saves nothing: the spot may be a one-off map tap. */
/** The hourly period holding `at`. */
export async function getPointHour(lat: number, lon: number, at = Date.now()): Promise<PointHour> {
  const pt = await cachedJson<{ properties: { forecastHourly: string } }>(`${NWS}/points/${lat.toFixed(4)},${lon.toFixed(4)}`, 10 * MINUTE, 'nws');
  const j = await cachedJson<{ properties: { periods: NwsPeriod[] } }>(pt.properties.forecastHourly, 10 * MINUTE, 'nws');
  const p = j.properties.periods.find(x => new Date(x.startTime).getTime() > at - 3_600_000); // mapHours' rule: keep the hour in progress
  if (!p) throw new Error('no current hour');
  if (typeof p.temperature !== 'number' || !inLimits('tempC', ((p.temperature - 32) * 5) / 9)) throw new Error('impossible temperature');
  return { startTime: p.startTime, tempF: p.temperature, wind: p.windSpeed, rainPct: p.probabilityOfPrecipitation?.value ?? null, condition: p.shortForecast };
}

export async function searchPlaces(q: string): Promise<Place[]> {
  type R = { results?: { id: number; name: string; latitude: number; longitude: number; admin1?: string; admin2?: string }[] };
  if (!admit('openmeteo')) throw new Error('Place search budget reached');
  const j = await json<R>(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=6&language=en&format=json&countryCode=US`).catch(error => {
    if (error?.status === 429) cooldownFor429('openmeteo', null);
    throw error;
  });
  return (j.results ?? []).filter(r => r.admin1).map(r => ({
    id: String(r.id),
    name: `${r.name}, ${STATE[r.admin1!] ?? r.admin1}`,
    region: r.admin2 ? `${r.admin2} County` : r.admin1!,
    lat: r.latitude, lon: r.longitude,
  }));
}

const STATE: Record<string, string> = {
  Alabama: 'AL', Alaska: 'AK', Arizona: 'AZ', Arkansas: 'AR', California: 'CA', Colorado: 'CO', Connecticut: 'CT',
  Delaware: 'DE', 'District of Columbia': 'DC', 'Washington, D.C.': 'DC', Florida: 'FL', Georgia: 'GA', Hawaii: 'HI',
  Idaho: 'ID', Illinois: 'IL', Indiana: 'IN', Iowa: 'IA', Kansas: 'KS', Kentucky: 'KY', Louisiana: 'LA', Maine: 'ME',
  Maryland: 'MD', Massachusetts: 'MA', Michigan: 'MI', Minnesota: 'MN', Mississippi: 'MS', Missouri: 'MO', Montana: 'MT',
  Nebraska: 'NE', Nevada: 'NV', 'New Hampshire': 'NH', 'New Jersey': 'NJ', 'New Mexico': 'NM', 'New York': 'NY',
  'North Carolina': 'NC', 'North Dakota': 'ND', Ohio: 'OH', Oklahoma: 'OK', Oregon: 'OR', Pennsylvania: 'PA',
  'Rhode Island': 'RI', 'South Carolina': 'SC', 'South Dakota': 'SD', Tennessee: 'TN', Texas: 'TX', Utah: 'UT',
  Vermont: 'VT', Virginia: 'VA', Washington: 'WA', 'West Virginia': 'WV', Wisconsin: 'WI', Wyoming: 'WY',
};

export const PROVIDERS = [
  { name: 'National Weather Service', note: 'Free · US only', needsKey: false, help: '' },
  { name: 'OpenWeather', note: 'API key required', needsKey: true, help: 'Get a free key at openweathermap.org → API keys. Uses Current Weather, the 5 day forecast and the precipitation map layer.' },
  { name: 'Tomorrow.io', note: 'API key required', needsKey: true, help: 'Get a free key at app.tomorrow.io → Development → API keys. Uses Realtime weather, the hourly and daily forecast and the precipitation map tiles.' },
  { name: 'WeatherAPI', note: 'API key required', needsKey: true, help: 'Get a free key at weatherapi.com → My account. Uses the forecast, which includes current weather.' },
];

const PROVIDER_SOURCE: Record<number, SourceId> = { 1: 'openweather', 2: 'tomorrow', 3: 'weatherapi' };

/** Tests a key with a single current-conditions call. Throws an Error with a user-facing message. */
export async function getLiveConditions(provider: number, key: string, place: Place): Promise<LiveConditions> {
  const { lat, lon } = place;
  const k = encodeURIComponent(key);
  const name = PROVIDERS[provider].name;
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const source: [string, (j: any) => Omit<LiveConditions, 'provider' | 'at'>] = ({
    1: [`https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&units=imperial&appid=${k}`,
      (j: any) => ({ tempF: j.main.temp, desc: j.weather[0].description, place: j.name, windMph: j.wind.speed })],
    2: [`https://api.tomorrow.io/v4/weather/realtime?location=${lat},${lon}&units=imperial&apikey=${k}`,
      (j: any) => { const v = j.data.values; return { tempF: v.temperature, desc: TOMORROW_CODES[v.weatherCode] ?? `code ${v.weatherCode}`, place: place.name, windMph: v.windSpeed, rainPct: v.precipitationProbability }; }],
    3: [`https://api.weatherapi.com/v1/current.json?key=${k}&q=${lat},${lon}`,
      (j: any) => ({ tempF: j.current.temp_f, desc: j.current.condition.text.toLowerCase(), place: j.location.name, windMph: j.current.wind_mph })],
  } as Record<number, [string, (j: any) => Omit<LiveConditions, 'provider' | 'at'>]>)[provider];

  let r: Response;
  spend(PROVIDER_SOURCE[provider]);
  try {
    r = await fetch(source[0], { headers: { accept: 'application/json' } });
  } catch {
    throw new Error(`Could not reach ${name}. Check your connection.`);
  }
  if (r.status === 401 || r.status === 403) {
    throw new Error(provider === 1 ? 'Key rejected. New OpenWeather keys can take up to 2 hours to activate.' : `Key rejected by ${name}. Check it was copied in full.`);
  }
  if (r.status === 429) bench(PROVIDER_SOURCE[provider]);
  if (r.status === 429) throw new Error(`${name} rate limit reached. Free plans allow a limited number of calls per hour; try again later.`);
  if (!r.ok) {
    const j = await r.json().catch(() => null);
    const m = j?.message ?? j?.error?.message;
    throw new Error(`${name} error ${r.status}${m ? ': ' + m : ''}`);
  }
  const at = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return { ...source[1](await r.json()), provider, at };
}

export type RadarFrame = { label: string; url: string | null; maxZoom?: number; at?: number; kind?: 'observed' | 'forecast'; run?: number; leadMin?: number };

const RADAR_MAX_ZOOM = { rainviewer: 7, openweather: 9, tomorrow: 7 }; // deepest tile fetched per source
const TOMORROW_RADAR_CALLS = 30; // what one radar view can cost

/** The radar source to use: the choice, unless its budget can't cover it. */
export function radarSourceFor(choice: number): { src: number; swapped: string | null } {
  if (choice === 3 && remaining('tomorrow') < TOMORROW_RADAR_CALLS) return { src: 1, swapped: 'Tomorrow.io' };
  if (choice === 2 && remaining('openweather') < TOMORROW_RADAR_CALLS) return { src: 1, swapped: 'OpenWeather' };
  return { src: choice, swapped: null };
}

type RadarPick = { choice: number; swapped: string | null };

/** The source that just came back, if the radar was swapped away from it and now isn't. Changing the choice doesn't count. */
export function restoredSource(before: RadarPick | null, now: RadarPick): string | null {
  return before?.swapped && !now.swapped && before.choice === now.choice ? before.swapped : null;
}

/** Time steps for a radar source: [frames, index of "now"]. Empty means the simulated source. */
export async function getRadarFrames(src: number, owKey: string, tmKey: string): Promise<{ frames: RadarFrame[]; now: number }> {
  if (src === 1) {
    type R = { host: string; radar: { past: { time: number; path: string }[]; nowcast?: { time: number; path: string }[] } };
    spend('rainviewer');
    const j = await cachedJson<R>('https://api.rainviewer.com/public/weather-maps.json', 2 * MINUTE);
    const past = j.radar.past.slice(-10), cast = j.radar.nowcast ?? [];
    const all = [...past, ...cast];
    const fmt = (t: number) => clock12(new Date(t * 1000));
    return {
      now: past.length - 1,
      frames: all.map(f => ({
        label: fmt(f.time), at: f.time * 1000,
        url: imageryTiles('rainviewer', `${j.host}${f.path}/256/{z}/{x}/{y}/2/0_1.png`),
        maxZoom: RADAR_MAX_ZOOM.rainviewer,
      })),
    };
  }
  if (src === 2) {
    return { now: 0, frames: [{
      label: 'Now',
      url: imageryTiles('openweather', `https://tile.openweathermap.org/map/precipitation_new/{z}/{x}/{y}.png?appid=${encodeURIComponent(owKey)}`),
        maxZoom: RADAR_MAX_ZOOM.openweather,
    }] };
  }
  if (src === 3) {
    // One frame only: playback would cost more than the free hourly limit.
    return { now: 0, frames: [{
      label: 'Now',
      url: imageryTiles('tomorrow', `https://api.tomorrow.io/v4/map/tile/{z}/{x}/{y}/precipitationIntensity/now.png?apikey=${encodeURIComponent(tmKey)}`),
        maxZoom: RADAR_MAX_ZOOM.tomorrow,
    }] };
  }
  return { now: 5, frames: [] };
}

const clock12 = (d: Date) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
