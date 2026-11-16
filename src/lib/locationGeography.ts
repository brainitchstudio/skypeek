import type { Geometry, Position } from 'geojson';
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
import { bearingFrom, distanceM, type Coordinates, type LocationDescription } from './locationDescription';
import { countyFipsAt, loadWarningCounties } from './warningCounties';

type Candidate = { name: string; distance: number };
export type MapFeature = { geometry: Geometry; properties: Record<string, unknown>; layer: string };
const STATES: Record<string, string> = Object.fromEntries(('01:AL 02:AK 04:AZ 05:AR 06:CA 08:CO 09:CT 10:DE 11:DC 12:FL 13:GA 15:HI 16:ID 17:IL 18:IN 19:IA 20:KS 21:KY 22:LA 23:ME 24:MD 25:MA 26:MI 27:MN 28:MS 29:MO 30:MT 31:NE 32:NV 33:NH 34:NJ 35:NM 36:NY 37:NC 38:ND 39:OH 40:OK 41:OR 42:PA 44:RI 45:SC 46:SD 47:TN 48:TX 49:UT 50:VT 51:VA 53:WA 54:WV 55:WI 56:WY 72:PR').split(' ').map(s => s.split(':')));

/** Bounded, short-lived in-process cache; no device coordinates are persisted on the server. */
const cache = new Map<string, { at: number; value: Promise<unknown> }>();
function cached<T>(key: string, run: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 3_600_000) return hit.value as Promise<T>;
  const value = run();
  if (cache.size >= 128) cache.delete(cache.keys().next().value!);
  cache.set(key, { at: Date.now(), value });
  value.catch(() => { if (cache.get(key)?.value === value) cache.delete(key); });
  return value;
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { signal: AbortSignal.timeout(5000), cache: 'no-store', headers: { Accept: 'application/json', 'User-Agent': 'SkyPeek (weather location lookup)' } });
  if (!response.ok) throw new Error('Geographic source unavailable');
  return response.json();
}

export function featureDistance(point: Coordinates, geometry: Geometry): number {
  const at = (p: Position) => distanceM(point, { lon: p[0], lat: p[1] });
  const line = (positions: Position[]) => {
    let best = Infinity;
    const scale = Math.cos(point.lat * Math.PI / 180);
    for (let i = 1; i < positions.length; i++) {
      const a = positions[i - 1], b = positions[i];
      const ax = (a[0] - point.lon) * scale, ay = a[1] - point.lat;
      const dx = (b[0] - a[0]) * scale, dy = b[1] - a[1];
      const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1)));
      best = Math.min(best, at([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]));
    }
    return best;
  };
  if (geometry.type === 'Point') return at(geometry.coordinates);
  if (geometry.type === 'MultiPoint') return Math.min(...geometry.coordinates.map(at));
  if (geometry.type === 'LineString') return line(geometry.coordinates);
  if (geometry.type === 'MultiLineString') return Math.min(...geometry.coordinates.map(line));
  return Infinity;
}

/** Fetch only tiles touching a 200m neighborhood, including across tile boundaries. */
export function nearbyTiles(point: Coordinates): { x: number; y: number; z: number }[] {
  const z = 14, n = 2 ** z;
  const xy = (lat: number, lon: number) => {
    const phi = Math.max(-85.0511, Math.min(85.0511, lat)) * Math.PI / 180;
    return [Math.floor((lon + 180) / 360 * n), Math.floor((1 - Math.asinh(Math.tan(phi)) / Math.PI) / 2 * n)];
  };
  const latDelta = 200 / 111_320, lonDelta = latDelta / Math.max(0.1, Math.cos(point.lat * Math.PI / 180));
  const tiles = new Map<string, { x: number; y: number; z: number }>();
  for (const lat of [point.lat - latDelta, point.lat, point.lat + latDelta]) {
    for (const lon of [point.lon - lonDelta, point.lon, point.lon + lonDelta]) {
      let [x, y] = xy(lat, lon); x = (x % n + n) % n; y = Math.max(0, Math.min(n - 1, y));
      tiles.set(`${x}/${y}`, { x, y, z });
    }
  }
  return [...tiles.values()];
}

async function mapFeatures(point: Coordinates): Promise<MapFeature[]> {
  const metadata = await cached('tilejson', () => getJson<{ tiles: string[] }>('https://tiles.openfreemap.org/planet'));
  const template = metadata.tiles?.[0];
  if (!template || new URL(template).hostname !== 'tiles.openfreemap.org' || !template.startsWith('https://')) throw new Error('Unsupported tile source');
  const tiles = await Promise.allSettled(nearbyTiles(point).map(({ x, y, z }) => {
    const url = template.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));
    return cached(url, async () => {
      const response = await fetch(url, { signal: AbortSignal.timeout(5000), cache: 'no-store' });
      if (!response.ok) throw new Error('Tile unavailable');
      const tile = new VectorTile(new PbfReader(await response.arrayBuffer()));
      const features: MapFeature[] = [];
      for (const name of ['transportation_name', 'poi']) {
        const layer = tile.layers[name];
        if (!layer) continue;
        for (let i = 0; i < layer.length; i++) {
          const f = layer.feature(i).toGeoJSON(x, y, z);
          if (f.geometry) features.push({ geometry: f.geometry, properties: f.properties ?? {}, layer: name });
        }
      }
      return features;
    });
  }));
  return tiles.flatMap(r => r.status === 'fulfilled' ? r.value : []);
}

export function nearbyDetails(point: Coordinates, accuracy: number, features: MapFeature[]): Pick<LocationDescription, 'road' | 'landmark' | 'mapped'> {
  if (accuracy > 100) return {};
  let road: Candidate | undefined, landmark: Candidate | undefined;
  for (const f of features) {
    const p = f.properties, name = String(p['name:en'] ?? p.name_en ?? p.name ?? '').trim();
    const distance = featureDistance(point, f.geometry);
    if (f.layer === 'transportation_name' && distance + accuracy <= 150) {
      const ref = String(p.ref ?? '').split(';')[0];
      const label = p.network === 'us-interstate' && ref ? `I-${ref.replace(/^I[- ]?/, '')}` : p.network === 'us-highway' && ref ? `US ${ref.replace(/^US[- ]?/, '')}` : name;
      if (label && (!road || distance < road.distance)) road = { name: label, distance };
    }
    // Avoid arbitrary shops and private properties; a nearby POI never establishes occupancy.
    if (f.layer === 'poi' && accuracy <= 50 && distance + accuracy <= 100 && name
      && /^(fuel|rest_area|services|park|camp_site|picnic_site|information|viewpoint)$/.test(String(p.subclass ?? p.class))) {
      if (!landmark || distance < landmark.distance) landmark = { name, distance };
    }
  }
  return { road: road?.name, landmark: landmark?.name, mapped: !!(road || landmark) };
}

export async function resolveGeography(point: Coordinates, accuracy: number): Promise<LocationDescription> {
  const [townResult, countyResult, detailResult] = await Promise.allSettled([
    cached(`nws:${point.lat.toFixed(3)},${point.lon.toFixed(3)}`, async () => {
      type Point = { properties?: { relativeLocation?: { geometry?: { coordinates: number[] }; properties?: { city?: string; state?: string } } } };
      return getJson<Point>(`https://api.weather.gov/points/${point.lat.toFixed(4)},${point.lon.toFixed(4)}`);
    }),
    countyFipsAt(point.lat, point.lon),
    accuracy <= 100 ? mapFeatures(point).then(features => nearbyDetails(point, accuracy, features)) : Promise.resolve({}),
  ]);
  const result: LocationDescription = detailResult.status === 'fulfilled' ? detailResult.value : {};
  if (townResult.status === 'fulfilled') {
    const relative = townResult.value.properties?.relativeLocation;
    const coords = relative?.geometry?.coordinates, properties = relative?.properties;
    if (coords && Number.isFinite(coords[0]) && Number.isFinite(coords[1]) && properties?.city && properties.state) {
      const town = { lon: coords[0], lat: coords[1] };
      result.town = { name: `${properties.city}, ${properties.state}`, distanceM: distanceM(town, point), bearing: bearingFrom(town, point) };
    }
  }
  if (countyResult.status === 'fulfilled' && countyResult.value) {
    const county = (await loadWarningCounties()).get(countyResult.value)!;
    const state = STATES[county.id.slice(0, 2)];
    const city = (state === 'VA' && Number(county.id.slice(2)) >= 500) || ['24510', '29510', '32510'].includes(county.id);
    const suffix = state === 'LA' ? ' Parish' : city || state === 'AK' || state === 'DC' || state === 'PR' || /city$/i.test(county.name) ? '' : ' County';
    result.region = `${county.name}${suffix}${state ? `, ${state}` : ''}`;
  }
  return result;
}
