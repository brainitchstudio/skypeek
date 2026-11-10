import { milesBetween } from './proximity';

export const LIGHTNING_SAFETY_MI = 10;
export const LIGHTNING_WINDOW_MS = 15 * 60_000;

export type LightningStrike = {
  id: string; lat: number; lon: number; at: number;
  kind: 'ground' | 'cloud' | 'unknown';
  intensity: number | null; accuracyMi: number | null;
  source: 'OpenWeather' | 'The Weather Company'; quality: string | null;
};

type Feed = { lightning?: {
  latitude?: unknown[]; longitude?: unknown[]; validTimeUtc?: unknown[];
  strikeTypeCode?: unknown[]; intensity?: unknown[]; errorMajor?: unknown[];
} };

/** The provider sends parallel arrays. Reject incomplete, future, and stale records. */
export function mapLightning(feed: Feed, now = Date.now()): LightningStrike[] {
  const rows = feed.lightning;
  if (!rows || !Array.isArray(rows.latitude) || !Array.isArray(rows.longitude) || !Array.isArray(rows.validTimeUtc)) return [];
  return rows.latitude.flatMap((rawLat, i) => {
    const lat = rawLat, lon = rows.longitude![i], rawTime = rows.validTimeUtc![i];
    const at = typeof rawTime === 'string' ? Date.parse(rawTime) : NaN;
    if (typeof lat !== 'number' || typeof lon !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180 || !Number.isFinite(at) || at > now + 60_000 || now - at > LIGHTNING_WINDOW_MS) return [];
    const code = rows.strikeTypeCode?.[i];
    const intensity = rows.intensity?.[i], accuracy = rows.errorMajor?.[i];
    return [{
      id: `${at}:${lat.toFixed(5)}:${lon.toFixed(5)}:${i}`, lat, lon, at,
      kind: code === 0 ? 'ground' as const : code === 1 ? 'cloud' as const : 'unknown' as const,
      intensity: typeof intensity === 'number' && Number.isFinite(intensity) ? intensity : null,
      accuracyMi: typeof accuracy === 'number' && Number.isFinite(accuracy) && accuracy >= 0 ? accuracy : null,
      source: 'The Weather Company' as const, quality: null,
    }];
  });
}

export function nearestStrike(strikes: LightningStrike[], lat: number, lon: number) {
  return strikes.reduce<{ strike: LightningStrike; miles: number } | null>((best, strike) => {
    const miles = milesBetween(lat, lon, strike.lat, strike.lon);
    return !best || miles < best.miles ? { strike, miles } : best;
  }, null);
}

export function mapOpenWeatherLightning(feed: { lightnings?: unknown }, now = Date.now()): LightningStrike[] {
  if (!Array.isArray(feed.lightnings)) return [];
  return feed.lightnings.flatMap((raw: unknown) => {
    if (!raw || typeof raw !== 'object') return [];
    const row = raw as Record<string, unknown>;
    const { lat, lon } = row;
    const at = typeof row.datetime === 'string' ? Date.parse(row.datetime) : NaN;
    if (typeof lat !== 'number' || typeof lon !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180 || !Number.isFinite(at) || at > now + 60_000 || now - at > LIGHTNING_WINDOW_MS) return [];
    const error = row.error;
    return [{ id: String(row.id ?? `${at}:${lat}:${lon}`), lat, lon, at, kind: 'unknown' as const,
      intensity: null, accuracyMi: typeof error === 'number' && Number.isFinite(error) && error >= 0 ? error / 1.609344 : null,
      source: 'OpenWeather' as const, quality: typeof row.quality === 'string' ? row.quality : null }];
  });
}

/** Uses the existing OpenWeather connection; the lightning product needs its own entitlement. */
export async function getOpenWeatherLightning(lat: number, lon: number, key: string, now = Date.now(), signal?: AbortSignal): Promise<LightningStrike[]> {
  const q = new URLSearchParams({ lat: lat.toFixed(5), lon: lon.toFixed(5), radius: '50', start_date: new Date(now - LIGHTNING_WINDOW_MS).toISOString(), end_date: new Date(now).toISOString(), apikey: key });
  const r = await fetch(`https://demo.openweathermap.org/lightning/1.0/data?${q}`, { signal });
  if (!r.ok) throw new Error(`OpenWeather lightning failed: ${r.status}`);
  return mapOpenWeatherLightning(await r.json(), now);
}

/** Two adjacent 15-minute windows cover the trailing quarter hour during a live interval. */
export async function getLightningStrikes(lat: number, lon: number, key: string, now = Date.now(), signal?: AbortSignal): Promise<LightningStrike[]> {
  const start = Math.floor(now / LIGHTNING_WINDOW_MS) * LIGHTNING_WINDOW_MS;
  const dates = [start - LIGHTNING_WINDOW_MS, start];
  const results = await Promise.all(dates.map(async at => {
    const stamp = new Date(at).toISOString().replace(/[-:T]/g, '').slice(0, 12);
    const q = new URLSearchParams({ startDateTime: stamp, geocode: `${lat.toFixed(5)},${lon.toFixed(5)}`, format: 'json', units: 'e', strikeType: 'all', apiKey: key });
    const r = await fetch(`https://api.weather.com/v3/wx/lightning/recent/region/15minute?${q}`, { signal });
    if (r.status === 204) return [];
    if (!r.ok) throw new Error(`Strike feed failed: ${r.status}`);
    return mapLightning(await r.json(), now);
  }));
  return [...new Map(results.flat().map(strike => [strike.id, strike])).values()];
}
