import { describe, expect, it } from 'vitest';
import { iconFor } from '@/lib/format';
import { memoryStore } from './accuracyStore';
import { fuseHour } from './fusion';
import { audit, mergeEvent, resolve, sanitize, toEvent, type Draft } from './safeguards';
import type { NwsPeriod } from '@/lib/forecast';
import { isDaylight } from './units';
import type { Batch, Point, Provider, Semantics } from './types';

const NOW = Date.parse('2026-11-05T18:00:00Z'), T = Date.parse('2026-11-05T21:00:00Z'), H = 3_600_000;
const c = { now: NOW, nwsCovers: true, event: false };
const name = (p: Provider) => p.toUpperCase();

const pt = (o: Partial<Point> = {}): Point => ({ start: T, end: T + H, tempC: 10, dewC: 2, windMs: 4, windDeg: 90, gustMs: 8, pop: .2, cloud: .5, cond: 'cloudy', text: 'Cloudy', isDay: true, ...o });
const SEM: Semantics = { pop: 'any_precip_1h', wind: 'mean', stepHours: 1, maxInterpHours: 0, days: null };
const batch = (provider: Provider, points: Point[], o: Partial<Batch> = {}): Batch => ({
  provider, product: 'forecast', apiVersion: 'x', mapping: 1, issuedAt: NOW, fetchedAt: NOW, availableAt: NOW, firstSeenAt: NOW, fingerprint: 'f', semantics: SEM, points, days: [], fact: null, flags: [], ...o,
});
const many = (n: number, o: Partial<Point> = {}) => Array.from({ length: n }, (_, i) => pt({ start: T + i * H, end: T + (i + 1) * H, ...o }));
const input = (points: Point[]) => ({ points, days: [], fact: null });

describe('the values from the audit that used to get through', () => {
  it('stops a -9999 placeholder reaching the blend', () => {
    const { clean, drafts } = sanitize(input(many(10).map((p, i) => (i ? p : { ...p, tempC: -9999 }))), 'tomorrow', 'Tomorrow.io');
    expect(clean.points[0].tempC).toBeNull();
    const out = fuseHour(T, [batch('nws', [pt()]), batch('tomorrow', clean.points)], c);
    expect(out.tempC).toBe(10);
    expect(out.sources.map(s => s.provider)).toEqual(['nws']);
    expect(drafts[0]).toMatchObject({ rule: 'out_of_range', field: 'temperature', sample: '-9999°C', source: 'tomorrow' });
  });

  it('stops impossible wind, and 0 K converted to -273°C', () => {
    expect(sanitize(input(many(10).map((p, i) => (i ? p : { ...p, windMs: 500 }))), 'tomorrow', 'T').clean.points[0].windMs).toBeNull();
    expect(sanitize({ ...input([]), fact: { kind: 'analysis', at: NOW, tempC: -273.15, dewC: null, windMs: 3, windDeg: 0, gustMs: null, visM: null, cond: 'clear', text: '', qualityFlags: [] } }, 'openweather', 'O').quarantined).toBeTruthy();
  });

  it('rejects NaN and Infinity, and a rain chance over 100%', () => {
    const { clean } = sanitize(input(many(10).map((p, i) => (i ? p : { ...p, dewC: NaN, gustMs: Infinity, pop: 1.2 }))), 'tomorrow', 'T');
    expect(clean.points[0]).toMatchObject({ dewC: null, gustMs: null, pop: null });
  });

  it('leaves real extremes alone', () => {
    const { clean, drafts } = sanitize(input([pt({ tempC: 56, windMs: 100, gustMs: 113 }), pt({ start: T + H, end: T + 2 * H, tempC: -60 })]), 'nws', 'NWS');
    expect(clean.points[0]).toMatchObject({ tempC: 56, windMs: 100 });
    expect(drafts).toEqual([]);
  });

  it('removes NWS periods with a bad temperature, since screens read those directly', () => {
    const period = (startTime: string, temperature: number, o: Partial<NwsPeriod> = {}): NwsPeriod => ({ name: '', startTime, temperature, isDaytime: true, windSpeed: '5 mph', shortForecast: '', detailedForecast: '', ...o });
    const ok = many(10);
    const { clean } = sanitize({ ...input(ok.map((p, i) => (i ? p : { ...p, tempC: -9999 }))), periods: [period(new Date(T).toISOString(), -9999), period(new Date(T + H).toISOString(), 50)] }, 'nws', 'NWS');
    expect(clean.periods?.map(p => p.temperature)).toEqual([50]);
  });

  it('blanks impossible wind and rain inside NWS periods, and logs them for daily ones', () => {
    const p: NwsPeriod = { name: '', startTime: new Date(T).toISOString(), temperature: 50, isDaytime: true, windSpeed: '900 mph', shortForecast: '', detailedForecast: '', probabilityOfPrecipitation: { value: 140 } };
    const { clean, drafts } = sanitize({ ...input([]), periods: [p] }, 'nws', 'NWS');
    expect(clean.periods![0]).toMatchObject({ windSpeed: '', probabilityOfPrecipitation: { value: null }, temperature: 50 });
    expect(drafts.map(d => d.field).sort()).toEqual(['rain chance', 'wind speed']);
  });
});

describe('quarantine', () => {
  it('throws out a response that is mostly impossible, like a unit bug', () => {
    const { quarantined, drafts, clean } = sanitize(input(many(10, { tempC: 9000 })), 'openweather', 'OpenWeather');
    expect(quarantined).toMatch(/10 of 10/);
    expect(drafts[0]).toMatchObject({ rule: 'response_quarantined', outcome: 'kept_last_good' });
    expect(clean.points[0].tempC).toBe(9000); // untouched: the caller must not store it
  });

  it('keeps the rest when only a few are bad', () => {
    expect(sanitize(input(many(20).map((p, i) => (i ? p : { ...p, tempC: 999 }))), 'nws', 'N').quarantined).toBeNull();
  });
});

describe('what was done', () => {
  const removed: Draft = { rule: 'out_of_range', source: 'tomorrow', field: 'temperature', why: 'x', action: 'x', outcome: 'fallback', target: T };

  it('records which source took over', () => {
    expect(resolve(removed, [batch('nws', [pt()]), batch('tomorrow', [pt({ tempC: null })])], c, name)).toMatchObject({ action: 'Removed the value. Recomputed fusion has a replacement for that hour; participating temperature sources: NWS. Display fallback is not independently confirmed.', outcome: 'fallback' });
  });

  it('names a source only if it actually supplied that field', () => {
    const wind = { ...removed, field: 'wind speed' };
    expect(resolve(wind, [batch('nws', [pt({ windMs: null })]), batch('tomorrow', [pt({ windMs: null })])], c, name)).toMatchObject({ outcome: 'blank' });
  });

  it('records when nothing could take over', () => {
    expect(resolve(removed, [batch('tomorrow', [pt({ tempC: null })])], c, name)).toMatchObject({ outcome: 'blank' });
  });
});

describe('audit', () => {
  const run = (bs: Batch[], o = {}) => audit(bs, c, name, { forecastShown: true, staleSince: null, alertsStale: false, ...o });
  const rules = (d: Draft[]) => d.map(x => x.rule);
  const three = { ...SEM, pop: 'any_precip_3h' as const, stepHours: 3, maxInterpHours: 3 };

  it('is silent when nothing fired', () => {
    expect(run([batch('nws', many(60))])).toEqual([]);
  });

  it('logs a source that was too old, and why', () => {
    const d = run([batch('nws', many(60)), batch('tomorrow', many(60), { issuedAt: null, firstSeenAt: NOW - 7 * H })]);
    expect(d[0]).toMatchObject({ rule: 'source_excluded', source: 'tomorrow', outcome: 'fallback' });
    expect(d[0].why).toMatch(/hasn’t changed/);
  });

  it('logs a mismatched rain chance being left out', () => {
    expect(rules(run([batch('nws', many(60)), batch('openweather', many(60), { semantics: three })]))).toContain('rain_chance_mismatch');
  });

  it('logs a rain chance shown with a label', () => {
    expect(run([batch('openweather', many(60), { semantics: three })]).find(x => x.rule === 'rain_chance_labeled')?.outcome).toBe('labeled');
  });

  it('logs blanks, stale data and an empty forecast', () => {
    const d = run([batch('nws', many(60, { windMs: null, pop: null }))], { staleSince: NOW - 5 * H, alertsStale: true, forecastShown: false });
    expect(rules(d)).toEqual(expect.arrayContaining(['blank_value', 'stale_forecast', 'alert_feed_stale', 'nothing_to_show']));
  });

  it('keeps a real disagreement and says so, rather than removing a source', () => {
    const d = run([batch('nws', many(60, { tempC: 10 })), batch('tomorrow', many(60, { tempC: 20 }))]);
    expect(d.find(x => x.rule === 'source_disagreement')).toMatchObject({ outcome: 'kept_all', sample: '10°C' });
  });
});

describe('facts that used to be assumed', () => {
  it('works out day and night instead of assuming day', () => {
    expect(isDaylight(Date.parse('2026-06-21T17:00:00Z'), 40.7, -74)).toBe(true);
    expect(isDaylight(Date.parse('2026-06-21T05:00:00Z'), 40.7, -74)).toBe(false);
    expect(isDaylight(Date.parse('2026-12-21T22:30:00Z'), 40.7, -74)).toBe(false);
  });

  it('shows no icon rather than a sun when no condition was given', () => {
    expect(iconFor('')).toBe('none');
  });
});

describe('the record', () => {
  const draft: Draft = { rule: 'blank_value', source: 'blend', field: 'wind speed', why: 'w', action: 'a', outcome: 'blank', count: 2 };

  it('raises a count instead of adding a line for a repeat the same day', async () => {
    const store = memoryStore();
    await store.addSafeguards([toEvent('s', draft, NOW)]);
    await store.addSafeguards([toEvent('s', draft, NOW + H)]);
    const out = await store.safeguards('s', 0);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ count: 4, firstAt: NOW, lastAt: NOW + H });
  });

  it('starts a new record on a new day', () => {
    expect(toEvent('s', draft, NOW).id).not.toBe(toEvent('s', draft, NOW + 24 * H).id);
  });

  it('keeps the first example value', () => {
    const a = toEvent('s', { ...draft, sample: 'first' }, NOW), b = toEvent('s', { ...draft, sample: 'second' }, NOW);
    expect(mergeEvent(a, b).sample).toBe('first');
  });
});

it('records the assembled snapshot rather than claiming a recomputed fallback was displayed', () => {
  const d: Draft = { rule: 'out_of_range', source: 'tomorrow', field: 'temperature', target: T, why: 'bad', action: '', outcome: 'fallback' };
  const result = resolve(d, [batch('nws', [pt()])], c, name, []);
  expect(result.outcome).toBe('blank');
  expect(result.action).toContain('assembled snapshot has no replacement');
});
it('separates daily outcomes and declares count units', () => {
  const d: Draft = { rule: 'out_of_range', source: 'tomorrow', field: 'wind speed', why: 'bad', action: '', outcome: 'fallback', count: 3 };
  const a = toEvent('scope', d, NOW), b = toEvent('scope', { ...d, outcome: 'blank' }, NOW);
  expect(a.id).not.toBe(b.id);
  expect(a.countUnit).toBe('removed_values');
  expect(toEvent('scope', { ...d, rule: 'source_disagreement' }, NOW).countUnit).toBe('audit_runs');
});
