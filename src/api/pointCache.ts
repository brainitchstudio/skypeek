import type { NwsPoint } from './weather';

export const POINT_CACHE_KEY = 'sky-peek-points';
export const POINT_CACHE_TTL = 7 * 86_400_000;
export const POINT_CACHE_MAX = 40;
export type PointCache = Record<string, { at: number; point: NwsPoint }>;

/** Refresh age is also an erasure policy, not just a cache-hit policy. */
export function prunePointCache(input: unknown, now: number): PointCache {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  return Object.fromEntries(Object.entries(input).filter(([key, value]) => {
    if (!/^-?\d+\.\d{4},-?\d+\.\d{4}$/.test(key) || !value || typeof value !== 'object') return false;
    const row = value as PointCache[string];
    return Number.isFinite(row.at) && row.at <= now && now - row.at < POINT_CACHE_TTL && !!row.point && typeof row.point === 'object';
  }).sort(([, a], [, b]) => b.at - a.at).slice(0, POINT_CACHE_MAX));
}
