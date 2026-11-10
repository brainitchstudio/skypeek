// The request ledger. Every outgoing call is charged here, whichever part of the
// app makes it. Weather refreshes go through reserve() and dispatch(), which
// enforce every window at once and keep capacity back for urgent work. Optional
// radar and search requests use admit() to enforce their browser budgets too.
//
// The ledger is read from and written to storage on every change, so a reload
// or a second tab can't refill a quota.

export type SourceId = 'nws' | 'nwsalerts' | 'tomorrow' | 'openweather' | 'weatherapi' | 'openmeteo' | 'rainviewer' | 'noaa' | 'hrrr' | 'iem' | 'probsevere';

/** A local budget or provider 429 paused this source. */
export class RateLimitError extends Error {
  constructor(public readonly source: SourceId) {
    super(`${SOURCES[source].name} request limit reached`);
    this.name = 'RateLimitError';
  }
}

/** service lanes: alert and urgent may use the reserve; baseline and optional may not. */
export type Lane = 'alert' | 'urgent' | 'baseline' | 'optional';

type Source = { name: string; perHour: number; perDay: number; perMinute?: number; rolling?: boolean; free?: boolean };

// Internal ceilings, not asserted entitlements: replace them with your plan's
// real limits. Tomorrow.io doesn't document its window type, so it is treated
// as the stricter rolling kind. NWS publishes no limit; these are launch bounds.
export const SOURCES: Record<SourceId, Source> = {
  nws: { name: 'National Weather Service', perHour: 600, perDay: 8000, free: true },
  nwsalerts: { name: 'NWS alerts', perHour: 240, perDay: 4000, free: true },
  tomorrow: { name: 'Tomorrow.io', perHour: 20, perDay: 400, rolling: true },
  openweather: { name: 'OpenWeather', perHour: 1500, perDay: 20_000, perMinute: 50 },
  weatherapi: { name: 'WeatherAPI', perHour: 1000, perDay: 20_000 },
  openmeteo: { name: 'Open-Meteo', perMinute: 60, perHour: 240, perDay: 1500, rolling: true, free: true },
  probsevere: { name: 'NOAA ProbSevere', perHour: 60, perDay: 600, free: true },
  iem: { name: 'IEM NWS storm attributes', perHour: 60, perDay: 600, perMinute: 10, rolling: true, free: true },
  noaa: { name: 'NOAA OpenGeo radar', perHour: 3000, perDay: 12000, perMinute: 600, free: true },
  hrrr: { name: 'NOAA HRRR forecast', perHour: 1500, perDay: 12000, perMinute: 300, free: true },
  rainviewer: { name: 'RainViewer', perHour: 3000, perDay: 30_000, free: true },
};

export const HEADROOM = 0.10;
export const URGENT_RESERVE = 0.15;
export const LEARNING_CAP = 0.05;
/** Share of ordinary capacity that optional challengers may not touch. */
export const BASELINE_FLOOR = 0.30;

const MINUTE = 60_000, HOUR = 3_600_000, DAY = 24 * HOUR;
const RESERVATION_MS = 60_000;
const KEY = 'sky-peek-ledger';
const OLD_KEY = 'sky-peek-usage';

/** All shares use one denominator: the 90% left after headroom. */
export function envelope(quota: number) {
  const headroom = quota * HEADROOM;
  const usable = quota - headroom;
  const urgent = usable * URGENT_RESERVE;
  return { headroom, usable, urgent, ordinary: usable - urgent, learning: usable * LEARNING_CAP };
}

type Held = { id: string; units: number; exp: number };
type Entry = {
  log: [number, number][]; // [minute index, units]
  held: Held[];
  benchedUntil: number;
  shrink: number; // internal limit multiplier after repeated 429s
  last429: number;
  hits: number; // consecutive 429s
};
type Ledger = { sources: Partial<Record<SourceId, Entry>>; closedUntil?: number };

export type Reservation = { id: string; source: SourceId; units: number; lane: Lane };

let memory: Ledger | null = null;
let seq = 0;

function storage(): Storage | null {
  try { return globalThis.localStorage ?? null; } catch { return null; }
}

function migrate(s: Storage, now: number): Ledger {
  const out: Ledger = { sources: {} };
  try {
    const old = JSON.parse(s.getItem(OLD_KEY) ?? '{}') as Record<string, { hourUsed: number; dayUsed: number; day: number; benchedUntil: number }>;
    for (const [id, c] of Object.entries(old)) {
      if (c.day !== Math.floor(now / DAY)) continue;
      const m = Math.floor(now / MINUTE);
      out.sources[id as SourceId] = {
        log: [[Math.floor(c.day * 1440), Math.max(0, c.dayUsed - c.hourUsed)], [m, c.hourUsed]],
        held: [], benchedUntil: c.benchedUntil, shrink: 1, last429: 0, hits: 0,
      };
    }
    s.removeItem(OLD_KEY);
  } catch { /* old counts were only ever approximate */ }
  return out;
}

function read(now: number): Ledger {
  const s = storage();
  if (!s) return (memory ??= { sources: {} });
  const raw = s.getItem(KEY);
  if (raw === null) return (memory = migrate(s, now));
  try {
    return (memory = JSON.parse(raw) as Ledger);
  } catch {
    // An unreadable ledger means unknown spend: paid sources wait out the day.
    return (memory = { sources: {}, closedUntil: now + DAY });
  }
}

function write(l: Ledger) {
  memory = l;
  try { storage()?.setItem(KEY, JSON.stringify(l)); } catch { /* storage full or blocked */ }
}

function entry(l: Ledger, id: SourceId, now: number): Entry {
  const e = l.sources[id] ?? { log: [], held: [], benchedUntil: 0, shrink: 1, last429: 0, hits: 0 };
  const floor = Math.floor((now - DAY) / MINUTE) - 1;
  e.log = e.log.filter(([m]) => m >= floor);
  e.held = e.held.filter(h => h.exp > now);
  if (e.shrink < 1 && now - e.last429 > HOUR) { e.shrink = 1; e.hits = 0; }
  l.sources[id] = e;
  return e;
}

type Window = { ms: number; limit: number; rolling: boolean };

function windows(id: SourceId): Window[] {
  const s = SOURCES[id], rolling = !!s.rolling;
  return [
    ...(s.perMinute ? [{ ms: MINUTE, limit: s.perMinute, rolling }] : []),
    { ms: HOUR, limit: s.perHour, rolling },
    { ms: DAY, limit: s.perDay, rolling },
  ];
}

function spent(e: Entry, w: Window, now: number): number {
  // A call stays counted until its whole minute bucket has aged out.
  const inWindow = w.rolling
    ? (m: number) => (m + 1) * MINUTE > now - w.ms
    : (m: number) => m * MINUTE >= Math.floor(now / w.ms) * w.ms;
  return e.log.reduce((sum, [m, units]) => (inWindow(m) ? sum + units : sum), 0);
}

const heldUnits = (e: Entry, except?: string) => e.held.reduce((s, h) => (h.id === except ? s : s + h.units), 0);

function capFor(limit: number, lane: Lane, shrink: number): number {
  const { usable, ordinary } = envelope(limit * shrink);
  if (lane === 'alert' || lane === 'urgent') return usable;
  return lane === 'baseline' ? ordinary : ordinary * (1 - BASELINE_FLOOR);
}

function fits(id: SourceId, e: Entry, units: number, lane: Lane, now: number, except?: string): boolean {
  return windows(id).every(w => spent(e, w, now) + heldUnits(e, except) + units <= capFor(w.limit, lane, e.shrink));
}

// Circuit breaker: 5 failures in 60 s opens for 60 s, then one probe. It lives in
// memory because a reload is itself a fresh attempt worth making.
type Breaker = { fails: number[]; openUntil: number; probing: boolean };
const breakers = new Map<SourceId, Breaker>();

function breakerAllows(id: SourceId, now: number): boolean {
  const b = breakers.get(id);
  if (!b || !b.openUntil) return true;
  if (now < b.openUntil || b.probing) return false;
  b.probing = true;
  return true;
}

export function recordFailure(id: SourceId, now = Date.now()) {
  const b = breakers.get(id) ?? { fails: [], openUntil: 0, probing: false };
  if (b.probing) { b.openUntil = now + MINUTE; b.probing = false; }
  b.fails = [...b.fails.filter(t => now - t < MINUTE), now];
  if (b.fails.length >= 5) b.openUntil = Math.max(b.openUntil, now + MINUTE);
  breakers.set(id, b);
}

export function recordSuccess(id: SourceId) {
  breakers.delete(id);
}

/** Holds capacity for a bounded fetch. Null means don't send it. */
export function reserve(id: SourceId, units: number, lane: Lane, now = Date.now()): Reservation | null {
  const l = read(now);
  if (!SOURCES[id].free && (l.closedUntil ?? 0) > now) return null;
  const e = entry(l, id, now);
  if (e.benchedUntil > now || !fits(id, e, units, lane, now) || !breakerAllows(id, now)) return null;
  const r = { id: `${now.toString(36)}-${++seq}`, source: id, units, lane };
  e.held.push({ id: r.id, units, exp: now + RESERVATION_MS });
  write(l);
  return r;
}

/**
 * Turns a reservation into spent units, re-checking every window first because
 * time may have passed and a cooldown may have begun. Call this before sending.
 * Once it returns true the units are never refunded.
 */
export function dispatch(r: Reservation, now = Date.now()): boolean {
  const l = read(now);
  const e = entry(l, r.source, now);
  const ok = e.benchedUntil <= now && fits(r.source, e, r.units, r.lane, now, r.id);
  e.held = e.held.filter(h => h.id !== r.id);
  if (ok) charge(e, r.units, now);
  write(l);
  return ok;
}

/** Admits and charges an immediate request before it is sent. */
export function admit(id: SourceId, units = 1, lane: Lane = 'baseline', now = Date.now()): boolean {
  const reservation = reserve(id, units, lane, now);
  return reservation !== null && dispatch(reservation, now);
}

/** Gives back a reservation that was never sent. Harmless after dispatch. */
export function release(r: Reservation, now = Date.now()) {
  const l = read(now);
  const e = entry(l, r.source, now);
  e.held = e.held.filter(h => h.id !== r.id);
  write(l);
  const b = breakers.get(r.source);
  if (b) b.probing = false; // an unsent probe mustn't hold the breaker shut
}

function charge(e: Entry, units: number, now: number) {
  const m = Math.floor(now / MINUTE), last = e.log.at(-1);
  if (last?.[0] === m) last[1] += units; else e.log.push([m, units]);
}

/** Counts a call that didn't go through admission. */
export function spend(id: SourceId, calls = 1, now = Date.now()) {
  const l = read(now);
  charge(entry(l, id, now), calls, now);
  write(l);
}

/** Takes a source out of rotation after it says it's rate limited. */
export function bench(id: SourceId, ms = HOUR, now = Date.now()) {
  const l = read(now);
  const e = entry(l, id, now);
  e.benchedUntil = Math.max(e.benchedUntil, now + ms);
  write(l);
}

/** Honors Retry-After in either format; otherwise 30 s plus bounded jitter. */
export function retryDelayMs(header: string | null, now: number, attempt: number, random = Math.random): number {
  if (header) {
    const secs = Number(header);
    if (Number.isFinite(secs)) return Math.max(0, secs) * 1000;
    const at = Date.parse(header);
    if (Number.isFinite(at)) return Math.max(0, at - now);
  }
  return (30 + random() * Math.min(870, 30 * 2 ** attempt)) * 1000;
}

/** Applies a 429: pauses the source, and repeated 429s lower its internal limit. */
export function cooldownFor429(id: SourceId, retryAfter: string | null, now = Date.now(), random = Math.random) {
  const l = read(now);
  const e = entry(l, id, now);
  const delay = retryDelayMs(retryAfter, now, e.hits, random);
  if (e.hits > 0) e.shrink = Math.max(0.5, e.shrink * 0.8);
  e.hits += 1;
  e.last429 = now;
  e.benchedUntil = Math.max(e.benchedUntil, now + delay);
  write(l);
}

/** Calls left before the tighter of the hourly and daily budgets; zero while benched. */
export function remaining(id: SourceId, now = Date.now()): number {
  const e = entry(read(now), id, now);
  if (e.benchedUntil > now) return 0;
  return Math.max(0, Math.min(...windows(id).map(w => w.limit - spent(e, w, now) - heldUnits(e))));
}

/** Fraction of a lane's capacity still free, across all windows. Used to rank optional work. */
export function room(id: SourceId, lane: Lane, now = Date.now()): number {
  const e = entry(read(now), id, now);
  if (e.benchedUntil > now) return 0;
  return Math.max(0, Math.min(...windows(id).map(w => {
    const cap = capFor(w.limit, lane, e.shrink);
    return cap > 0 ? 1 - (spent(e, w, now) + heldUnits(e)) / cap : 0;
  })));
}

export function usage(now = Date.now()) {
  const l = read(now);
  return (Object.keys(SOURCES) as SourceId[]).map(id => {
    const e = entry(l, id, now), [hour, day] = windows(id).slice(-2);
    return {
      id, ...SOURCES[id], hourUsed: spent(e, hour, now), dayUsed: spent(e, day, now), shrink: e.shrink,
      benchedUntil: e.benchedUntil > now ? e.benchedUntil : 0,
    };
  });
}

/** Test seam: forgets all counts. */
export function resetBudget() {
  memory = { sources: {} };
  breakers.clear();
  try { storage()?.removeItem(KEY); storage()?.setItem(KEY, '{"sources":{}}'); } catch { /* nothing stored */ }
}

/** Test seam: drops the memory copy, as a restart would. */
export function reloadBudget() {
  memory = null;
  breakers.clear();
}
