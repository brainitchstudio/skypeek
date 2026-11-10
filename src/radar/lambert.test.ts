import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { decodeGrib2 } from './grib2';
import { createLambert } from './lambert';
import golden from './__fixtures__/refd-golden.json';

const { grid } = decodeGrib2(new Uint8Array(readFileSync(fileURLToPath(new URL('./__fixtures__/refd.grib2', import.meta.url)))));
const project = createLambert(grid);
const out = new Float64Array(2);

describe('createLambert', () => {
  it('returns each ecCodes point at its own grid position', () => {
    expect(golden.points.length).toBeGreaterThan(50);
    for (const p of golden.points) {
      project(p.lat, p.lon, out);
      expect(Math.abs(out[0] - p.i)).toBeLessThan(0.001);
      expect(Math.abs(out[1] - p.j)).toBeLessThan(0.001);
    }
  });

  it('treats -97.5 and 262.5 as the same longitude', () => {
    const a = new Float64Array(2), b = new Float64Array(2);
    project(38.5, -97.5, a); project(38.5, 262.5, b);
    expect(a[0]).toBeCloseTo(b[0], 9);
    expect(a[1]).toBeCloseTo(b[1], 9);
  });

  it('puts a point west of the grid outside it', () => {
    project(38.5, -150, out);
    expect(out[0]).toBeLessThan(-0.5);
  });

  it('handles two different standard parallels', () => {
    const p = createLambert({ ...grid, latin1: 33, latin2: 45 });
    p(grid.lat1, grid.lon1, out);
    expect(out[0]).toBeCloseTo(0, 6);
    expect(out[1]).toBeCloseTo(0, 6);
    p(38.5, -97.5, out);
    expect(Number.isFinite(out[0]) && Number.isFinite(out[1])).toBe(true);
  });
});
