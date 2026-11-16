import { expect, it } from 'vitest';
import { prunePointCache, POINT_CACHE_MAX, POINT_CACHE_TTL } from './pointCache';

it('erases expired and future coordinate records and bounds the newest cache entries', () => {
  const now = Date.now();
  const row = (at: number) => ({ at, point: {} });
  const cache = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`${i}.0000,-94.0000`, row(now - i)]));
  cache['1.0000,1.0000'] = row(now - POINT_CACHE_TTL);
  cache['2.0000,2.0000'] = row(now + 10000);
  const result = prunePointCache(cache, now);
  expect(Object.keys(result)).toHaveLength(POINT_CACHE_MAX);
  expect(result['1.0000,1.0000']).toBeUndefined();
  expect(result['2.0000,2.0000']).toBeUndefined();
  expect(result['0.0000,-94.0000']).toBeDefined();
});
