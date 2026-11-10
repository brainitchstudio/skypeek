// Finds HRRR forecast steps. One timeline always comes from one model run, and
// a newer run is only used once every file the selected range needs is published.

import { bench, remaining, spend } from '@/api/budget';
import type { RadarFrame } from '@/api/weather';

export const FORECAST_SCHEME = 'hrrr-forecast';
export const FORECAST_HOURS = [2, 6, 18] as const;
export const FORECAST_MAX_ZOOM = 11;
export type ForecastStep = { url: string; start: number; end: number; run: number; leadMin: number };

const BUCKET = 'https://noaa-hrrr-bdp-pds.s3.amazonaws.com/';
const FIELD = ':REFD:1000 m above ground:';
const MINUTE = 60_000, HOUR = 60 * MINUTE;
const STEP_MIN = 15, LAST_LEAD_MIN = 18 * 60; // the 15-minute file series ends at 18 hours
const RUNS_TO_TRY = 6;
const IDX_TIMEOUT_MS = 15_000, COOLDOWN_MS = 60_000;

const two = (n: number) => String(n).padStart(2, '0');
const compactDate = (d: Date) => `${d.getUTCFullYear()}${two(d.getUTCMonth() + 1)}${two(d.getUTCDate())}`;

export function runUrl(run: number, hour: number) {
  const d = new Date(run);
  return `${BUCKET}hrrr.${compactDate(d)}/conus/hrrr.t${two(d.getUTCHours())}z.wrfsubhf${two(hour)}.grib2`;
}

/** The REFD steps in one idx file. An idx from any other run yields nothing. */
export function parseIdx(text: string, run: number, url: string): ForecastStep[] {
  const stamp = `:d=${compactDate(new Date(run))}${two(new Date(run).getUTCHours())}`;
  const lines = text.trim().split('\n');
  return lines.flatMap((line, i) => {
    const lead = line.match(/:(\d+) min fcst:/);
    const next = lines[i + 1]?.split(':')[1];
    if (!lead || !line.includes(FIELD) || !line.includes(stamp) || next === undefined) return [];
    return [{ url, start: Number(line.split(':')[1]), end: Number(next) - 1, run, leadMin: Number(lead[1]) }];
  });
}

export function forecastTileUrl(s: ForecastStep) {
  return `${FORECAST_SCHEME}://tile/{z}/{x}/{y}?u=${encodeURIComponent(s.url)}&s=${s.start}&e=${s.end}&r=${s.run}&l=${s.leadMin}`;
}

const published = new Map<string, string>();

/** The idx text, or null if it isn't out yet. */
async function readIdx(url: string, signal?: AbortSignal): Promise<string | null> {
  const hit = published.get(url);
  if (hit !== undefined) return hit;
  signal?.throwIfAborted();
  spend('hrrr');
  const timeout = AbortSignal.timeout(IDX_TIMEOUT_MS);
  const r = await fetch(url, { signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
  if (r.status === 404 || r.status === 403) return null;
  if (r.status === 429 || r.status >= 500) bench('hrrr', COOLDOWN_MS);
  if (!r.ok) throw new Error(`HRRR index failed: ${r.status}`);
  const text = await r.text();
  published.set(url, text);
  return text;
}

/** Leads from `run` valid after `from`, up to `to`, on the model's 15-minute steps. */
function leadsBetween(run: number, from: number, to: number) {
  const first = Math.max(STEP_MIN, (Math.floor((from - run) / MINUTE / STEP_MIN) + 1) * STEP_MIN);
  const last = Math.min(LAST_LEAD_MIN, Math.floor((to - run) / MINUTE / STEP_MIN) * STEP_MIN);
  return last < first ? null : { first, last };
}

const fileOf = (leadMin: number) => Math.ceil(leadMin / 60);

async function stepsFromRun(run: number, first: number, last: number, signal?: AbortSignal) {
  const steps: ForecastStep[] = [];
  for (let hour = fileOf(last); hour >= fileOf(first); hour--) { // furthest first: it publishes last
    if (remaining('hrrr') < 1) return null;
    const url = runUrl(run, hour);
    const text = await readIdx(`${url}.idx`, signal);
    if (text === null) return null;
    steps.push(...parseIdx(text, run, url));
  }
  return steps;
}

const label = (at: number) => new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

/** Forecast frames after the latest scan, from the newest run that has the whole range published. */
export async function getForecastFrames(latestScanAt: number, hours: number, now: number, signal?: AbortSignal): Promise<RadarFrame[]> {
  signal?.throwIfAborted();
  const newest = Math.floor(now / HOUR) * HOUR;
  for (let back = 0; back < RUNS_TO_TRY; back++) {
    const run = newest - back * HOUR;
    const range = leadsBetween(run, latestScanAt, latestScanAt + hours * HOUR);
    if (!range) continue;
    const steps = await stepsFromRun(run, range.first, range.last, signal);
    if (remaining('hrrr') < 1 && !steps) return [];
    if (!steps) continue;
    const wanted = steps.filter(s => s.leadMin >= range.first && s.leadMin <= range.last).sort((a, b) => a.leadMin - b.leadMin);
    if (wanted.length !== (range.last - range.first) / STEP_MIN + 1) continue; // a gap would hide a missing time
    return wanted.map(s => {
      const at = run + s.leadMin * MINUTE;
      return { at, label: label(at), url: forecastTileUrl(s), maxZoom: FORECAST_MAX_ZOOM, kind: 'forecast', run, leadMin: s.leadMin };
    });
  }
  return [];
}
