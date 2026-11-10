// Field-specific blending. Budget never touches this file: a source's trust
// depends on its data, not on how much quota it has left. If nothing eligible
// remains the answer is null, never a made-up value.

import { FUTURE_TOLERANCE_MS, HALF_LIFE_MS, HARD_AGE, prior, TRIGGERS, UNKNOWN_AGE_FRESHNESS } from './config';
import type { Agreement, Batch, Cond, Contribution, Fact, Point, Provider, Semantics } from './types';

export type FuseContext = { now: number; nwsCovers: boolean; event: boolean };

/** Why a batch can't be used right now, or null if it can. */
export function ineligible(b: Batch, c: FuseContext): string | null {
  if (b.availableAt > c.now + FUTURE_TOLERANCE_MS || (b.issuedAt ?? 0) > c.now + FUTURE_TOLERANCE_MS) return 'future_timestamp';
  if (b.issuedAt == null) return c.now - b.firstSeenAt > HARD_AGE.unknownAgeMs ? 'unknown_age_past_cap' : null;
  const age = c.now - b.issuedAt;
  if (b.product === 'daily') return age > HARD_AGE.dailyMs ? 'too_old' : null;
  const h = HARD_AGE.hourly;
  const cap = !c.event ? h.routineMs : b.provider === 'nws' ? h.nwsEventMs : h.eventMs;
  return age > cap ? 'too_old' : null;
}

/** r = prior × learned skill (1 until verified) × freshness. Spatial fit and quality are 1 for now. */
function rawWeight(b: Batch, halfLife: number, c: FuseContext): number {
  const fresh = b.issuedAt == null
    ? UNKNOWN_AGE_FRESHNESS
    : Math.exp((-Math.LN2 * Math.max(0, c.now - b.issuedAt)) / halfLife);
  return prior(b.provider, c.nwsCovers) * fresh;
}

type Row<T> = { provider: Provider; value: T; r: number };

function normalize<T>(rows: Row<T>[]): (Row<T> & { w: number })[] {
  const sum = rows.reduce((s, x) => s + x.r, 0);
  return rows.map(x => ({ ...x, w: x.r / sum }));
}

/** Weighted mean, or null with no inputs. Returns the weights that were used. */
export function blend(rows: Row<number>[]): { value: number; weights: Contribution[]; spread: number } | null {
  if (!rows.length) return null;
  const n = normalize(rows);
  const vals = rows.map(x => x.value);
  return {
    value: n.reduce((s, x) => s + x.w * x.value, 0),
    weights: n.map(x => ({ provider: x.provider, weight: x.w })),
    spread: Math.max(...vals) - Math.min(...vals),
  };
}

export type WindResult = { speedMs: number; deg: number | null; variable: boolean };

/** Blends in u/v components so 359° and 1° point north. Opposing winds report as variable, not calm. */
export function blendWind(rows: Row<{ s: number; deg: number | null }>[]): WindResult | null {
  if (!rows.length) return null;
  const n = normalize(rows);
  const scalar = n.reduce((a, x) => a + x.w * x.value.s, 0);
  const dir = n.filter(x => x.value.deg != null && x.value.s > 0);
  if (!dir.length) return { speedMs: scalar, deg: null, variable: false };
  // Direction comes from the sources that gave one, reweighted among themselves.
  const total = dir.reduce((a, x) => a + x.w, 0);
  const rad = Math.PI / 180;
  let u = 0, v = 0;
  for (const x of dir) {
    u += (-x.w / total) * x.value.s * Math.sin(x.value.deg! * rad);
    v += (-x.w / total) * x.value.s * Math.cos(x.value.deg! * rad);
  }
  const mag = Math.hypot(u, v);
  const dirScalar = dir.reduce((a, x) => a + (x.w / total) * x.value.s, 0);
  if (dirScalar > 0 && mag / dirScalar < 0.5) return { speedMs: scalar, deg: null, variable: true };
  const deg = Math.round((Math.atan2(-u, -v) / rad + 360) % 360) % 360;
  // A sourceless direction can't shorten the vector, so a partial set keeps the scalar speed.
  return { speedMs: dir.length === n.length ? mag : scalar, deg, variable: false };
}

/** The value at a time: exact, or interpolated for continuous fields within a declared gap. */
export function pointAt(b: Batch, t: number): { p: Point; interpolated: boolean } | null {
  const pts = b.points;
  const exact = pts.find(p => p.start === t);
  if (exact) return { p: exact, interpolated: false };
  const stepMs = b.semantics.stepHours * 3_600_000;
  const i = pts.findIndex(p => p.start > t);
  if (i <= 0) return null;
  const a = pts[i - 1], z = pts[i];
  if (z.start - a.start > b.semantics.maxInterpHours * 3_600_000 || z.start - a.start > stepMs) return null;
  const f = (t - a.start) / (z.start - a.start);
  const mix = (x: number | null, y: number | null) => (x == null || y == null ? null : x + (y - x) * f);
  // Direction goes the short way round. Probabilities and gust maxima aren't interpolated.
  const turn = a.windDeg == null || z.windDeg == null ? null : ((z.windDeg - a.windDeg + 540) % 360) - 180;
  const windDeg = turn == null ? null : (a.windDeg! + turn * f + 360) % 360;
  return {
    interpolated: true,
    p: { ...a, start: t, end: t + 3_600_000, tempC: mix(a.tempC, z.tempC), dewC: mix(a.dewC, z.dewC), windMs: mix(a.windMs, z.windMs), cloud: mix(a.cloud, z.cloud), gustMs: null, windDeg, pop: null },
  };
}

export type FusedHour = {
  tempC: number | null; dewC: number | null;
  wind: WindResult | null; pop: number | null; popEvent: Semantics['pop'];
  cond: Cond; text: string; thunderPossible: boolean;
  sources: Contribution[]; agreement: Agreement; flags: string[];
  spreads: { pop: number; tempC: number; windMs: number };
};

const POP_EVENTS = (b: Batch) => b.semantics.pop;
const WET: Cond[] = ['rain', 'snow', 'mixed', 'freezing', 'thunder'];
const FROZEN: Cond[] = ['snow', 'mixed', 'freezing'];

function agreementOf(n: number, spreadC: number): Agreement {
  if (n < 2) return 'single';
  return spreadC <= 1.5 ? 'high' : spreadC <= TRIGGERS.tempSpreadC ? 'medium' : 'low';
}

export function fuseHour(t: number, batches: Batch[], c: FuseContext): FusedHour {
  const live = batches
    .filter(b => !ineligible(b, c))
    .map(b => ({ b, at: pointAt(b, t), r: rawWeight(b, HALF_LIFE_MS.hourly, c) }))
    .filter((x): x is typeof x & { at: NonNullable<typeof x.at> } => !!x.at);
  const row = <T,>(pick: (p: Point, b: Batch) => T | null) => live.flatMap(x => {
    const value = pick(x.at.p, x.b);
    return value == null ? [] : [{ provider: x.b.provider, value, r: x.r }];
  });

  // Temperature and dew point share one source set, then dew point is held below temperature.
  const temp = blend(row(p => p.tempC));
  let dew = blend(row(p => (p.tempC == null ? null : p.dewC)));
  const flags: string[] = [];
  if (live.some(x => x.at.interpolated)) flags.push('interpolated');
  if (temp && dew && dew.value > temp.value) {
    if (dew.value - temp.value <= 0.5) dew = { ...dew, value: temp.value };
    else { dew = null; flags.push('dew_point_above_temperature'); }
  }

  // Wind means blend only with wind means; a max-speed source is used only if nothing else exists.
  const means = row((p, b) => (p.windMs != null && b.semantics.wind === 'mean' ? { s: p.windMs, deg: p.windDeg } : null));
  const windRows = means.length ? means : row(p => (p.windMs != null ? { s: p.windMs, deg: p.windDeg } : null));
  const wind = blendWind(windRows);
  if (!means.length && windRows.length) flags.push('wind_support_unresolved');

  // Probabilities blend only inside one event definition. A true one-hour chance
  // always wins; anything else is used only if nothing better exists, and is labeled.
  const popBatches = live.filter(x => x.at.p.pop != null).sort((x, y) => y.r - x.r);
  const oneHour = popBatches.some(x => POP_EVENTS(x.b) === 'any_precip_1h');
  const event = oneHour ? 'any_precip_1h' : popBatches[0] && POP_EVENTS(popBatches[0].b);
  const pops = popBatches.filter(x => POP_EVENTS(x.b) === event);
  const pop = blend(pops.map(x => ({ provider: x.b.provider, value: x.at.p.pop!, r: x.r })));
  if (popBatches.length > pops.length) flags.push('pop_semantics_excluded');
  if (event && event !== 'any_precip_1h') flags.push(`pop_${event}`);

  // The condition comes whole from the heaviest source; only explicit evidence changes it.
  const top = [...live].sort((x, y) => y.r - x.r)[0];
  const conds = live.map(x => x.at.p.cond);
  let cond: Cond = top?.at.p.cond ?? 'unknown', text = top?.at.p.text ?? '';
  const phases = new Set(conds.filter(x => x === 'rain' || FROZEN.includes(x)));
  if (phases.size > 1 && conds.some(x => FROZEN.includes(x))) {
    cond = 'mixed'; text = 'Wintry precipitation possible'; flags.push('phase_disagreement');
  }

  const sources = (temp?.weights ?? live.map(x => ({ provider: x.b.provider, weight: 1 / live.length })));
  return {
    tempC: temp?.value ?? null, dewC: dew?.value ?? null, wind, pop: pop?.value ?? null, popEvent: event ?? null, cond, text,
    thunderPossible: conds.includes('thunder'), sources, agreement: agreementOf(temp?.weights.length ?? 0, temp?.spread ?? 0), flags,
    spreads: {
      pop: pop?.spread ?? 0, tempC: temp?.spread ?? 0,
      windMs: means.length > 1 ? Math.max(...means.map(x => x.value.s)) - Math.min(...means.map(x => x.value.s)) : 0,
    },
  };
}

/** Blends daily highs only from true daily products. NWS day periods count; sampled hours don't. */
export function fuseHigh(date: string, batches: Batch[], c: FuseContext): { hiC: number; sources: Contribution[] } | null {
  const rows = batches
    .filter(b => !ineligible(b, c) && b.semantics.days)
    .flatMap(b => {
      const value = b.days.find(d => d.date === date)?.hiC;
      return value == null ? [] : [{ provider: b.provider, value, r: rawWeight(b, HALF_LIFE_MS.daily, c) }];
    });
  const out = blend(rows);
  return out && { hiC: out.value, sources: out.weights };
}

export function observationOk(f: Fact, c: FuseContext): boolean {
  if (f.tempC == null || f.at > c.now + FUTURE_TOLERANCE_MS) return false;
  return c.now - f.at <= (c.event ? HARD_AGE.observationEventMs : HARD_AGE.observationMs);
}

export type Current = {
  kind: 'observation' | 'analysis' | 'forecast';
  at: number; tempC: number; windMs: number | null; windDeg: number | null; windVariable: boolean;
  cond: Cond; text: string; stationId?: string; distanceKm?: number; sources: Contribution[];
};

/** A good nearby observation wins outright; otherwise analyses blend and are labeled estimated. */
export function chooseCurrent(obs: Fact | null, analyses: { provider: Provider; fact: Fact }[], c: FuseContext): Current | null {
  if (obs && observationOk(obs, c)) {
    return {
      kind: 'observation', at: obs.at, tempC: obs.tempC!, windMs: obs.windMs, windDeg: obs.windDeg, windVariable: false,
      cond: obs.cond, text: obs.text, stationId: obs.stationId, distanceKm: obs.distanceKm, sources: [{ provider: 'nws', weight: 1 }],
    };
  }
  const ok = analyses.filter(a => observationOk(a.fact, c));
  const rows = ok.map(a => ({
    a, r: prior(a.provider, c.nwsCovers) * Math.exp((-Math.LN2 * Math.max(0, c.now - a.fact.at)) / HALF_LIFE_MS.current),
  }));
  const temp = blend(rows.map(x => ({ provider: x.a.provider, value: x.a.fact.tempC!, r: x.r })));
  if (!temp) return null;
  const wind = blendWind(rows.flatMap(x => (x.a.fact.windMs == null ? [] : [{ provider: x.a.provider, value: { s: x.a.fact.windMs, deg: x.a.fact.windDeg }, r: x.r }])));
  const top = [...rows].sort((x, y) => y.r - x.r)[0].a.fact;
  return {
    kind: 'analysis', at: top.at, tempC: temp.value, windMs: wind?.speedMs ?? null, windDeg: wind?.deg ?? null, windVariable: !!wind?.variable,
    cond: top.cond, text: top.text, sources: temp.weights,
  };
}

export const isWet = (c: Cond) => WET.includes(c);
