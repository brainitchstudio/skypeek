// The storm motion an NWS warning carries in its eventMotionDescription parameter.

import type { Motion } from './approach';
import type { MapPoint } from './tools';

export type WarningMotion = Motion & { points: MapPoint[] };

const PAIR = /^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/;
const FORMAT = /^(.+?)\.\.\.\S+\.\.\.(\d+)DEG\.\.\.(\d+)KT\.\.\.(.+)$/;

/** "time...label...236DEG...14KT...lat,lon lat,lon" as a heading toward, mph and the storm's position. */
export function parseWarningMotion(text: string | undefined): WarningMotion | null {
  const m = FORMAT.exec(text ?? '');
  if (!m) return null;
  const at = Date.parse(m[1]);
  const points: MapPoint[] = [];
  for (const pair of m[4].trim().split(/\s+/)) {
    if (!PAIR.test(pair)) return null;
    const [lat, lon] = pair.split(',').map(Number);
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
    points.push({ lat, lon });
  }
  if (!Number.isFinite(at) || !points.length || Number(m[2]) > 360) return null;
  return { heading: (Number(m[2]) + 180) % 360, mph: Number(m[3]) * 1.15078, at, points }; // reported as the direction it's moving from
}
