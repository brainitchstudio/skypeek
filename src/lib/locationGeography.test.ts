import { afterEach, describe, expect, it, vi } from 'vitest';
import { featureDistance, nearbyDetails, nearbyTiles, resolveGeography, type MapFeature } from './locationGeography';

const point = { lat: 35.5, lon: -93.8 };
const road: MapFeature = { layer: 'transportation_name', geometry: { type: 'LineString', coordinates: [[-94, 35.5], [-93, 35.5]] }, properties: { ref: '40', network: 'us-interstate' } };
const landmark: MapFeature = { layer: 'poi', geometry: { type: 'Point', coordinates: [-93.8, 35.5] }, properties: { name: 'Test Service Plaza', subclass: 'services' } };
afterEach(() => vi.unstubAllGlobals());

describe('map geographic context', () => {
  it('measures the nearest road segment, not its endpoints', () => {
    expect(featureDistance(point, road.geometry)).toBeCloseTo(0);
    expect(nearbyDetails(point, 20, [road])).toMatchObject({ road: 'I-40' });
  });
  it('rejects distant roads, uncertain fixes and unrelated shops', () => {
    expect(nearbyDetails({ ...point, lat: 36 }, 20, [road]).road).toBeUndefined();
    expect(nearbyDetails(point, 1500, [road, landmark])).toEqual({});
    expect(nearbyDetails(point, 80, [landmark]).landmark).toBeUndefined();
    expect(nearbyDetails(point, 20, [{ ...landmark, properties: { name: 'Private Shop', subclass: 'shop' } }]).landmark).toBeUndefined();
    expect(nearbyDetails(point, 20, [landmark]).landmark).toBe('Test Service Plaza');
  });
  it('includes adjacent tiles at boundaries and wraps the date line', () => {
    expect(nearbyTiles({ lat: 0, lon: 0 })).toHaveLength(4);
    expect(nearbyTiles({ lat: 0, lon: 180 }).every(t => t.x >= 0 && t.x < 16384 && t.y >= 0 && t.y < 16384)).toBe(true);
  });
  it('retains county containment when both network sources are offline', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const result = await resolveGeography({ lat: 36.3729, lon: -94.2088 }, 20);
    expect(result.region).toBe('Benton County, AR');
    expect(result.town).toBeUndefined();
  });
  it('uses NWS reference geometry for the correct distance and direction', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('api.weather.gov')) return Response.json({ properties: { relativeLocation: { geometry: { coordinates: [-93.8, 35.4] }, properties: { city: 'Ozark', state: 'AR' } } } });
      throw new Error('map unavailable');
    }));
    const result = await resolveGeography(point, 20);
    expect(result.town?.name).toBe('Ozark, AR');
    expect(result.town?.bearing).toBeCloseTo(0);
    expect(result.town?.distanceM).toBeGreaterThan(11000);
  });
  it('keeps the regional fallback when NWS returns incomplete metadata', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({})));
    const result = await resolveGeography({ lat: 36.38, lon: -94.21 }, 2000);
    expect(result.region).toBe('Benton County, AR');
    expect(result.town).toBeUndefined();
  });
});
