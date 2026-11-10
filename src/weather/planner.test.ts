import { describe, expect, it } from 'vitest';
import { planFetches, priority, type PlanInput } from './planner';
import type { ProductState } from './types';

const NOW = 1_800_000_000_000, MIN = 60_000;

const base: PlanInput = {
  now: NOW, nwsCovers: true, connected: [], states: {}, event: false, uncertainty: 0, hasObservation: true,
  userMinutes: 15, manual: false, room: () => 1,
};
const fresh = (over: Partial<ProductState> = {}): ProductState => ({ lastFetch: NOW, nextAt: 0, change: .5, failures: 0, ...over });
const done = { 'nws:hourly': fresh(), 'nws:daily': fresh(), 'nws:observation': fresh() };
const names = (i: PlanInput) => planFetches(i).map(j => `${j.provider}:${j.product}:${j.lane}`);

describe('planner', () => {
  it('uses only NWS with no keys, and nothing commercial', () => {
    expect(names(base)).toEqual(['nws:hourly:baseline', 'nws:daily:baseline', 'nws:observation:baseline']);
  });

  it('makes no calls when everything is fresh', () => {
    expect(names({ ...base, states: done })).toEqual([]);
  });

  it('does not fan out to every vendor on a cold start', () => {
    const jobs = names({ ...base, connected: ['openweather', 'tomorrow', 'weatherapi'] });
    expect(jobs.filter(j => !j.startsWith('nws'))).toHaveLength(1);
  });

  it('refreshes a challenger on its slow calm cadence', () => {
    const states = { ...done, 'tomorrow:forecast': fresh({ lastFetch: NOW - 60 * MIN }) };
    expect(names({ ...base, states, connected: ['tomorrow'] })).toEqual([]);
    states['tomorrow:forecast'] = fresh({ lastFetch: NOW - 121 * MIN });
    expect(names({ ...base, states, connected: ['tomorrow'] })).toEqual(['tomorrow:forecast:optional']);
  });

  it('speeds challengers up in an event, on the urgent lane', () => {
    const states = { ...done, 'tomorrow:forecast': fresh({ lastFetch: NOW - 20 * MIN }) };
    expect(names({ ...base, states, connected: ['tomorrow'], event: true })).toContain('tomorrow:forecast:urgent');
  });

  it('never polls NWS below its calm cadence because of the Refresh setting', () => {
    const states = { ...done, 'nws:hourly': fresh({ lastFetch: NOW - 10 * MIN }) };
    expect(names({ ...base, states, userMinutes: 5 })).toEqual([]);
  });

  it('honors a backoff or cache time even when overdue', () => {
    const states = { ...done, 'nws:hourly': fresh({ lastFetch: NOW - 90 * MIN, nextAt: NOW + MIN }) };
    expect(names({ ...base, states })).toEqual([]);
  });

  it('lets manual refresh skip the interval but not a cooldown', () => {
    const states = { ...done, 'nws:observation': fresh({ lastFetch: NOW - 5 * MIN }) };
    expect(names({ ...base, states, manual: true })).toEqual(['nws:observation:baseline']);
    states['nws:observation'] = fresh({ lastFetch: NOW - 5 * MIN, nextAt: NOW + MIN });
    expect(names({ ...base, states, manual: true })).toEqual([]);
  });

  it('falls back to a commercial primary outside NWS coverage', () => {
    expect(names({ ...base, nwsCovers: false, connected: ['tomorrow', 'weatherapi'] })[0]).toBe('weatherapi:forecast:baseline');
  });

  it('fills a missing observation from one provider, as bundled data when it can', () => {
    const out = names({ ...base, states: done, hasObservation: false, connected: ['weatherapi', 'tomorrow'] });
    expect(out.filter(j => j.endsWith('baseline'))).toEqual(['weatherapi:forecast:baseline']);
  });

  it('gives NWS the first try at "now" before spending a commercial call', () => {
    const out = names({ ...base, hasObservation: false, connected: ['tomorrow'] });
    expect(out).not.toContain('tomorrow:current:baseline');
  });

  it('skips a provider with no room rather than failing', () => {
    const out = names({ ...base, states: done, connected: ['tomorrow'], room: () => 0 });
    expect(out).toEqual([]);
  });

  it('ranks by information value and scarcity, not by who has been used least', () => {
    const i = { ...base, event: false };
    const repeats = priority(fresh({ lastFetch: NOW - 200 * MIN, change: .05 }), 120 * MIN, i, 1);
    const changes = priority(fresh({ lastFetch: NOW - 200 * MIN, change: .9 }), 120 * MIN, i, 1);
    const scarce = priority(fresh({ lastFetch: NOW - 200 * MIN, change: .9 }), 120 * MIN, i, .05);
    expect(changes).toBeGreaterThan(repeats);
    expect(changes).toBeGreaterThan(scarce);
  });
});
