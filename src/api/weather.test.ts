import { afterEach, describe, expect, it, vi } from 'vitest';
import { getPointHour, restoredSource } from './weather';

vi.mock('./budget', async orig => ({ ...await orig<typeof import('./budget')>(), spend: vi.fn() }));


describe('restoredSource', () => {
  const swapped = { choice: 3, swapped: 'Tomorrow.io' };

  it('names the source when the swap ends', () => {
    expect(restoredSource(swapped, { choice: 3, swapped: null })).toBe('Tomorrow.io');
  });

  it('stays quiet while still swapped', () => {
    expect(restoredSource(swapped, swapped)).toBeNull();
  });

  it('stays quiet when the user picked a different source', () => {
    expect(restoredSource(swapped, { choice: 1, swapped: null })).toBeNull();
  });

  it('stays quiet with nothing to compare', () => {
    expect(restoredSource(null, { choice: 3, swapped: null })).toBeNull();
  });
});

describe('getPointHour', () => {
  afterEach(() => vi.unstubAllGlobals());
  function stubNws(period: Record<string, unknown>) {
    const setItem = vi.fn();
    vi.stubGlobal('localStorage', { getItem: () => null, setItem, removeItem: vi.fn() });
    vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(
      url.includes('/points/') ? { properties: { forecastHourly: `https://api.weather.gov/gridpoints/X/${url.split('/points/')[1]}/forecast/hourly` } } // unique per spot: responses are cached by URL
        : { properties: { periods: [{ startTime: new Date(Date.now() + 600_000).toISOString(), isDaytime: true, ...period }] } }))));
    return setItem;
  }
  it('reads the coming hour without saving the point', async () => {
    const setItem = stubNws({ temperature: 71, windSpeed: '12 mph', shortForecast: 'Showers', probabilityOfPrecipitation: { value: 60 } });
    expect(await getPointHour(41.1, -88.2)).toMatchObject({ tempF: 71, wind: '12 mph', rainPct: 60, condition: 'Showers' });
    expect(setItem).not.toHaveBeenCalled();
  });
  it('labels the hour in progress with its own start', async () => {
    const startTime = new Date(Date.now() - 30 * 60_000).toISOString();
    stubNws({ startTime, temperature: 71, windSpeed: '12 mph', shortForecast: 'Clear' });
    expect((await getPointHour(41.4, -88.5)).startTime).toBe(startTime);
  });
  it('gives up on a hung request', async () => {
    stubNws({ temperature: 71, windSpeed: '12 mph', shortForecast: 'Clear' });
    await getPointHour(41.5, -88.6);
    for (const [, init] of vi.mocked(fetch).mock.calls as unknown as [string, RequestInit][]) expect(init.signal).toBeInstanceOf(AbortSignal);
  });
  it('keeps a missing rain chance blank', async () => {
    stubNws({ temperature: 71, windSpeed: '12 mph', shortForecast: 'Clear', probabilityOfPrecipitation: { value: null } });
    expect((await getPointHour(41.2, -88.3)).rainPct).toBeNull();
  });
  it('refuses an impossible temperature', async () => {
    stubNws({ temperature: 400, windSpeed: '12 mph', shortForecast: 'Clear' });
    await expect(getPointHour(41.3, -88.4)).rejects.toThrow();
  });
});
