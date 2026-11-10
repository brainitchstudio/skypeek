import { afterEach, describe, expect, it, vi } from 'vitest';
import { dedupeCells, followWarning, getGrid, getPointAlerts, getStormReports, gridPoints, lightningTiles, mapStormCells, mapStormReports } from './layers';
import { RateLimitError, resetBudget } from './budget';

const NOW = Date.parse('2026-11-05T06:40:00Z');
const cell = (o: Record<string, unknown> = {}, coordinates: [number, number] = [-84, 35]) => ({
  properties: { nexrad: 'FFC', storm_id: 'O5', tvs: 'NONE', poh: 0, max_dbz: 47, drct: 236, sknt: 25, valid: '2026-11-05T06:35:00Z', ...o },
  geometry: { coordinates },
});

describe('mapStormCells', () => {
  it('turns the reported from-direction into a heading and knots into mph', () => {
    const [c] = mapStormCells([cell()], NOW);
    expect(c.heading).toBe(56);
    expect(c.mph).toBeCloseTo(28.8, 1);
    expect([c.lat, c.lon]).toEqual([35, -84]);
  });

  it('keeps the storm details', () => {
    const [c] = mapStormCells([cell({ tvs: 'TVS', meso: '2', poh: 70, max_size: 1.25 })], NOW);
    expect(c).toMatchObject({ dbz: 47, hailPct: 70, hailIn: 1.25, tornado: true, rotation: true, radar: 'FFC', at: Date.parse('2026-11-05T06:35:00Z') });
  });

  it('maps measured storm metrics and preserves zero separately from unavailable', () => {
    const [c] = mapStormCells([cell({ posh: 0, poh: 0, max_size: 0, top: 10.3, vil: 8 })], NOW);
    expect(c).toMatchObject({ severeHailPct: 0, hailPct: 0, hailIn: 0, echoTopFt: 10300, vil: 8 });
    const [missing] = mapStormCells([cell({ poh: null, max_size: -999, top: -999, vil: null, posh: null, drct: -999, sknt: -999, tvs: null })], NOW);
    expect(missing).toMatchObject({ hailPct: null, hailIn: null, echoTopFt: null, vil: null, severeHailPct: null, motionKnown: false, mph: 0, tornado: false });
  });
  it('rejects missing times, future reports, and invalid coordinates', () => {
    expect(mapStormCells([cell({ valid: 'invalid' }), cell({ valid: '2026-11-06T06:35:00Z' }), cell({}, [Infinity, 35])], NOW)).toEqual([]);
  });

  it('drops old cells', () => {
    expect(mapStormCells([cell({ valid: '2026-11-05T06:00:00Z' })], NOW)).toEqual([]);
  });

  it('keeps the strongest report when radars see the same storm', () => {
    const cells = mapStormCells([cell({ max_dbz: 40, nexrad: 'A' }), cell({ max_dbz: 50, nexrad: 'B' }, [-84.01, 35.01])], NOW);
    expect(cells.map(c => c.id)).toEqual(['B-O5']);
  });

  it('flags tornadic, hail and very strong cells as severe', () => {
    expect(mapStormCells([cell()], NOW)[0].severe).toBe(false);
    expect(mapStormCells([cell({ tvs: 'TVS' })], NOW)[0].severe).toBe(true);
    expect(mapStormCells([cell({ poh: 60 })], NOW)[0].severe).toBe(true);
    expect(mapStormCells([cell({ max_dbz: 58 })], NOW)[0].severe).toBe(true);
  });
});

const iemFeature = (o: Record<string, unknown>, coordinates: [number, number]) => cell(o, coordinates);

describe('mapStormReports', () => {
  it('keeps every report while the map removes duplicates', () => {
    const near = [iemFeature({ nexrad: 'KLOT', storm_id: 'A1', max_dbz: 50 }, [-88, 41]), iemFeature({ nexrad: 'KILX', storm_id: 'B2', max_dbz: 60 }, [-88, 41])];
    const all = mapStormReports(near, NOW);
    expect(all.map(c => c.id)).toEqual(['KLOT-A1', 'KILX-B2']);
    expect(dedupeCells(all).map(c => c.id)).toEqual(['KILX-B2']);
  });
  it('mapStormCells output is unchanged by the split', () => {
    const features = [cell({ max_dbz: 40, nexrad: 'A' }), cell({ max_dbz: 50, nexrad: 'B' }, [-84.01, 35.01]), cell({ storm_id: 'Z' }, [-90, 30])];
    expect(dedupeCells(mapStormReports(features, NOW))).toEqual(mapStormCells(features, NOW));
  });
  it('first seen wins a tie', () => {
    const tie = [cell({ nexrad: 'A', max_dbz: 50 }), cell({ nexrad: 'B', max_dbz: 50 })];
    expect(dedupeCells(mapStormReports(tie, NOW)).map(c => c.id)).toEqual(['A-O5']);
  });
});

const alertBody = (id: string, o: { replacedBy?: string; messageType?: string }) => ({
  id, type: 'Feature', geometry: null,
  properties: { id, event: 'Severe Thunderstorm Warning', areaDesc: 'Cochise', messageType: 'Alert', ...o },
});
function stubFetch(bodies: Record<string, unknown>) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const body = bodies[decodeURIComponent(url.split('/').pop()!)];
    return body ? new Response(JSON.stringify(body)) : new Response('', { status: 404 });
  }));
}

describe('followWarning', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('follows replacedBy to the newest warning', async () => {
    stubFetch({ 'urn:a': alertBody('urn:a', { replacedBy: 'https://api.weather.gov/alerts/urn:b' }), 'urn:b': alertBody('urn:b', {}) });
    expect((await followWarning('urn:a')).id).toBe('urn:b');
  });
  it('marks a cancellation', async () => {
    stubFetch({ 'urn:a': alertBody('urn:a', { messageType: 'Cancel' }) });
    expect((await followWarning('urn:a')).cancelled).toBe(true);
  });
  it('gives up after 10 replacements', async () => {
    const chain = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`urn:${i}`, alertBody(`urn:${i}`, { replacedBy: `https://api.weather.gov/alerts/urn:${i + 1}` })]));
    stubFetch(chain);
    await expect(followWarning('urn:0')).rejects.toThrow();
  });
});

describe('getPointAlerts', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('gives up on a hung request', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ features: [] })));
    vi.stubGlobal('fetch', fetchMock);
    await getPointAlerts(40, -90);
    expect((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].signal).toBeInstanceOf(AbortSignal);
  });
});

describe('gridPoints', () => {
  it('stays on round coordinates and inside the view', () => {
    const pts = gridPoints({ west: -74.3, south: 40.1, east: -73.1, north: 41.2 });
    expect(pts).toContainEqual([40.5, -74]);
    pts.forEach(([lat, lon]) => {
      expect(lat % 0.25).toBe(0);
      expect(lon).toBeGreaterThanOrEqual(-74.5);
      expect(lat).toBeLessThanOrEqual(41.5);
    });
  });

  it('caps the number of points when zoomed out', () => {
    expect(gridPoints({ west: -105, south: 25, east: -65, north: 49 }).length).toBeLessThanOrEqual(64);
  });
});

describe('radar request limits', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('identifies an Open-Meteo 429 so the radar can show its limit toast', async () => {
    resetBudget();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 429, headers: { 'retry-after': '60' } })));
    await expect(getGrid({ west: -74.3, south: 40.1, east: -73.1, north: 41.2 })).rejects.toBeInstanceOf(RateLimitError);
  });

  it('identifies an IEM 429 separately from other storm failures', async () => {
    resetBudget();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 429 })));
    await expect(getStormReports()).rejects.toBeInstanceOf(RateLimitError);
  });
});

describe('lightningTiles', () => {
  it('goes through the flat pipeline', () => {
    expect(lightningTiles(1).startsWith('flat://lightning/7/')).toBe(true);
  });
});

// Validate actual boundary values and missing/malformed input before radar rendering.
import { validRadarWeather } from './layers';
describe('radar surface guardrails', () => {
  const good = { temperature_2m: 50, wind_speed_10m: 12, wind_direction_10m: 359 };
  it('accepts valid surface data', () => expect(validRadarWeather(good)).toBe(true));
  it('rejects sentinel temperatures, missing wind, infinity, and bad directions', () => {
    expect(validRadarWeather({ ...good, temperature_2m: -9999 })).toBe(false);
    expect(validRadarWeather({ ...good, wind_speed_10m: null as unknown as number })).toBe(false);
    expect(validRadarWeather({ ...good, wind_speed_10m: Infinity })).toBe(false);
    expect(validRadarWeather({ ...good, wind_direction_10m: 361 })).toBe(false);
  });
});
