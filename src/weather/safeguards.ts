// The checks that stand between provider data and the screen, plus the record of
// each time one fired: what happened, why, and what was done instead. Values that
// fail are removed, never adjusted or guessed, so the next real source or a blank
// takes their place.

import { fuseHour, ineligible, type FuseContext } from './fusion';
import { cToF, msToMph } from './units';
import type { Batch, DayFact, Fact, Point, Provider } from './types';
import type { Hour } from '@/lib/types';
import type { NwsPeriod } from '@/lib/forecast';

/** Product guardrails for supported surface variables; not universal physical limits. */
export const LIMITS = {
  tempC: [-90, 60], dewC: [-100, 60], windMs: [0, 115], gustMs: [0, 150], windDeg: [0, 360], pop: [0, 1], cloud: [0, 1], visM: [0, 500_000],
} as const;
type LimitField = keyof typeof LIMITS;

const LABEL: Record<LimitField, string> = {
  tempC: 'temperature', dewC: 'dew point', windMs: 'wind speed', gustMs: 'wind gust', windDeg: 'wind direction', pop: 'rain chance', cloud: 'cloud cover', visM: 'visibility',
};

/** A share of bad temperatures this large means the response is broken, not one value. */
export const QUARANTINE_SHARE = 0.2;

export type Rule =
  | 'out_of_range' | 'response_quarantined' | 'unreadable_response' | 'source_excluded' | 'station_rejected'
  | 'rain_chance_mismatch' | 'rain_chance_labeled' | 'wind_unresolved' | 'dew_point_conflict' | 'phase_disagreement'
  | 'source_disagreement' | 'blank_value' | 'stale_forecast' | 'alert_feed_stale' | 'nothing_to_show';

export type Outcome = 'fallback' | 'blank' | 'kept_last_good' | 'labeled' | 'warned' | 'kept_all';

export type Draft = {
  rule: Rule; source: string; field?: string;
  why: string; action: string; outcome: Outcome;
  sample?: string; target?: number; count?: number;
};

export type SafeguardEvent = {
  id: string; scope: string; rule: Rule; source: string; field: string | null;
  firstAt: number; lastAt: number; count: number;
  why: string; action: string; outcome: Outcome; sample: string | null;
  countUnit?: 'removed_values' | 'audit_runs' | 'responses';
};

const DAY = 86_400_000, HOUR = 3_600_000;

export const inLimits = (f: LimitField, v: number | null) => v == null || (Number.isFinite(v) && v >= LIMITS[f][0] && v <= LIMITS[f][1]);

type Sanitizable = { points: Point[]; days: DayFact[]; fact: Fact | null; periods?: NwsPeriod[] };

/**
 * Checks one normalized response. Bad fields become null. If too much of it is
 * bad, `quarantined` is set and the caller must keep the last good copy instead.
 */
export function sanitize<T extends Sanitizable>(n: T, source: Provider, name: string): { clean: T; drafts: Draft[]; quarantined: string | null } {
  const tally = new Map<LimitField, { count: number; sample: number; target?: number }>();
  const bad = (field: LimitField, v: number | null, target?: number) => {
    if (inLimits(field, v)) return false;
    const t = tally.get(field);
    tally.set(field, { count: (t?.count ?? 0) + 1, sample: t?.sample ?? (v as number), target: t?.target ?? target });
    return true;
  };

  const fields = ['tempC', 'dewC', 'windMs', 'gustMs', 'windDeg', 'pop', 'cloud'] as const;
  const points = n.points.flatMap(p => {
    if (!Number.isFinite(p.start) || !Number.isFinite(p.end) || p.end <= p.start) return [];
    const out = { ...p };
    for (const f of fields) if (bad(f, out[f], p.start)) out[f] = null as never;
    return [out];
  });
  const days = n.days.map(d => {
    const hiBad = bad('tempC', d.hiC), loBad = bad('tempC', d.loC);
    return { ...d, hiC: hiBad ? null : d.hiC, loC: loBad ? null : d.loC };
  });
  let fact = n.fact;
  if (fact) {
    fact = { ...fact };
    for (const f of ['tempC', 'dewC', 'windMs', 'gustMs', 'windDeg', 'visM'] as const) if (bad(f, fact[f])) fact[f] = null;
  }
  // Screens read NWS periods directly, so they must be as clean as the points. Hourly
  // periods repeat the points already counted above; daily ones are only checked here.
  const log = !n.points.length;
  const periods = n.periods?.flatMap(p => {
    if (typeof p.temperature !== 'number' || !inLimits('tempC', ((p.temperature - 32) * 5) / 9)) return [];
    const pop = p.probabilityOfPrecipitation?.value ?? null, popC = pop == null ? null : pop / 100;
    const mph = (String(p.windSpeed ?? '').match(/\d+/g) ?? []).map(Number), fastest = mph.length ? Math.max(...mph) * 0.44704 : null;
    const popBad = log ? bad('pop', popC) : !inLimits('pop', popC), windBad = log ? bad('windMs', fastest) : !inLimits('windMs', fastest);
    return [{ ...p, ...(popBad ? { probabilityOfPrecipitation: { value: null } } : {}), ...(windBad ? { windSpeed: '' } : {}) }];
  });

  const badTemps = tally.get('tempC')?.count ?? 0;
  const total = n.points.filter(p => p.tempC != null).length + n.days.filter(d => d.hiC != null).length + n.days.filter(d => d.loC != null).length + (n.fact?.tempC != null ? 1 : 0);
  if (badTemps / Math.max(1, total) > QUARANTINE_SHARE) {
    const why = `${badTemps} of ${total} temperatures from ${name} failed configured guardrails, for example ${plain('tempC', tally.get('tempC')!.sample)}.`;
    return { clean: n, quarantined: why, drafts: [{
      rule: 'response_quarantined', source, field: 'temperature', why, sample: fmt('tempC', tally.get('tempC')!.sample),
      action: `Threw out this whole response and kept using the last good one from ${name}.`, outcome: 'kept_last_good',
    }] };
  }

  const drafts: Draft[] = [...tally].map(([f, t]) => ({
    rule: 'out_of_range', source, field: LABEL[f], count: t.count, sample: fmt(f, t.sample), target: f === 'tempC' || f === 'windMs' || f === 'pop' ? t.target : undefined,
    why: `${name} sent a ${LABEL[f]} of ${plain(f, t.sample)}, outside the configured range of ${plain(f, LIMITS[f][0])} to ${plain(f, LIMITS[f][1])}.`,
    action: 'Removed the value. It was not adjusted or replaced with a guess.', outcome: 'fallback',
  }));
  return { clean: { ...n, points, days, fact, ...(periods ? { periods } : {}) }, drafts, quarantined: null };
}

function fmt(f: LimitField, v: number): string {
  const unit: Record<LimitField, string> = { tempC: '°C', dewC: '°C', windMs: ' m/s', gustMs: ' m/s', windDeg: '°', pop: '', cloud: '', visM: ' m' };
  return `${Number.isFinite(v) ? +v.toFixed(2) : String(v)}${unit[f]}`;
}

/** For reading in the log: °F and mph. `sample` keeps the stored units for the export. */
function plain(f: LimitField, v: number): string {
  if (!Number.isFinite(v)) return String(v);
  if (f === 'tempC' || f === 'dewC') return `${Math.round(cToF(v))}°F`;
  if (f === 'windMs' || f === 'gustMs') return `${Math.round(msToMph(v))} mph`;
  if (f === 'pop' || f === 'cloud') return `${Math.round(v * 100)}%`;
  return fmt(f, v);
}

/** Fills in what a removed value's hour actually fell back to. */
export function resolve(d: Draft, batches: Batch[], c: FuseContext, nameOf: (p: Provider) => string, shownHours?: Hour[]): Draft {
  if (d.rule !== 'out_of_range' || d.target == null) return d;
  if (shownHours) {
    const hour = shownHours.find(h => Date.parse(h.start) === d.target);
    const value = !hour ? null : d.field === 'temperature' ? hour.tempF : d.field === 'wind speed' ? hour.windMph : hour.pop;
    return { ...d, outcome: value == null ? 'blank' : 'fallback', action: value == null
      ? 'Removed the value. The assembled snapshot has no replacement for the sampled field/hour.'
      : 'Removed the value. The assembled snapshot contains a replacement for the sampled field/hour. This does not identify field-specific provider contributions.' };
  }
  const f = fuseHour(d.target, batches, c);
  const value = d.field === 'temperature' ? f.tempC : d.field === 'wind speed' ? f.wind : f.pop;
  const others = value == null ? [] : f.sources.map(s => s.provider).filter(p => p !== d.source);
  return others.length
    ? { ...d, action: `Removed the value. Recomputed fusion has a replacement for that hour; participating temperature sources: ${others.map(nameOf).join(', ')}. Display fallback is not independently confirmed.`, outcome: 'fallback' }
    : { ...d, action: 'Removed the value. Recomputed fusion has no replacement for this field; display outcome is not independently confirmed.', outcome: 'blank' };
}

const PER_SOURCE_REASON: Record<string, string> = {
  too_old: 'its forecast is older than the age limit',
  unknown_age_past_cap: 'it gives no issue time and its content hasn’t changed in over 6 hours',
  future_timestamp: 'its timestamp is in the future',
};

/** Looks over what's about to be shown and records every rule that shaped it. */
export function audit(batches: Batch[], c: FuseContext, nameOf: (p: Provider) => string, o: { forecastShown: boolean; staleSince: number | null; alertsStale: boolean }): Draft[] {
  const out: Draft[] = [];
  for (const b of batches) {
    const why = b.points.length || b.days.length ? ineligible(b, c) : null;
    if (why) out.push({
      rule: 'source_excluded', source: b.provider, why: `${nameOf(b.provider)} was left out because ${PER_SOURCE_REASON[why] ?? why}.`,
      action: 'Blended the remaining sources without it.', outcome: 'fallback',
    });
  }

  const start = Math.ceil(c.now / HOUR) * HOUR;
  const flags = new Map<string, number>();
  let blankWind = 0, blankPop = 0, spreadHours = 0, worst = 0;
  for (let t = start; t < start + 48 * HOUR; t += HOUR) {
    const f = fuseHour(t, batches, c);
    if (f.tempC == null) continue;
    for (const x of f.flags) flags.set(x, (flags.get(x) ?? 0) + 1);
    if (!f.wind) blankWind++;
    if (f.pop == null) blankPop++;
    if (f.spreads.tempC > 3) { spreadHours++; worst = Math.max(worst, f.spreads.tempC); }
  }
  const hrs = (n: number) => `${n} of the next 48 hours`;
  const count = (k: string) => flags.get(k) ?? 0;
  const add = (d: Draft) => out.push(d);
  if (count('pop_semantics_excluded')) add({
    rule: 'rain_chance_mismatch', source: 'blend', field: 'rain chance',
    why: `For ${hrs(count('pop_semantics_excluded'))}, some sources gave a rain chance with a different meaning, such as rain only or a 3-hour window.`,
    action: 'Used only the matching one-hour chances and left the others out.', outcome: 'fallback',
  });
  for (const [k, label] of [['pop_rain_only_1h', 'rain only, so snow isn’t counted'], ['pop_any_precip_3h', 'for a 3-hour window']] as const) {
    if (count(k)) add({
      rule: 'rain_chance_labeled', source: 'blend', field: 'rain chance',
      why: `For ${hrs(count(k))}, the only rain chance available was ${label}.`,
      action: 'Showed it with a label instead of presenting it as a normal hourly chance.', outcome: 'labeled',
    });
  }
  if (count('wind_support_unresolved')) add({
    rule: 'wind_unresolved', source: 'blend', field: 'wind speed',
    why: `For ${hrs(count('wind_support_unresolved'))}, the only wind data may be a maximum, not an average.`, action: 'Showed that one source without blending it.', outcome: 'kept_all',
  });
  if (count('dew_point_above_temperature')) add({
    rule: 'dew_point_conflict', source: 'blend', field: 'dew point',
    why: `For ${hrs(count('dew_point_above_temperature'))}, the blended dew point came out above the temperature, which can’t happen.`, action: 'Removed the dew point for those hours.', outcome: 'blank',
  });
  if (count('phase_disagreement')) add({
    rule: 'phase_disagreement', source: 'blend',
    why: `For ${hrs(count('phase_disagreement'))}, sources disagreed on rain versus snow or ice.`, action: 'Showed “Wintry precipitation possible” instead of picking a side.', outcome: 'labeled',
  });
  if (spreadHours) add({
    rule: 'source_disagreement', source: 'blend', field: 'temperature', sample: `${+worst.toFixed(1)}°C`,
    why: `For ${hrs(spreadHours)}, sources disagreed on temperature by more than 3°C, up to ${+worst.toFixed(1)}°C.`,
    action: 'Kept every source, since a real front can look like this, and marked the event for faster refreshes.', outcome: 'kept_all',
  });
  if (blankWind) add({ rule: 'blank_value', source: 'blend', field: 'wind speed', why: `No usable wind value for ${hrs(blankWind)}.`, action: 'Left wind blank instead of showing 0 mph.', outcome: 'blank' });
  if (blankPop) add({ rule: 'blank_value', source: 'blend', field: 'rain chance', why: `No usable rain chance for ${hrs(blankPop)}.`, action: 'Left it blank instead of showing 0%.', outcome: 'blank' });
  if (o.staleSince) add({
    rule: 'stale_forecast', source: 'blend', why: `The forecast couldn’t be refreshed. The newest copy is from ${new Date(o.staleSince).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}.`,
    action: 'Kept showing it with a warning on screen, until it passes its age limit.', outcome: 'warned',
  });
  if (o.alertsStale) add({ rule: 'alert_feed_stale', source: 'nws', why: 'Alerts haven’t been checked in over 3 minutes.', action: 'Kept the last known alerts and showed a warning.', outcome: 'warned' });
  if (!o.forecastShown) add({ rule: 'nothing_to_show', source: 'blend', why: 'No source had a usable forecast for this place.', action: 'Showed a message instead of inventing numbers.', outcome: 'blank' });
  return out;
}

/** One record per rule, source and field per UTC day, so a repeat raises a count instead of adding a line. */
export function toEvent(scope: string, d: Draft, now: number): SafeguardEvent {
  return {
    id: `${scope}|${Math.floor(now / DAY)}|${d.rule}|${d.source}|${d.field ?? ''}|${d.outcome}`, scope, rule: d.rule, source: d.source, field: d.field ?? null,
    countUnit: d.rule === 'out_of_range' ? 'removed_values' : ['response_quarantined', 'unreadable_response'].includes(d.rule) ? 'responses' : 'audit_runs',
    firstAt: now, lastAt: now, count: d.count ?? 1, why: d.why, action: d.action, outcome: d.outcome, sample: d.sample ?? null,
  };
}

export function mergeEvent(old: SafeguardEvent | undefined, next: SafeguardEvent): SafeguardEvent {
  return old ? { ...next, firstAt: old.firstAt, count: old.count + next.count, sample: old.sample ?? next.sample } : next;
}
