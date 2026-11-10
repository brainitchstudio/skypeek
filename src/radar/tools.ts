import type { StormCell } from '@/api/layers';
import type { RadarFrame } from '@/api/weather';
export type MapPoint = { lat: number; lon: number };
export type RadarExtent = { west: number; south: number; east: number; north: number };
export function measure(from: MapPoint, to: MapPoint) {
  const r = Math.PI / 180, a = from.lat * r, b = to.lat * r, d = (to.lon - from.lon) * r;
  const h = Math.sin((b - a) / 2) ** 2 + Math.cos(a) * Math.cos(b) * Math.sin(d / 2) ** 2;
  const km = 6371.0088 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
  const bearing = (Math.atan2(Math.sin(d) * Math.cos(b), Math.cos(a) * Math.sin(b) - Math.sin(a) * Math.cos(b) * Math.cos(d)) / r + 360) % 360;
  return { km, miles: km / 1.609344, bearing };
}
export function alignedCells(cells: StormCell[], at: number, tolerance = 5 * 60_000) {
  return cells.filter(c => Number.isFinite(c.at) && Math.abs(c.at - at) <= tolerance);
}
export function frameAfterRefresh(frames: Pick<RadarFrame, 'at' | 'kind'>[], selectedAt: number | undefined, followLatest: boolean) {
  if (followLatest || selectedAt === undefined) return Math.max(0, latestObservedIndex(frames));
  return frames.reduce((best, f, i) => Math.abs((f.at ?? Infinity) - selectedAt) < Math.abs((frames[best].at ?? Infinity) - selectedAt) ? i : best, 0);
}
export function contains(extent: RadarExtent, p: MapPoint) {
  return p.lon >= extent.west && p.lon <= extent.east && p.lat >= extent.south && p.lat <= extent.north;
}

/** The newest real scan on a timeline, or -1. A frame with no kind is observed. */
export function latestObservedIndex(frames: Pick<RadarFrame, 'kind'>[]) {
  return frames.findLastIndex(f => !isForecast(f));
}
export const isForecast = (frame?: Pick<RadarFrame, 'kind'>) => frame?.kind === 'forecast';

/** Real scans, then forecast frames that are still after the newest of them. */
export function mergeTimeline(observed: RadarFrame[], forecast: RadarFrame[]) {
  const latest = observed.at(-1)?.at;
  return latest === undefined ? observed : [...observed, ...forecast.filter(f => f.at !== undefined && f.at > latest)];
}

export function forecastBanner(frame: RadarFrame) {
  const hours = Math.floor((frame.leadMin ?? 0) / 60), minutes = (frame.leadMin ?? 0) % 60;
  const lead = [hours ? `${hours} h` : '', minutes ? `${minutes} min` : ''].filter(Boolean).join(' ');
  const run = new Date(frame.run ?? 0).toLocaleTimeString([], { hour: 'numeric' }).replace(/\s/g, ' ');
  return `HRRR simulated radar · Run ${run} · +${lead}`;
}

/** Least recently seen entries past the limit. The frame on screen always stays. */
export function layersToDrop(visited: string[], keep: number, current: string) {
  const others = visited.filter(v => v !== current);
  return others.slice(0, Math.max(0, others.length - (keep - 1)));
}
