import { describe, expect, it } from 'vitest';
import { condOf, fingerprint, nws, openweather, tomorrow, weatherapi } from './adapters';
import { fToC, kToC, mphToMs, pct } from './units';

const ctx = { fetchedAt: 0, timeZone: 'America/Chicago' };

// Shape recorded from api.weather.gov on 2026-11-05.
const nwsHourly = { properties: {
  updateTime: '2026-11-05T06:21:08+00:00', generatedAt: '2026-11-05T06:46:20+00:00', elevation: { unitCode: 'wmoUnit:m', value: 180.1 },
  periods: [{
    number: 1, name: '', startTime: '2026-11-05T00:00:00-06:00', endTime: '2026-11-05T01:00:00-06:00', isDaytime: false,
    temperature: 53, temperatureUnit: 'F', probabilityOfPrecipitation: { unitCode: 'wmoUnit:percent', value: 35 },
    dewpoint: { unitCode: 'wmoUnit:degC', value: 8.33 }, windSpeed: '15 mph', windDirection: 'WSW', shortForecast: 'Areas Of Drizzle', detailedForecast: '',
  }, {
    number: 2, name: '', startTime: '2026-11-05T01:00:00-06:00', endTime: '2026-11-05T02:00:00-06:00', isDaytime: false,
    temperature: 52, temperatureUnit: 'F', probabilityOfPrecipitation: { value: null }, dewpoint: { value: null }, windSpeed: '5 to 10 mph', windDirection: 'XX', shortForecast: 'Cloudy', detailedForecast: '',
  }],
} };

const nwsObs = { properties: {
  timestamp: '2026-11-05T06:53:00+00:00', textDescription: 'Cloudy',
  temperature: { unitCode: 'wmoUnit:degC', value: 11.7, qualityControl: 'V' }, dewpoint: { value: 8.9, qualityControl: 'V' },
  windDirection: { value: 240 }, windSpeed: { unitCode: 'wmoUnit:km_h-1', value: 22.32 }, windGust: { value: null }, visibility: { value: 16090, qualityControl: 'C' },
} };

describe('conversions', () => {
  it('maps 80 percent to .8 and keeps missing null', () => {
    expect(pct(80)).toBe(.8);
    expect(pct(null)).toBeNull();
    expect(pct(120)).toBe(1.2); // left for the safeguards to catch and log
  });
  it('converts Kelvin, Fahrenheit and mph', () => {
    expect(kToC(273.15)).toBe(0);
    expect(fToC(212)).toBe(100);
    expect(mphToMs(100)).toBeCloseTo(44.704);
  });
});

describe('NWS', () => {
  const n = nws.normalize('hourly', nwsHourly, ctx);
  it('normalizes hourly data and uses its own issue time', () => {
    expect(n.issuedAt).toBe(Date.parse('2026-11-05T06:21:08+00:00'));
    expect(n.elevationM).toBeCloseTo(180.1);
    expect(n.points[0]).toMatchObject({ pop: .35, dewC: 8.33, windDeg: 247.5, cond: 'rain' });
    expect(n.points[0].tempC).toBeCloseTo(fToC(53));
    expect(n.points[0].windMs).toBeCloseTo(mphToMs(15));
  });
  it('keeps nulls null and averages a range', () => {
    expect(n.points[1]).toMatchObject({ pop: null, dewC: null, windDeg: null });
    expect(n.points[1].windMs).toBeCloseTo(mphToMs(7.5));
  });
  it('dates an observation by when it was observed, not fetched', () => {
    const o = nws.normalize('observation', nwsObs, { fetchedAt: 9e12 });
    expect(o.fact).toMatchObject({ kind: 'observation', at: Date.parse('2026-11-05T06:53:00+00:00'), tempC: 11.7, gustMs: null });
    expect(o.fact!.windMs).toBeCloseTo(6.2);
  });
  it('rejects a temperature that failed quality control', () => {
    const bad = { properties: { ...nwsObs.properties, temperature: { value: 90, qualityControl: 'X' } } };
    expect(nws.normalize('observation', bad, ctx).fact?.tempC).toBeNull();
  });
  it('treats a 404 as coverage, not an outage', () => {
    expect(nws.classifyError(404, null).kind).toBe('coverage');
    expect(nws.classifyError(503, null).kind).toBe('server');
  });
});

describe('OpenWeather', () => {
  const raw = { list: [{ dt: 1_800_000_000, main: { temp: 283.15 }, weather: [{ description: 'light rain' }], clouds: { all: 75 }, wind: { speed: 4, deg: 200, gust: 7 }, pop: .4, sys: { pod: 'd' } }] };
  const n = openweather.normalize('forecast', raw, ctx);
  it('converts Kelvin and marks a 3 hour interval', () => {
    expect(n.points[0].tempC).toBeCloseTo(10);
    expect(n.points[0].end - n.points[0].start).toBe(3 * 3_600_000);
    expect(n.points[0]).toMatchObject({ pop: .4, cloud: .75, cond: 'rain', isDay: true });
  });
  it('declares what the fields mean and that the issue time is unknown', () => {
    expect(n.issuedAt).toBeNull();
    expect(n.flags).toContain('issue_age_unknown');
    expect(n.semantics.pop).toBe('any_precip_3h');
  });
  it('builds a key-bearing URL only inside the plan', () => {
    expect(openweather.plan('forecast', { lat: 1, lon: 2, key: 'a b' }).url).toContain('appid=a%20b');
  });
});

describe('Tomorrow.io', () => {
  const raw = { timelines: {
    hourly: [{ time: '2026-11-05T18:00:00Z', values: { temperature: 9, dewPoint: 4, windSpeed: 3, windDirection: 10, windGust: 6, precipitationProbability: 20, cloudCover: 50, weatherCode: 4001 } }],
    daily: [{ time: '2026-11-05T12:00:00Z', values: { temperatureMax: 12, temperatureMin: 3, weatherCodeMax: 1001 } }],
  } };
  it('maps hourly and dates daily rows in the place’s time zone', () => {
    const n = tomorrow.normalize('forecast', raw, ctx);
    expect(n.points[0]).toMatchObject({ tempC: 9, pop: .2, cond: 'rain', text: 'rain' });
    expect(n.days[0]).toMatchObject({ date: '2026-11-05', hiC: 12, loC: 3 });
    expect(n.semantics.days).toBe('calendar');
  });
  it('tells an entitlement failure from a bad key', () => {
    expect(tomorrow.classifyError(403, { message: 'requires a premium plan' }).kind).toBe('entitlement');
    expect(tomorrow.classifyError(401, null).kind).toBe('auth');
  });
});

describe('WeatherAPI', () => {
  const raw = {
    location: { tz_id: 'America/Chicago' },
    current: { last_updated_epoch: 1_800_000_000, temp_c: 8, wind_kph: 36, wind_degree: 90, condition: { text: 'Light rain' } },
    forecast: { forecastday: [{
      date: '2026-11-05', day: { maxtemp_c: 12, mintemp_c: 2, condition: { text: 'Sunny' } },
      hour: [{ time_epoch: 1_800_000_000, temp_c: 8, dewpoint_c: 4, wind_kph: 36, wind_degree: 90, gust_kph: 54, chance_of_rain: 60, chance_of_snow: 10, will_it_rain: 1, cloud: 80, condition: { text: 'Patchy rain nearby' }, is_day: 1 }],
    }] },
  };
  const n = weatherapi.normalize('forecast', raw, ctx);
  it('takes current, hourly and daily from one bundled call', () => {
    expect(weatherapi.plan('current', { lat: 1, lon: 2, key: 'k' }).covers).toEqual(['forecast', 'current']);
    expect(n.fact).toMatchObject({ kind: 'analysis', at: 1_800_000_000_000, tempC: 8 });
    expect(n.points[0].windMs).toBeCloseTo(10);
    expect(n.days[0].hiC).toBe(12);
  });
  it('treats chance_of_rain as rain only and never uses the yes/no flag as a probability', () => {
    expect(n.points[0].pop).toBe(.6);
    expect(n.semantics.pop).toBe('rain_only_1h');
  });
  it('leaves wind support unresolved because hourly wind is documented as a maximum', () => {
    expect(n.semantics.wind).toBe('unresolved');
  });
  it('reads the error body, not just the status', () => {
    expect(weatherapi.classifyError(403, { error: { code: 2007 } }).kind).toBe('quota');
    expect(weatherapi.classifyError(403, { error: { code: 2009 } }).kind).toBe('entitlement');
    expect(weatherapi.classifyError(401, { error: { code: 2006 } }).kind).toBe('auth');
  });
});

describe('content fingerprint', () => {
  it('ignores metadata and spots real change', () => {
    const a = nws.normalize('hourly', nwsHourly, ctx);
    const b = nws.normalize('hourly', { properties: { ...nwsHourly.properties, generatedAt: 'later', updateTime: '2026-11-05T07:21:08+00:00' } }, ctx);
    expect(fingerprint(a)).toBe(fingerprint(b));
    expect(fingerprint({ ...a, points: [{ ...a.points[0], tempC: 1 }] })).not.toBe(fingerprint(a));
  });
  it('classifies conditions without guessing', () => {
    expect(condOf('Freezing Rain')).toBe('freezing');
    expect(condOf('Chance Thunderstorms')).toBe('thunder');
    expect(condOf('')).toBe('unknown');
  });
});
