// On-device accuracy log. It answers "what did each source say an hour, a day or
// two days ahead, and what happened?". Reports are always derived from stored
// facts, and they only describe: nothing here feeds back into blend weights.
//
// Each forecast slot is (target hour, lead, source). A slot is written only while
// the target is at least `lead` hours away, so it ends up holding the latest
// forecast known at that cutoff and can't be improved with hindsight.

import { FUSION_VERSION } from './config';
import { fuseHour, ineligible, pointAt, type FuseContext } from './fusion';
import type { SafeguardEvent } from './safeguards';
import type { Batch, Provider } from './types';
import { inLimits } from './safeguards';
import { kphToMs } from './units';

export const LEADS = [1, 3, 6, 12, 24, 48];
export const BUCKETS = [
  { id: '1-6h', leads: [1, 3] }, { id: '6-24h', leads: [6, 12] }, { id: '24-48h', leads: [24, 48] },
] as const;
export type BucketId = (typeof BUCKETS)[number]['id'];

export const RAIN_EVENT = 'present_weather_in_hour_v2';
export const MATCHING = { policy: 'station-v1', maxMinutes: 10, maxDistanceKm: 15, maxElevationDiffM: 150, minReportsForDry: 2 };
/** How long after a target hour its observations are given to arrive. */
export const TRUTH_GRACE_MS = 2 * 3_600_000;
export const COLLECTING_DAYS = 7;
export const COMPARABLE_DAYS = 30;

const HOUR = 3_600_000, MIN = 60_000, DAY = 24 * HOUR;
/** Reaches past 48 h so a long-lead slot still fills if the app was closed near its cutoff. */
const CAPTURE_HOURS = 60;

export type Source = Provider | 'blend';
export type ReportSource = Source | 'equal';

export type ForecastRow = {
  id: string; scope: string; target: number; lead: number; source: Source;
  tempC: number | null; windMs: number | null;
  /** Only ever an any-precipitation chance for that hour. */
  pop: number | null;
  capturedAt: number;
  availableAt: number;
  issuedAt: number | null; // null when unknown, and always null for a blend
  interpolated: boolean;
  fusionVersion: string;
};

export type TruthRow = {
  id: string; scope: string; target: number; stationId: string; distanceKm: number;
  tempC: number | null; windMs: number | null;
  /** true: precipitation reported. false: enough reports said none. null: can't tell. */
  wet: boolean | null;
  reports: number;
  rainEvent?: string;
  availableAt: number;
};

export function forecastRows(scope: string, batches: Batch[], c: FuseContext): ForecastRow[] {
  const live = batches.filter(b => b.points.length && !ineligible(b, c));
  if (!live.length) return [];
  const first = Math.ceil(c.now / HOUR) * HOUR;
  const out: ForecastRow[] = [];
  for (let target = first; target <= first + CAPTURE_HOURS * HOUR; target += HOUR) {
    const leads = LEADS.filter(l => target - l * HOUR >= c.now);
    if (!leads.length) continue;
    const base = { scope, target, capturedAt: c.now, fusionVersion: FUSION_VERSION };
    const perSource = live.flatMap(b => {
      const at = pointAt(b, target);
      if (!at || at.p.tempC == null) return [];
      return [{
        ...base, source: b.provider as Source, tempC: at.p.tempC,
        windMs: b.semantics.wind === 'mean' ? at.p.windMs : null,
        pop: b.semantics.pop === 'any_precip_1h' ? at.p.pop : null,
        availableAt: b.availableAt, issuedAt: b.issuedAt, interpolated: at.interpolated,
      }];
    });
    if (!perSource.length) continue;
    const f = fuseHour(target, live, c);
    const offEvent = f.flags.some(x => x === 'pop_rain_only_1h' || x === 'pop_any_precip_3h');
    const blend = {
      ...base, source: 'blend' as Source, tempC: f.tempC,
      windMs: f.flags.includes('wind_support_unresolved') ? null : f.wind?.speedMs ?? null,
      pop: offEvent ? null : f.pop,
      availableAt: Math.max(...perSource.map(r => r.availableAt)), issuedAt: null, interpolated: f.flags.includes('interpolated'),
    };
    for (const lead of leads) {
      for (const r of [...perSource, blend]) out.push({ ...r, lead, id: `${scope}|${target}|${lead}|${r.source}` });
    }
  }
  return out;
}

export type StationRef = { id: string; distanceKm: number };

/* eslint-disable @typescript-eslint/no-explicit-any */
const PRECIP = /rain|snow|drizzle|shower|thunder|sleet|hail|ice_pellets|freezing/i;

/** Turns raw observations into one row per complete hour, with nothing assumed for gaps. */
export function truthRows(scope: string, station: StationRef, features: any[], window: { from: number; now: number; rejected?: (field: string) => void }): TruthRow[] {
  const { from, now } = window;
  const obs = features.map(f => f.properties).map(p => ({ p, at: Date.parse(p.timestamp) })).filter(o => Number.isFinite(o.at));
  if (!obs.length) return [];
  // Starts at the first whole hour in the window: a partly seen hour could look dry.
  const lo = Math.ceil(from / HOUR) * HOUR;
  const nearest = <T,>(target: number, pick: (p: any) => T | null): T | null => {
    const hits = obs
      .filter(o => Math.abs(o.at - target) <= MATCHING.maxMinutes * MIN)
      .map(o => ({ d: Math.abs(o.at - target), v: pick(o.p) }))
      .filter(x => x.v != null)
      .sort((a, b) => a.d - b.d);
    return hits[0]?.v ?? null;
  };
  const rows: TruthRow[] = [];
  for (let target = lo; target + HOUR <= now; target += HOUR) {
    const inHour = obs.filter(o => o.at >= target && o.at < target + HOUR);
    const reports = inHour.filter(o => Array.isArray(o.p.presentWeather));
    // Hour-ending accumulations cannot be assigned to this hour-starting bucket.
    const wetReport = inHour.some(({ p }) => (p.presentWeather ?? []).some((w: any) => PRECIP.test(w.weather ?? '')) || PRECIP.test(p.textDescription ?? ''));
    const wet = wetReport ? true : reports.length >= MATCHING.minReportsForDry ? false : null;
    const tempC = nearest(target, p => {
      const v = p.temperature?.value ?? null;
      if (/[XQ]/.test(p.temperature?.qualityControl ?? '') || !inLimits('tempC', v)) { window.rejected?.('temperature'); return null; }
      return v;
    });
    const windMs = nearest(target, p => {
      const v = p.windSpeed?.value == null ? null : kphToMs(p.windSpeed.value);
      if (/[XQ]/.test(p.windSpeed?.qualityControl ?? '') || !inLimits('windMs', v)) { window.rejected?.('wind speed'); return null; }
      return v;
    });
    if (tempC == null && windMs == null && wet == null) continue;
    rows.push({ id: `${scope}|${target}|${station.id}`, scope, target, stationId: station.id, distanceKm: station.distanceKm, tempC, windMs, wet, reports: reports.length, rainEvent: RAIN_EVENT, availableAt: now });
  }
  return rows;
}

// ---- reporting --------------------------------------------------------------

/** Sums, so cells can be combined without averaging averages. */
type Sums = { n: number; err: number; abs: number; sq: number };
export type Stat = { n: number; bias: number | null; mae: number | null; rmse: number | null };

const zero = (): Sums => ({ n: 0, err: 0, abs: 0, sq: 0 });
const add = (s: Sums, e: number) => { s.n++; s.err += e; s.abs += Math.abs(e); s.sq += e * e; };
const stat = (s: Sums): Stat => (s.n
  ? { n: s.n, bias: s.err / s.n, mae: s.abs / s.n, rmse: Math.sqrt(s.sq / s.n) }
  : { n: 0, bias: null, mae: null, rmse: null });

export type Maturity = 'collecting' | 'provisional' | 'comparable';

export type Comparison = {
  pairs: number; days: number;
  blendMae: number; equalMae: number | null;
  best: { source: Provider; mae: number };
  /** Days the blend beat the best single source, out of `days`. */
  blendWonDays: number;
};

export type AccuracyReport = {
  schemaVersion: 1;
  asOf: number; from: number; days: number;
  fusionVersion: string; matching: string; rainEvent: string;
  maturity: Maturity;
  independentDays: number;
  sources: ReportSource[];
  /** Target hours, so missing forecasts or truth can't quietly vanish from the scores. */
  coverage: { expected: number; withForecast: number; withTruth: number; paired: number; pending: number };
  temperature: Record<string, Record<BucketId, Stat>>;
  wind: Record<string, Stat>;
  rain: Record<string, { n: number; brier: number | null; baseRate: number | null }>;
  comparison: Comparison | null;
};

const bucketOf = (lead: number) => BUCKETS.find(b => (b.leads as readonly number[]).includes(lead))!.id;

/** Picks the nearest station that actually has the value. */
function truthFor<K extends 'tempC' | 'windMs' | 'wet'>(rows: TruthRow[] | undefined, k: K): TruthRow[K] | null {
  const hit = (rows ?? []).filter(r => r[k] != null).sort((a, b) => a.distanceKm - b.distanceKm)[0];
  return hit ? hit[k] : null;
}

export function buildReport(forecasts: ForecastRow[], truth: TruthRow[], o: { now: number; days: number; trackingStart: number | null; scope?: string; fusionVersion?: string }): AccuracyReport {
  const asOf = o.now;
  const from = asOf - o.days * DAY;
  const selectedVersion = o.fusionVersion ?? FUSION_VERSION;
  const scopes = new Set([...forecasts, ...truth].map(r => r.scope));
  if (!o.scope && scopes.size > 1) throw new Error('Accuracy reports require one explicit location scope.');
  const known = forecasts.filter(r => (!o.scope || r.scope === o.scope) && r.fusionVersion === selectedVersion && r.availableAt <= r.target - r.lead * HOUR && r.target >= from && r.capturedAt <= asOf && r.capturedAt <= r.target - r.lead * HOUR);
  const truths = new Map<number, TruthRow[]>();
  for (const t of truth) {
    if (t.availableAt > asOf || (o.scope && t.scope !== o.scope)) continue;
    truths.set(t.target, [...(truths.get(t.target) ?? []), t]);
  }

  // An hour is scored only after its readings have had time to arrive.
  const lastHour = Math.floor((asOf - TRUTH_GRACE_MS) / HOUR) * HOUR;
  const pending = new Set(known.filter(r => r.target > lastHour && r.target <= asOf).map(r => r.target)).size;

  // Slots keyed by (target, lead) so sources compare only on shared cases.
  const slots = new Map<string, ForecastRow[]>();
  for (const r of known) {
    if (r.target > lastHour) continue;
    const k = `${r.target}|${r.lead}`;
    slots.set(k, [...(slots.get(k) ?? []), r]);
  }

  const temperature: AccuracyReport['temperature'] = {};
  const tempSums: Record<string, Record<string, Sums>> = {};
  const windSums: Record<string, Sums> = {};
  const rainSums: Record<string, { n: number; sq: number; wet: number }> = {};
  const scoreTemp = (src: string, lead: number, e: number) => add(((tempSums[src] ??= {})[bucketOf(lead)] ??= zero()), e);

  const providers = [...new Set(known.map(r => r.source))].filter((s): s is Provider => s !== 'blend').sort();
  const matched: { day: number; errs: Record<string, number> }[] = [];
  const paired = new Set<number>();

  for (const rows of slots.values()) {
    const { target, lead } = rows[0];
    const t = truths.get(target);
    const obsT = truthFor(t, 'tempC'), obsW = truthFor(t, 'windMs'), wet = truthFor(t?.filter(r => r.rainEvent === RAIN_EVENT), 'wet');
    const singles = rows.filter(r => r.source !== 'blend' && r.tempC != null);
    if (obsT != null) {
      if (rows.some(r => r.tempC != null)) paired.add(target);
      const errs: Record<string, number> = {};
      for (const r of rows) {
        if (r.tempC == null) continue;
        errs[r.source] = r.tempC - obsT;
        scoreTemp(r.source, lead, errs[r.source]);
      }
      if (singles.length >= 2) {
        errs.equal = singles.reduce((s, r) => s + r.tempC!, 0) / singles.length - obsT;
        scoreTemp('equal', lead, errs.equal);
      }
      if (errs.blend != null && providers.length >= 2 && providers.every(p => errs[p] != null)) {
        matched.push({ day: Math.floor(target / DAY), errs });
      }
    }
    for (const r of rows) {
      if (obsW != null && r.windMs != null) add((windSums[r.source] ??= zero()), r.windMs - obsW);
      if (wet != null && r.pop != null) {
        const s = (rainSums[r.source] ??= { n: 0, sq: 0, wet: 0 });
        const y = wet ? 1 : 0;
        s.n++; s.sq += (r.pop - y) ** 2; s.wet += y;
      }
    }
  }

  for (const [src, cells] of Object.entries(tempSums)) {
    temperature[src] = Object.fromEntries(BUCKETS.map(b => [b.id, stat(cells[b.id] ?? zero())])) as Record<BucketId, Stat>;
  }

  const start = Math.max(from, o.trackingStart ?? asOf);
  const firstHour = Math.ceil(start / HOUR) * HOUR;
  const expected = lastHour >= firstHour ? (lastHour - firstHour) / HOUR + 1 : 0;
  const inRange = (t: number) => t >= firstHour && t <= lastHour;
  const forecastHours = new Set(known.map(r => r.target).filter(inRange));
  const truthHours = [...truths.keys()].filter(inRange);
  const days = new Set([...paired].map(t => Math.floor(t / DAY))).size;
  const maturity: Maturity = days < COLLECTING_DAYS ? 'collecting' : days < COMPARABLE_DAYS ? 'provisional' : 'comparable';

  const mae = (src: string) => {
    const hits = matched.filter(m => m.errs[src] != null);
    return hits.length ? hits.reduce((s, m) => s + Math.abs(m.errs[src]), 0) / hits.length : null;
  };
  let comparison: Comparison | null = null;
  if (matched.length) {
    const best = providers.map(p => ({ source: p, mae: mae(p)! })).sort((a, b) => a.mae - b.mae || a.source.localeCompare(b.source))[0];
    const byDay = new Map<number, { blend: number; best: number; n: number }>();
    for (const m of matched) {
      const d = byDay.get(m.day) ?? { blend: 0, best: 0, n: 0 };
      d.blend += Math.abs(m.errs.blend); d.best += Math.abs(m.errs[best.source]); d.n++;
      byDay.set(m.day, d);
    }
    comparison = {
      pairs: matched.length, days: byDay.size, blendMae: mae('blend')!, equalMae: mae('equal'), best,
      blendWonDays: [...byDay.values()].filter(d => d.blend < d.best).length,
    };
  }

  return {
    schemaVersion: 1, asOf, from, days: o.days, fusionVersion: selectedVersion, matching: MATCHING.policy, rainEvent: RAIN_EVENT,
    maturity, independentDays: days, sources: Object.keys(temperature) as ReportSource[],
    coverage: { expected, withForecast: forecastHours.size, withTruth: truthHours.length, paired: [...paired].filter(inRange).length, pending },
    temperature,
    wind: Object.fromEntries(Object.entries(windSums).map(([k, v]) => [k, stat(v)])),
    rain: Object.fromEntries(Object.entries(rainSums).map(([k, s]) => [k, { n: s.n, brier: s.n ? s.sq / s.n : null, baseRate: s.n ? s.wet / s.n : null }])),
    comparison,
  };
}

/** One line for each record, in the spec's reviewable JSONL envelope. */
export function toJsonl(forecasts: ForecastRow[], truth: TruthRow[], now: number, safeguards: SafeguardEvent[] = []): string {
  const line = (event_type: string, id: string, occurred: number, payload: unknown) => JSON.stringify({
    schema_version: 1, event_type, event_id: id, occurred_at: new Date(occurred).toISOString(), recorded_at: new Date(now).toISOString(),
    producer: 'sky-peek', environment: 'device', payload,
  });
  return [
    ...forecasts.map(r => line('source_forecast', r.id, r.capturedAt, r)),
    ...truth.map(r => line('observation', r.id, r.target, r)),
    ...safeguards.map(r => line('safeguard', r.id, r.firstAt, r)),
  ].join('\n');
}
