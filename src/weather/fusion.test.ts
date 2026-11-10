import { describe, expect, it } from 'vitest';
import { blend, blendWind, chooseCurrent, fuseHigh, fuseHour, ineligible, pointAt } from './fusion';
import type { Batch, Fact, Point, Provider, Semantics } from './types';

const NOW = Date.parse('2026-11-05T18:00:00Z');
const T = Date.parse('2026-11-05T20:00:00Z');
const HOUR = 3_600_000;
const c = { now: NOW, nwsCovers: true, event: false };

const pt = (p: Partial<Point> = {}): Point => ({
  start: T, end: T + HOUR, tempC: null, dewC: null, windMs: null, windDeg: null, gustMs: null, pop: null, cloud: null, cond: 'cloudy', text: 'Cloudy', isDay: true, ...p,
});

const SEM: Record<Provider, Semantics> = {
  nws: { pop: 'any_precip_1h', wind: 'mean', stepHours: 1, maxInterpHours: 0, days: 'nws-periods' },
  tomorrow: { pop: 'any_precip_1h', wind: 'mean', stepHours: 1, maxInterpHours: 0, days: 'calendar' },
  openweather: { pop: 'any_precip_3h', wind: 'mean', stepHours: 3, maxInterpHours: 3, days: null },
  weatherapi: { pop: 'rain_only_1h', wind: 'unresolved', stepHours: 1, maxInterpHours: 0, days: 'calendar' },
};

function batch(provider: Provider, points: Point[], over: Partial<Batch> = {}): Batch {
  return {
    provider, product: provider === 'nws' ? 'hourly' : 'forecast', apiVersion: 'x', mapping: 1, issuedAt: NOW, fetchedAt: NOW, availableAt: NOW, firstSeenAt: NOW,
    fingerprint: 'f', semantics: SEM[provider], points, days: [], fact: null, flags: [], ...over,
  };
}

describe('weights', () => {
  it('reproduces the spec worked example', () => {
    const b = blend([
      { provider: 'nws', value: 8, r: .32 }, { provider: 'openweather', value: 10, r: .18 },
      { provider: 'tomorrow', value: 9, r: .20 }, { provider: 'weatherapi', value: 11, r: .15 },
    ])!;
    expect(b.value).toBeCloseTo(9.188, 3);
    expect(b.weights[0].weight).toBeCloseTo(.3765, 4);
  });

  it('renormalizes when a source lacks the horizon instead of inserting zero', () => {
    const out = fuseHour(T, [batch('nws', [pt({ tempC: 10 })]), batch('tomorrow', [pt({ start: T + 9 * HOUR, tempC: 0 })])], c);
    expect(out.tempC).toBe(10);
    expect(out.sources).toEqual([{ provider: 'nws', weight: 1 }]);
    expect(out.agreement).toBe('single');
  });

  it('weights NWS at its prior when ages match, and equally outside NWS coverage', () => {
    const rows = [batch('nws', [pt({ tempC: 10 })]), batch('tomorrow', [pt({ tempC: 20 })], { issuedAt: NOW })];
    expect(fuseHour(T, rows, c).tempC).toBeCloseTo(13.33, 2);
    expect(fuseHour(T, rows, { ...c, nwsCovers: false }).tempC).toBeCloseTo(15, 5);
  });

  it('returns unavailable rather than inventing a value', () => {
    const out = fuseHour(T, [], c);
    expect(out).toMatchObject({ tempC: null, pop: null, wind: null, cond: 'unknown' });
  });
});

describe('eligibility', () => {
  it('rejects forecasts past their issue-age cap', () => {
    const old = batch('nws', [pt({ tempC: 10 })], { issuedAt: NOW - 13 * HOUR });
    expect(ineligible(old, c)).toBe('too_old');
    expect(fuseHour(T, [old], c).tempC).toBeNull();
  });

  it('keeps NWS on its normal cadence during events but tightens commercial issue age', () => {
    const e = { ...c, event: true };
    expect(ineligible(batch('nws', [], { issuedAt: NOW - 8 * HOUR }), e)).toBeNull();
    expect(ineligible(batch('openweather', [], { issuedAt: NOW - 8 * HOUR }), e)).toBe('too_old');
  });

  it('quarantines timestamps far in the future', () => {
    expect(ineligible(batch('nws', [], { issuedAt: NOW + 10 * 60_000 }), c)).toBe('future_timestamp');
  });

  it('ages unknown-issue data from first sight, so a re-fetch of old content expires', () => {
    const b = batch('tomorrow', [], { issuedAt: null, fetchedAt: NOW, firstSeenAt: NOW - 7 * HOUR });
    expect(ineligible(b, c)).toBe('unknown_age_past_cap');
  });
});

describe('wind', () => {
  const w = (s: number, deg: number, provider: Provider = 'nws') => ({ provider, value: { s, deg }, r: 1 });

  it('blends 359° and 1° to north', () => {
    const out = blendWind([w(5, 359), w(5, 1, 'tomorrow')])!;
    expect(out.deg).toBe(0);
    expect(out.variable).toBe(false);
  });

  it('reports opposite directions as variable, keeping scalar speed rather than calm', () => {
    const out = blendWind([w(8, 90), w(8, 270, 'tomorrow')])!;
    expect(out).toEqual({ speedMs: 8, deg: null, variable: true });
  });

  it('keeps full speed when one source has no direction', () => {
    const out = blendWind([w(4, 180), { provider: 'openweather', value: { s: 4, deg: null }, r: 1 }])!;
    expect(out.speedMs).toBeCloseTo(4);
    expect(out.deg).toBe(180);
  });

  it('interpolates direction the short way round, so a 3-hour source stays smooth', () => {
    const b = batch('openweather', [pt({ windMs: 4, windDeg: 350 }), pt({ start: T + 3 * HOUR, windMs: 4, windDeg: 10 })]);
    const d = pointAt(b, T + 1.5 * HOUR)!.p.windDeg!;
    expect(Math.min(d, 360 - d)).toBeLessThan(1);
  });

  it('does not blend a max-speed source into mean wind', () => {
    const out = fuseHour(T, [batch('nws', [pt({ windMs: 4, windDeg: 180 })]), batch('weatherapi', [pt({ windMs: 40, windDeg: 180 })])], c);
    expect(out.wind?.speedMs).toBeCloseTo(4);
  });

  it('uses it, flagged, only when nothing else exists', () => {
    const out = fuseHour(T, [batch('weatherapi', [pt({ windMs: 7, windDeg: 180 })])], c);
    expect(out.wind?.speedMs).toBeCloseTo(7);
    expect(out.flags).toContain('wind_support_unresolved');
  });
});

describe('precipitation probability', () => {
  it('keeps a missing probability null', () => {
    expect(fuseHour(T, [batch('nws', [pt({ tempC: 5, pop: null })])], c).pop).toBeNull();
  });

  it('blends the same event only, and never unions probabilities', () => {
    const out = fuseHour(T, [batch('nws', [pt({ pop: .7 })]), batch('tomorrow', [pt({ pop: .6 })])], c);
    expect(out.pop).toBeCloseTo((.4 * .7 + .2 * .6) / .6, 5);
  });

  it('keeps rain-only and 3-hour probabilities out of the 1-hour blend', () => {
    const out = fuseHour(T, [batch('nws', [pt({ pop: .5 })]), batch('weatherapi', [pt({ pop: .9 })]), batch('openweather', [pt({ pop: .9 })])], c);
    expect(out.pop).toBeCloseTo(.5);
    expect(out.flags).toContain('pop_semantics_excluded');
  });

  it('keeps a one-hour chance even when the other source outweighs it', () => {
    const old = batch('nws', [pt({ pop: .1, tempC: 10 })], { issuedAt: NOW - 8 * HOUR });
    const three = batch('openweather', [pt({ pop: .95, tempC: 10 })], { issuedAt: null });
    expect(fuseHour(T, [old, three], c)).toMatchObject({ pop: .1, popEvent: 'any_precip_1h' });
  });

  it('marks a rain-only chance when it is all there is', () => {
    expect(fuseHour(T, [batch('weatherapi', [pt({ pop: .9 })])], c)).toMatchObject({ pop: .9, popEvent: 'rain_only_1h' });
  });

  it('never interpolates probability across a 3-hour step', () => {
    const b = batch('openweather', [pt({ tempC: 0, pop: .2 }), pt({ start: T + 3 * HOUR, tempC: 3, pop: .8 })]);
    const mid = pointAt(b, T + HOUR)!;
    expect(mid.interpolated).toBe(true);
    expect(mid.p.tempC).toBeCloseTo(1);
    expect(mid.p.pop).toBeNull();
  });
});

describe('condition and physical checks', () => {
  it('preserves near-freezing phase disagreement instead of picking a side', () => {
    const out = fuseHour(T, [batch('nws', [pt({ cond: 'rain', text: 'Rain' })]), batch('tomorrow', [pt({ cond: 'snow', text: 'snow' })])], c);
    expect(out).toMatchObject({ cond: 'mixed', text: 'Wintry precipitation possible' });
  });

  it('keeps minority thunder evidence and the heaviest source text', () => {
    const out = fuseHour(T, [batch('nws', [pt({ cond: 'rain', text: 'Rain Likely' })]), batch('tomorrow', [pt({ cond: 'thunder', text: 'thunderstorm' })])], c);
    expect(out.text).toBe('Rain Likely');
    expect(out.thunderPossible).toBe(true);
  });

  it('retains an extreme minority forecast in the blend', () => {
    const out = fuseHour(T, [batch('nws', [pt({ tempC: 10 })]), batch('tomorrow', [pt({ tempC: 30 })])], c);
    expect(out.tempC).toBeGreaterThan(15);
    expect(out.agreement).toBe('low');
  });

  it('clamps a rounding-sized dew point excess but flags a real one', () => {
    const near = fuseHour(T, [batch('nws', [pt({ tempC: 10, dewC: 10.3 })])], c);
    expect(near.dewC).toBe(10);
    const bad = fuseHour(T, [batch('nws', [pt({ tempC: 10, dewC: 14 })])], c);
    expect(bad.dewC).toBeNull();
    expect(bad.flags).toContain('dew_point_above_temperature');
  });
});

describe('daily highs', () => {
  it('blends true daily products only', () => {
    const d = (hiC: number) => [{ date: '2026-11-06', hiC, loC: 1, cond: 'clear' as const, text: '' }];
    const n = batch('nws', [], { product: 'daily', days: d(10) });
    const t = batch('tomorrow', [], { days: d(13), issuedAt: NOW });
    const ow = batch('openweather', [], { days: d(40) });
    expect(fuseHigh('2026-11-06', [n, t, ow], c)?.hiC).toBeCloseTo(11, 5);
  });
});

describe('current conditions', () => {
  const f = (over: Partial<Fact>): Fact => ({ kind: 'observation', at: NOW - 10 * 60_000, tempC: 12, dewC: null, windMs: 3, windDeg: 90, gustMs: null, visM: null, cond: 'cloudy', text: 'Cloudy', qualityFlags: [], ...over });

  it('prefers a fresh observation and does not average forecasts into it', () => {
    const out = chooseCurrent(f({}), [{ provider: 'tomorrow', fact: f({ kind: 'analysis', tempC: 30 }) }], c)!;
    expect(out).toMatchObject({ kind: 'observation', tempC: 12 });
  });

  it('falls to labeled analyses when the observation is stale, and keeps its real time', () => {
    const old = f({ at: NOW - 2 * HOUR });
    const out = chooseCurrent(old, [{ provider: 'tomorrow', fact: f({ kind: 'analysis', tempC: 14 }) }], c)!;
    expect(out).toMatchObject({ kind: 'analysis', tempC: 14, at: NOW - 10 * 60_000 });
  });

  it('applies the tighter age during an event', () => {
    expect(chooseCurrent(f({ at: NOW - 30 * 60_000 }), [], { ...c, event: true })).toBeNull();
  });
});
