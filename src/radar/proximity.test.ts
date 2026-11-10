import { describe, expect, it } from 'vitest';
import { arrivalPhrase, boxAround, lightningPhrase, milesBetween, nearestDrawn, stormArrival } from './proximity';
import type { StormCell } from '@/api/layers';

const NOW = Date.parse('2026-11-05T06:40:00Z');
const storm = (o: Partial<StormCell> = {}): StormCell => ({
  id: 'a', lat: 40, lon: -75, heading: 90, mph: 30, severe: false, dbz: 45, hailPct: 0, hailIn: 0, tornado: false, rotation: false, radar: 'DIX', at: NOW, ...o,
});
const east = (miles: number) => -75 + miles / (69.17 * Math.cos((40 * Math.PI) / 180));

describe('stormArrival', () => {
  it('times a storm heading straight at the point', () => {
    expect(stormArrival([storm()], 40, east(15), NOW)?.minutes).toBeCloseTo(30, 0);
  });

  it('says a storm on top of the point is already there', () => {
    expect(stormArrival([storm({ mph: 0 })], 40, east(3), NOW)?.minutes).toBe(0);
  });

  it('ignores storms moving away', () => {
    expect(stormArrival([storm({ heading: 270 })], 40, east(15), NOW)).toBeNull();
  });

  it('ignores storms that will pass well to one side', () => {
    expect(stormArrival([storm()], 40.5, east(15), NOW)).toBeNull();
  });

  it('ignores storms more than an hour out', () => {
    expect(stormArrival([storm({ mph: 10 })], 40, east(15), NOW)).toBeNull();
  });

  it('counts the time since the report', () => {
    const old = storm({ at: NOW - 10 * 60_000 });
    expect(stormArrival([old], 40, east(15), NOW)?.minutes).toBeCloseTo(20, 0);
  });

  it('picks the soonest storm', () => {
    const cells = [storm({ id: 'slow', mph: 20 }), storm({ id: 'fast', mph: 40 })];
    expect(stormArrival(cells, 40, east(15), NOW)?.cell.id).toBe('fast');
  });
});

describe('nearestDrawn', () => {
  const size = 11, box = boxAround(40, -75, 100);
  const image = (...pixels: [number, number][]) => {
    const rgba = new Uint8ClampedArray(size * size * 4);
    pixels.forEach(([x, y]) => { rgba[(y * size + x) * 4 + 3] = 255; });
    return rgba;
  };

  it('finds nothing in an empty image', () => {
    expect(nearestDrawn(image(), size, box, 40, -75, 100)).toBeNull();
  });

  it('measures to the closest drawn pixel', () => {
    const miles = nearestDrawn(image([10, 5], [7, 5]), size, box, 40, -75, 100)!;
    expect(miles).toBeCloseTo((2 / 11) * 200, 0);
  });

  it('leaves out the corners past the range', () => {
    expect(nearestDrawn(image([0, 0]), size, box, 40, -75, 100)).toBeNull();
  });
});

it('measures distance', () => {
  expect(milesBetween(40, -75, 41, -75)).toBeCloseTo(69.17, 1);
});

it('rounds phrases to what the data can support', () => {
  expect(arrivalPhrase(3)).toBe('in under 5 minutes');
  expect(arrivalPhrase(23)).toBe('in about 25 minutes');
  expect(lightningPhrase(null)).toBe('None within 100 miles');
  expect(lightningPhrase(2)).toBe('Within 5 miles');
  expect(lightningPhrase(12)).toBe('About 10 miles away');
});
