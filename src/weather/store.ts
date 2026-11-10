// Device-side cache. A "scope" is what can share data: one NWS grid square, or
// one roughly 2 km cell for commercial sources. Alerts are never shared this way:
// they're stored per exact location.

import { FUTURE_TOLERANCE_MS } from './config';
import { emptyAlertState, type AlertState } from './alertState';
import type { Tracks } from './events';
import type { Batch, ProductState } from './types';
import type { ExtendedDay } from '@/lib/forecast';

export type Station = { id: string; distanceKm: number; elevationM: number | null };

export type Scope = {
  batches: Record<string, Batch>;
  states: Record<string, ProductState>;
  stations?: { at: number; list: Station[] };
  events?: Tracks;
  extended?: { at: number; days: ExtendedDay[]; timeZone?: string };
  nwsCovers?: boolean | null;
  coverCheckedAt?: number;
  timeZone?: string;
};

const PREFIX = 'sky-peek-wx:';
const INDEX = 'sky-peek-wx-index';
const MAX_SCOPES = 40;

const ls = () => { try { return globalThis.localStorage ?? null; } catch { return null; } };

function touch(id: string, now: number) {
  const s = ls();
  if (!s) return;
  let idx: Record<string, number> = {};
  try { idx = JSON.parse(s.getItem(INDEX) ?? '{}'); } catch { /* rebuilt below */ }
  idx[id] = now;
  const ids = Object.keys(idx).sort((a, b) => idx[b] - idx[a]);
  for (const old of ids.slice(MAX_SCOPES)) { s.removeItem(PREFIX + old); delete idx[old]; }
  s.setItem(INDEX, JSON.stringify(idx));
}

export function loadJson<T>(id: string, fallback: () => T): T {
  try {
    const raw = ls()?.getItem(PREFIX + id);
    return raw ? (JSON.parse(raw) as T) : fallback();
  } catch { return fallback(); }
}

export function saveJson(id: string, value: unknown, now: number) {
  const s = ls();
  if (!s) return;
  try {
    touch(id, now);
    s.setItem(PREFIX + id, JSON.stringify(value));
  } catch {
    // Full: drop everything else, keep this. Budgets live in their own key, so nothing is refunded.
    try {
      const idx = JSON.parse(s.getItem(INDEX) ?? '{}') as Record<string, number>;
      for (const other of Object.keys(idx)) if (other !== id) s.removeItem(PREFIX + other);
      s.setItem(INDEX, JSON.stringify({ [id]: now }));
      s.setItem(PREFIX + id, JSON.stringify(value));
    } catch { /* runs from memory until the next save */ }
  }
}

export const loadScope = (id: string): Scope => loadJson<Scope>(id, () => ({ batches: {}, states: {} }));
export const loadAlerts = (id: string): AlertState => loadJson<AlertState>(`alerts:${id}`, emptyAlertState);

/** Keeps the newer run. A late response or an unchanged re-fetch can't make data look newer. */
export function mergeBatch(old: Batch | undefined, next: Batch): { batch: Batch; changed: boolean } {
  // A forged future issue time must not poison the cache and block valid recovery.
  if (next.issuedAt != null && next.issuedAt > next.fetchedAt + FUTURE_TOLERANCE_MS) return { batch: old ?? { ...next, points: [], days: [], fact: null, periods: [] }, changed: false };
  if (!old || (old.issuedAt != null && old.issuedAt > next.fetchedAt + FUTURE_TOLERANCE_MS)) return { batch: next, changed: true };
  if (old.issuedAt != null && next.issuedAt != null && next.issuedAt < old.issuedAt) return { batch: old, changed: false };
  if (old.fingerprint === next.fingerprint) {
    return { batch: { ...old, fetchedAt: Math.max(old.fetchedAt, next.fetchedAt) }, changed: false };
  }
  if (next.availableAt < old.availableAt) return { batch: old, changed: false };
  return { batch: next, changed: true };
}
