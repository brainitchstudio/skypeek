// Decides which fetches are worth making this tick. It only proposes: the ledger
// has the final say on every one. Lanes run in the spec's order: baseline needs
// by earliest deadline, then urgent event work, then the single best optional
// challenger. Providers are never picked to even out their call counts.

import type { Lane } from '@/api/budget';
import { COMMERCIAL, ENABLED, key, REFRESH_MIN, USABLE_RESPONSE_P } from './config';
import type { Product, ProductState, Provider } from './types';

export type Job = { provider: Provider; product: Product; lane: Lane; intervalMs: number };

export type PlanInput = {
  now: number;
  nwsCovers: boolean | null; // null until the first point lookup
  connected: Provider[];
  states: Record<string, ProductState | undefined>;
  event: boolean;
  /** 0 to 1: how much sources currently disagree. */
  uncertainty: number;
  /** A good observation exists, so analyses aren't needed. */
  hasObservation: boolean;
  userMinutes: number;
  manual: boolean;
  room: (p: Provider, lane: Lane) => number;
};

const MIN = 60_000;
const NEVER = -Infinity;

function intervalMs(kind: keyof typeof REFRESH_MIN, event: boolean, userMinutes: number): number {
  const [calm, ev] = REFRESH_MIN[kind];
  if (event) return ev * MIN;
  // The Refresh setting moves "now" and hourly data within what's useful, but no faster.
  if (kind === 'observation') return Math.min(Math.max(userMinutes, calm), 60) * MIN;
  if (kind === 'hourly') return Math.min(Math.max(userMinutes, calm), 60) * MIN;
  return calm * MIN;
}

function due(s: ProductState | undefined, interval: number, i: PlanInput): boolean {
  const last = s?.lastFetch ?? NEVER;
  const backoff = s?.nextAt ?? 0;
  // A manual refresh skips the wait, not admission, cooldowns or the provider's own cadence.
  if (i.manual) return i.now >= backoff && i.now - last >= 2 * MIN;
  return i.now >= Math.max(last + interval, backoff);
}

/**
 * Bootstrap value of a challenger: freshness gap, event relevance, disagreement,
 * coverage gap and a little exploration, scaled by the chance a call brings
 * something new, over the scarcity of that provider's quota.
 */
export function priority(s: ProductState | undefined, interval: number, i: PlanInput, room: number): number {
  const last = s?.lastFetch ?? NEVER;
  const F = Math.min(1, (i.now - last) / (2 * interval));
  const H = i.event ? 1 : 0;
  const U = i.uncertainty;
  const C = last === NEVER ? 1 : 0;
  const E = last === NEVER ? 1 : 0.2;
  const V = 0.30 * F + 0.25 * H + 0.20 * U + 0.15 * C + 0.10 * E;
  const useful = USABLE_RESPONSE_P * (s?.change ?? 0.5);
  return (V * useful) / (0.001 + 1 / Math.max(room, 0.01));
}

export function planFetches(i: PlanInput): Job[] {
  const baseline: (Job & { deadline: number })[] = [];
  const need = (provider: Provider, product: Product, kind: keyof typeof REFRESH_MIN, lane: Lane = 'baseline') => {
    const s = i.states[key(provider, product)], ms = intervalMs(kind, i.event, i.userMinutes);
    if (due(s, ms, i)) baseline.push({ provider, product, lane, intervalMs: ms, deadline: (s?.lastFetch ?? NEVER) + ms });
  };

  const connected = i.connected.filter(p => ENABLED[p] && p !== 'nws');
  const ordered = COMMERCIAL.filter(p => connected.includes(p));
  const nwsOn = ENABLED.nws && i.nwsCovers !== false;
  let primary: Provider | null = null;

  if (nwsOn) {
    need('nws', 'hourly', 'hourly');
    need('nws', 'daily', 'daily');
    need('nws', 'observation', 'observation');
  } else if (ordered.length) {
    primary = ordered[0];
    need(primary, 'forecast', 'hourly');
  }

  // No usable observation: cover "now" from one provider instead of asking all of them.
  const obsUntried = nwsOn && !i.states[key('nws', 'observation')];
  if (!i.hasObservation && !obsUntried && ordered.length && i.nwsCovers !== null) {
    const p = ordered[0];
    if (p === 'weatherapi') { if (primary !== p) need(p, 'forecast', 'current'); }
    else need(p, 'current', 'current');
  }

  const out: Job[] = baseline.sort((a, b) => a.deadline - b.deadline).map(({ deadline: _, ...j }) => j);
  const taken = new Set(out.map(j => key(j.provider, j.product)));

  const lane: Lane = i.event ? 'urgent' : 'optional';
  const ms = intervalMs('challenger', i.event, i.userMinutes);
  const challengers = ordered
    .filter(p => p !== primary && !taken.has(key(p, 'forecast')) && due(i.states[key(p, 'forecast')], ms, i))
    .map(p => ({ p, room: i.room(p, lane) }))
    .filter(x => x.room > 0)
    .map(x => ({ p: x.p, score: priority(i.states[key(x.p, 'forecast')], ms, i, x.room) }))
    .sort((a, b) => b.score - a.score || a.p.localeCompare(b.p));

  // One challenger per tick: the rest wait, and benefit is recomputed next time.
  if (challengers[0]) out.push({ provider: challengers[0].p, product: 'forecast', lane, intervalMs: ms });
  return out;
}
