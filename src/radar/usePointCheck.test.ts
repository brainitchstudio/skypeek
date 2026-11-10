import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Geometry } from 'geojson';
import type { WeatherAlert } from '@/lib/types';
import type { StormFeed, StormObject } from '@/lib/probSevere';
import type { PointHour } from '@/api/weather';
import { remaining } from '@/api/budget';
import { loadSpotData, resolveStormObject, resolveWarning, shouldStartLoad } from './usePointCheck';

vi.mock('@/api/budget', () => ({ remaining: vi.fn(() => 100) }));

const MIN = 60_000, HOUR = 60 * MIN, NOW = 1_000_000_000, SCAN = NOW - 5 * MIN;
const spot = { lat: 40, lon: -90 };
const MI_PER_DEG = 69.17;
const object = (o: Partial<StormObject> = {}): StormObject => ({
  id: '77', at: NOW, ring: [[-90.6, 39.9], [-90.4, 39.9], [-90.4, 40.1], [-90.6, 40.1], [-90.6, 39.9]], center: { lat: 40, lon: -90.5 }, sizeKm2: 100, drift: { eastMps: 13.41, northMps: 0 },
  dbz: 50, vil: 20, hailIn: 1, probSevere: 10, probHail: 5, probWind: 5, probTor: 1, past: [], ...o,
});
const covering = (p: { lat: number; lon: number }): Geometry => ({
  type: 'Polygon', coordinates: [[[p.lon - 1, p.lat - 1], [p.lon + 1, p.lat - 1], [p.lon + 1, p.lat + 1], [p.lon - 1, p.lat + 1], [p.lon - 1, p.lat - 1]]],
});
const warning = (o: Partial<WeatherAlert> = {}): WeatherAlert => ({
  id: 'w1', title: 'Severe Thunderstorm Warning', level: 'Warning', color: '', fg: '', when: '', until: '', area: '', sender: '', body: '', todo: [],
  timeline: { left: '', width: '', now: '', ticks: [] }, geometry: null, endsAt: null, cancelled: false, ...o,
});
// A line 20 miles west of the spot moving east at 60 mph, reported at NOW.
const lat = (mi: number) => spot.lat + mi / MI_PER_DEG;
const lon = (mi: number) => spot.lon + mi / (MI_PER_DEG * Math.cos((spot.lat * Math.PI) / 180));
const lineHeadingAtSpot20MinAway = `${new Date(NOW).toISOString()}...storm...270DEG...52KT...${lat(-5)},${lon(-20)} ${lat(5)},${lon(-20)}`;

const ok = <T,>(v: T) => async () => v;
const fails = (m: string) => async () => { throw new Error(m); };
const pending = () => new Promise<never>(() => {});
const never = new AbortController().signal;
const hour: PointHour = { startTime: '', tempF: 70, wind: '', rainPct: null, condition: '' };
const forecast = { run: NOW, steps: [] };

describe('resolveStormObject', () => {
  const ID = '77';
  const at = (when: number): StormFeed => ({ at: when, storms: [] });
  const last = object({ at: NOW - 5 * MIN });
  const newest = object({ at: NOW });
  const seen = NOW - 5 * MIN;
  const run = (feed: StormFeed | null, fresh: boolean, goneAt: number | null = null, alerts: WeatherAlert[] | null = []) => resolveStormObject(ID, last, feed, fresh, seen, goneAt, alerts, spot, NOW);

  it('tracks the newest object for the ID', () => {
    expect(run({ at: NOW, storms: [newest] }, true)).toMatchObject({ state: 'tracking', storm: newest, stale: false });
  });
  it('never goes back to an older object', () => {
    expect(resolveStormObject(ID, newest, { at: NOW, storms: [last] }, true, seen, null, [], spot, NOW)).toMatchObject({ storm: newest });
  });
  it('is gone when a good newer feed lacks the ID', () => {
    expect(run(at(NOW), true)).toMatchObject({ state: 'gone', asOf: NOW, storm: last });
  });
  it('keeps the last object as stale when the fetch fails', () => {
    expect(run(at(seen), false)).toMatchObject({ state: 'tracking', storm: last, stale: true });
  });
  it('stays gone when a later fetch fails', () => {
    expect(run(at(NOW), false, NOW - MIN)).toMatchObject({ state: 'gone', asOf: NOW - MIN, storm: last });
  });
  it('tracks again when a good feed lists the ID', () => {
    expect(run({ at: NOW, storms: [newest] }, true, NOW - MIN)).toMatchObject({ state: 'tracking', storm: newest });
  });
  it('is not gone before a newer feed arrives', () => {
    expect(run(at(seen), true).state).toBe('tracking');
  });
  it('has no arrival before a pin', () => {
    expect(resolveStormObject(ID, last, { at: NOW, storms: [newest] }, true, seen, null, [], null, NOW)).toMatchObject({ state: 'tracking', arrival: null });
  });
  it('keeps the last answer for this spot when the fetch fails, without sliding the outline further', () => {
    const answer = { level: 'possible', headline: 'Possible, around 3:40 PM', reported: 'r', observed: 'o', path: 'p', warning: 'w', earliest: NOW } as const;
    const track = resolveStormObject(ID, last, at(seen), false, seen, null, [], spot, NOW + 40 * MIN, { spot, arrival: answer });
    expect(track).toMatchObject({ state: 'tracking', stale: true, arrival: answer });
  });
  it('gives no answer for a new pin while the fetch is failing', () => {
    const answer = { level: 'possible', headline: 'x', reported: 'r', observed: 'o', path: 'p', warning: 'w', earliest: NOW } as const;
    const moved = { lat: 41, lon: -90 };
    expect(resolveStormObject(ID, last, at(seen), false, seen, null, [], moved, NOW, { spot, arrival: answer })).toMatchObject({ state: 'tracking', stale: true, arrival: null });
  });
  it('passes failed warnings through as unavailable', () => {
    expect(run({ at: NOW, storms: [newest] }, true, null, null)).toMatchObject({ arrival: { warning: 'Warning status unavailable' } });
  });
});

describe('resolveWarning', () => {
  it('reports inside and end from the warning alone', () => {
    expect(resolveWarning(warning({ endsAt: NOW + HOUR, geometry: covering(spot) }), false, spot, NOW, NOW)).toMatchObject({ state: 'active', inside: true, afterEnd: false });
  });
  it('has no inside answer without a polygon', () => {
    expect(resolveWarning(warning({ geometry: null }), false, spot, NOW, NOW)).toMatchObject({ inside: null });
    expect(resolveWarning(warning({ geometry: { type: 'Point', coordinates: [-90, 40] } }), false, spot, NOW, NOW)).toMatchObject({ inside: null });
  });
  it('ends on cancellation, even when the lookup failed', () => {
    expect(resolveWarning(warning({ cancelled: true }), false, spot, NOW, null).state).toBe('ended');
    expect(resolveWarning(warning({ cancelled: true }), true, spot, NOW, null).state).toBe('ended');
  });
  it('ends by time only when a lookup at or after the end returned this version', () => {
    expect(resolveWarning(warning({ endsAt: NOW - 1 }), false, spot, NOW, NOW).state).toBe('ended');
    expect(resolveWarning(warning({ endsAt: NOW }), false, spot, NOW, NOW).state).toBe('ended');
  });
  it('keeps a past end active before a lookup returns or when the lookup came before the end', () => {
    expect(resolveWarning(warning({ endsAt: NOW - 1 }), false, spot, NOW, null).state).toBe('active');
    expect(resolveWarning(warning({ endsAt: NOW - 1 }), false, spot, NOW, NOW - MIN).state).toBe('active');
  });
  it('never ends a warning by time because a lookup failed', () => {
    expect(resolveWarning(warning({ endsAt: NOW - 1 }), true, spot, NOW, NOW - MIN)).toMatchObject({ state: 'active', stale: true });
    expect(resolveWarning(warning({ endsAt: NOW + HOUR }), true, spot, NOW, null)).toMatchObject({ state: 'active', stale: true });
  });
  it('stays ended when a later lookup fails after one confirmed the end', () => {
    expect(resolveWarning(warning({ endsAt: NOW - MIN }), true, spot, NOW, NOW - 1).state).toBe('ended');
    expect(resolveWarning(warning({ endsAt: NOW - MIN }), true, spot, NOW, NOW - MIN).state).toBe('ended');
  });
  it('never ends a warning by time when it has no end', () => {
    expect(resolveWarning(warning({ endsAt: null }), false, spot, NOW, NOW).state).toBe('active');
  });
  it('notes a crossing after the warning ends', () => {
    const w = warning({ endsAt: NOW + 10 * MIN, motionText: lineHeadingAtSpot20MinAway });
    expect(resolveWarning(w, false, spot, NOW, NOW)).toMatchObject({ afterEnd: true, approach: { kind: 'crossing' }, motionAt: NOW, onePoint: false });
  });
  it('flags one-point motion', () => {
    const w = warning({ motionText: `${new Date(NOW).toISOString()}...storm...270DEG...52KT...${lat(0)},${lon(-20)}` });
    expect(resolveWarning(w, false, spot, NOW, NOW)).toMatchObject({ onePoint: true, motionAt: NOW });
  });
  it('keeps official facts when motion will not parse', () => {
    expect(resolveWarning(warning({ motionText: 'nonsense', endsAt: NOW + HOUR }), false, spot, NOW, NOW)).toMatchObject({ state: 'active', approach: null, afterEnd: false, motionAt: null });
  });
});

describe('loadSpotData', () => {
  beforeEach(() => vi.mocked(remaining).mockReturnValue(100));
  it('keeps each section apart', async () => {
    const r = await loadSpotData(spot, SCAN, NOW, never, { forecast: fails('HRRR down'), hour: ok(hour), alerts: ok([]) });
    expect(r.forecast).toEqual({ state: 'unavailable', reason: 'HRRR down' });
    expect(r.hour.state).toBe('ready');
  });
  it('says the NWS forecast is unavailable when the hour fails', async () => {
    const r = await loadSpotData(spot, SCAN, NOW, never, { forecast: ok(forecast), hour: fails('x'), alerts: ok([]) });
    expect(r.hour).toEqual({ state: 'unavailable', reason: 'NWS forecast unavailable' });
  });
  it('says warning status is unavailable, never none', async () => {
    const r = await loadSpotData(spot, SCAN, NOW, never, { forecast: ok(forecast), hour: ok(hour), alerts: fails('down') });
    expect(r.warnings).toEqual({ state: 'unavailable', reason: 'Warning status unavailable' });
  });
  it('lists warnings only', async () => {
    const list = [warning({ id: 'a' }), warning({ id: 'b', level: 'Advisory' })];
    const r = await loadSpotData(spot, SCAN, NOW, never, { forecast: ok(forecast), hour: ok(hour), alerts: ok(list) });
    expect(r.warnings).toEqual({ state: 'ready', value: [list[0]] });
  });
  it('reports the alert budget', async () => {
    vi.mocked(remaining).mockReturnValue(0);
    const alerts = vi.fn(ok([]));
    const r = await loadSpotData(spot, SCAN, NOW, never, { forecast: ok(forecast), hour: ok(hour), alerts });
    expect(r.warnings).toEqual({ state: 'unavailable', reason: 'Warning request budget reached' });
    expect(alerts).not.toHaveBeenCalled();
  });
  it('publishes each section as it settles', async () => {
    let release: (h: PointHour) => void = () => {};
    const slow = new Promise<PointHour>(r => { release = r; });
    const seen: string[] = [];
    const load = loadSpotData(spot, SCAN, NOW, never, { forecast: ok(forecast), hour: () => slow, alerts: ok([]) }, p => seen.push(...Object.keys(p)));
    await new Promise(r => setTimeout(r, 0));
    expect(seen.sort()).toEqual(['forecast', 'warnings']);
    release(hour);
    await load;
    expect(seen.sort()).toEqual(['forecast', 'hour', 'warnings']);
  });
  it('publishes nothing after an abort', async () => {
    const abort = new AbortController();
    const seen: string[] = [];
    const load = loadSpotData(spot, SCAN, NOW, abort.signal, { forecast: async () => { abort.abort(); return forecast; }, hour: pending, alerts: pending }, p => seen.push(...Object.keys(p)));
    await expect(load).rejects.toThrow();
    expect(seen).toEqual([]);
  });
  it('rejects when aborted so an old pin cannot win', async () => {
    const abort = new AbortController();
    const load = loadSpotData(spot, SCAN, NOW, abort.signal, { forecast: pending, hour: pending, alerts: pending });
    abort.abort();
    await expect(load).rejects.toThrow();
  });
});

describe('shouldStartLoad', () => {
  it('lets a refresh skip a load running for the same spot and scan', () => {
    expect(shouldStartLoad({ spot, scan: SCAN }, spot, SCAN)).toBe(false);
    expect(shouldStartLoad(null, spot, SCAN)).toBe(true);
    expect(shouldStartLoad({ spot, scan: SCAN }, { ...spot }, SCAN)).toBe(true);
  });
  it('starts a load for a new scan', () => {
    expect(shouldStartLoad({ spot, scan: SCAN }, spot, SCAN + 5 * MIN)).toBe(true);
  });
});
