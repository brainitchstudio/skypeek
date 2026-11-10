// Where a storm's outline goes over the next hour, kept at its current shape and size.

import { degToCompass } from '@/weather/units';
import { offset } from './proximity';
import type { MapPoint } from './tools';

const DEFAULT_HORIZON_MIN = 60;
const FAN_MARGIN_DEG = 15; // either side of the tracks: Sky Peek's own rule
const FAN_STEP_DEG = 5;
const STILL_MPS = 0.447; // 1 mph
const MI_PER_MIN_PER_MPS = 0.0372823;
const MIN_HISTORY_MS = 20 * 60_000;
const MAX_OBSERVED_MPH = 100; // faster than any storm: the ID jumped in a merge or split
const MPH_PER_MPS = 2.23694;
const METERS_PER_MILE = 1609.344;

export type Ring = [number, number][]; // [lon, lat], closed
export type Drift = { eastMps: number; northMps: number };
export type Sweep = { kind: 'still' } | { kind: 'hit'; at: number } | { kind: 'miss'; miles: number; side: string };

type XY = [number, number];

/** The polygon's area centroid. A ring with no area falls back to its vertex average. */
export function areaCentroid(ring: Ring): MapPoint {
  let area = 0, lon = 0, lat = 0;
  for (let i = 0; i + 1 < ring.length; i++) {
    const [x0, y0] = ring[i], [x1, y1] = ring[i + 1];
    const c = x0 * y1 - x1 * y0;
    area += c; lon += (x0 + x1) * c; lat += (y0 + y1) * c;
  }
  if (Math.abs(area) < 1e-12) {
    const open = ring.slice(0, -1);
    return { lat: open.reduce((s, p) => s + p[1], 0) / open.length, lon: open.reduce((s, p) => s + p[0], 0) / open.length };
  }
  return { lat: lat / (3 * area), lon: lon / (3 * area) };
}

/** Motion the storm actually showed: newest center against the oldest one at least 20 minutes back. */
export function observedDrift(center: MapPoint, at: number, past: { at: number; center: MapPoint }[]): Drift | null {
  const old = past.filter(p => at - p.at >= MIN_HISTORY_MS).reduce<{ at: number; center: MapPoint } | null>((best, p) => (!best || p.at < best.at ? p : best), null);
  if (!old) return null;
  const [east, north] = offset(old.center.lat, old.center.lon, center.lat, center.lon);
  const seconds = (at - old.at) / 1000;
  const drift = { eastMps: (east * METERS_PER_MILE) / seconds, northMps: (north * METERS_PER_MILE) / seconds };
  return Math.hypot(drift.eastMps, drift.northMps) * MPH_PER_MPS > MAX_OBSERVED_MPH ? null : drift;
}

const speedOf = (d: Drift) => Math.hypot(d.eastMps, d.northMps);
const headingOf = (d: Drift) => (Math.atan2(d.eastMps, d.northMps) * 180) / Math.PI;
const toward = (deg: number, mps: number): Drift => ({ eastMps: mps * Math.sin((deg * Math.PI) / 180), northMps: mps * Math.cos((deg * Math.PI) / 180) });

export const moving = (d: Drift | null): d is Drift => d !== null && speedOf(d) >= STILL_MPS;
export const atSpeed = (d: Drift, mps: number) => toward(headingOf(d), mps);
export const fasterSpeed = (a: Drift | null, b: Drift | null) => Math.max(a ? speedOf(a) : 0, b ? speedOf(b) : 0);

/** The widened path: headings across the arc between the moving tracks and a margin past it, all at the faster speed. */
export function fanDrifts(reported: Drift | null, observed: Drift | null): Drift[] {
  const tracks = [reported, observed].filter(moving);
  if (!tracks.length) return [];
  const speed = Math.max(...tracks.map(speedOf));
  const base = headingOf(tracks[0]);
  const arc = tracks[1] ? ((headingOf(tracks[1]) - base + 540) % 360) - 180 : 0; // the short way round
  const fan: Drift[] = [];
  const end = Math.max(arc, 0) + FAN_MARGIN_DEG;
  for (let d = Math.min(arc, 0) - FAN_MARGIN_DEG; d <= end + 1e-9; d += FAN_STEP_DEG) fan.push(toward(base + d, speed));
  return fan;
}

/** The ring in miles from the spot, moved along the drift to where it is by now. */
function ringNow(ring: Ring, drift: Drift | null, at: number, spot: MapPoint, now: number): XY[] {
  const minutes = Math.max(0, now - at) / 60_000;
  const dx = drift ? drift.eastMps * MI_PER_MIN_PER_MPS * minutes : 0;
  const dy = drift ? drift.northMps * MI_PER_MIN_PER_MPS * minutes : 0;
  return ring.map(([lon, lat]): XY => { const [e, n] = offset(spot.lat, spot.lon, lat, lon); return [e + dx, n + dy]; });
}

function holdsOrigin(ring: XY[]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > 0 !== yj > 0 && 0 < ((xj - xi) * -yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function insideNow(ring: Ring, drift: Drift | null, at: number, spot: MapPoint, now: number) {
  return holdsOrigin(ringNow(ring, drift, at, spot, now));
}

/** The point on segment a-b nearest p. */
function nearestOn(p: XY, a: XY, b: XY): XY {
  const d: XY = [b[0] - a[0], b[1] - a[1]];
  const len2 = d[0] ** 2 + d[1] ** 2;
  const s = len2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1]) / len2)) : 0;
  return [a[0] + s * d[0], a[1] + s * d[1]];
}

/**
 * Slides the outline along the drift from now. Relative to the outline the spot
 * walks a straight path backwards, so contact is that path meeting an edge.
 */
export function sweep(ring: Ring, drift: Drift, at: number, spot: MapPoint, now: number, horizonMin = DEFAULT_HORIZON_MIN): Sweep {
  if (!moving(drift)) return { kind: 'still' };
  const shape = ringNow(ring, drift, at, spot, now);
  if (holdsOrigin(shape)) return { kind: 'hit', at: now };
  const walk: XY = [-drift.eastMps * MI_PER_MIN_PER_MPS * horizonMin, -drift.northMps * MI_PER_MIN_PER_MPS * horizonMin];

  let first: number | null = null;
  for (let i = 0; i + 1 < shape.length; i++) {
    const a = shape[i], e: XY = [shape[i + 1][0] - a[0], shape[i + 1][1] - a[1]];
    const denom = walk[0] * e[1] - walk[1] * e[0];
    if (!denom) continue;
    const t = (a[0] * e[1] - a[1] * e[0]) / denom, s = (a[0] * walk[1] - a[1] * walk[0]) / denom;
    if (t >= 0 && t <= 1 && s >= 0 && s <= 1 && (first === null || t < first)) first = t;
  }
  if (first !== null) return { kind: 'hit', at: now + first * horizonMin * 60_000 };

  // With no contact, the shortest gap always ends at a vertex or at an end of the path.
  let miles = Infinity, from: XY = [0, 0], to: XY = shape[0];
  const consider = (p: XY, q: XY) => { const d = Math.hypot(q[0] - p[0], q[1] - p[1]); if (d < miles) { miles = d; from = p; to = q; } };
  for (const v of shape) consider(nearestOn(v, [0, 0], walk), v);
  for (let i = 0; i + 1 < shape.length; i++) {
    consider([0, 0], nearestOn([0, 0], shape[i], shape[i + 1]));
    consider(walk, nearestOn(walk, shape[i], shape[i + 1]));
  }
  return { kind: 'miss', miles, side: degToCompass((Math.atan2(to[0] - from[0], to[1] - from[1]) * 180) / Math.PI) };
}
