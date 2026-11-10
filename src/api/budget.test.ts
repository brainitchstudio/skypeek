import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  admit, bench, cooldownFor429, dispatch, envelope, recordFailure, recordSuccess, release, reloadBudget, remaining, reserve,
  resetBudget, retryDelayMs, SOURCES, spend, usage,
} from './budget';

const NOW = Date.parse('2026-11-05T12:10:00Z');
const HOUR = 3_600_000;

function fakeStorage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
}

beforeEach(() => {
  vi.stubGlobal('localStorage', fakeStorage());
  resetBudget();
});

describe('counting', () => {
  it('counts calls against the tighter limit', () => {
    spend('tomorrow', 5, NOW);
    expect(remaining('tomorrow', NOW)).toBe(SOURCES.tomorrow.perHour - 5);
  });

  it('starts a new hour with a clean count on a fixed window but keeps the daily one', () => {
    spend('openweather', 18, NOW);
    const later = NOW + HOUR;
    expect(usage(later).find(u => u.id === 'openweather')).toMatchObject({ hourUsed: 0, dayUsed: 18 });
  });

  it('keeps calls in a rolling window until they age out, even across the hour mark', () => {
    spend('tomorrow', 18, Date.parse('2026-11-05T12:50:00Z'));
    expect(remaining('tomorrow', Date.parse('2026-11-05T13:10:00Z'))).toBe(2);
    expect(remaining('tomorrow', Date.parse('2026-11-05T13:52:00Z'))).toBe(20);
  });

  it('benches a rate-limited source until the time is up', () => {
    bench('openweather', 60_000, NOW);
    expect(remaining('openweather', NOW)).toBe(0);
    expect(reserve('openweather', 1, 'baseline', NOW)).toBeNull();
    expect(remaining('openweather', NOW + 60_001)).toBeGreaterThan(0);
  });

  it('survives a restart: an empty memory cache cannot refill a quota', () => {
    spend('tomorrow', 10, NOW);
    reloadBudget();
    expect(remaining('tomorrow', NOW)).toBe(SOURCES.tomorrow.perHour - 10);
  });

  it('fails closed for keyed sources when the ledger is unreadable, but not for NWS alerts', () => {
    localStorage.setItem('sky-peek-ledger', '{not json');
    reloadBudget();
    expect(reserve('tomorrow', 1, 'baseline', NOW)).toBeNull();
    expect(reserve('nwsalerts', 1, 'alert', NOW)).not.toBeNull();
  });
});

describe('capacity envelope', () => {
  it('stops optional map work before it consumes baseline Open-Meteo capacity', () => {
    expect(admit('openmeteo', 20, 'optional', NOW)).toBe(true);
    expect(admit('openmeteo', 13, 'optional', NOW)).toBe(false);
    expect(admit('openmeteo', 1, 'baseline', NOW)).toBe(true);
    expect(usage(NOW).find(u => u.id === 'openmeteo')?.hourUsed).toBe(21);
  });

  it('keeps live storm capacity after replay reaches its optional ceiling', () => {
    for (let i = 0; i < 32; i++) expect(admit('iem', 1, 'optional', NOW + i * 60_000)).toBe(true);
    expect(admit('iem', 1, 'optional', NOW + 32 * 60_000)).toBe(false);
    expect(admit('iem', 1, 'baseline', NOW + 32 * 60_000)).toBe(true);
  });

  it('matches the spec arithmetic on a 40,000 unit quota', () => {
    expect(envelope(40_000)).toEqual({ headroom: 4000, usable: 36_000, urgent: 5400, ordinary: 30_600, learning: 1800 });
  });

  it('keeps urgent reserve away from ordinary refreshes', () => {
    // perHour 20 -> usable 18 -> ordinary 15.3
    spend('tomorrow', 15, NOW);
    expect(reserve('tomorrow', 1, 'baseline', NOW)).toBeNull();
    expect(reserve('tomorrow', 1, 'urgent', NOW)).not.toBeNull();
  });

  it('keeps optional challengers from eating the baseline allocation', () => {
    spend('tomorrow', 11, NOW); // past 70% of ordinary
    expect(reserve('tomorrow', 1, 'optional', NOW)).toBeNull();
    expect(reserve('tomorrow', 1, 'baseline', NOW)).not.toBeNull();
  });

  it('enforces every window: a rolling hour cannot hide an exhausted day', () => {
    spend('tomorrow', 360, NOW - 10 * HOUR);
    expect(remaining('tomorrow', NOW)).toBe(20); // the hour is clear, the day is not
    expect(reserve('tomorrow', 1, 'urgent', NOW)).toBeNull(); // 360 of usable 360
  });
});

describe('reserve, dispatch, release', () => {
  it('lets only one of many competitors take the last unit', () => {
    spend('tomorrow', 17, NOW);
    const got = Array.from({ length: 8 }, () => reserve('tomorrow', 1, 'urgent', NOW)).filter(Boolean);
    expect(got).toHaveLength(1);
    expect(dispatch(got[0]!, NOW)).toBe(true);
    expect(reserve('tomorrow', 1, 'urgent', NOW)).toBeNull();
  });

  it('counts a reservation against capacity and returns it only if unsent', () => {
    const r = reserve('tomorrow', 5, 'baseline', NOW)!;
    expect(remaining('tomorrow', NOW)).toBe(15);
    release(r, NOW);
    expect(remaining('tomorrow', NOW)).toBe(20);
  });

  it('never refunds a dispatched attempt, including after a crash', () => {
    const r = reserve('tomorrow', 3, 'baseline', NOW)!;
    dispatch(r, NOW);
    release(r, NOW);
    reloadBudget();
    expect(remaining('tomorrow', NOW)).toBe(17);
  });

  it('re-admits at dispatch: a cooldown that started after reserving blocks the send', () => {
    const r = reserve('openweather', 1, 'baseline', NOW)!;
    bench('openweather', 60_000, NOW);
    expect(dispatch(r, NOW)).toBe(false);
  });

  it('expires an orphaned unsent reservation', () => {
    reserve('tomorrow', 5, 'baseline', NOW);
    expect(remaining('tomorrow', NOW + 120_000)).toBe(20);
  });

  it('re-checks a fixed window after its reset instead of trusting the old reservation', () => {
    const late = Date.parse('2026-11-05T23:59:50Z');
    const r = reserve('openmeteo', 1, 'baseline', late)!;
    expect(dispatch(r, late + 20_000)).toBe(true); // new day, fresh window, re-admitted there
    expect(usage(late + 20_000).find(u => u.id === 'openmeteo')?.dayUsed).toBe(1);
  });

  it('counts per-location units, not HTTP calls', () => {
    const r = reserve('weatherapi', 50, 'baseline', NOW)!;
    dispatch(r, NOW);
    expect(usage(NOW).find(u => u.id === 'weatherapi')?.hourUsed).toBe(50);
  });
});

describe('429 and breaker', () => {
  it('reads Retry-After as seconds and as an HTTP date', () => {
    expect(retryDelayMs('120', NOW, 0, () => 0)).toBe(120_000);
    expect(retryDelayMs(new Date(NOW + 90_000).toUTCString(), NOW, 0, () => 0)).toBe(90_000);
  });

  it('backs off at least 30 s without a header, bounded at 15 minutes', () => {
    expect(retryDelayMs(null, NOW, 0, () => 0)).toBe(30_000);
    expect(retryDelayMs(null, NOW, 2, () => 1)).toBe(150_000);
    expect(retryDelayMs(null, NOW, 20, () => 1)).toBe(900_000);
  });

  it('pauses the source and shrinks its limit on repeated 429s', () => {
    cooldownFor429('tomorrow', '60', NOW, () => 0);
    expect(remaining('tomorrow', NOW + 1000)).toBe(0);
    cooldownFor429('tomorrow', '60', NOW + 61_000, () => 0);
    expect(usage(NOW + 200_000).find(u => u.id === 'tomorrow')?.shrink).toBeLessThan(1);
  });

  it('does not get stuck when a probe is never sent', () => {
    for (let i = 0; i < 5; i++) recordFailure('weatherapi', NOW + i);
    const probe = reserve('weatherapi', 1, 'baseline', NOW + 61_000)!;
    release(probe, NOW + 61_000);
    expect(reserve('weatherapi', 1, 'baseline', NOW + 61_001)).not.toBeNull();
  });

  it('opens after 5 failures in a minute, then allows a single probe', () => {
    for (let i = 0; i < 5; i++) recordFailure('weatherapi', NOW + i);
    expect(reserve('weatherapi', 1, 'baseline', NOW + 10)).toBeNull();
    const probe = reserve('weatherapi', 1, 'baseline', NOW + 61_000);
    expect(probe).not.toBeNull();
    expect(reserve('weatherapi', 1, 'baseline', NOW + 61_001)).toBeNull();
    recordSuccess('weatherapi');
    expect(reserve('weatherapi', 1, 'baseline', NOW + 61_002)).not.toBeNull();
  });
});
