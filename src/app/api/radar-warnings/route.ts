import { NextRequest, NextResponse } from 'next/server';
import type { Geometry, Position } from 'geojson';
import { countyFipsOf, type NwsAlertFeature } from '@/lib/alerts';
import { loadWarningCounties, type WarningCounty } from '@/lib/warningCounties';

export const runtime = 'nodejs';

type Box = { west: number; south: number; east: number; north: number };

function coordinates(geometry: Geometry): Position[] {
  const out: Position[] = [];
  const visit = (value: unknown) => {
    if (!Array.isArray(value)) return;
    if (typeof value[0] === 'number' && typeof value[1] === 'number') out.push(value as Position);
    else value.forEach(visit);
  };
  if (geometry.type === 'GeometryCollection') geometry.geometries.forEach(g => out.push(...coordinates(g)));
  else visit(geometry.coordinates);
  return out;
}

export function warningIntersects(geometry: Geometry, box: Box): boolean {
  const pts = coordinates(geometry);
  if (!pts.length) return false;
  let west = Infinity, east = -Infinity, south = Infinity, north = -Infinity;
  for (const [lon, lat] of pts) {
    west = Math.min(west, lon); east = Math.max(east, lon);
    south = Math.min(south, lat); north = Math.max(north, lat);
  }
  return boxIntersects({ west, south, east, north }, box);
}

function boxIntersects(area: Box, view: Box): boolean {
  // MapLibre can report longitudes past ±180 while panning across the date line.
  return area.north >= view.south && area.south <= view.north
    && [-360, 0, 360].some(shift => area.east >= view.west + shift && area.west <= view.east + shift);
}

export function visibleWarnings(features: NwsAlertFeature[], box: Box, counties: Map<string, WarningCounty> = new Map()): NwsAlertFeature[] {
  return features.filter(f => (f.properties.status ?? 'Actual') === 'Actual' && f.properties.messageType !== 'Cancel'
    && ((f.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon') && warningIntersects(f.geometry, box))
      || countyFipsOf(f).some(id => {
        const county = counties.get(id);
        return county ? boxIntersects(county.bounds, box) : false;
      })));
}

export async function GET(request: NextRequest) {
  const values = ['west', 'south', 'east', 'north'].map(k => {
    const value = request.nextUrl.searchParams.get(k);
    return value === null ? NaN : Number(value);
  });
  const [west, south, east, north] = values;
  if (values.some(v => !Number.isFinite(v)) || west < -540 || east > 540 || east - west > 360 || south < -90 || north > 90 || west >= east || south >= north) {
    return NextResponse.json({ error: 'Invalid map bounds' }, { status: 400 });
  }
  try {
    const response = await fetch('https://api.weather.gov/alerts/active', {
      headers: { accept: 'application/geo+json', 'user-agent': 'Sky Peek radar (weather app)' },
      next: { revalidate: 60 }, signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(`NWS alerts: ${response.status}`);
    const data = await response.json() as { features?: NwsAlertFeature[] };
    if (!Array.isArray(data.features)) throw new Error('Invalid NWS alerts');
    const counties = await loadWarningCounties();
    return NextResponse.json({ features: visibleWarnings(data.features, { west, south, east, north }, counties) }, { headers: { 'cache-control': 'public, max-age=30' } });
  } catch {
    return NextResponse.json({ error: 'NWS warnings unavailable' }, { status: 503 });
  }
}
