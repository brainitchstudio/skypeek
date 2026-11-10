import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { reloadBudget, resetBudget, SOURCES, usage } from '@/api/budget';
import { accuracyExport, accuracyReport, readSnapshot, safeguardLog, tick, type WeatherRequest } from './service';
import { mergeBatch } from './store';
import type { Batch } from './types';

const T0 = Date.parse('2026-11-05T18:10:00Z');
const place = { lat: 41.88, lon: -87.63 };
const req = (over: Partial<WeatherRequest> = {}): WeatherRequest => ({ place, keys: {}, userMinutes: 15, ...over });
const iso = (ms: number) => new Date(ms).toISOString();
const H = 3_600_000;

function storage() {
  const m = new Map<string, string>();
  return { dump: () => [...m.values()].join('\n'), getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
}

const POINT = { properties: {
  forecast: 'https://api.weather.gov/gridpoints/LOT/76,73/forecast', forecastHourly: 'https://api.weather.gov/gridpoints/LOT/76,73/forecast/hourly',
  observationStations: 'https://api.weather.gov/gridpoints/LOT/76,73/stations', timeZone: 'America/Chicago', gridId: 'LOT', gridX: 76, gridY: 73,
} };

const hourStart = Math.floor(T0 / H) * H;
const periods = (pop: number | null = 20) => Array.from({ length: 30 }, (_, i) => ({
  name: '', startTime: iso(hourStart + i * H), endTime: iso(hourStart + (i + 1) * H), isDaytime: true, temperature: 50, temperatureUnit: 'F',
  windSpeed: '10 mph', windDirection: 'N', shortForecast: 'Cloudy', detailedForecast: '', probabilityOfPrecipitation: { value: pop }, dewpoint: { value: 2 },
}));
const dailyPeriods = [{ name: 'Today', startTime: iso(hourStart), endTime: iso(hourStart + 6 * H), isDaytime: true, temperature: 55, temperatureUnit: 'F', windSpeed: '10 mph', shortForecast: 'Cloudy', detailedForecast: 'Cloudy.', probabilityOfPrecipitation: { value: 20 } }];

type Handler = (url: string) => Response | Promise<Response>;
const ok = (body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status: 200, headers });

let calls: string[];
let alertsBody: unknown;
let override: Handler | null;
let lastLat = 0, lastLon = 0;

const route: Handler = url => {
  if (override) { const hit = override(url); if (hit) return hit; }
  if (url.includes('/points/')) {
    [lastLat, lastLon] = url.split('/points/')[1].split(',').map(Number);
    return ok(POINT);
  }
  if (url.includes('/alerts/active')) return ok(alertsBody);
  if (url.endsWith('/forecast/hourly')) return ok({ properties: { updateTime: iso(Date.now() - H), periods: periods() } });
  if (url.endsWith('/forecast')) return ok({ properties: { updateTime: iso(Date.now() - H), periods: dailyPeriods } });
  if (url.includes('/stations?')) return ok({ features: [{ properties: { stationIdentifier: 'KMDW', elevation: { value: 188 } }, geometry: { coordinates: [lastLon, lastLat + 0.05] } }] });
  if (url.includes('/observations?')) {
    const end = Math.floor(Date.now() / H) * H;
    return ok({ features: Array.from({ length: 12 }, (_, i) => ({ properties: { timestamp: iso(end - i * 15 * 60_000), temperature: { value: 10, qualityControl: 'V' }, windSpeed: { value: 18 }, presentWeather: [], textDescription: 'Cloudy' } })) });
  }
  if (url.includes('/observations/latest')) return ok({ properties: { timestamp: iso(Date.now() - 10 * 60_000), textDescription: 'Cloudy', temperature: { value: 10, qualityControl: 'V' }, windSpeed: { value: 18 }, windDirection: { value: 0 } } });
  if (url.includes('open-meteo')) return ok({ timezone: 'America/Chicago', daily: { time: [], weather_code: [], temperature_2m_max: [], temperature_2m_min: [], precipitation_probability_max: [], wind_speed_10m_max: [] } });
  if (url.includes('api.tomorrow.io')) return ok({ timelines: { hourly: Array.from({ length: 30 }, (_, i) => ({ time: iso(hourStart + i * H), values: { temperature: 20, windSpeed: 4.47, windDirection: 0, precipitationProbability: 80, weatherCode: 1001 } })), daily: [] } });
  throw new Error(`unexpected ${url}`);
};

beforeEach(() => {
  vi.useFakeTimers({ now: T0, toFake: ['Date'] });
  vi.stubGlobal('localStorage', storage());
  vi.stubGlobal('navigator', {});
  resetBudget();
  calls = []; alertsBody = { features: [] }; override = null;
  vi.stubGlobal('fetch', async (url: string) => { calls.push(url); return route(url); });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

// Module state (the point cache) survives between tests, so each test uses its own place.
let n = 0;
const fresh = () => ({ lat: 30 + ++n * 0.1, lon: -90 });

describe('tick', () => {
  it('turns 1,000 simultaneous requests for a cold place into one fetch of each product', async () => {
    const p = fresh();
    await Promise.all(Array.from({ length: 1000 }, () => tick(req({ place: p, keys: { tomorrow: 'k' } }))));
    const count = (s: string) => calls.filter(u => u.includes(s)).length;
    expect(count('/forecast/hourly')).toBe(1);
    expect(count('api.tomorrow.io')).toBe(1);
    expect(calls.length).toBeLessThan(10);
  });

  it('makes no forecast calls on a tick when nothing is due', async () => {
    const p = fresh();
    await tick(req({ place: p }));
    calls = [];
    vi.setSystemTime(T0 + 70_000);
    await tick(req({ place: p }));
    expect(calls.every(u => u.includes('/alerts/active'))).toBe(true);
  });

  it('serves a usable forecast from NWS alone with no keys', async () => {
    const s = await tick(req({ place: fresh() }));
    expect(s.forecast?.hours[0]).toMatchObject({ tempF: 50, pop: 20, windMph: 10, agreement: 'single' });
    expect(s.now).toMatchObject({ kind: 'observation', stationId: 'KMDW', tempF: 50 });
    expect(s.nowcast.status).toBe('unavailable');
    expect(s.alertFeed.status).toBe('fresh');
  });

  it('blends a challenger only where fields are comparable', async () => {
    const s = await tick(req({ place: fresh(), keys: { tomorrow: 'k' } }));
    const h = s.forecast!.hours[0];
    expect(h.sources?.map(x => x.provider).sort()).toEqual(['nws', 'tomorrow']);
    expect(h.tempF).toBeGreaterThan(50);
    expect(h.tempF).toBeLessThan(68);
    expect(h.pop).toBeGreaterThan(20);
  });

  it('never fetches a keyed provider without a verified key', async () => {
    await tick(req({ place: fresh() }));
    expect(calls.some(u => u.includes('tomorrow') || u.includes('openweather') || u.includes('weatherapi'))).toBe(false);
  });

  it('keeps alerts running but buys no forecasts in a hidden tab', async () => {
    await tick(req({ place: fresh(), background: true }));
    expect(calls.some(u => u.includes('/alerts/active'))).toBe(true);
    expect(calls.some(u => u.includes('/forecast'))).toBe(false);
  });

  it('charges a failed call and backs off instead of retrying every tick', async () => {
    const p = fresh();
    await tick(req({ place: p }));
    override = u => (u.includes('api.tomorrow.io') ? new Response('{}', { status: 503 }) : (null as unknown as Response));
    const keys = { tomorrow: 'k' };
    await tick(req({ place: p, keys }));
    const used = usage().find(u => u.id === 'tomorrow')!.hourUsed;
    expect(used).toBe(1);
    vi.setSystemTime(T0 + 10_000);
    await tick(req({ place: p, keys }));
    expect(usage().find(u => u.id === 'tomorrow')!.hourUsed).toBe(1);
  });

  it('pauses the right source on a 429 and honors Retry-After', async () => {
    override = u => (u.includes('api.tomorrow.io') ? new Response('{}', { status: 429, headers: { 'retry-after': '600' } }) : (null as unknown as Response));
    await tick(req({ place: fresh(), keys: { tomorrow: 'k' } }));
    expect(usage().find(u => u.id === 'tomorrow')!.benchedUntil).toBe(T0 + 600_000);
    expect(usage().find(u => u.id === 'nws')!.benchedUntil).toBe(0);
  });

  it('stops using a rejected key until it changes', async () => {
    const p = fresh();
    override = u => (u.includes('api.tomorrow.io') ? new Response('{}', { status: 401 }) : (null as unknown as Response));
    const s = await tick(req({ place: p, keys: { tomorrow: 'bad' } }));
    calls = [];
    override = null;
    vi.setSystemTime(T0 + 3 * H);
    await tick(req({ place: p, keys: { tomorrow: 'bad' } }));
    expect(calls.some(u => u.includes('api.tomorrow.io'))).toBe(false);
    expect(s.sources.find(x => x.provider === 'tomorrow')).toMatchObject({ healthy: false, note: 'Tomorrow.io rejected the key' });
  });

  it('falls back to commercial data outside NWS coverage and says alerts are unsupported', async () => {
    override = u => (u.includes('/points/') ? new Response('{}', { status: 404 }) : (null as unknown as Response));
    const s = await tick(req({ place: fresh(), keys: { tomorrow: 'k' } }));
    expect(s.nwsCovers).toBe(false);
    expect(s.forecast?.hours[0].tempF).toBe(68);
    expect(s.alertFeed.status).toBe('unsupported');
  });

  it('explains itself outside coverage with no keys, instead of inventing data', async () => {
    override = u => (u.includes('/points/') ? new Response('{}', { status: 404 }) : (null as unknown as Response));
    const s = await tick(req({ place: fresh() }));
    expect(s.forecast).toBeNull();
    expect(s.error).toMatch(/only covers US/);
  });

  it('keeps showing cached data through an outage, with last-known alerts', async () => {
    const p = fresh();
    alertsBody = { features: [{ id: 'a', geometry: null, properties: { id: 'a', event: 'Flood Warning', status: 'Actual', messageType: 'Alert', expires: iso(T0 + 8 * H) } }] };
    await tick(req({ place: p }));
    override = () => { throw new Error('offline'); };
    vi.setSystemTime(T0 + 5 * 60_000);
    const s = await tick(req({ place: p }));
    expect(s.forecast).not.toBeNull();
    expect(s.alerts.map(a => a.id)).toEqual(['a']);
    expect(s.alertFeed.status).toBe('stale');
  });

  it('paints from cache with no network at all', async () => {
    const p = fresh();
    await tick(req({ place: p }));
    calls = [];
    expect(readSnapshot(req({ place: p })).forecast).not.toBeNull();
    expect(calls).toEqual([]);
  });

  it('never leaves a key in stored data', async () => {
    await tick(req({ place: fresh(), keys: { tomorrow: 'SECRET123' } }));
    expect((localStorage as unknown as { dump: () => string }).dump()).not.toContain('SECRET123');
  });

  it('keeps quota spent across a restart', async () => {
    await tick(req({ place: fresh(), keys: { tomorrow: 'k' } }));
    reloadBudget();
    expect(usage().find(u => u.id === 'tomorrow')!.hourUsed).toBe(1);
    expect(SOURCES.tomorrow.perHour).toBe(20);
  });
});

describe('bad data from a live provider', () => {
  const tomorrowSays = (temperature: number, n = 30) => (u: string) => (u.includes('api.tomorrow.io')
    ? ok({ timelines: { hourly: Array.from({ length: 30 }, (_, i) => ({ time: iso(hourStart + i * H), values: { temperature: i < n ? temperature : 20, windSpeed: 4, windDirection: 0, precipitationProbability: 10, weatherCode: 1001 } })), daily: [] } })
    : (null as unknown as Response));

  it('falls back to NWS for an impossible value and logs why and what was done', async () => {
    const p = fresh();
    override = tomorrowSays(-9999, 1);
    const s = await tick(req({ place: p, keys: { tomorrow: 'k' } }));
    expect(s.forecast!.hours[0].tempF).toBe(50);
    const log = await safeguardLog(p);
    const hit = log.find(e => e.rule === 'out_of_range')!;
    expect(hit).toMatchObject({ source: 'tomorrow', field: 'temperature', sample: '-9999°C' });
    expect(hit.why).toMatch(/Tomorrow\.io sent a temperature of -17966°F/);
    expect(hit.action).toMatch(/assembled snapshot contains a replacement/);
  });

  it('quarantines a whole bad response, keeps the last good one and shows no bad number', async () => {
    const p = fresh();
    await tick(req({ place: p, keys: { tomorrow: 'k' } }));
    const before = (await tick(req({ place: p, keys: { tomorrow: 'k' } }))).forecast!.hours[0].tempF;
    override = tomorrowSays(9000);
    vi.setSystemTime(T0 + 3 * H);
    const s = await tick(req({ place: p, keys: { tomorrow: 'k' }, manual: true }));
    expect(s.forecast!.hours.every(h => h.tempF > 0 && h.tempF < 130)).toBe(true);
    expect(before).toBeLessThan(130);
    expect((await safeguardLog(p)).find(e => e.rule === 'response_quarantined')?.outcome).toBe('kept_last_good');
  });

  it('logs an unreadable response and carries on', async () => {
    const p = fresh();
    override = u => (u.includes('api.tomorrow.io') ? ok({ surprise: true }) : (null as unknown as Response));
    const s = await tick(req({ place: p, keys: { tomorrow: 'k' } }));
    expect(s.forecast).not.toBeNull();
    expect((await safeguardLog(p)).some(e => e.rule === 'unreadable_response')).toBe(true);
  });

  it('skips an impossible station reading and logs it', async () => {
    const p = fresh();
    override = u => (u.includes('/observations/latest') ? ok({ properties: { timestamp: iso(Date.now()), textDescription: 'Clear', temperature: { value: 500, qualityControl: 'V' } } }) : (null as unknown as Response));
    const s = await tick(req({ place: p }));
    expect(s.now?.kind).toBe('forecast');
    expect((await safeguardLog(p)).map(e => e.rule)).toContain('station_rejected');
  });

  it('warns when the shown forecast is old, and logs that', async () => {
    const p = fresh();
    await tick(req({ place: p }));
    override = () => { throw new Error('offline'); };
    vi.setSystemTime(T0 + 3 * H);
    const s = await tick(req({ place: p }));
    expect(s.staleSince).toBe(T0);
    expect((await safeguardLog(p)).map(e => e.rule)).toContain('stale_forecast');
  });

  it('shows no stale warning on a healthy forecast', async () => {
    expect((await tick(req({ place: fresh() }))).staleSince).toBeNull();
  });

  it('shows blank wind, never 0, when no source has it', async () => {
    const p = fresh();
    override = u => (u.endsWith('/forecast/hourly') ? ok({ properties: { updateTime: iso(Date.now() - H), periods: periods().map(x => ({ ...x, windSpeed: '' })) } }) : (null as unknown as Response));
    const s = await tick(req({ place: p }));
    expect(s.forecast!.hours[0].windMph).toBeNull();
    expect((await safeguardLog(p)).find(e => e.rule === 'blank_value' && e.field === 'wind speed')?.action).toMatch(/instead of showing 0 mph/);
  });

  it('labels a rain chance that is not a normal hourly chance', async () => {
    override = u => (u.includes('/points/') ? new Response('{}', { status: 404 }) : u.includes('weatherapi') ? ok({
      location: { tz_id: 'UTC' },
      forecast: { forecastday: [{ date: '2026-11-05', day: { maxtemp_c: 12, mintemp_c: 2, condition: { text: 'Rain' } }, hour: Array.from({ length: 30 }, (_, i) => ({ time_epoch: (hourStart + i * H) / 1000, temp_c: 8, chance_of_rain: 60, condition: { text: 'Rain' } })) }] },
    }) : (null as unknown as Response));
    const s = await tick(req({ place: fresh(), keys: { weatherapi: 'k' } }));
    expect(s.forecast!.hours[0]).toMatchObject({ pop: 60, popKind: 'rain', windMph: null });
  });

  it('includes the safeguards in the export', async () => {
    const p = fresh();
    override = tomorrowSays(-9999, 1);
    await tick(req({ place: p, keys: { tomorrow: 'k' } }));
    expect(await accuracyExport(p)).toContain('"event_type":"safeguard"');
  });
});

describe('accuracy log', () => {
  it('saves forecasts without any extra provider calls', async () => {
    const p = fresh();
    await tick(req({ place: p, keys: { tomorrow: 'k' } }));
    const before = calls.length;
    await new Promise(r => setImmediate(r));
    expect(calls.length).toBe(before);
    expect(calls.some(u => u.includes('/observations?'))).toBe(false);
    expect((await accuracyExport(p)).split('\n').some(l => l.includes('"source":"blend"'))).toBe(true);
  });

  it('skips the log entirely in a hidden tab', async () => {
    const p = fresh();
    await tick(req({ place: p, background: true }));
    expect(JSON.parse((await accuracyExport(p)).trim())).toMatchObject({ event_type: 'audit_health', payload: { status: 'unknown' } });
  });

  it('catches up on station readings once an hour and scores what it saved', async () => {
    const p = fresh();
    await tick(req({ place: p }));
    vi.setSystemTime(T0 + 4 * H);
    await tick(req({ place: p }));
    const history = () => calls.filter(u => u.includes('/observations?')).length;
    expect(history()).toBe(1);
    vi.setSystemTime(T0 + 4 * H + 5 * 60_000);
    await tick(req({ place: p }));
    expect(history()).toBe(1);
    const r = await accuracyReport(p);
    expect(r.temperature.nws['1-6h'].n).toBeGreaterThan(0);
    expect(r.maturity).toBe('collecting');
    expect(r.comparison).toBeNull();
  });

  it('never lets a logging failure break the forecast', async () => {
    override = u => (u.includes('/observations?') ? new Response('{}', { status: 500 }) : (null as unknown as Response));
    const p = fresh();
    await tick(req({ place: p }));
    vi.setSystemTime(T0 + 2 * H);
    const s = await tick(req({ place: p }));
    expect(s.forecast).not.toBeNull();
  });
});

describe('revisions', () => {
  const b = (over: Partial<Batch>): Batch => ({
    provider: 'nws', product: 'hourly', apiVersion: 'v1', mapping: 1, issuedAt: 100, fetchedAt: 100, availableAt: 100, firstSeenAt: 100, fingerprint: 'a',
    semantics: { pop: null, wind: null, stepHours: 1, maxInterpHours: 0, days: null }, points: [], days: [], fact: null, flags: [], ...over,
  });

  it('a late response cannot overwrite a newer run', () => {
    const newer = b({ issuedAt: 200, fingerprint: 'new' });
    expect(mergeBatch(newer, b({ issuedAt: 100, fingerprint: 'old', fetchedAt: 300 })).batch).toBe(newer);
  });

  it('an unchanged re-fetch keeps its issue age and first-seen time', () => {
    const out = mergeBatch(b({ firstSeenAt: 50 }), b({ fetchedAt: 900, firstSeenAt: 900 }));
    expect(out.changed).toBe(false);
    expect(out.batch).toMatchObject({ firstSeenAt: 50, issuedAt: 100, fetchedAt: 900 });
  });
});
