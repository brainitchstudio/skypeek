import { describe, expect, it } from 'vitest';
import { buildReport, forecastRows, toJsonl, truthRows, RAIN_EVENT, type ForecastRow, type Source, type TruthRow } from './accuracy';
import { memoryStore } from './accuracyStore';
import type { Batch, Point, Provider, Semantics } from './types';

const HOUR = 3_600_000, DAY = 24 * HOUR;
const NOW = Date.parse('2026-11-05T18:10:00Z');
const T = Date.parse('2026-11-05T21:00:00Z');
const SCOPE = 'geo:1:1';

const SEM: Record<string, Semantics> = {
  nws: { pop: 'any_precip_1h', wind: 'mean', stepHours: 1, maxInterpHours: 0, days: null },
  weatherapi: { pop: 'rain_only_1h', wind: 'unresolved', stepHours: 1, maxInterpHours: 0, days: null },
};
const point = (start: number, tempC: number, pop = .3): Point => ({ start, end: start + HOUR, tempC, dewC: null, windMs: 5, windDeg: 0, gustMs: null, pop, cloud: null, cond: 'cloudy', text: '', isDay: true });
const batch = (provider: Provider, tempC: number, availableAt = NOW): Batch => ({
  provider, product: 'forecast', apiVersion: 'x', mapping: 1, issuedAt: null, fetchedAt: availableAt, availableAt, firstSeenAt: availableAt, fingerprint: 'f',
  semantics: SEM[provider] ?? SEM.nws, points: Array.from({ length: 70 }, (_, i) => point(Math.floor(NOW / HOUR) * HOUR + i * HOUR, tempC)), days: [], fact: null, flags: [],
});
const c = (now = NOW) => ({ now, nwsCovers: true, event: false });

const row = (source: Source, tempC: number | null, over: Partial<ForecastRow> = {}): ForecastRow => {
  const target = over.target ?? T, lead = over.lead ?? 1;
  return { id: `${SCOPE}|${target}|${lead}|${source}`, scope: SCOPE, target, lead, source, tempC, windMs: null, pop: null, capturedAt: target - lead * HOUR - 60_000, availableAt: target - 2 * lead * HOUR, issuedAt: null, interpolated: false, fusionVersion: 'fusion-v1', ...over };
};
const obs = (target: number, tempC: number | null, over: Partial<TruthRow> = {}): TruthRow => ({ id: `${target}`, scope: SCOPE, target, stationId: 'KAAA', distanceKm: 5, tempC, windMs: null, wet: null, rainEvent: RAIN_EVENT, reports: 3, availableAt: target + HOUR, ...over });
const report = (f: ForecastRow[], t: TruthRow[], now = T + 3 * HOUR, trackingStart: number | null = T - DAY) => buildReport(f, t, { now, days: 30, trackingStart, fusionVersion: 'fusion-v1' });

describe('capturing forecasts', () => {
  const rows = forecastRows(SCOPE, [batch('nws', 10), batch('tomorrow', 20)], c());

  it('saves a slot only while the target is at least its lead away', () => {
    expect(rows.every(r => r.target - r.lead * HOUR >= NOW)).toBe(true);
    expect(rows.find(r => r.target === T && r.lead === 3)).toBeUndefined(); // 2 h 50 m away
    expect(rows.find(r => r.target === T && r.lead === 1)).toBeDefined();
  });

  it('records each source and a blend, with no invented issue time', () => {
    const at = rows.filter(r => r.target === T && r.lead === 1);
    expect(at.map(r => r.source).sort()).toEqual(['blend', 'nws', 'tomorrow']);
    expect(at.find(r => r.source === 'blend')).toMatchObject({ issuedAt: null });
  });

  it('cannot improve a frozen slot with a later forecast', async () => {
    const store = memoryStore();
    await store.putForecasts(forecastRows(SCOPE, [batch('nws', 10)], c()));
    const after = T - 30 * 60_000; // past the 1 hour cutoff
    await store.putForecasts(forecastRows(SCOPE, [batch('nws', 99, after)], c(after)));
    const slot = (await store.forecasts(SCOPE, 0)).find(r => r.target === T && r.lead === 1 && r.source === 'nws');
    expect(slot?.tempC).toBe(10);
  });

  it('leaves off fields whose meaning does not match', () => {
    const r = forecastRows(SCOPE, [batch('weatherapi', 10)], c()).find(x => x.source === 'weatherapi')!;
    expect(r.pop).toBeNull();
    expect(r.windMs).toBeNull();
    const b = forecastRows(SCOPE, [batch('weatherapi', 10)], c()).find(x => x.source === 'blend')!;
    expect(b.pop).toBeNull();
  });

  it('saves nothing from data too old to be shown', () => {
    const stale = { ...batch('nws', 10), issuedAt: NOW - 20 * HOUR };
    expect(forecastRows(SCOPE, [stale], c())).toEqual([]);
  });
});

describe('building truth from observations', () => {
  const at = (ms: number, p: object = {}) => ({ properties: { timestamp: new Date(ms).toISOString(), temperature: { value: 10, qualityControl: 'V' }, windSpeed: { value: 36 }, textDescription: 'Cloudy', presentWeather: [], ...p } });
  const station = { id: 'KAAA', distanceKm: 5 };
  const win = { from: T - HOUR, now: T + 2 * HOUR };

  it('uses the reading nearest the hour, within 10 minutes', () => {
    const rows = truthRows(SCOPE, station, [at(T - 9 * 60_000, { temperature: { value: 7 } }), at(T + 30 * 60_000, { temperature: { value: 30 } }), at(T + 40 * 60_000)], win);
    expect(rows.find(r => r.target === T)).toMatchObject({ tempC: 7, windMs: 10 });
  });

  it('leaves temperature empty rather than stretching to a far reading', () => {
    const rows = truthRows(SCOPE, station, [at(T + 20 * 60_000), at(T + 40 * 60_000)], win);
    expect(rows.find(r => r.target === T)?.tempC).toBeNull();
  });

  it('rejects readings that failed quality control', () => {
    const rows = truthRows(SCOPE, station, [at(T, { temperature: { value: 60, qualityControl: 'X' } })], win);
    expect(rows.find(r => r.target === T)?.tempC ?? null).toBeNull();
  });

  it('calls an hour wet on any report, dry only on enough explicit reports, otherwise unknown', () => {
    const wet = truthRows(SCOPE, station, [at(T + 60_000, { presentWeather: [{ weather: 'rain' }] })], win);
    expect(wet.find(r => r.target === T)?.wet).toBe(true);
    const dry = truthRows(SCOPE, station, [at(T + 60_000), at(T + 40 * 60_000)], win);
    expect(dry.find(r => r.target === T)?.wet).toBe(false);
    const thin = truthRows(SCOPE, station, [at(T + 60_000)], win);
    expect(thin.find(r => r.target === T)?.wet).toBeNull();
  });

  it('never turns a missing rain measurement into zero rain', () => {
    const rows = truthRows(SCOPE, station, [at(T + 60_000, { presentWeather: undefined, precipitationLastHour: { value: null } }), at(T + 30 * 60_000, { presentWeather: undefined })], win);
    expect(rows.find(r => r.target === T)?.wet).toBeNull();
  });

  it('skips an hour the fetch window only partly saw', () => {
    const rows = truthRows(SCOPE, station, [at(T + 40 * 60_000), at(T + 50 * 60_000)], { from: T + 30 * 60_000, now: T + 2 * HOUR });
    expect(rows.filter(r => r.target === T)).toEqual([]);
  });

  it('waits for an hour to finish', () => {
    expect(truthRows(SCOPE, station, [at(T + 60_000)], { from: T - HOUR, now: T + 30 * 60_000 }).filter(r => r.target === T)).toEqual([]);
  });
});

describe('report', () => {
  it('scores with forecast minus observed, and computes MAE, bias and RMSE from sums', () => {
    const t2 = T + HOUR;
    const r = report([row('nws', 12), row('nws', 6, { target: t2 })], [obs(T, 10), obs(t2, 10)]);
    expect(r.temperature.nws['1-6h']).toEqual({ n: 2, bias: -1, mae: 3, rmse: Math.sqrt(10) });
  });

  it('gives null, not zero error, with no pairs', () => {
    const r = report([row('nws', 12)], []);
    expect(r.temperature.nws).toBeUndefined();
    expect(r.coverage.paired).toBe(0);
    expect(r.comparison).toBeNull();
  });

  it('counts missing forecasts and truth against a declared set of hours', () => {
    const r = report([row('nws', 12)], [obs(T, 10), obs(T - HOUR, 10)], T + 3 * HOUR, T - 5 * HOUR);
    expect(r.coverage).toMatchObject({ expected: 7, withForecast: 1, withTruth: 2, paired: 1 });
  });

  it('marks hours still inside the observation grace period as pending', () => {
    expect(report([row('nws', 12)], [], T + 30 * 60_000).coverage.pending).toBe(1);
  });

  it('does not score an hour until it leaves the grace period, so counts and scores agree', () => {
    const r = report([row('nws', 12)], [obs(T, 10, { availableAt: T + 20 * 60_000 })], T + 30 * 60_000);
    expect(r.temperature.nws).toBeUndefined();
    expect(r.independentDays).toBe(0);
    expect(r.coverage).toMatchObject({ paired: 0, pending: 1 });
  });

  it('ignores any row captured after its cutoff', () => {
    const late = row('nws', 10, { capturedAt: T - 30 * 60_000 });
    expect(report([late], [obs(T, 10)]).temperature.nws).toBeUndefined();
  });

  it('reconstructs an earlier report: late truth and rows stay out', () => {
    const r = report([row('nws', 12)], [obs(T, 10, { availableAt: T + 5 * HOUR })], T + 3 * HOUR);
    expect(r.coverage.paired).toBe(0);
  });

  it('counts a duplicated upload once because rows are keyed by slot', async () => {
    const store = memoryStore();
    await store.putForecasts([row('nws', 12)]);
    await store.putForecasts([row('nws', 12)]);
    expect(await store.forecasts(SCOPE, 0)).toHaveLength(1);
  });

  it('uses the nearest station that has the value', () => {
    const r = report([row('nws', 12)], [obs(T, null, { distanceKm: 2, stationId: 'A', id: 'a' }), obs(T, 10, { distanceKm: 9, stationId: 'B', id: 'b' })]);
    expect(r.temperature.nws['1-6h'].mae).toBe(2);
  });

  it('adds an equal-weight baseline and compares sources only on shared cases', () => {
    const f = [row('blend', 11), row('nws', 12), row('tomorrow', 14), row('nws', 10.5, { target: T + HOUR })];
    const r = report(f, [obs(T, 10), obs(T + HOUR, 10)]);
    expect(r.temperature.equal['1-6h'].mae).toBe(3);
    expect(r.comparison).toMatchObject({ pairs: 1, days: 1, blendMae: 1, equalMae: 3, best: { source: 'nws', mae: 2 }, blendWonDays: 1 });
  });

  it('does not compare a single source against itself', () => {
    expect(report([row('blend', 11), row('nws', 11)], [obs(T, 10)]).comparison).toBeNull();
  });

  it('scores rain with Brier, only on hours with known truth', () => {
    const f = [row('nws', 10, { pop: .8 }), row('nws', 10, { pop: .9, target: T + HOUR })];
    const r = report(f, [obs(T, 10, { wet: true }), obs(T + HOUR, 10, { wet: null })]);
    expect(r.rain.nws.n).toBe(1);
    expect(r.rain.nws.brier).toBeCloseTo(.04);
    expect(r.rain.nws.baseRate).toBe(1);
  });

  it('says it is too early until there are enough separate days', () => {
    const days = (n: number) => Array.from({ length: n }, (_, i) => T - i * DAY);
    const at = (n: number) => report(days(n).map(t => row('nws', 11, { target: t })), days(n).map(t => obs(t, 10)), T + 3 * HOUR, T - 40 * DAY).maturity;
    expect(at(6)).toBe('collecting');
    expect(at(7)).toBe('provisional');
    expect(at(30)).toBe('comparable');
  });
});

describe('export', () => {
  it('writes one complete JSON object per line with nulls preserved', () => {
    const out = toJsonl([row('nws', null)], [obs(T, 10)], NOW).split('\n').map(l => JSON.parse(l));
    expect(out.map(l => l.event_type)).toEqual(['source_forecast', 'observation']);
    expect(out[0]).toMatchObject({ schema_version: 1, producer: 'sky-peek', payload: { tempC: null } });
  });
});

describe('experiment isolation and observation semantics', () => {
  it('rejects ambiguous mixed-location reports', () => {
    expect(() => report([row('nws', 12)], [obs(T, 10, { scope: 'another-place' })])).toThrow(/scope/);
  });
  it('does not score an unavailable forecast or a different fusion version', () => {
    const r = report([row('nws', 12, { availableAt: T }), row('blend', 12, { fusionVersion: 'other' })], [obs(T, 10)]);
    expect(r.coverage.paired).toBe(0);
  });
  it('excludes legacy rain truth whose event policy is unknown', () => {
    const r = report([row('nws', 12, { pop: .8 })], [obs(T, 10, { wet: true, rainEvent: undefined })]);
    expect(r.rain.nws).toBeUndefined();
    expect(r.coverage.paired).toBe(1);
  });
  it('does not assign hour-ending precipitation to the next hour', () => {
    const rows = truthRows(SCOPE, { id: 'KAAA', distanceKm: 5 }, [{ properties: {
      timestamp: new Date(T).toISOString(), precipitationLastHour: { value: 2 }, presentWeather: [],
      temperature: { value: 10 }, windSpeed: { value: 36, qualityControl: 'X' },
    } }], { from: T - HOUR, now: T + 2 * HOUR });
    const t = rows.find(r => r.target === T)!;
    expect(t.wet).toBeNull();
    expect(t.windMs).toBeNull();
    expect(t.rainEvent).toBe(RAIN_EVENT);
  });
});
