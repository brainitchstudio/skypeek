import { describe, expect, it } from 'vitest';
import type { StormObject } from '@/lib/probSevere';
import type { WeatherAlert } from '@/lib/types';
import { checkArrival, confirmingWarning, decide, type WarningCheck } from './arrival';
import { offset } from './proximity';
import type { Ring, Sweep } from './stormPath';

const NOW = Date.UTC(2026, 10, 7, 20, 0);
const MIN = 60_000;
const spot = { lat: 40, lon: -90 };
const [miEast] = offset(40, -90, 40, -89);
const hit = (m: number): Sweep => ({ kind: 'hit', at: NOW + m * MIN });
const miss = (mi: number): Sweep => ({ kind: 'miss', miles: mi, side: 'SE' });
const still: Sweep = { kind: 'still' };
const NONE: WarningCheck = { state: 'none' };
const W: WarningCheck = { state: 'confirmed', title: 'Tornado Warning' };
const FAILED: WarningCheck = { state: 'unavailable' };

const box = (west: number, south: number, east: number, north: number) => ({ type: 'Polygon' as const, coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]] });
const alert = (title: string, geometry: ReturnType<typeof box>) => ({ title, geometry }) as unknown as WeatherAlert;
const ringWest = (mi: number, half: number): Ring => {
  const w = -90 - (mi + half) / miEast, e = -90 - (mi - half) / miEast;
  return [[w, 39.95], [e, 39.95], [e, 40.05], [w, 40.05], [w, 39.95]];
};
const storm = (over: Partial<StormObject>): StormObject => ({
  id: '1', at: NOW, ring: ringWest(30, 5), center: { lat: 40, lon: -90.5 }, sizeKm2: 100, drift: { eastMps: 13.41, northMps: 0 },
  dbz: 50, vil: 20, hailIn: 1, probSevere: 10, probHail: 5, probWind: 5, probTor: 1, past: [], ...over,
});

describe('decide', () => {
  const run = (o: { inside?: boolean; reported?: Sweep | null; observed?: Sweep | null; fan?: Sweep[]; bothSoon?: boolean; beyond?: boolean; warning?: WarningCheck; jumped?: boolean }) =>
    decide({ inside: o.inside ?? false, reported: o.reported ?? null, observed: o.observed ?? null, fan: o.fan ?? [], bothSoon: o.bothSoon ?? false, beyond: o.beyond ?? false, warning: o.warning ?? NONE, jumped: o.jumped ?? false, now: NOW });

  it.each<[string, Parameters<typeof run>[0], string]>([
    ['inside beats everything', { inside: true, fan: [hit(5)], bothSoon: true, warning: W }, 'here'],
    ['nothing moving', { reported: still }, 'cant-tell'],
    ['no motion at all', {}, 'cant-tell'],
    ['both tracks soon', { fan: [hit(20), miss(3)], bothSoon: true }, 'likely'],
    ['path soon with a warning', { fan: [hit(20)], warning: W }, 'likely'],
    ['path soon', { fan: [hit(20), miss(5)] }, 'possible'],
    ['exactly 60 minutes', { fan: [hit(60)] }, 'possible'],
    ['warning lookup failed cannot raise', { fan: [hit(20)], warning: FAILED }, 'possible'],
    ['just past the hour', { fan: [hit(61)], warning: W }, 'on-path'],
    ['two hours out', { fan: [hit(120), miss(5)] }, 'on-path'],
    ['on the path past 3 hours', { fan: [miss(50)], beyond: true }, 'far'],
    ['no hit with a warning', { fan: [miss(5), miss(9)], warning: W }, 'unlikely'],
    ['no hit', { fan: [miss(5)] }, 'unlikely'],
  ])('%s', (_n, input, level) => {
    expect(run(input).level).toBe(level);
  });

  it('shows a range from the first path hit to the last track hit', () => {
    expect(run({ fan: [hit(20)], reported: hit(30), bothSoon: true }).headline).toMatch(/^Likely coming, around .+–.+$/);
  });
  it('shows one time when they round together', () => {
    expect(run({ fan: [hit(20)], reported: hit(20.5) }).headline).not.toContain('–');
  });
  it('gives the earliest path hit', () => {
    expect(run({ fan: [hit(30), hit(20)] }).earliest).toBe(NOW + 20 * MIN);
    expect(run({ fan: [hit(120)] }).earliest).toBe(NOW + 120 * MIN);
    expect(run({ fan: [miss(3)] }).earliest).toBeNull();
  });
  it('words a far-off spot by how long it is', () => {
    expect(run({ fan: [hit(120)] }).headline).toBe('On its path, about 2 hours away');
    expect(run({ fan: [hit(62)] }).headline).toBe('On its path, about 1 hour away');
    expect(run({ fan: [hit(100)] }).headline).toBe('On its path, about 1 hr 45 min away');
  });
  it('names the nearest miss across the path', () => {
    expect(run({ fan: [miss(30), miss(12)] }).headline).toBe('Unlikely, closest about 12 mi SE');
    expect(run({ fan: [miss(0.4)] }).headline).toBe('Unlikely, closest under 1 mi');
  });
  it('words the possible and here headlines', () => {
    expect(run({ fan: [hit(20)] }).headline).toMatch(/^Possible, around \S+ (AM|PM)$/);
    expect(run({ inside: true }).headline).toBe('Already here');
  });
  it('says why it cannot tell', () => {
    expect(run({ reported: still }).headline).toBe("Can't tell, storm isn't moving");
    expect(run({}).headline).toBe("Can't tell, motion unavailable");
  });
  it('words each track', () => {
    const a = run({ fan: [hit(20)], reported: hit(20), observed: miss(12) });
    expect(a.reported).toMatch(/^Reported track hits around /);
    expect(a.observed).toBe('Observed track misses by about 12 mi SE');
    expect(run({ reported: null, observed: still })).toMatchObject({ reported: 'Reported track unavailable', observed: "Observed track isn't moving" });
  });
  it('words the path', () => {
    expect(run({ fan: [hit(20)] }).path).toBe('Spot is inside the widened path');
    expect(run({ fan: [miss(4)] }).path).toBe('Spot is outside the widened path');
    expect(run({}).path).toBe('Widened path unavailable');
  });
  it('explains a storm too new for a track', () => {
    expect(run({ fan: [hit(20)] }).observed).toBe('Storm too new to show a track');
  });
  it('does not call a storm new when its track was thrown out', () => {
    expect(run({ fan: [hit(20)], jumped: true }).observed).toBe('Observed track unavailable');
  });
  it('explains warning status', () => {
    expect(run({ fan: [hit(20)] }).warning).toBe('No warning covers both');
    expect(run({ fan: [hit(20)], warning: FAILED }).warning).toBe('Warning status unavailable');
    expect(run({ fan: [hit(20)], warning: W }).warning).toBe('Tornado Warning covers the storm and this spot');
  });
});

describe('confirmingWarning', () => {
  const both = box(-91, 39, -89, 41);
  const center = { lat: 40, lon: -90.5 };
  it('confirms a tornado or severe thunderstorm warning covering both', () => {
    expect(confirmingWarning([alert('Tornado Warning', both)], center, spot)).toEqual({ state: 'confirmed', title: 'Tornado Warning' });
    expect(confirmingWarning([alert('Severe Thunderstorm Warning', both)], center, spot)).toEqual({ state: 'confirmed', title: 'Severe Thunderstorm Warning' });
  });
  it('ignores other warnings', () => {
    expect(confirmingWarning([alert('Flash Flood Warning', both)], center, spot)).toEqual({ state: 'none' });
  });
  it('needs both the storm and the spot inside', () => {
    expect(confirmingWarning([alert('Tornado Warning', box(-90.2, 39, -89, 41))], center, spot)).toEqual({ state: 'none' });
  });
  it('reports unavailable for a failed lookup', () => {
    expect(confirmingWarning(null, center, spot)).toEqual({ state: 'unavailable' });
  });
});

describe('checkArrival', () => {
  it('runs both tracks', () => {
    const past = [{ at: NOW - 30 * MIN, center: { lat: 40, lon: -90.5 - 15 / miEast } }];
    expect(checkArrival(storm({ past }), [], spot, NOW).level).toBe('likely');
  });
  it('is likely for a storm with no history when only the warning backs it', () => {
    const w = alert('Tornado Warning', box(-91, 39, -89, 41));
    expect(checkArrival(storm({}), [w], spot, NOW).level).toBe('likely');
  });
  it('is possible for a storm with no history', () => {
    expect(checkArrival(storm({}), [], spot, NOW).level).toBe('possible');
  });
  it('says on its path for a spot straight ahead but past the hour', () => {
    expect(checkArrival(storm({ ring: ringWest(60, 5) }), [], spot, NOW)).toMatchObject({ level: 'on-path', headline: 'On its path, about 1 hr 45 min away' });
  });
  it('counts a spot just off the line as inside the path', () => {
    const toward = { eastMps: 13.41 * Math.cos(0.17), northMps: 13.41 * Math.sin(0.17) }; // about 10 degrees off
    expect(checkArrival(storm({ drift: toward, ring: ringWest(60, 3) }), [], spot, NOW).level).toBe('on-path');
  });
  it('says more than 3 hours for a slow storm straight ahead, not unlikely', () => {
    expect(checkArrival(storm({ ring: ringWest(150, 5) }), [], spot, NOW)).toMatchObject({ level: 'far', headline: 'On its path, more than 3 hours away', earliest: null });
  });
  it('is unlikely for a storm heading away', () => {
    expect(checkArrival(storm({ drift: { eastMps: -13.41, northMps: 0 } }), [], spot, NOW).level).toBe('unlikely');
  });
  it('reads Already here from the outline advanced to now', () => {
    expect(checkArrival(storm({ ring: ringWest(10, 5), at: NOW - 20 * MIN }), [], spot, NOW).level).toBe('here');
  });
  it('is unavailable, not new, when history exists but the jump was thrown out', () => {
    const past = [{ at: NOW - 20 * MIN, center: { lat: 40, lon: -90.5 - 60 / miEast } }];
    expect(checkArrival(storm({ past }), [], spot, NOW).observed).toBe('Observed track unavailable');
  });
  it('carries a failed warning lookup through', () => {
    expect(checkArrival(storm({}), null, spot, NOW).warning).toBe('Warning status unavailable');
  });
  it('cannot tell with no reported motion and no history', () => {
    expect(checkArrival(storm({ drift: null }), [], spot, NOW).level).toBe('cant-tell');
  });
});
