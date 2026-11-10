// NOAA MRMS ProbSevere 3.0 files, trimmed to what the storm arrival check needs.
// Motion and probability meanings: NOAA's ProbSevere v3 file description.

import { areaCentroid, type Drift, type Ring } from '@/radar/stormPath';
import type { MapPoint } from '@/radar/tools';

export const PROBSEVERE_BASE = 'https://mrms.ncep.noaa.gov/ProbSevere/PROBSEVERE/';

export type StormObject = {
  id: string; at: number; ring: Ring; center: MapPoint; sizeKm2: number | null;
  drift: Drift | null; // reported motion
  dbz: number | null; vil: number | null; hailIn: number | null;
  probSevere: number | null; probHail: number | null; probWind: number | null; probTor: number | null;
  past: { at: number; center: MapPoint }[];
};
export type StormFeed = { at: number; storms: StormObject[] };
type FileName = { name: string; at: number };

const NAME = /MRMS_PROBSEVERE_(\d{4})(\d\d)(\d\d)_(\d\d)(\d\d)(\d\d)\.json/;
const MIN = 60_000;
const HISTORY_MIN = [10, 20, 30];
const SLOT_MS = 3 * MIN; // how far past its slot a history file may be

export function parseIndex(html: string): FileName[] {
  const names = new Map<string, number>();
  for (const [, href] of html.matchAll(/href="([^"]+)"/g)) {
    const m = href.match(new RegExp(`^${NAME.source}$`));
    if (m) names.set(href, Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]));
  }
  return [...names].map(([name, at]) => ({ name, at })).sort((a, b) => a.at - b.at);
}

/** The newest file, then for each slot the nearest file at or past it, so a 20-minute slot really is 20 minutes old. */
export function pickFiles(files: FileName[]): FileName[] {
  if (!files.length) return [];
  const newest = files.reduce((a, b) => (b.at > a.at ? b : a));
  const picked = [newest];
  for (const minutes of HISTORY_MIN) {
    const target = newest.at - minutes * MIN;
    const near = files.filter(f => f.at <= target && target - f.at <= SLOT_MS).sort((a, b) => b.at - a.at)[0];
    if (near && !picked.includes(near)) picked.push(near);
  }
  return picked;
}

const num = (value: unknown) => {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  if (value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

function ringOf(geometry: unknown): Ring | null {
  const g = geometry as { type?: string; coordinates?: unknown[] } | null;
  if (g?.type !== 'Polygon' || !Array.isArray(g.coordinates?.[0])) return null;
  const ring = g.coordinates[0] as unknown[];
  const ok = ring.length >= 4 && ring.every(p => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]) && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90);
  return ok ? (ring as Ring) : null;
}

/** One file's storms. A bad feature is dropped alone; a file with no feature list throws, so it can't read as no storms. */
export function parseFile(json: unknown, at: number): StormObject[] {
  const features = (json as { features?: unknown } | null)?.features;
  if (!Array.isArray(features)) throw new Error('Invalid ProbSevere file');
  const out: StormObject[] = [];
  for (const f of features as ({ geometry?: unknown; properties?: Record<string, unknown> } | null)[]) {
    const p = f?.properties, ring = ringOf(f?.geometry);
    if (!p || !ring || p.ID === undefined || p.ID === null || p.ID === '') continue;
    const east = num(p.MOTION_EAST), south = num(p.MOTION_SOUTH);
    out.push({
      id: String(p.ID), at, ring, center: areaCentroid(ring), sizeKm2: num(p.SIZE),
      // Observed storm moves show negative MOTION_SOUTH going north, so north is its negative.
      // Exactly zero isn't a stopped storm: in a day of files most of those were moving.
      drift: east === null || south === null || (east === 0 && south === 0) ? null : { eastMps: east, northMps: south === 0 ? 0 : -south },
      dbz: num(p.COMPREF), vil: num(p.VIL), hailIn: num(p.MESH),
      probSevere: num(p.ProbSevere), probHail: num(p.ProbHail), probWind: num(p.ProbWind), probTor: num(p.ProbTor),
      past: [],
    });
  }
  return out;
}

export function joinHistory(newest: StormObject[], older: StormObject[][]): StormObject[] {
  return newest.map(storm => ({
    ...storm,
    past: older.flatMap(file => file.filter(o => o.id === storm.id).map(o => ({ at: o.at, center: o.center }))).sort((a, b) => a.at - b.at),
  }));
}
