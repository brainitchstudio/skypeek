import { describe, expect, it } from 'vitest';
import { offset } from './proximity';
import { areaCentroid, fanDrifts, insideNow, observedDrift, sweep, type Ring } from './stormPath';

const NOW = Date.UTC(2026, 10, 7, 20);
const MIN = 60_000;
const MPS_30 = 13.41; // 30 mph
const spot = { lat: 40, lon: -90 };
const [miEast] = offset(40, -90, 40, -89);
const [, miNorth] = offset(40, -90, 41, -90);
const at = (e: number, n: number): [number, number] => [spot.lon + e / miEast, spot.lat + n / miNorth];
const square = (e: number, n: number, half: number): Ring => [at(e - half, n - half), at(e + half, n - half), at(e + half, n + half), at(e - half, n + half), at(e - half, n - half)];
const minutes = (s: ReturnType<typeof sweep>) => (s.kind === 'hit' ? (s.at - NOW) / MIN : NaN);
const east = { eastMps: MPS_30, northMps: 0 };

describe('sweep', () => {
  it('hits at first contact', () => {
    expect(minutes(sweep(square(-30, 0, 5), east, NOW, spot, NOW))).toBeCloseTo(50, 0);
  });
  it('hits from each direction', () => {
    expect(minutes(sweep(square(30, 0, 5), { eastMps: -MPS_30, northMps: 0 }, NOW, spot, NOW))).toBeCloseTo(50, 0);
    expect(minutes(sweep(square(0, 30, 5), { eastMps: 0, northMps: -MPS_30 }, NOW, spot, NOW))).toBeCloseTo(50, 0);
    expect(minutes(sweep(square(0, -30, 5), { eastMps: 0, northMps: MPS_30 }, NOW, spot, NOW))).toBeCloseTo(50, 0);
  });
  it('advances the outline by the file age', () => {
    expect(minutes(sweep(square(-30, 0, 5), east, NOW - 10 * MIN, spot, NOW))).toBeCloseTo(40, 0);
  });
  it('hits at exactly 60 minutes and misses just beyond', () => {
    expect(sweep(square(-34.9, 0, 5), east, NOW, spot, NOW).kind).toBe('hit');
    expect(sweep(square(-36, 0, 5), east, NOW, spot, NOW).kind).toBe('miss');
  });
  it('reports the closest miss and the side the storm passes', () => {
    const s = sweep(square(-30, -17, 5), east, NOW, spot, NOW);
    expect(s).toMatchObject({ kind: 'miss', side: 'S' });
    expect(s.kind === 'miss' && s.miles).toBeCloseTo(12, 0);
  });
  it('measures a storm moving away from where it is now', () => {
    const s = sweep(square(20, 0, 5), east, NOW, spot, NOW);
    expect(s).toMatchObject({ kind: 'miss', side: 'E' });
    expect(s.kind === 'miss' && s.miles).toBeCloseTo(15, 0);
  });
  it('treats a concave outline by its edges, not its hull', () => {
    // A U open to the south, moving south: the spot rides up the notch, past where the hull would touch it.
    const u: Ring = [at(-10, -40), at(-5, -40), at(-5, -20), at(5, -20), at(5, -40), at(10, -40), at(10, -10), at(-10, -10), at(-10, -40)];
    const hull = square(0, -25, 15);
    const south = { eastMps: 0, northMps: -MPS_30 };
    const below = { lat: at(0, -45)[1], lon: spot.lon };
    expect(minutes(sweep(hull, south, NOW, below, NOW))).toBeCloseTo(10, 0);
    expect(minutes(sweep(u, south, NOW, below, NOW))).toBeCloseTo(50, 0);
    const notch = { lat: at(0, -30)[1], lon: spot.lon };
    expect(insideNow(u, null, NOW, notch, NOW)).toBe(false);
    expect(insideNow(hull, null, NOW, notch, NOW)).toBe(true);
  });
  it('is still under 1 mph', () => {
    expect(sweep(square(-30, 0, 5), { eastMps: 0.4, northMps: 0 }, NOW, spot, NOW)).toEqual({ kind: 'still' });
  });
  it('hits now when the spot is already inside', () => {
    expect(sweep(square(0, 0, 5), east, NOW, spot, NOW)).toEqual({ kind: 'hit', at: NOW });
  });
});

describe('sweep horizon', () => {
  it('reaches further with a longer horizon', () => {
    expect(sweep(square(-60, 0, 5), east, NOW, spot, NOW).kind).toBe('miss');
    expect(minutes(sweep(square(-60, 0, 5), east, NOW, spot, NOW, 180))).toBeCloseTo(110, 0);
  });
});

describe('fanDrifts', () => {
  const heading = (d: { eastMps: number; northMps: number }) => Math.round(((Math.atan2(d.eastMps, d.northMps) * 180) / Math.PI + 360) % 360);
  const speed = (d: { eastMps: number; northMps: number }) => Math.hypot(d.eastMps, d.northMps);
  const toward = (deg: number, mps: number) => ({ eastMps: mps * Math.sin((deg * Math.PI) / 180), northMps: mps * Math.cos((deg * Math.PI) / 180) });
  it('spreads 15 degrees either side of one track', () => {
    const f = fanDrifts(toward(90, 10), null);
    expect(f.map(heading)).toEqual([75, 80, 85, 90, 95, 100, 105]);
    expect(speed(f[0])).toBeCloseTo(10, 5);
  });
  it('covers the arc between two tracks at the faster speed', () => {
    const f = fanDrifts(toward(90, 10), toward(110, 14));
    expect(f.map(heading)).toEqual([75, 80, 85, 90, 95, 100, 105, 110, 115, 120, 125]);
    f.forEach(d => expect(speed(d)).toBeCloseTo(14, 5));
  });
  it('takes the short way across north', () => {
    const f = fanDrifts(toward(350, 10), toward(10, 10)).map(heading);
    expect(f[0]).toBe(335);
    expect(f[f.length - 1]).toBe(25);
    expect(f).toHaveLength(11);
  });
  it('ignores a track that is not moving', () => {
    expect(fanDrifts({ eastMps: 0.1, northMps: 0 }, toward(90, 10)).map(heading)).toEqual([75, 80, 85, 90, 95, 100, 105]);
  });
  it('is empty when nothing moves', () => {
    expect(fanDrifts(null, null)).toEqual([]);
    expect(fanDrifts({ eastMps: 0.1, northMps: 0 }, null)).toEqual([]);
  });
});

describe('insideNow', () => {
  it('advances by the drift', () => {
    expect(insideNow(square(-10, 0, 5), east, NOW - 20 * MIN, spot, NOW)).toBe(true);
    expect(insideNow(square(-10, 0, 5), east, NOW, spot, NOW)).toBe(false);
  });
  it('uses the file outline with no drift', () => {
    expect(insideNow(square(0, 0, 5), null, NOW - 20 * MIN, spot, NOW)).toBe(true);
  });
});

describe('areaCentroid', () => {
  it('finds the area centroid of a lopsided ring', () => {
    const l: Ring = [[0, 0], [4, 0], [4, 1], [1, 1], [1, 4], [0, 4], [0, 0]];
    const c = areaCentroid(l);
    expect(c.lon).toBeCloseTo(19 / 14, 5);
    expect(c.lat).toBeCloseTo(19 / 14, 5);
  });
});

describe('observedDrift', () => {
  const c = { lat: 40, lon: -90 };
  const west = (mi: number) => ({ lat: 40, lon: -90 - mi / miEast });
  it('needs 20 minutes of history', () => {
    expect(observedDrift(c, NOW, [{ at: NOW - 19 * MIN, center: west(5) }])).toBeNull();
    expect(observedDrift(c, NOW, [{ at: NOW - 20 * MIN, center: west(10) }])?.eastMps).toBeCloseTo(13.41, 1);
  });
  it('uses the oldest past center', () => {
    const d = observedDrift(c, NOW, [{ at: NOW - 10 * MIN, center: west(99) }, { at: NOW - 30 * MIN, center: west(15) }, { at: NOW - 20 * MIN, center: west(99) }]);
    expect(d?.eastMps).toBeCloseTo(13.41, 1);
  });
  it('discards an observed speed above 100 mph', () => {
    expect(observedDrift(c, NOW, [{ at: NOW - 20 * MIN, center: west(50) }])).toBeNull();
  });
  it('has no track with no past', () => {
    expect(observedDrift(c, NOW, [])).toBeNull();
  });
});
