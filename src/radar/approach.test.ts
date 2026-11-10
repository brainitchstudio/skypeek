import { describe, expect, it } from 'vitest';
import type { Geometry, Position } from 'geojson';
import { approach, approachPhrase, insideGeometry } from './approach';

const now = 1_000_000_000;
const spot = { lat: 40, lon: -90 };
const MI_PER_DEG = 69.17;
const at = (eastMi: number, northMi: number) => ({
  lat: spot.lat + northMi / MI_PER_DEG,
  lon: spot.lon + eastMi / (MI_PER_DEG * Math.cos((spot.lat * Math.PI) / 180)),
});
const east = (mi: number) => at(mi, 0);

const ring = (s: number, e: number): Position[] => [[s, s], [e, s], [e, e], [s, e], [s, s]];
const square = (s: number, e: number): Geometry => ({ type: 'Polygon', coordinates: [ring(s, e)] });
const squareWithHole = (s: number, e: number, hs: number, he: number): Geometry => ({ type: 'Polygon', coordinates: [ring(s, e), ring(hs, he)] });
const multi = (...polys: Geometry[]): Geometry => ({
  type: 'MultiPolygon',
  coordinates: polys.map(p => (p as Extract<Geometry, { type: 'Polygon' }>).coordinates),
});

describe('approach', () => {
  it('finds the closest point ahead', () => {
    const a = approach([east(-20)], { heading: 90, mph: 40, at: now }, spot, now);
    expect(a).toMatchObject({ kind: 'closest', side: expect.any(String) });
    if (a.kind === 'closest') { expect(a.miles).toBeCloseTo(0, 3); expect(a.at).toBeCloseTo(now + 30 * 60_000, -3); }
  });
  it('names the side the center passes on', () => {
    const a = approach([at(-20, 2)], { heading: 90, mph: 40, at: now }, spot, now);
    expect(a).toMatchObject({ kind: 'closest', side: 'N' });
    expect((a as { miles: number }).miles).toBeCloseTo(2, 2);
  });
  it.each([[0, 'S'], [90, 'W'], [180, 'N'], [270, 'E']])('tracks a storm heading %i', (heading, from) => {
    const start = { S: at(0, -20), W: at(-20, 0), N: at(0, 20), E: at(20, 0) }[from as 'S' | 'W' | 'N' | 'E'];
    expect(approach([start], { heading, mph: 40, at: now }, spot, now).kind).toBe('closest');
  });
  it.each([[at(-2, -20), 0, 'W'], [at(2, -20), 0, 'E'], [at(-20, -2), 90, 'S']])('names the side %#', (start, heading, side) => {
    expect(approach([start], { heading, mph: 40, at: now }, spot, now)).toMatchObject({ kind: 'closest', side });
  });
  it('advances the track by the age of the report', () => {
    const a = approach([east(-20)], { heading: 90, mph: 40, at: now - 15 * 60_000 }, spot, now);
    if (a.kind !== 'closest') throw new Error(a.kind);
    expect(a.at).toBeCloseTo(now + 15 * 60_000, -3);
  });
  it('reports moving away once the closest point has passed', () => {
    const a = approach([east(12)], { heading: 90, mph: 40, at: now }, spot, now);
    expect(a).toMatchObject({ kind: 'away' });
    expect((a as { miles: number }).miles).toBeCloseTo(12, 2);
  });
  it('stops at 60 minutes', () => {
    const a = approach([east(-70)], { heading: 90, mph: 40, at: now }, spot, now);
    expect(a).toMatchObject({ kind: 'beyond' });
    expect((a as { miles: number }).miles).toBeCloseTo(30, 2);
  });
  it('treats under 1 mph as stationary and null motion as unknown', () => {
    expect(approach([east(8)], { heading: 90, mph: 0.5, at: now }, spot, now).kind).toBe('stationary');
    expect(approach([east(8)], null, spot, now).kind).toBe('unknown');
  });
  it('finds when a moving line crosses the spot', () => {
    const a = approach([at(-20, -10), at(-20, 10)], { heading: 90, mph: 40, at: now }, spot, now);
    if (a.kind !== 'crossing') throw new Error(a.kind);
    expect(a.at).toBeCloseTo(now + 30 * 60_000, -3);
  });
  it('measures to the end of a line that misses', () => {
    const a = approach([at(-20, 3), at(-20, 10)], { heading: 90, mph: 40, at: now }, spot, now);
    expect(a).toMatchObject({ kind: 'closest', side: 'N' });
    expect((a as { miles: number }).miles).toBeCloseTo(3, 2);
  });
  it('refuses an empty line', () => {
    expect(() => approach([], { heading: 90, mph: 40, at: now }, spot, now)).toThrow(RangeError);
  });
  it('words every case as the spec does', () => {
    const t = new Date(2026, 10, 6, 16, 18).getTime();
    expect(approachPhrase({ kind: 'closest', miles: 2.2, side: 'N', at: t })).toBe('Closest about 2 mi N, around 4:20 PM');
    expect(approachPhrase({ kind: 'closest', miles: 0.2, side: 'N', at: t })).toBe('Closest under 1 mi, around 4:20 PM');
    expect(approachPhrase({ kind: 'crossing', at: t })).toBe('Line crosses this spot around 4:20 PM');
    expect(approachPhrase({ kind: 'beyond', miles: 30 })).toBe('Still about 30 mi away after 60 minutes');
    expect(approachPhrase({ kind: 'away', miles: 12 })).toBe('Moving away, about 12 mi now');
    expect(approachPhrase({ kind: 'away', miles: 0.2 })).toBe('Moving away, under 1 mi now');
    expect(approachPhrase({ kind: 'stationary', miles: 8 })).toBe('Stationary, about 8 mi away');
    expect(approachPhrase({ kind: 'unknown', miles: 8 })).toBe('Motion unavailable, about 8 mi away');
  });
});

describe('insideGeometry', () => {
  it('handles polygon holes and MultiPolygons', () => {
    expect(insideGeometry({ lat: 0.5, lon: 0.5 }, square(0, 1))).toBe(true);
    expect(insideGeometry({ lat: 0.5, lon: 0.5 }, squareWithHole(0, 1, 0.4, 0.6))).toBe(false);
    expect(insideGeometry({ lat: 5.5, lon: 5.5 }, multi(square(0, 1), square(5, 6)))).toBe(true);
    expect(insideGeometry({ lat: 0, lon: 0 }, null)).toBeNull();
    expect(insideGeometry({ lat: 0, lon: 0 }, { type: 'Point', coordinates: [0, 0] })).toBeNull();
  });
});
