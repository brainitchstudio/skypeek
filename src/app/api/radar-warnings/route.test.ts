import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, visibleWarnings } from './route';
import type { NwsAlertFeature } from '@/lib/alerts';
import { countyFipsAt, loadWarningCounties } from '@/lib/warningCounties';

const polygon = (west: number, south: number, east: number, north: number) => ({
  type: 'Polygon' as const, coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]],
});
const feature = (id: string, event: string, geometry = polygon(-88, 41, -87, 42)): NwsAlertFeature => ({
  id, geometry, properties: { event, status: 'Actual', description: 'Official warning text' },
});
const box = { west: -88.5, south: 40.5, east: -86.5, north: 42.5 };

afterEach(() => vi.restoreAllMocks());

describe('visible radar alerts', () => {
  it('keeps active alert polygons intersecting the map and excludes cancelled and distant alerts', () => {
    const current = feature('current', 'Tornado Warning');
    const distant = feature('distant', 'Flood Warning', polygon(-100, 30, -99, 31));
    const watch = feature('watch', 'Tornado Watch');
    const cancelled = { ...feature('cancelled', 'Severe Thunderstorm Warning'), properties: { event: 'Severe Thunderstorm Warning', status: 'Actual', messageType: 'Cancel' } };
    expect(visibleWarnings([current, distant, watch, cancelled], box)).toEqual([current, watch]);
    expect(visibleWarnings([feature('date-line', 'Tsunami Warning', polygon(170, 50, 171, 51))],
      { west: -190, south: 49, east: -170, north: 52 })).toHaveLength(1);
  });

  it('keeps polygonless county advisories only when an affected county is in view', async () => {
    const counties = await loadWarningCounties();
    const cook: NwsAlertFeature = { id: 'cook', geometry: null, properties: {
      event: 'Frost Advisory', status: 'Actual', geocode: { SAME: ['017031'] }, description: 'Official county advisory',
    } };
    expect(visibleWarnings([cook], { west: -88.1, south: 41.4, east: -87.5, north: 42.1 }, counties)).toEqual([cook]);
    expect(visibleWarnings([cook], { west: -100, south: 30, east: -99, north: 31 }, counties)).toEqual([]);
  });

  it('finds the county for an NWS point alert when county codes are absent', async () => {
    expect(await countyFipsAt(36.3729, -94.2088)).toBe('05007');
  });

  it('rejects missing bounds before fetching and returns official warning text for a valid map', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ features: [feature('one', 'Tornado Warning')] }), { status: 200 }));
    const bad = await GET(new NextRequest('http://localhost/api/radar-warnings?west=-88&south=40&east=-87'));
    expect(bad.status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();

    const good = await GET(new NextRequest('http://localhost/api/radar-warnings?west=-88.5&south=40.5&east=-86.5&north=42.5'));
    expect(good.status).toBe(200);
    expect((await good.json()).features[0].properties.description).toBe('Official warning text');
  });
});
