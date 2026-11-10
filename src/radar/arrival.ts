// Sky Peek's own rule for whether a storm reaches a spot. No source publishes this:
// it only combines reported motion, observed motion and NWS warnings.

import type { StormObject } from '@/lib/probSevere';
import type { WeatherAlert } from '@/lib/types';
import { insideGeometry } from './approach';
import { atSpeed, fanDrifts, fasterSpeed, insideNow, moving, observedDrift, sweep, type Drift, type Sweep } from './stormPath';
import type { MapPoint } from './tools';

export type WarningCheck = { state: 'confirmed'; title: string } | { state: 'none' } | { state: 'unavailable' };
export type Level = 'here' | 'cant-tell' | 'likely' | 'possible' | 'on-path' | 'far' | 'unlikely';
export type Arrival = { level: Level; headline: string; reported: string; observed: string; path: string; warning: string; earliest: number | null };

const CONFIRMING = new Set(['Severe Thunderstorm Warning', 'Tornado Warning']);
const MIN_HISTORY_MS = 20 * 60_000;
const HORIZON_MIN = 180; // Sky Peek's own rule
const FAR_HORIZON_MIN = 1440; // far enough to tell "heading here, slowly" from "heading elsewhere"
const HOUR_MS = 3_600_000;

const clock = (ms: number) => new Date(Math.round(ms / 300_000) * 300_000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const distance = (m: number) => (Math.round(m) < 1 ? 'under 1 mi' : `about ${Math.round(m)} mi`);
const away = (s: Extract<Sweep, { kind: 'miss' }>) => (Math.round(s.miles) < 1 ? distance(s.miles) : `${distance(s.miles)} ${s.side}`);

/** A warning that contains both the storm and the spot. `alerts` is null when the lookup failed. */
export function confirmingWarning(alerts: WeatherAlert[] | null, center: MapPoint, spot: MapPoint): WarningCheck {
  if (!alerts) return { state: 'unavailable' };
  const found = alerts.find(a => CONFIRMING.has(a.title) && insideGeometry(center, a.geometry) === true && insideGeometry(spot, a.geometry) === true);
  return found ? { state: 'confirmed', title: found.title } : { state: 'none' };
}

const trackLine = (name: string, s: Sweep | null) => {
  if (!s) return `${name} track unavailable`;
  if (s.kind === 'still') return `${name} track isn't moving`;
  return s.kind === 'hit' ? `${name} track hits around ${clock(s.at)}` : `${name} track misses by ${away(s)}`;
};

const warningLine = (w: WarningCheck) => (w.state === 'confirmed' ? `${w.title} covers the storm and this spot` : w.state === 'none' ? 'No warning covers both' : 'Warning status unavailable');

/** "about 2 hours", rounded to 15 minutes. */
function duration(ms: number) {
  const minutes = Math.round(ms / 900_000) * 15, hours = Math.floor(minutes / 60), rest = minutes - hours * 60;
  return rest ? `about ${hours} hr ${rest} min` : `about ${hours} ${hours === 1 ? 'hour' : 'hours'}`;
}

export type ArrivalInput = {
  inside: boolean;
  reported: Sweep | null; observed: Sweep | null; // each track at its own speed, for the reasons
  fan: Sweep[]; // the widened path
  bothSoon: boolean; // both track headings hit within the hour at the faster speed
  beyond: boolean; // the path reaches the spot, but only past 3 hours
  warning: WarningCheck;
  jumped: boolean; // the storm has history, but its observed motion was thrown out
  now: number;
};

export function decide({ inside, reported, observed, fan, bothSoon, beyond, warning, jumped, now }: ArrivalInput): Arrival {
  const lines = {
    reported: trackLine('Reported', reported),
    observed: observed || jumped ? trackLine('Observed', observed) : 'Storm too new to show a track',
    warning: warningLine(warning),
  };
  const hits = fan.flatMap(s => (s.kind === 'hit' ? [s.at] : []));
  const misses = fan.flatMap(s => (s.kind === 'miss' ? [s] : []));
  const earliest = hits.length ? Math.min(...hits) : null;
  const path = !fan.length ? 'Widened path unavailable' : hits.length || beyond ? 'Spot is inside the widened path' : 'Spot is outside the widened path';
  const base = { ...lines, path };

  if (inside) return { level: 'here', headline: 'Already here', ...base, earliest: null };
  if (!fan.length) {
    const someStill = [reported, observed].some(s => s?.kind === 'still');
    return { level: 'cant-tell', headline: someStill ? "Can't tell, storm isn't moving" : "Can't tell, motion unavailable", ...base, earliest: null };
  }
  if (earliest === null) {
    if (beyond) return { level: 'far', headline: 'On its path, more than 3 hours away', ...base, earliest: null };
    const nearest = misses.reduce((a, b) => (b.miles < a.miles ? b : a));
    return { level: 'unlikely', headline: `Unlikely, closest ${away(nearest)}`, ...base, earliest: null };
  }
  if (earliest - now > HOUR_MS) return { level: 'on-path', headline: `On its path, ${duration(earliest - now)} away`, ...base, earliest };
  const trackHits = [reported, observed].flatMap(s => (s?.kind === 'hit' ? [s.at] : []));
  const first = clock(earliest), last = clock(Math.max(earliest, ...trackHits));
  const when = first === last ? `around ${first}` : `around ${first}–${last}`;
  if (bothSoon || warning.state === 'confirmed') return { level: 'likely', headline: `Likely coming, ${when}`, ...base, earliest };
  return { level: 'possible', headline: `Possible, ${when}`, ...base, earliest };
}

export function checkArrival(storm: StormObject, alerts: WeatherAlert[] | null, spot: MapPoint, now: number): Arrival {
  const seen = observedDrift(storm.center, storm.at, storm.past);
  const path = (d: Drift, horizon = HORIZON_MIN) => sweep(storm.ring, d, storm.at, spot, now, horizon);
  const fast = fasterSpeed(storm.drift, seen);
  const soon = (d: Drift) => path(atSpeed(d, fast), 60).kind === 'hit';
  return decide({
    inside: insideNow(storm.ring, storm.drift ?? seen, storm.at, spot, now),
    reported: storm.drift ? path(storm.drift) : null,
    observed: seen ? path(seen) : null,
    fan: fanDrifts(storm.drift, seen).map(d => path(d)),
    beyond: fanDrifts(storm.drift, seen).some(d => path(d, FAR_HORIZON_MIN).kind === 'hit'),
    bothSoon: moving(storm.drift) && moving(seen) && soon(storm.drift) && soon(seen),
    warning: confirmingWarning(alerts, storm.center, spot),
    jumped: !seen && storm.past.some(p => storm.at - p.at >= MIN_HISTORY_MS),
    now,
  });
}
