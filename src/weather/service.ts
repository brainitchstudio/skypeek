import { recordDiagnostic } from './diagnostics';
// The app's weather service. Screens call tick() and render what comes back;
// nothing else talks to a forecast provider. Each tick looks at what is stale,
// asks the planner what's worth fetching, charges the ledger, stores immutable
// batches and rebuilds the snapshot from what's stored.

import { bench, cooldownFor429, dispatch, recordFailure, recordSuccess, release, reserve, room, type Lane, type SourceId } from '@/api/budget';
import { getExtended, getPoint, savedPoint, type NwsPoint } from '@/api/weather';
import { mapAlert, sortAlerts, type NwsAlertFeature } from '@/lib/alerts';
import { buildForecast } from '@/lib/forecast';
import { dateKey, iconFor } from '@/lib/format';
import type { Forecast, Hour, Place, WeatherAlert } from '@/lib/types';
import { ADAPTERS, fingerprint, type FetchPlan } from './adapters';
import { buildReport, forecastRows, MATCHING, toJsonl, truthRows, type AccuracyReport, type StationRef } from './accuracy';
import { accuracyStore, pruneCutoff } from './accuracyStore';
import { activeRecords, applyPoll, notifyKey, type AlertState } from './alertState';
import { audit, resolve, sanitize, toEvent, type Draft, type SafeguardEvent } from './safeguards';
import { ALERT_POLL_MS, ALERT_STALE_MS, COMMERCIAL, ENABLED, FUSION_VERSION, INITIAL_CHANGE_P, key, MAPPING_VERSION, OBS_LIMITS, POINT_TTL_MS, TIMEOUT_MS, TRIGGERS } from './config';
import { accelerating, CALM_TRACK, step, type Evidence, type EventKind, type Tracks } from './events';
import { chooseCurrent, fuseHigh, fuseHour, ineligible, isWet, observationOk, type Current, type FuseContext, type FusedHour } from './fusion';
import { planFetches, type Job } from './planner';
import { loadAlerts, loadJson, loadScope, mergeBatch, saveJson, type Scope, type Station } from './store';
import type { Batch, Fact, Product, ProductState, Provider, ProviderFailure } from './types';
import { cToF, distanceKm, isDaylight, msToMph } from './units';

const MIN = 60_000, HOUR = 60 * MIN;
/** Past this a forecast is shown with a warning: the slowest refresh setting is an hour. */
const STALE_AFTER_MS = 2 * HOUR;
/** Logging is never worth holding up a refresh. */
const ARCHIVE_TIMEOUT_MS = 4000;
const NWS_API = 'https://api.weather.gov';

export const PROVIDER_NAMES: Record<Provider, string> = { nws: 'National Weather Service', openweather: 'OpenWeather', tomorrow: 'Tomorrow.io', weatherapi: 'WeatherAPI' };

export type WeatherRequest = {
  place: Pick<Place, 'lat' | 'lon'>;
  keys: Partial<Record<Provider, string>>;
  userMinutes: number;
  manual?: boolean;
  /** Tab hidden: keep alerts running, spend nothing on forecasts. */
  background?: boolean;
  onUpdate?: (s: WeatherSnapshot) => void;
};

export type NowConditions = {
  kind: Current['kind']; tempF: number; condition: string; windMph: number | null; windDeg: number | null; windVariable: boolean;
  at: number; stationId?: string; distanceKm?: number; sources: Provider[];
};

export type AlertFeed = { status: 'fresh' | 'stale' | 'unknown' | 'unsupported'; checkedAt: number | null };

export type SourceStatus = { provider: Provider; name: string; role: string; note: string; healthy: boolean };

export type WeatherSnapshot = {
  fusionVersion: string;
  generatedAt: number;
  forecast: Forecast | null;
  forecastFetchedAt: number | null;
  /** When the shown forecast was fetched, if it should be newer by now. */
  staleSince: number | null;
  now: NowConditions | null;
  alerts: WeatherAlert[];
  alertFeed: AlertFeed;
  nowcast: { status: 'unavailable'; reason: string };
  sources: SourceStatus[];
  nwsCovers: boolean | null;
  error: string | null;
  eventActive: boolean;
};

export const geoScope = (lat: number, lon: number) => {
  const wrapped = ((lon + 540) % 360) - 180;
  const y = Math.round(lat / 0.02), x = Math.round(wrapped / 0.02);
  return { id: `geo:${y}:${x}`, lat: +(y * 0.02).toFixed(4), lon: +(x * 0.02).toFixed(4) };
};

const placeId = (p: Pick<Place, 'lat' | 'lon'>) => `${p.lat.toFixed(4)},${p.lon.toFixed(4)}`;
const nwsScopeId = (pt: NwsPoint) => `nws:${pt.gridId}/${pt.gridX},${pt.gridY}`;

const hashKey = (k: string) => [...k].reduce((h, c) => ((h * 33) ^ c.charCodeAt(0)) >>> 0, 5381).toString(36);
const DISABLED = 'disabled';
const disabled = () => loadJson<Partial<Record<Provider, string>>>(DISABLED, () => ({}));

function connected(keys: WeatherRequest['keys']): Provider[] {
  const off = disabled();
  return COMMERCIAL.filter(p => ENABLED[p] && keys[p] && off[p] !== hashKey(keys[p]!));
}

// ---- fetching ---------------------------------------------------------------

type Outcome = { ok: true; json: unknown; headers: Headers; at: number } | { ok: false; failure?: ProviderFailure; denied?: boolean };

/** Charges the ledger, then sends. Timed-out and failed attempts stay charged. */
async function guarded(plan: FetchPlan, lane: Lane, signalKey?: string): Promise<Outcome> {
  const r = reserve(plan.source, plan.units, lane);
  if (!r) return { ok: false, denied: true };
  if (!dispatch(r)) { release(r); return { ok: false, denied: true }; }
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), plan.timeoutMs);
  try {
    const res = await fetch(plan.url, { signal: ctl.signal, headers: { accept: plan.provider === 'nws' ? 'application/geo+json' : 'application/json' } });
    const at = Date.now();
    if (res.ok) {
      const json = await res.json();
      recordSuccess(plan.source);
      return { ok: true, json, headers: res.headers, at };
    }
    const body = await res.json().catch(() => null);
    const failure = ADAPTERS[plan.provider].classifyError(res.status, body);
    applyFailure(plan, failure, res.headers, signalKey);
    return { ok: false, failure };
  } catch {
    recordFailure(plan.source);
    return { ok: false, failure: { kind: 'network', message: `Could not reach ${PROVIDER_NAMES[plan.provider]}` } };
  } finally {
    clearTimeout(timer);
  }
}

function applyFailure(plan: FetchPlan, f: ProviderFailure, headers: Headers, apiKey?: string) {
  // The breaker is for outages. Any other answer means the service is up.
  if (f.kind === 'server') recordFailure(plan.source); else recordSuccess(plan.source);
  if (f.kind === 'rate') cooldownFor429(plan.source, headers.get('retry-after'));
  else if (f.kind === 'quota') bench(plan.source, f.resetAt ? f.resetAt - Date.now() : 24 * HOUR);
  else if ((f.kind === 'auth' || f.kind === 'entitlement') && apiKey) {
    saveJson(DISABLED, { ...disabled(), [plan.provider]: hashKey(apiKey) }, Date.now());
  }
}

/** The provider's own cache lifetime, when it gave one. */
function maxAgeMs(h: Headers): number {
  const cc = h.get('cache-control') ?? '';
  const m = /max-age=(\d+)/.exec(cc);
  if (!m) return 0;
  return Math.max(0, +m[1] - +(h.get('age') ?? 0)) * 1000;
}

function storeBatch(scope: Scope, provider: Provider, product: Product, plan: FetchPlan, n: Omit<Batch, 'provider' | 'product' | 'apiVersion' | 'mapping' | 'fetchedAt' | 'availableAt' | 'firstSeenAt' | 'fingerprint'>, at: number) {
  const k = key(provider, product);
  const old = scope.batches[k];
  const fp = fingerprint(n);
  const incoming: Batch = { ...n, provider, product, apiVersion: plan.apiVersion, mapping: MAPPING_VERSION, fetchedAt: at, availableAt: Date.now(), firstSeenAt: old?.fingerprint === fp ? old.firstSeenAt : at, fingerprint: fp };
  const { batch, changed } = mergeBatch(old, incoming);
  scope.batches[k] = batch;
  if (n.timeZone) scope.timeZone = n.timeZone;
  return changed;
}

function noteSuccess(scope: Scope, k: string, changed: boolean, headers: Headers, at: number) {
  const prev = scope.states[k];
  const change = (prev?.change ?? INITIAL_CHANGE_P) * 0.7 + (changed ? 0.3 : 0);
  const cache = maxAgeMs(headers);
  scope.states[k] = { lastFetch: at, nextAt: at + cache * (1 + Math.random() * 0.1), change, failures: 0 };
}

function noteFailure(scope: Scope, k: string, f: ProviderFailure | undefined, now: number) {
  const prev = scope.states[k];
  const failures = (prev?.failures ?? 0) + 1;
  scope.states[k] = {
    lastFetch: prev?.lastFetch ?? -Infinity, change: prev?.change ?? INITIAL_CHANGE_P, failures,
    nextAt: now + Math.min(15 * MIN, 30_000 * 2 ** (failures - 1)), lastError: f?.message, lastErrorKind: f?.kind,
  };
}

const NWS_FORECAST_URL = (pt: NwsPoint, product: Product) => (product === 'daily' ? pt.forecast : pt.forecastHourly);

async function runForecastJob(job: Job, req: WeatherRequest, pt: NwsPoint | null, geo: Scope, grid: Scope | null, notes: Draft[]) {
  const a = ADAPTERS[job.provider];
  const scope = job.provider === 'nws' ? grid! : geo;
  const rep = geoScope(req.place.lat, req.place.lon);
  const plan = a.plan(job.product, job.provider === 'nws'
    ? { lat: req.place.lat, lon: req.place.lon, url: NWS_FORECAST_URL(pt!, job.product) }
    : { lat: rep.lat, lon: rep.lon, key: req.keys[job.provider] });
  const out = await guarded(plan, job.lane, req.keys[job.provider]);
  const k = key(job.provider, job.product);
  if (!out.ok) { if (!out.denied) noteFailure(scope, k, out.failure, Date.now()); return; }
  try {
    const n = a.normalize(job.product, out.json, { fetchedAt: out.at, timeZone: geo.timeZone ?? pt?.timeZone });
    const { clean, drafts, quarantined } = sanitize(n, job.provider, PROVIDER_NAMES[job.provider]);
    notes.push(...drafts);
    if (quarantined) { noteFailure(scope, k, { kind: 'schema', message: quarantined }, Date.now()); return; }
    const changed = storeBatch(scope, job.provider, job.product, plan, clean, out.at);
    noteSuccess(scope, k, changed, out.headers, out.at);
  } catch {
    const name = PROVIDER_NAMES[job.provider];
    noteFailure(scope, k, { kind: 'schema', message: `${name} sent data we couldn't read` }, Date.now());
    notes.push({ rule: 'unreadable_response', source: job.provider, why: `${name} sent a response in an unexpected format.`, action: `Ignored it and kept the last good data from ${name}.`, outcome: 'kept_last_good' });
  }
}

/** Walks nearby stations, skipping unsuitable ones rather than always taking the nearest. */
async function runObservationJob(job: Job, req: WeatherRequest, pt: NwsPoint, grid: Scope, c: FuseContext, notes: Draft[]) {
  const k = key('nws', 'observation');
  if (!grid.stations || c.now - grid.stations.at > POINT_TTL_MS) {
    const plan = ADAPTERS.nws.plan('observation', { lat: req.place.lat, lon: req.place.lon, url: `${pt.observationStations}?limit=8` });
    const out = await guarded(plan, job.lane);
    if (!out.ok) { if (!out.denied) noteFailure(grid, k, out.failure, Date.now()); return; }
    type F = { properties: { stationIdentifier: string; elevation?: { value: number | null } }; geometry: { coordinates: [number, number] } };
    const features = (out.json as { features?: F[] }).features ?? [];
    grid.stations = {
      at: out.at,
      list: features.map((f): Station => ({
        id: f.properties.stationIdentifier, elevationM: f.properties.elevation?.value ?? null,
        distanceKm: distanceKm(req.place, { lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] }),
      })).sort((a, b) => a.distanceKm - b.distanceKm),
    };
  }
  const elevation = grid.batches[key('nws', 'hourly')]?.elevationM ?? null;
  const usable = grid.stations.list.filter(s => s.distanceKm <= OBS_LIMITS.maxDistanceKm
    && (s.elevationM == null || elevation == null || Math.abs(s.elevationM - elevation) <= OBS_LIMITS.maxElevationDiffM));
  let lastFail: ProviderFailure | undefined;
  for (const s of usable.slice(0, OBS_LIMITS.stationsToTry)) {
    const plan = ADAPTERS.nws.plan('observation', { lat: req.place.lat, lon: req.place.lon, url: `${NWS_API}/stations/${s.id}/observations/latest` });
    const out = await guarded(plan, job.lane);
    if (!out.ok) { if (out.denied) return; lastFail = out.failure; continue; }
    try {
      const raw = ADAPTERS.nws.normalize('observation', out.json, { fetchedAt: out.at });
      const { clean: n, drafts, quarantined } = sanitize(raw, 'nws', `Station ${s.id}`);
      if (!quarantined) notes.push(...drafts);
      const fact: Fact = { ...n.fact!, stationId: s.id, distanceKm: s.distanceKm };
      if (quarantined || !observationOk(fact, c)) {
        const minutes = Math.round((c.now - fact.at) / 60_000);
        const why = quarantined ? quarantined : fact.tempC == null ? `Station ${s.id} had no usable temperature.` : `Station ${s.id}’s last reading was ${minutes} minutes old.`;
        notes.push({ rule: 'station_rejected', source: `station ${s.id}`, why, action: 'Skipped it and tried the next nearest station.', outcome: 'fallback' });
        continue;
      }
      const changed = storeBatch(grid, 'nws', 'observation', plan, { ...n, fact }, out.at);
      noteSuccess(grid, k, changed, new Headers(), out.at);
      return;
    } catch { /* try the next station */ }
  }
  noteFailure(grid, k, lastFail, Date.now());
}

const flights = new Map<string, Promise<unknown>>();

function once<T>(id: string, run: () => Promise<T>): Promise<T> {
  const hit = flights.get(id);
  if (hit) return hit as Promise<T>;
  const p = run().finally(() => flights.delete(id));
  flights.set(id, p);
  return p;
}

async function pollAlerts(place: WeatherRequest['place'], covers: boolean | null): Promise<void> {
  if (covers === false) return;
  const id = placeId(place), now = Date.now();
  const s = loadAlerts(id);
  if (s.checkedAt && now - s.checkedAt < ALERT_POLL_MS - 2000) return;
  const plan: FetchPlan = {
    provider: 'nws', product: 'observation', apiVersion: 'v1', source: 'nwsalerts', units: 1, timeoutMs: TIMEOUT_MS.nws!, covers: [],
    url: `${NWS_API}/alerts/active?point=${id}`,
  };
  const out = await guarded(plan, 'alert');
  if (!out.ok) return; // state stays as it was, and the feed goes stale on its own
  const j = out.json as { features: NwsAlertFeature[]; pagination?: { next?: string } };
  saveJson(`alerts:${id}`, applyPoll(s, j.features ?? [], !j.pagination?.next, out.at), out.at);
}

// ---- building a snapshot ----------------------------------------------------

const roundMph = (ms: number | null | undefined) => (ms == null ? null : Math.round(msToMph(ms)));

const popLabel = (f: FusedHour): Pick<Hour, 'popKind'> => (f.popEvent === 'rain_only_1h' ? { popKind: 'rain' } : f.popEvent === 'any_precip_3h' ? { popKind: '3h' } : {});

/** An hour built only from fused values, with the sun worked out rather than assumed. */
function hourFrom(t: number, f: FusedHour, batches: Batch[], place: WeatherRequest['place']): Hour {
  const isDay = batches.flatMap(b => b.points).find(p => p.start === t)?.isDay ?? isDaylight(t, place.lat, place.lon);
  return {
    start: new Date(t).toISOString(), tempF: f.tempC == null ? NaN : cToF(f.tempC), icon: iconFor(f.text, isDay), condition: f.text, isDaytime: isDay,
    pop: f.pop == null ? null : Math.round(f.pop * 100), ...popLabel(f), windMph: f.wind ? Math.round(msToMph(f.wind.speedMs)) : null,
    agreement: f.agreement, sources: f.sources, flags: f.flags, windDeg: f.wind?.deg ?? null, windVariable: !!f.wind?.variable,
  };
}

function overlayHour(h: Hour, f: FusedHour): Hour {
  const meta = { agreement: f.agreement, sources: f.sources, windDeg: f.wind?.deg ?? null, windVariable: !!f.wind?.variable, thunderPossible: f.thunderPossible, flags: f.flags };
  const nwsOnly = f.sources.length === 1 && f.sources[0].provider === 'nws';
  if (nwsOnly) return { ...h, ...meta };
  const reworded = f.text && f.text !== h.condition;
  return {
    ...h, ...meta,
    tempF: f.tempC == null ? h.tempF : cToF(f.tempC),
    windMph: f.wind ? Math.round(msToMph(f.wind.speedMs)) : h.windMph,
    pop: f.pop == null ? h.pop : Math.round(f.pop * 100),
    ...(f.pop == null ? {} : popLabel(f)),
    ...(reworded && f.flags.includes('phase_disagreement') ? { condition: f.text, icon: 'snow' as const } : {}),
  };
}

function fromCommercial(batches: Batch[], c: FuseContext, tz: string, ext: Scope['extended'], place: WeatherRequest['place']): Forecast | null {
  const times = [...new Set(batches.filter(b => !ineligible(b, c)).flatMap(b => b.points.map(p => p.start)))]
    .filter(t => t > c.now - HOUR).sort((a, b) => a - b);
  // Prefer the hourly grid: 3-hourly times alone would leave holes.
  const hourlyTimes = times.filter(t => batches.some(b => b.semantics.stepHours === 1 && b.points.some(p => p.start === t)));
  const hours: Hour[] = (hourlyTimes.length ? hourlyTimes : times).slice(0, 96)
    .map(t => hourFrom(t, fuseHour(t, batches, c), batches, place))
    .filter(h => Number.isFinite(h.tempF));
  if (!hours.length) return null;
  const base = buildForecast([], [], ext?.days ?? [], tz, new Date(c.now));
  const dated = batches.flatMap(b => b.days).map(d => d.date);
  const days = [...new Set(dated)].sort().filter(d => d >= dateKey(new Date(c.now), tz)).map(date => {
    const facts = batches.filter(b => !ineligible(b, c)).flatMap(b => b.days).filter(d => d.date === date);
    const hi = fuseHigh(date, batches, c);
    const lo = facts.find(d => d.loC != null)?.loC ?? null;
    const f = facts[0];
    const noon = new Date(`${date}T12:00:00Z`);
    const today = date === dateKey(new Date(c.now), tz);
    const name = today ? 'Today' : noon.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
    return {
      date, name, short: today ? 'Today' : name.slice(0, 3), dateLabel: noon.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }),
      hiF: hi ? cToF(hi.hiC) : null, loF: lo == null ? null : cToF(lo), icon: iconFor(f?.text ?? ''), pop: null, windMph: null, summary: f?.text ?? '',
      source: [...new Set(batches.filter(b => b.days.some(x => x.date === date)).map(b => PROVIDER_NAMES[b.provider]))].join(', '),
    };
  });
  const seen = new Set(days.map(d => d.date));
  return { timeZone: tz, hours, days: [...days, ...base.days.filter(d => !seen.has(d.date))].slice(0, 10), narrative: '' };
}

type Built = { snapshot: WeatherSnapshot; evidence: Record<EventKind, Evidence>; uncertainty: number; hasObservation: boolean };

function assemble(req: WeatherRequest, geo: Scope, grid: Scope | null, pt: NwsPoint | null, alerts: AlertState, event: boolean, now = Date.now()): Built {
  const covers = geo.nwsCovers ?? null;
  const c: FuseContext = { now, nwsCovers: covers !== false, event };
  const live = new Set<Provider>(['nws', ...connected(req.keys)]);
  const usable = (s: Scope | null) => Object.values(s?.batches ?? {}).filter(b => ENABLED[b.provider] && live.has(b.provider));
  const all = [...usable(grid), ...usable(geo)];
  const hourly = all.filter(b => b.points.length);
  const tz = pt?.timeZone ?? geo.timeZone ?? geo.extended?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;

  const nh = grid?.batches[key('nws', 'hourly')], nd = grid?.batches[key('nws', 'daily')];
  let forecast: Forecast | null = null;
  if (nh?.periods && nd?.periods && !ineligible(nh, c)) {
    forecast = buildForecast(nd.periods, nh.periods, geo.extended?.days ?? [], tz, new Date(now));
    const hours = forecast.hours.map(h => overlayHour(h, fuseHour(Date.parse(h.start), hourly, c)));
    // An hour removed from NWS by a safeguard is filled by any other real source, or stays out.
    const have = new Set(hours.map(h => Date.parse(h.start)));
    if (hours.length) {
      const last = Math.max(...have);
      for (let t = Math.min(...have); t < last; t += HOUR) {
        if (have.has(t)) continue;
        const f = fuseHour(t, hourly, c);
        if (f.tempC != null) hours.push(hourFrom(t, f, hourly, req.place));
      }
      hours.sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
    }
    const days = forecast.days.map(d => {
      const hi = fuseHigh(d.date, all.filter(b => b.product !== 'hourly'), c);
      if (!hi?.sources.length) return d;
      const names = hi.sources.map(s => PROVIDER_NAMES[s.provider]).join(', ');
      return { ...d, hiF: cToF(hi.hiC), hiEstimated: false, highFrom: names === d.source ? undefined : names };
    });
    forecast = { ...forecast, hours, days };
  } else if (hourly.length) {
    forecast = fromCommercial(hourly, c, tz, geo.extended, req.place);
  }

  const obs = grid?.batches[key('nws', 'observation')]?.fact ?? null;
  const analyses = usable(geo).flatMap(b => (b.fact ? [{ provider: b.provider, fact: b.fact }] : []));
  const cur = chooseCurrent(obs, analyses, c);
  const first = forecast?.hours[0];
  const nowC: NowConditions | null = cur ? {
    kind: cur.kind, tempF: cToF(cur.tempC), condition: cur.text, windMph: roundMph(cur.windMs), windDeg: cur.windDeg, windVariable: cur.windVariable,
    at: cur.at, stationId: cur.stationId, distanceKm: cur.distanceKm, sources: cur.sources.map(s => s.provider),
  } : first ? {
    kind: 'forecast', tempF: first.tempF, condition: first.condition, windMph: first.windMph, windDeg: first.windDeg ?? null, windVariable: !!first.windVariable,
    at: Date.parse(first.start), sources: (first.sources ?? [{ provider: 'nws', weight: 1 }]).map(s => s.provider),
  } : null;

  const records = activeRecords(alerts, now);
  const mapped = sortAlerts(records.map(r => ({
    ...mapAlert(r.feature, tz, new Date(now)),
    notifyKey: notifyKey(r, r.feature.properties.severity),
  })));
  const alertFeed: AlertFeed = covers === false ? { status: 'unsupported', checkedAt: null }
    : !alerts.checkedAt ? { status: 'unknown', checkedAt: null }
    : { status: now - alerts.checkedAt > ALERT_STALE_MS ? 'stale' : 'fresh', checkedAt: alerts.checkedAt };

  // Evidence for acquisition: this decides what to fetch next, never what to show.
  const next24 = (forecast?.hours ?? []).filter(h => Date.parse(h.start) < now + 24 * HOUR).map(h => ({ h, f: fuseHour(Date.parse(h.start), hourly, c) }));
  const max = (pick: (f: FusedHour) => number) => Math.max(0, ...next24.map(x => pick(x.f)));
  const spreadPop = max(f => f.spreads.pop), spreadT = max(f => f.spreads.tempC), spreadW = max(f => f.spreads.windMs);
  const soon = next24.filter(x => Date.parse(x.h.start) < now + 90 * MIN);
  const gust = Math.max(0, cur?.windMs ?? 0, obs?.gustMs ?? 0, ...hourly.flatMap(b => b.points.filter(p => p.start > now && p.start < now + 6 * HOUR).map(p => p.gustMs ?? 0)));
  const revision = all.map(b => b.fingerprint).sort().join('.');
  const known = forecast != null;
  const ev = (watch: boolean, active = false): Evidence => ({ level: !known ? 'unknown' : active ? 'active' : watch ? 'watch' : 'none', revision });
  const evidence: Record<EventKind, Evidence> = {
    precipitation: ev(soon.some(x => (x.f.pop ?? 0) >= TRIGGERS.popWatch) || spreadPop > TRIGGERS.popSpread, cur?.kind === 'observation' && isWet(cur.cond)),
    wind: ev(spreadW > TRIGGERS.windSpreadMs || gust >= TRIGGERS.dangerousGustMs),
    winter: ev(next24.some(x => x.f.flags.includes('phase_disagreement'))),
    visibility: ev(false, obs != null && obs.visM != null && obs.visM < TRIGGERS.lowVisibilityM),
    temperature: ev(spreadT > TRIGGERS.tempSpreadC),
  };
  const uncertainty = Math.min(1, Math.max(spreadPop / TRIGGERS.popSpread, spreadT / TRIGGERS.tempSpreadC, spreadW / TRIGGERS.windSpreadMs) / 2);

  const fetched = [nh, ...hourly].filter(Boolean).map(b => b!.fetchedAt);
  const primary = nh && !ineligible(nh, c) ? nh : hourly[0];
  const primaryState = primary && (primary.provider === 'nws' ? grid : geo)?.states[key(primary.provider, primary.product)];
  const staleSince = forecast && primary && ((primaryState?.failures ?? 0) > 0 || now - primary.fetchedAt > STALE_AFTER_MS) ? primary.fetchedAt : null;
  return {
    uncertainty, evidence, hasObservation: cur?.kind === 'observation',
    snapshot: {
      fusionVersion: FUSION_VERSION, generatedAt: now, forecast, forecastFetchedAt: fetched.length ? Math.max(...fetched) : null, staleSince, now: nowC,
      alerts: mapped, alertFeed, nowcast: { status: 'unavailable', reason: 'no_eligible_minute_product' },
      sources: sourceList(req, geo, grid, covers, now), nwsCovers: covers, eventActive: event, error: null,
    },
  };
}

function sourceList(req: WeatherRequest, geo: Scope, grid: Scope | null, covers: boolean | null, now: number): SourceStatus[] {
  const off = disabled();
  const when = (t: number) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const row = (provider: Provider, role: string, state: ProductState | undefined, batch: Batch | undefined, problem?: string): SourceStatus => ({
    provider, name: PROVIDER_NAMES[provider], role, healthy: !problem,
    note: problem ?? (state?.lastError && state.nextAt > now ? state.lastError : batch ? `Updated ${when(batch.fetchedAt)}` : 'Waiting for its first update'),
  });
  const conn = connected(req.keys);
  const primary = covers === false ? conn[0] : 'nws';
  const rows: SourceStatus[] = [covers === false
    ? row('nws', 'Not available here', undefined, undefined, 'Only covers US locations')
    : row('nws', 'Primary', grid?.states[key('nws', 'hourly')], grid?.batches[key('nws', 'hourly')])];
  for (const p of COMMERCIAL) {
    const k = req.keys[p];
    if (!k) continue;
    const blocked = off[p] === hashKey(k) ? (geo.states[key(p, 'forecast')]?.lastError ?? 'Key rejected') : undefined;
    rows.push(row(p, p === primary ? 'Primary' : 'Challenger', geo.states[key(p, 'forecast')], geo.batches[key(p, 'forecast')], blocked));
  }
  return rows;
}

function friendlyError(s: WeatherSnapshot, geo: Scope): string | null {
  if (s.forecast) return null;
  if (geo.nwsCovers === false) return 'The National Weather Service only covers US locations. Connect a key under Settings > Data source to see weather here.';
  return 'Could not reach the National Weather Service. Check your connection and try again.';
}

/** What's on hand right now, with no network. Lets a screen paint before a tick finishes. */
export function readSnapshot(req: WeatherRequest): WeatherSnapshot {
  const pt = savedPoint(req.place.lat, req.place.lon);
  const geo = loadScope(geoScope(req.place.lat, req.place.lon).id);
  const grid = pt ? loadScope(nwsScopeId(pt)) : null;
  const built = assemble(req, geo, grid, pt, loadAlerts(placeId(req.place)), accelerating(geo.events ?? {}));
  return { ...built.snapshot, error: null };
}

// ---- accuracy log -----------------------------------------------------------

export type AuditHealth = { status: 'unknown' | 'ok' | 'failed' | 'timeout'; lastSuccess: number | null; persistence: 'memory' | 'indexeddb' };
const auditHealth = new Map<string, AuditHealth>();
const healthFor = (scope: string): AuditHealth => auditHealth.get(scope) ?? { status: 'unknown', lastSuccess: null, persistence: typeof indexedDB === 'undefined' ? 'memory' : 'indexeddb' };
const REPORT_DAYS = 30;
const TRUTH_EVERY_MS = HOUR;
const TRUTH_MAX_BACK_MS = 6 * 24 * HOUR; // about what the NWS history endpoint keeps

function truthStations(grid: Scope): StationRef[] {
  const elevation = grid.batches[key('nws', 'hourly')]?.elevationM ?? null;
  return (grid.stations?.list ?? [])
    .filter(s => s.distanceKm <= MATCHING.maxDistanceKm && (s.elevationM == null || elevation == null || Math.abs(s.elevationM - elevation) <= MATCHING.maxElevationDiffM))
    .slice(0, 2);
}

/** Saves the forecasts on hand and catches up on station readings. Never costs the app a refresh. */
async function archive(req: WeatherRequest, scope: string, geo: Scope, grid: Scope | null, event: boolean, notes: Draft[], shown: WeatherSnapshot) {
  const store = accuracyStore();
  const now = Date.now();
  const live = new Set<Provider>(['nws', ...connected(req.keys)]);
  const batches = [...Object.values(grid?.batches ?? {}), ...Object.values(geo.batches)].filter(b => ENABLED[b.provider] && live.has(b.provider));
  const c: FuseContext = { now, nwsCovers: geo.nwsCovers !== false, event };
  const name = (p: Provider) => PROVIDER_NAMES[p];
  const drafts = notes.map(d => resolve(d, batches, c, name, shown.forecast?.hours ?? []));
  const prior = await store.meta(scope);
  const meta = prior ?? { scope, trackingStart: now, truthThrough: now, lastCapture: '' };

  // New data, or a new hour opening new slots, is worth a write. Other ticks aren't.
  const stamp = `${Math.floor(now / HOUR)}|${batches.map(b => b.fingerprint).sort().join('.')}`;
  const fresh = stamp !== meta.lastCapture;
  if (fresh) {
    const rows = forecastRows(scope, batches, c);
    if (rows.length) await store.putForecasts(rows);
    meta.lastCapture = stamp;
    if (!prior) await store.prune(pruneCutoff(now));
  }

  // Removed values are logged as they happen; the review of what's shown runs once per change or hour.
  if (fresh) {
    drafts.push(...audit(batches, c, name, { forecastShown: !!shown.forecast, staleSince: shown.staleSince, alertsStale: shown.alertFeed.status === 'stale' }));
  }
  await store.addSafeguards(drafts.map(d => toEvent(scope, d, now)));

  if (grid && now - meta.truthThrough >= TRUTH_EVERY_MS) {
    const from = Math.max(meta.truthThrough - 2 * HOUR, now - TRUTH_MAX_BACK_MS, meta.trackingStart - HOUR);
    const stations = truthStations(grid);
    meta.noStation = !stations.length;
    let reached = stations.length === 0;
    for (const s of stations) {
      const url = `${NWS_API}/stations/${s.id}/observations?start=${new Date(from).toISOString()}&end=${new Date(now).toISOString()}&limit=500`;
      const out = await guarded(ADAPTERS.nws.plan('observation', { lat: req.place.lat, lon: req.place.lon, url }), 'optional');
      if (!out.ok) continue;
      reached = true;
      await store.putTruth(truthRows(scope, s, (out.json as { features?: unknown[] }).features ?? [], { from, now: out.at, rejected: field => recordDiagnostic('observation_qc', `Rejected station ${s.id} ${field} during accuracy matching (range or QC). Matching attempts are not unique observations.`) }));
    }
    if (reached) meta.truthThrough = now;
  }
  await store.setMeta(meta);
}

export async function accuracyReport(place: WeatherRequest['place']): Promise<AccuracyReport & { noStation: boolean; auditHealth: AuditHealth }> {
  const scope = geoScope(place.lat, place.lon).id, now = Date.now();
  const store = accuracyStore();
  const from = now - REPORT_DAYS * 24 * HOUR;
  const [forecasts, truth, meta] = await Promise.all([store.forecasts(scope, from), store.truth(scope, from), store.meta(scope)]);
  return { ...buildReport(forecasts, truth, { now, days: REPORT_DAYS, trackingStart: meta?.trackingStart ?? null, scope }), auditHealth: healthFor(scope), noStation: !!meta?.noStation };
}

/** Everything logged for a place, ready to save as a .jsonl file. */
export async function accuracyExport(place: WeatherRequest['place']): Promise<string> {
  const scope = geoScope(place.lat, place.lon).id;
  const store = accuracyStore();
  return JSON.stringify({ schema_version: 1, event_type: 'audit_health', scope, recorded_at: new Date().toISOString(), payload: healthFor(scope) }) + '\n' + toJsonl(await store.forecasts(scope, 0), await store.truth(scope, 0), Date.now(), await store.safeguards(scope, 0));
}

/** The safeguards that fired for a place, newest first. */
export async function safeguardLog(place: WeatherRequest['place']): Promise<SafeguardEvent[]> {
  const out = await accuracyStore().safeguards(geoScope(place.lat, place.lon).id, Date.now() - REPORT_DAYS * 24 * HOUR);
  return out.sort((a, b) => b.lastAt - a.lastAt);
}

async function run(req: WeatherRequest): Promise<WeatherSnapshot> {
  const g = geoScope(req.place.lat, req.place.lon);
  const geo = loadScope(g.id);
  const now = Date.now();
  let pt: NwsPoint | null = null;
  if (geo.nwsCovers !== false || now - (geo.coverCheckedAt ?? 0) > POINT_TTL_MS) {
    try {
      pt = await getPoint(req.place.lat, req.place.lon);
      geo.nwsCovers = true;
      geo.coverCheckedAt = now;
      geo.timeZone = pt.timeZone;
    } catch (e) {
      if ((e as { status?: number }).status === 404) { geo.nwsCovers = false; geo.coverCheckedAt = now; }
      else pt = savedPoint(req.place.lat, req.place.lon); // an outage shouldn't hide what's cached
    }
  }
  const grid = pt ? loadScope(nwsScopeId(pt)) : null;
  const notes: Draft[] = [];
  const save = () => { saveJson(g.id, geo, Date.now()); if (pt) saveJson(nwsScopeId(pt), grid, Date.now()); };

  // Alerts come first and run on their own budget, whatever happens below.
  const alertsDone = pollAlerts(req.place, geo.nwsCovers ?? null).catch(() => undefined);

  const tracks: Tracks = geo.events ?? {};
  const alertsNow = () => loadAlerts(placeId(req.place));
  // Routine advisories don't buy faster polling; a serious official alert does.
  const serious = () => activeRecords(alertsNow(), Date.now()).some(r => /Severe|Extreme/.test(r.feature.properties.severity ?? ''));
  const eventOn = () => accelerating(tracks) || serious();

  if (!req.background) {
    const before = assemble(req, geo, grid, pt, alertsNow(), eventOn(), now);
    const ctx: FuseContext = { now, nwsCovers: geo.nwsCovers !== false, event: eventOn() };
    const jobs = planFetches({
      now, nwsCovers: pt ? true : (geo.nwsCovers ?? null), connected: connected(req.keys),
      states: { ...geo.states, ...grid?.states }, event: ctx.event, uncertainty: before.uncertainty, hasObservation: before.hasObservation,
      userMinutes: req.userMinutes, manual: !!req.manual, room: (p, lane) => room(p as SourceId, lane),
    });
    const exec = (j: Job) => once(`${g.id}:${j.provider}:${j.product}`, () => (
      j.provider === 'nws' && j.product === 'observation'
        ? (pt && grid ? runObservationJob(j, req, pt, grid, ctx, notes) : Promise.resolve())
        : j.provider === 'nws' && !pt ? Promise.resolve() : runForecastJob(j, req, pt, geo, grid, notes)
    ));
    // Hourly first: observation rejection needs its elevation, so the rest wait on it.
    const first = jobs.filter(j => j.product !== 'observation' && j.lane === 'baseline');
    await Promise.allSettled(first.map(exec));
    const later = jobs.filter(j => !first.includes(j));
    await Promise.allSettled(later.filter(j => j.lane === 'baseline').map(exec));
    await alertsDone;
    save();
    req.onUpdate?.(assemble(req, geo, grid, pt, alertsNow(), eventOn()).snapshot);
    for (const j of later.filter(x => x.lane !== 'baseline')) await exec(j);
    if (!geo.extended || now - geo.extended.at > 3 * HOUR) {
      try {
        const e = await getExtended(g.lat, g.lon);
        geo.extended = { at: Date.now(), days: e.days, timeZone: e.timeZone };
        if (!geo.timeZone) geo.timeZone = e.timeZone;
        if (e.rejected.length) notes.push({ rule: 'out_of_range', source: 'Open-Meteo', field: 'daily forecast', count: e.rejected.length, sample: `${e.rejected[0].date}: ${e.rejected[0].why}`, why: `Open-Meteo sent ${e.rejected.length} day(s) with missing or impossible values.`, action: 'Left those days out of the 10 day list.', outcome: 'blank' });
      }
      catch { /* days 8-10 are a bonus */ }
    }
  } else {
    await alertsDone;
  }

  const built = assemble(req, geo, grid, pt, alertsNow(), eventOn());
  for (const k of Object.keys(built.evidence) as EventKind[]) tracks[k] = step(tracks[k] ?? CALM_TRACK, built.evidence[k], Date.now());
  geo.events = tracks;
  save();
  if (!req.background) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const logged = archive(req, g.id, geo, grid, eventOn(), notes, built.snapshot).then(() => {
      auditHealth.set(g.id, { ...healthFor(g.id), status: 'ok', lastSuccess: Date.now() });
    }).catch(() => { recordDiagnostic('archive', 'Accuracy/safeguard archive failed; records may be incomplete.'); auditHealth.set(g.id, { ...healthFor(g.id), status: 'failed' }); });
    await Promise.race([logged, new Promise<void>(r => { timer = setTimeout(() => { recordDiagnostic('archive', 'Archive exceeded refresh timeout; write may still complete.'); auditHealth.set(g.id, { ...healthFor(g.id), status: 'timeout' }); r(); }, ARCHIVE_TIMEOUT_MS); })]);
    if (timer) clearTimeout(timer);
  }
  return { ...built.snapshot, eventActive: eventOn(), error: friendlyError(built.snapshot, geo) };
}

/**
 * One refresh for a place. Overlapping calls share one run, here and across
 * tabs, so a burst of requests can't multiply provider calls.
 */
export function tick(req: WeatherRequest): Promise<WeatherSnapshot> {
  const id = `tick:${placeId(req.place)}:${req.background ? 'bg' : 'fg'}`;
  return once(id, () => {
    const locks = (globalThis.navigator as Navigator | undefined)?.locks;
    if (!locks) return run(req);
    return locks.request(`sky-peek:${id}`, { ifAvailable: true }, lock => (lock ? run(req) : readLatest(req)));
  });
}

/** Another tab is refreshing this place, so read what it has saved so far. */
const readLatest = async (req: WeatherRequest) => readSnapshot(req);

