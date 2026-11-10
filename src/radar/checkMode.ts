import type { StormObject } from '@/lib/probSevere';
import { insideGeometry } from './approach';
import type { MapPoint } from './tools';
import type { StormTrack } from './usePointCheck';

export type CheckPrompt = { text: string; skip: boolean; again: boolean };

const clock = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
export const lostText = (asOf: number) => `No longer tracked as of ${clock(asOf)}`;

/** The mode's prompt. Null once a pin is down, because the card has taken over. */
export function checkPrompt({ picking, hasSpot, failed, loaded, count, noOutline, track }: {
  picking: boolean; hasSpot: boolean; failed: boolean; loaded: boolean; count: number; noOutline: boolean; track: StormTrack | null;
}): CheckPrompt | null {
  if (picking) {
    const text = count ? (noOutline ? 'No outline for this storm. Click a storm' : 'Click a storm') : failed ? 'Storm outlines unavailable' : loaded ? 'No storms reported right now' : 'Loading storm outlines…';
    return { text, skip: true, again: false };
  }
  if (hasSpot) return null;
  if (track?.state === 'gone') return { text: lostText(track.asOf), skip: false, again: true };
  return { text: 'Click a location', skip: false, again: false };
}

export const outlineAt = (storms: StormObject[], point: MapPoint) =>
  storms.find(s => insideGeometry(point, { type: 'Polygon', coordinates: [s.ring] })) ?? null;

const STORM_DBZ = 35; // Sky Peek's own cutoff for calling simulated echo a storm

/** What HRRR shows at the spot, from any storm. */
export function forecastLine(steps: { at: number; dbz: number | null }[]) {
  const hit = steps.find(s => s.dbz !== null && s.dbz >= STORM_DBZ);
  if (hit) return `Forecast: HRRR shows storms here around ${clock(hit.at)}`;
  if (!steps.some(s => s.dbz !== null)) return 'Forecast: HRRR unavailable';
  return steps.some(s => s.dbz === null) ? 'Forecast: HRRR has gaps, with no storms in the values it has' : 'Forecast: HRRR shows no storms here in the next 3 hours';
}

/** The 15-minute step nearest a time. Further than half a step isn't that time. */
export function nearestStep<T extends { at: number }>(steps: T[], at: number): T | null {
  const best = steps.reduce<T | null>((a, b) => (!a || Math.abs(b.at - at) < Math.abs(a.at - at) ? b : a), null);
  return best && Math.abs(best.at - at) <= 7.5 * 60_000 ? best : null;
}
