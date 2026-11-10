// Distances and arrival times around a point on the radar map.

import type { StormCell } from '@/api/layers';

const MI_PER_DEG = 69.17;
const NEAR_MI = 5; // a storm this close counts as already here
const CORRIDOR_MI = 10; // how far off a storm's track still counts as in its path
const HORIZON_MIN = 60; // storm motion isn't worth extrapolating past this

/** Miles east and north from one point to another. Good enough at storm-tracking distances. */
export function offset(fromLat: number, fromLon: number, lat: number, lon: number): [number, number] {
  return [(lon - fromLon) * MI_PER_DEG * Math.cos((fromLat * Math.PI) / 180), (lat - fromLat) * MI_PER_DEG];
}

export function milesBetween(fromLat: number, fromLon: number, lat: number, lon: number) {
  return Math.hypot(...offset(fromLat, fromLon, lat, lon));
}

export type Arrival = { cell: StormCell; minutes: number };

/** The soonest storm to reach a point, if any will within the hour. 0 minutes means it's already there. */
export function stormArrival(cells: StormCell[], lat: number, lon: number, now = Date.now()): Arrival | null {
  let best: Arrival | null = null;
  for (const cell of cells) {
    const [east, north] = offset(cell.lat, cell.lon, lat, lon);
    let minutes: number | null = null;
    if (Math.hypot(east, north) <= NEAR_MI) minutes = 0;
    else if (cell.mph > 0) {
      const h = (cell.heading * Math.PI) / 180;
      const ahead = east * Math.sin(h) + north * Math.cos(h);
      const across = Math.abs(east * Math.cos(h) - north * Math.sin(h));
      // Reports can be minutes old, so count from where the storm has reached by now.
      const m = (ahead / cell.mph) * 60 - (now - cell.at) / 60_000;
      if (across <= CORRIDOR_MI && m > 0 && m <= HORIZON_MIN) minutes = m;
    }
    if (minutes !== null && (!best || minutes < best.minutes)) best = { cell, minutes };
  }
  return best;
}

/** "in about 25 minutes". Radar motion can't justify more precision than this. */
export function arrivalPhrase(minutes: number) {
  return minutes < 5 ? 'in under 5 minutes' : `in about ${Math.round(minutes / 5) * 5} minutes`;
}

export const LIGHTNING_RANGE_MI = 100;

export type Box = { south: number; west: number; north: number; east: number };

/** A square box around a point, this many miles from center to edge. */
export function boxAround(lat: number, lon: number, miles: number): Box {
  const dLat = miles / MI_PER_DEG, dLon = dLat / Math.cos((lat * Math.PI) / 180);
  return { south: lat - dLat, west: lon - dLon, north: lat + dLat, east: lon + dLon };
}

/** Miles to the nearest drawn pixel of a square RGBA image covering `box`, or null if none is in range. */
export function nearestDrawn(rgba: ArrayLike<number>, size: number, box: Box, lat: number, lon: number, maxMiles: number) {
  let best: number | null = null;
  for (let y = 0; y < size; y++) {
    const pLat = box.north - ((y + 0.5) / size) * (box.north - box.south);
    for (let x = 0; x < size; x++) {
      if (!rgba[(y * size + x) * 4 + 3]) continue;
      const miles = milesBetween(lat, lon, pLat, box.west + ((x + 0.5) / size) * (box.east - box.west));
      if (miles <= maxMiles && (best === null || miles < best)) best = miles;
    }
  }
  return best;
}

/** Strikes are mapped on a 5-mile grid, so the distance can't be any finer than that. */
export function lightningPhrase(miles: number | null) {
  if (miles === null) return `None within ${LIGHTNING_RANGE_MI} miles`;
  return miles < 5 ? 'Within 5 miles' : `About ${Math.round(miles / 5) * 5} miles away`;
}
