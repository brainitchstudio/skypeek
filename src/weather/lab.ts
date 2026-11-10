import { usage } from '@/api/budget';
import { buildReport, LEADS, type ForecastRow, type TruthRow } from './accuracy';
import { accuracyStore } from './accuracyStore';
import { geoScope, accuracyReport } from './service';
import { FUSION_VERSION } from './config';
import type { Place } from '@/lib/types';

export async function loadLab(place: Place, days: number, lead: number, version = FUSION_VERSION) {
  const now = Date.now(), scope = geoScope(place.lat, place.lon).id;
  const store = accuracyStore(), from = now - days * 86400000;
  const [forecasts, truth, events, meta, current] = await Promise.all([
    store.forecasts(scope, from), store.truth(scope, from), store.safeguards(scope, from), store.meta(scope), accuracyReport(place),
  ]);
  const selected = forecasts.filter(f => !lead || f.lead === lead);
  const report = buildReport(selected, truth, { now, days, scope, fusionVersion: version, trackingStart: meta?.trackingStart ?? null });
  return { budget: usage(now), now, scope, forecasts, truth, events, meta, health: current.auditHealth, report, versions: [...new Set([FUSION_VERSION, ...forecasts.map(f => f.fusionVersion)])], daily: dailyErrors(selected.filter(f => f.fusionVersion === version), truth, now) };
}

/** Descriptive trend, one explicit lead at a time; no inference of independent samples. */
export function dailyErrors(forecasts: ForecastRow[], truth: TruthRow[], now: number) {
  const groups = new Map<string, { day: string; source: string; n: number; abs: number; err: number }>();
  for (const f of forecasts) {
    if (f.tempC == null || f.target > now - 2 * 3600000 || f.capturedAt > f.target - f.lead * 3600000 || f.availableAt > f.target - f.lead * 3600000) continue;
    const t = truth.filter(t => t.scope === f.scope && t.target === f.target && t.availableAt <= now && t.tempC != null).sort((a, b) => a.distanceKm - b.distanceKm)[0];
    if (!t) continue;
    const day = new Date(f.target).toISOString().slice(0, 10), key = `${day}|${f.source}`;
    const g = groups.get(key) ?? { day, source: f.source, n: 0, abs: 0, err: 0 };
    const e = f.tempC - t.tempC!; g.n++; g.abs += Math.abs(e); g.err += e; groups.set(key, g);
  }
  return [...groups.values()].sort((a, b) => a.day.localeCompare(b.day)).map(g => ({ ...g, mae: g.abs / g.n, bias: g.err / g.n }));
}
export { LEADS };
