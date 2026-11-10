import { spend } from '@/api/budget';
export type StationStatus = { at: number | null; status: string; mode: string; alarm: string | null };
export function readStationStatus(j: { properties?: { rda?: { timestamp?: string; properties?: { status?: string; mode?: string; alarmSummary?: string } } } }): StationStatus {
  const r = j.properties?.rda, p = r?.properties;
  const at = Date.parse(r?.timestamp ?? '');
  return { at: Number.isFinite(at) ? at : null, status: p?.status ?? 'Unknown', mode: p?.mode ?? 'Unknown', alarm: p?.alarmSummary && p.alarmSummary !== 'None' ? p.alarmSummary : null };
}
const cache = new Map<string, { at: number; request: Promise<StationStatus> }>();
export function getStationStatus(id: string) {
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < 5 * 60_000) return hit.request;
  spend('nws');
  const request = fetch(`https://api.weather.gov/radar/stations/${encodeURIComponent(id)}`, { headers: { accept: 'application/geo+json' }, signal: AbortSignal.timeout(15000) })
    .then(async r => { if (!r.ok) throw new Error('Station status unavailable'); return readStationStatus(await r.json()); });
  cache.set(id, { at: Date.now(), request }); request.catch(() => cache.delete(id));
  if (cache.size > 12) cache.delete(cache.keys().next().value!);
  return request;
}
