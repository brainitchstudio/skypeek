export const fToC = (f: number) => ((f - 32) * 5) / 9;
export const cToF = (c: number) => (c * 9) / 5 + 32;
export const kToC = (k: number) => k - 273.15;
export const mphToMs = (m: number) => m * 0.44704;
export const kphToMs = (k: number) => k / 3.6;
export const msToMph = (m: number) => m / 0.44704;

/** Percent to [0,1]. A number out of range passes through so the safeguards can catch and log it. */
export function pct(v: unknown): number | null {
  return typeof v === 'number' ? v / 100 : null;
}

/** A number, or null. Numeric strings don't pass; limits are checked in safeguards.ts. */
export const num = (v: unknown): number | null => (typeof v === 'number' ? v : null);

/** Whether the sun is up: calculated, so no source has to supply it and nothing assumes it. */
export function isDaylight(t: number, lat: number, lon: number): boolean {
  const rad = Math.PI / 180;
  const day = (t - Date.UTC(new Date(t).getUTCFullYear(), 0, 0)) / 86_400_000;
  const decl = 23.44 * rad * Math.sin((2 * Math.PI * (284 + day)) / 365);
  const hourAngle = (((t % 86_400_000) / 3_600_000 + lon / 15 - 12) * 15) * rad;
  return Math.sin(lat * rad) * Math.sin(decl) + Math.cos(lat * rad) * Math.cos(decl) * Math.cos(hourAngle) > -0.0145;
}

const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

export const degToCompass = (deg: number) => COMPASS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];

export function compassToDeg(s: string | null | undefined): number | null {
  const i = COMPASS.indexOf(s ?? '');
  return i < 0 ? null : i * 22.5;
}

/** Great-circle distance, safe across the antimeridian. */
export function distanceKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}
