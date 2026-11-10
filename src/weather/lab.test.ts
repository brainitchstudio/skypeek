import { expect, it } from 'vitest';
import { dailyErrors } from './lab';
import type { ForecastRow, TruthRow } from './accuracy';
it('trend excludes other locations, future truth and forecasts received after cutoff', () => {
  const target = Date.UTC(2026, 10, 1), hour = 3600000;
  const f: ForecastRow = { id: 'f', scope: 'a', target, lead: 24, source: 'nws', tempC: 12, windMs: null, pop: null, capturedAt: target - 24 * hour, availableAt: target - 24 * hour, issuedAt: null, interpolated: false, fusionVersion: 'v' };
  const t: TruthRow = { id: 't', scope: 'a', target, stationId: 'KAAA', distanceKm: 5, tempC: 10, windMs: null, wet: null, reports: 1, availableAt: target + hour };
  expect(dailyErrors([f], [{ ...t, scope: 'b', distanceKm: 1, tempC: 100 }, t], target + 3 * hour)[0]).toMatchObject({ n: 1, mae: 2, bias: 2 });
  expect(dailyErrors([{ ...f, availableAt: target }], [t], target + 3 * hour)).toEqual([]);
  expect(dailyErrors([f], [{ ...t, availableAt: target + 4 * hour }], target + 3 * hour)).toEqual([]);
});

import { mergeBatch } from './store';
import type { Batch } from './types';
it('a cached future timestamp cannot block recovery with a valid provider run', () => {
  const now = Date.UTC(2026, 10, 5);
  const base: Batch = { provider: 'nws', product: 'hourly', apiVersion: 'x', mapping: 1, issuedAt: now, fetchedAt: now, availableAt: now, firstSeenAt: now, fingerprint: 'valid', semantics: { pop: 'any_precip_1h', wind: 'mean', stepHours: 1, maxInterpHours: 0, days: null }, points: [], days: [], fact: null, flags: [] };
  expect(mergeBatch({ ...base, issuedAt: now + 86400000, fingerprint: 'forged' }, base)).toMatchObject({ changed: true, batch: { fingerprint: 'valid' } });
  expect(mergeBatch(base, { ...base, issuedAt: now + 86400000 })).toMatchObject({ changed: false, batch: { fingerprint: 'valid' } });
});
