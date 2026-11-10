import type { Feature, FeatureCollection, MultiPolygon, Polygon, Position } from 'geojson';
import { feature } from 'topojson-client';
import type { GeometryCollection, Topology } from 'topojson-specification';
import { insideGeometry } from '@/radar/approach';

export type WarningCounty = {
  id: string;
  name: string;
  geometry: Polygon | MultiPolygon;
  bounds: { west: number; south: number; east: number; north: number };
  icon: [number, number]; // longitude, latitude, within the county
};

let countiesPromise: Promise<Map<string, WarningCounty>> | null = null;

function positions(geometry: Polygon | MultiPolygon): Position[] {
  return (geometry.type === 'Polygon' ? geometry.coordinates : geometry.coordinates.flat()).flat();
}

function iconPoint(geometry: Polygon | MultiPolygon, bounds: WarningCounty['bounds']): [number, number] {
  const center: [number, number] = [(bounds.west + bounds.east) / 2, (bounds.south + bounds.north) / 2];
  const inside = ([lon, lat]: [number, number]) => insideGeometry({ lat, lon }, geometry) === true;
  if (inside(center)) return center;
  for (const fraction of [0.25, 0.5, 0.75, 0.125, 0.375, 0.625, 0.875]) {
    for (const other of [0.5, 0.25, 0.75, 0.125, 0.375, 0.625, 0.875]) {
      const candidate: [number, number] = [bounds.west + (bounds.east - bounds.west) * fraction, bounds.south + (bounds.north - bounds.south) * other];
      if (inside(candidate)) return candidate;
    }
  }
  const [lon, lat] = positions(geometry)[0];
  return [lon, lat];
}

/** Census county shapes keyed by five-digit FIPS, shared by the server filter and map overlay. */
export function loadWarningCounties(): Promise<Map<string, WarningCounty>> {
  countiesPromise ??= import('us-atlas/counties-10m.json').then(module => {
    const topology = module.default as unknown as Topology<{ counties: GeometryCollection }>;
    const collection = feature(topology, topology.objects.counties) as FeatureCollection<Polygon | MultiPolygon>;
    const counties = new Map<string, WarningCounty>();
    for (const item of collection.features as Feature<Polygon | MultiPolygon>[]) {
      const id = String(item.id ?? '').padStart(5, '0');
      if (!/^\d{5}$/.test(id)) continue;
      let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity;
      for (const [lon, lat] of positions(item.geometry)) {
        west = Math.min(west, lon); south = Math.min(south, lat);
        east = Math.max(east, lon); north = Math.max(north, lat);
      }
      if (!Number.isFinite(west)) continue;
      const bounds = { west, south, east, north };
      counties.set(id, { id, name: String(item.properties?.name ?? id), geometry: item.geometry, bounds, icon: iconPoint(item.geometry, bounds) });
    }
    return counties;
  });
  return countiesPromise;
}

/** Find the county containing a point already confirmed by NWS as affected. */
export async function countyFipsAt(lat: number, lon: number): Promise<string | null> {
  const counties = await loadWarningCounties();
  for (const county of counties.values()) {
    if (lon < county.bounds.west || lon > county.bounds.east || lat < county.bounds.south || lat > county.bounds.north) continue;
    if (insideGeometry({ lat, lon }, county.geometry)) return county.id;
  }
  return null;
}
