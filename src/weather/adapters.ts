// One adapter per provider: what a fetch costs, how its response maps to
// canonical units, and what its errors mean. API versions are pinned. Keys only
// ever appear in the URL built here, and that URL is never logged or stored.

/* eslint-disable @typescript-eslint/no-explicit-any */
import type { SourceId } from '@/api/budget';
import type { NwsPeriod } from '@/lib/forecast';
import { dateKey } from '@/lib/format';
import { TIMEOUT_MS } from './config';
import type { Batch, Cond, DayFact, Fact, Point, Product, Provider, ProviderFailure, Semantics } from './types';
import { compassToDeg, fToC, kphToMs, kToC, mphToMs, num, pct } from './units';

export type FetchPlan = {
  provider: Provider; product: Product; apiVersion: string;
  source: SourceId;
  url: string;
  units: number; // billable units; one HTTP call may charge more
  timeoutMs: number;
  /** Products this single call also satisfies. */
  covers: Product[];
};

export type NormalizeContext = { fetchedAt: number; timeZone?: string; station?: { id: string; distanceKm: number; elevationDiffM: number | null } };
type Normalized = Pick<Batch, 'issuedAt' | 'semantics' | 'points' | 'days' | 'fact' | 'periods' | 'timeZone' | 'elevationM' | 'flags'>;

export type ProviderAdapter = {
  id: Provider;
  apiVersion: string;
  forecastProduct: Product;
  plan(product: Product, q: { lat: number; lon: number; key?: string; url?: string }): FetchPlan;
  normalize(product: Product, raw: any, ctx: NormalizeContext): Normalized;
  classifyError(status: number, body: any): ProviderFailure;
};

const HOUR = 3_600_000;
const NO_SEMANTICS: Semantics = { pop: null, wind: null, stepHours: 1, maxInterpHours: 0, days: null };

export function condOf(text: string): Cond {
  const t = text.toLowerCase();
  if (/thunder|t-storm|tstorm/.test(t)) return 'thunder';
  if (/freezing (rain|drizzle)/.test(t)) return 'freezing';
  if (/sleet|wintry|ice pellet|rain and snow|mix/.test(t)) return 'mixed';
  if (/snow|flurr|blizzard/.test(t)) return 'snow';
  if (/rain|shower|drizzle/.test(t)) return 'rain';
  if (/fog|mist|haze/.test(t)) return 'fog';
  if (/cloud|overcast/.test(t)) return 'cloudy';
  if (/clear|sunny|fair/.test(t)) return 'clear';
  return 'unknown';
}

function generic(status: number, name: string): ProviderFailure {
  if (status === 429) return { kind: 'rate', message: `${name} rate limit reached` };
  if (status === 401 || status === 403) return { kind: 'auth', message: `${name} rejected the key` };
  if (status >= 500) return { kind: 'server', message: `${name} is having problems` };
  return { kind: 'schema', message: `${name} returned ${status}` };
}

const point = (p: Partial<Point> & Pick<Point, 'start' | 'end'>): Point => ({
  tempC: null, dewC: null, windMs: null, windDeg: null, gustMs: null, pop: null, cloud: null,
  cond: condOf(p.text ?? ''), text: '', isDay: null, ...p,
});

const fact = (f: Partial<Fact> & Pick<Fact, 'kind' | 'at'>): Fact => ({
  tempC: null, dewC: null, windMs: null, windDeg: null, gustMs: null, visM: null,
  cond: condOf(f.text ?? ''), text: '', qualityFlags: [], ...f,
});

// ---- National Weather Service ----------------------------------------------

/** "15 mph" -> 15, "5 to 10 mph" -> 7.5. A range's mean, for blending. */
function nwsWindMph(s: string | undefined): number | null {
  const n = (s ?? '').match(/\d+/g)?.map(Number);
  return n?.length ? n.reduce((a, b) => a + b, 0) / n.length : null;
}

function trimPeriod(p: any): NwsPeriod {
  return {
    name: p.name, startTime: p.startTime, isDaytime: p.isDaytime, temperature: p.temperature, windSpeed: p.windSpeed,
    shortForecast: p.shortForecast, detailedForecast: p.detailedForecast, probabilityOfPrecipitation: p.probabilityOfPrecipitation,
  };
}

const qc = (o: any) => o?.qualityControl as string | undefined;
const nwsTemp = (t: number, unit: string) => (unit === 'C' ? t : fToC(t));

export const nws: ProviderAdapter = {
  id: 'nws', apiVersion: 'v1', forecastProduct: 'hourly',
  plan: (product, q) => ({
    provider: 'nws', product, apiVersion: 'v1', source: 'nws', url: q.url!, units: 1, timeoutMs: TIMEOUT_MS.nws!, covers: [product],
  }),
  normalize(product, raw) {
    if (product === 'observation') {
      const p = raw.properties;
      const at = Date.parse(p.timestamp);
      if (!Number.isFinite(at)) throw new Error('observation has no time');
      const bad = [p.temperature].some(v => qc(v) === 'X' || qc(v) === 'Q');
      return {
        issuedAt: at, semantics: NO_SEMANTICS, points: [], days: [], flags: [],
        fact: fact({
          kind: 'observation', at, tempC: bad ? null : num(p.temperature?.value), dewC: num(p.dewpoint?.value),
          windMs: p.windSpeed?.value == null ? null : kphToMs(p.windSpeed.value), windDeg: num(p.windDirection?.value),
          gustMs: p.windGust?.value == null ? null : kphToMs(p.windGust.value), visM: num(p.visibility?.value),
          text: p.textDescription ?? '', qualityFlags: bad ? ['temperature_failed_qc'] : [],
        }),
      };
    }
    const p = raw.properties;
    if (!Array.isArray(p?.periods)) throw new Error('no periods');
    const issuedAt = Date.parse(p.updateTime);
    const hourly = product === 'hourly';
    const periods = (hourly ? p.periods.slice(0, 96) : p.periods).map(trimPeriod);
    const points: Point[] = hourly ? p.periods.slice(0, 96).map((r: any): Point => {
      const mph = nwsWindMph(r.windSpeed);
      return point({
        start: Date.parse(r.startTime), end: Date.parse(r.endTime),
        tempC: nwsTemp(r.temperature, r.temperatureUnit), dewC: num(r.dewpoint?.value),
        windMs: mph == null ? null : mphToMs(mph), windDeg: compassToDeg(r.windDirection),
        pop: pct(r.probabilityOfPrecipitation?.value), text: r.shortForecast, isDay: !!r.isDaytime,
      });
    }) : [];
    const days: DayFact[] = hourly ? [] : p.periods.filter((r: any) => r.isDaytime).map((r: any) => ({
      date: r.startTime.slice(0, 10), hiC: nwsTemp(r.temperature, r.temperatureUnit), loC: null, cond: condOf(r.shortForecast), text: r.shortForecast,
    }));
    return {
      issuedAt: Number.isFinite(issuedAt) ? issuedAt : null, points, days, fact: null, periods, flags: [], elevationM: num(p.elevation?.value),
      semantics: { pop: hourly ? 'any_precip_1h' : null, wind: 'mean', stepHours: 1, maxInterpHours: 0, days: hourly ? null : 'nws-periods' },
    };
  },
  classifyError(status) {
    if (status === 404) return { kind: 'coverage', message: 'The National Weather Service only covers US locations.' };
    return generic(status, 'The National Weather Service');
  },
};

// ---- OpenWeather (free 2.5 products) ---------------------------------------

const OW = 'https://api.openweathermap.org/data/2.5';

export const openweather: ProviderAdapter = {
  id: 'openweather', apiVersion: '2.5', forecastProduct: 'forecast',
  plan(product, { lat, lon, key }) {
    const k = encodeURIComponent(key ?? '');
    const url = product === 'current' ? `${OW}/weather?lat=${lat}&lon=${lon}&appid=${k}` : `${OW}/forecast?lat=${lat}&lon=${lon}&cnt=17&appid=${k}`;
    return { provider: 'openweather', product, apiVersion: '2.5', source: 'openweather', url, units: 1, timeoutMs: TIMEOUT_MS.default, covers: [product] };
  },
  normalize(product, raw) {
    if (product === 'current') {
      return {
        issuedAt: raw.dt * 1000, semantics: NO_SEMANTICS, points: [], days: [], flags: [],
        fact: fact({
          kind: 'analysis', at: raw.dt * 1000, tempC: raw.main?.temp == null ? null : kToC(raw.main.temp),
          windMs: num(raw.wind?.speed), windDeg: num(raw.wind?.deg), gustMs: num(raw.wind?.gust), visM: num(raw.visibility),
          text: raw.weather?.[0]?.description ?? '',
        }),
      };
    }
    if (!Array.isArray(raw.list)) throw new Error('no list');
    const points = raw.list.map((r: any): Point => point({
      start: r.dt * 1000, end: r.dt * 1000 + 3 * HOUR,
      tempC: r.main?.temp == null ? null : kToC(r.main.temp),
      windMs: num(r.wind?.speed), windDeg: num(r.wind?.deg), gustMs: num(r.wind?.gust),
      pop: num(r.pop), cloud: pct(r.clouds?.all), text: r.weather?.[0]?.description ?? '', isDay: r.sys?.pod ? r.sys.pod === 'd' : null,
    }));
    return {
      issuedAt: null, points, days: [], fact: null, flags: ['issue_age_unknown'],
      semantics: { pop: 'any_precip_3h', wind: 'mean', stepHours: 3, maxInterpHours: 3, days: null },
    };
  },
  classifyError: (status) => generic(status, 'OpenWeather'),
};

// ---- Tomorrow.io ------------------------------------------------------------

export const TOMORROW_CODES: Record<number, string> = {
  1000: 'clear', 1100: 'mostly clear', 1101: 'partly cloudy', 1102: 'mostly cloudy', 1001: 'cloudy', 2000: 'fog', 2100: 'light fog',
  4000: 'drizzle', 4001: 'rain', 4200: 'light rain', 4201: 'heavy rain', 5000: 'snow', 5001: 'flurries', 5100: 'light snow', 5101: 'heavy snow',
  6000: 'freezing drizzle', 6001: 'freezing rain', 6200: 'light freezing rain', 6201: 'heavy freezing rain', 7000: 'ice pellets', 7101: 'heavy ice pellets', 7102: 'light ice pellets', 8000: 'thunderstorm',
};

const tomorrowText = (code: unknown) => TOMORROW_CODES[code as number] ?? '';

export const tomorrow: ProviderAdapter = {
  id: 'tomorrow', apiVersion: 'v4', forecastProduct: 'forecast',
  plan(product, { lat, lon, key }) {
    const k = encodeURIComponent(key ?? '');
    const url = product === 'current'
      ? `https://api.tomorrow.io/v4/weather/realtime?location=${lat},${lon}&units=metric&apikey=${k}`
      : `https://api.tomorrow.io/v4/weather/forecast?location=${lat},${lon}&timesteps=1h,1d&units=metric&apikey=${k}`;
    return { provider: 'tomorrow', product, apiVersion: 'v4', source: 'tomorrow', url, units: 1, timeoutMs: TIMEOUT_MS.default, covers: [product] };
  },
  normalize(product, raw, ctx) {
    if (product === 'current') {
      const v = raw.data.values, at = Date.parse(raw.data.time);
      return {
        issuedAt: at, semantics: NO_SEMANTICS, points: [], days: [], flags: [],
        fact: fact({
          kind: 'analysis', at, tempC: num(v.temperature), dewC: num(v.dewPoint), windMs: num(v.windSpeed), windDeg: num(v.windDirection),
          gustMs: num(v.windGust), visM: v.visibility == null ? null : v.visibility * 1000, text: tomorrowText(v.weatherCode),
        }),
      };
    }
    const hourly = raw.timelines?.hourly;
    if (!Array.isArray(hourly)) throw new Error('no hourly timeline');
    const points = hourly.slice(0, 96).map((r: any): Point => {
      const v = r.values, start = Date.parse(r.time);
      return point({
        start, end: start + HOUR, tempC: num(v.temperature), dewC: num(v.dewPoint), windMs: num(v.windSpeed), windDeg: num(v.windDirection),
        gustMs: num(v.windGust), pop: pct(v.precipitationProbability), cloud: pct(v.cloudCover), text: tomorrowText(v.weatherCode),
      });
    });
    const tz = ctx.timeZone ?? 'UTC';
    const days = (raw.timelines.daily ?? []).map((r: any): DayFact => {
      const v = r.values, text = tomorrowText(v.weatherCodeMax);
      return { date: dateKey(new Date(r.time), tz), hiC: num(v.temperatureMax), loC: num(v.temperatureMin), cond: condOf(text), text };
    });
    return {
      issuedAt: null, points, days, fact: null, flags: ['issue_age_unknown'],
      semantics: { pop: 'any_precip_1h', wind: 'mean', stepHours: 1, maxInterpHours: 0, days: 'calendar' },
    };
  },
  classifyError(status, body) {
    if (status === 403 && /premium|plan|access/i.test(String(body?.message ?? ''))) return { kind: 'entitlement', message: 'Tomorrow.io plan does not include this' };
    return generic(status, 'Tomorrow.io');
  },
};

// ---- WeatherAPI.com ---------------------------------------------------------

export const weatherapi: ProviderAdapter = {
  id: 'weatherapi', apiVersion: 'v1', forecastProduct: 'forecast',
  plan(_product, { lat, lon, key }) {
    // One bundled call carries current, hourly and daily, so reuse it for all three.
    const url = `https://api.weatherapi.com/v1/forecast.json?key=${encodeURIComponent(key ?? '')}&q=${lat},${lon}&days=3&aqi=no&alerts=no`;
    return { provider: 'weatherapi', product: 'forecast', apiVersion: 'v1', source: 'weatherapi', url, units: 1, timeoutMs: TIMEOUT_MS.default, covers: ['forecast', 'current'] };
  },
  normalize(_product, raw) {
    const fd = raw.forecast?.forecastday;
    if (!Array.isArray(fd)) throw new Error('no forecast');
    const points = fd.flatMap((d: any) => d.hour.map((h: any): Point => point({
      start: h.time_epoch * 1000, end: h.time_epoch * 1000 + HOUR, tempC: num(h.temp_c), dewC: num(h.dewpoint_c),
      windMs: h.wind_kph == null ? null : kphToMs(h.wind_kph), windDeg: num(h.wind_degree), gustMs: h.gust_kph == null ? null : kphToMs(h.gust_kph),
      // chance_of_rain is rain only, and will_it_rain is a yes/no flag, not a 0% or 100% chance.
      pop: pct(h.chance_of_rain), cloud: pct(h.cloud), text: h.condition?.text ?? '', isDay: h.is_day == null ? null : !!h.is_day,
    })));
    const days = fd.map((d: any): DayFact => ({
      date: d.date, hiC: num(d.day?.maxtemp_c), loC: num(d.day?.mintemp_c), cond: condOf(d.day?.condition?.text ?? ''), text: d.day?.condition?.text ?? '',
    }));
    const c = raw.current;
    return {
      issuedAt: null, points, days, flags: ['issue_age_unknown'], timeZone: raw.location?.tz_id,
      fact: c ? fact({
        kind: 'analysis', at: c.last_updated_epoch * 1000, tempC: num(c.temp_c), dewC: num(c.dewpoint_c),
        windMs: c.wind_kph == null ? null : kphToMs(c.wind_kph), windDeg: num(c.wind_degree), gustMs: c.gust_kph == null ? null : kphToMs(c.gust_kph),
        visM: c.vis_km == null ? null : c.vis_km * 1000, text: c.condition?.text ?? '',
      }) : null,
      // Its docs call hourly wind "maximum speed", so it isn't blended with means.
      semantics: { pop: 'rain_only_1h', wind: 'unresolved', stepHours: 1, maxInterpHours: 0, days: 'calendar' },
    };
  },
  classifyError(status, body) {
    const code = body?.error?.code;
    if (code === 2007) return { kind: 'quota', message: 'WeatherAPI monthly quota is used up' };
    if (code === 2008 || code === 2009) return { kind: 'entitlement', message: 'WeatherAPI plan does not allow this' };
    if (code === 1006) return { kind: 'coverage', message: 'WeatherAPI has no data for this place' };
    if (code === 2006 || code === 1002) return { kind: 'auth', message: 'WeatherAPI rejected the key' };
    return generic(status, 'WeatherAPI');
  },
};

export const ADAPTERS: Record<Provider, ProviderAdapter> = { nws, openweather, tomorrow, weatherapi };

/** Stable fingerprint of the meteorological content, ignoring fetch times and key order. */
export function fingerprint(n: Pick<Batch, 'points' | 'days' | 'fact'>): string {
  const body = JSON.stringify([
    n.points.map(p => [p.start, p.tempC, p.dewC, p.windMs, p.windDeg, p.gustMs, p.pop, p.cloud, p.cond]),
    n.days.map(d => [d.date, d.hiC, d.loC, d.cond]),
    n.fact && [n.fact.at, n.fact.tempC, n.fact.windMs, n.fact.cond],
  ]);
  let h = 5381;
  for (let i = 0; i < body.length; i++) h = ((h * 33) ^ body.charCodeAt(i)) >>> 0;
  return h.toString(36);
}
