// How close a storm's reported motion carries it to a spot.

import type { Geometry, Position } from 'geojson';
import { degToCompass } from '@/weather/units';
import { offset } from './proximity';
import type { MapPoint } from './tools';

const HORIZON_MIN = 60; // storm motion isn't worth extrapolating past this
const STILL_MPH = 1; // slower than this counts as stationary

export type Motion = { heading: number; mph: number; at: number }; // heading: degrees toward; at: report time, ms
export type Approach =
  | { kind: 'unknown'; miles: number }
  | { kind: 'stationary'; miles: number }
  | { kind: 'away'; miles: number }
  | { kind: 'beyond'; miles: number }
  | { kind: 'closest'; miles: number; side: string; at: number }
  | { kind: 'crossing'; at: number };

type XY = [number, number];
const cross = (a: XY, b: XY) => a[0] * b[1] - a[1] * b[0];

/** The point on segment a-b nearest the origin. */
function nearestOnSegment(a: XY, b: XY): XY {
  const d: XY = [b[0] - a[0], b[1] - a[1]];
  const len2 = d[0] ** 2 + d[1] ** 2;
  const s = len2 ? Math.max(0, Math.min(1, -(a[0] * d[0] + a[1] * d[1]) / len2)) : 0;
  return [a[0] + s * d[0], a[1] + s * d[1]];
}

/** The nearest spot on the line to the origin when every point is shifted by v * t. */
function nearestAt(line: XY[], v: XY, t: number): XY {
  const p = line.map(([e, n]): XY => [e + v[0] * t, n + v[1] * t]);
  let best = p[0];
  for (let i = 0; i < p.length; i++) {
    const q = nearestOnSegment(p[i], p[Math.min(i + 1, p.length - 1)]);
    if (Math.hypot(...q) < Math.hypot(...best)) best = q;
  }
  return best;
}

/** Where the storm's nearest point goes relative to a spot over the next hour, from its reported motion. */
export function approach(points: MapPoint[], motion: Motion | null, spot: MapPoint, now: number): Approach {
  if (!points.length) throw new RangeError('approach needs at least one point');
  const line = points.map(p => offset(spot.lat, spot.lon, p.lat, p.lon));
  const rate = motion ? motion.mph / 60 : 0; // miles per minute
  if (!motion || motion.mph < STILL_MPH) {
    const miles = Math.hypot(...nearestAt(line, [0, 0], 0));
    return { kind: motion ? 'stationary' : 'unknown', miles };
  }
  const h = (motion.heading * Math.PI) / 180;
  const v: XY = [rate * Math.sin(h), rate * Math.cos(h)];
  // Reports can be minutes old, so start from where the line has reached by now.
  const age = (now - motion.at) / 60_000;
  const start = line.map(([e, n]): XY => [e + v[0] * age, n + v[1] * age]);

  // A line only crosses when it has a length to sweep over the spot.
  let crossing: number | null = null;
  for (let i = 0; i + 1 < start.length; i++) {
    const a = start[i], d: XY = [start[i + 1][0] - a[0], start[i + 1][1] - a[1]];
    const denom = cross(v, d);
    if (!denom) continue;
    const t = -cross(a, d) / denom, s = cross(a, v) / denom;
    if (t >= 0 && t <= HORIZON_MIN && s >= 0 && s <= 1 && (crossing === null || t < crossing)) crossing = t;
  }
  if (crossing !== null) return { kind: 'crossing', at: now + crossing * 60_000 };

  // Distance changes linearly between vertex passes, so the best moment is one of these.
  const v2 = v[0] ** 2 + v[1] ** 2;
  const times = [0, HORIZON_MIN, ...start.map(([e, n]) => Math.max(0, Math.min(HORIZON_MIN, -(e * v[0] + n * v[1]) / v2)))];
  let bestT = 0, best = nearestAt(start, v, 0);
  for (const t of times) {
    const q = nearestAt(start, v, t);
    if (Math.hypot(...q) < Math.hypot(...best)) { best = q; bestT = t; }
  }
  const miles = Math.hypot(...best);
  if (bestT === 0) return { kind: 'away', miles };
  if (bestT === HORIZON_MIN) return { kind: 'beyond', miles };
  const side = degToCompass((Math.atan2(best[0], best[1]) * 180) / Math.PI);
  return { kind: 'closest', miles, side, at: now + bestT * 60_000 };
}

const miles = (m: number) => (Math.round(m) < 1 ? 'under 1 mi' : `about ${Math.round(m)} mi`);
const clock = (ms: number) => new Date(Math.round(ms / 300_000) * 300_000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

export function approachPhrase(a: Approach) {
  switch (a.kind) {
    case 'closest': return `Closest ${Math.round(a.miles) < 1 ? miles(a.miles) : `${miles(a.miles)} ${a.side}`}, around ${clock(a.at)}`;
    case 'crossing': return `Line crosses this spot around ${clock(a.at)}`;
    case 'beyond': return `Still ${miles(a.miles)} away after ${HORIZON_MIN} minutes`;
    case 'away': return `Moving away, ${miles(a.miles)} now`;
    case 'stationary': return `Stationary, ${miles(a.miles)} away`;
    case 'unknown': return `Motion unavailable, ${miles(a.miles)} away`;
  }
}

function inRing(p: MapPoint, ring: Position[]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > p.lat !== yj > p.lat && p.lon < ((xj - xi) * (p.lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const inPolygon = (p: MapPoint, rings: Position[][]) => inRing(p, rings[0]) && !rings.slice(1).some(hole => inRing(p, hole));

/** Whether a spot is inside a polygon (holes excluded) or any part of a multipolygon; null for any other geometry. */
export function insideGeometry(spot: MapPoint, geometry: Geometry | null): boolean | null {
  if (geometry?.type === 'Polygon') return inPolygon(spot, geometry.coordinates);
  if (geometry?.type === 'MultiPolygon') return geometry.coordinates.some(rings => inPolygon(spot, rings));
  return null; // no polygon to test against
}
