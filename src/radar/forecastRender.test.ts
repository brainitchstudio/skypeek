import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { reflectivityLut } from './flat';
import { forecastTileSize, gridIndex, paintForecastTile, sampleField } from './forecastRender';
import { decodeGrib2, type GribField } from './grib2';
import golden from './__fixtures__/refd-golden.json';

const real = decodeGrib2(new Uint8Array(readFileSync(fileURLToPath(new URL('./__fixtures__/refd.grib2', import.meta.url)))));
const realLut = reflectivityLut(real);

/** The tile and pixel a point falls in. */
function tileOf(lat: number, lon: number, z: number, size: number) {
  const n = 2 ** z, wrapped = ((lon + 180) % 360 + 360) % 360 - 180;
  const fx = ((wrapped + 180) / 360) * n;
  const fy = ((1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) / 2) * n;
  const x = Math.floor(fx), y = Math.floor(fy);
  return { x, y, px: Math.floor((fx - x) * size), py: Math.floor((fy - y) * size) };
}
const pixel = (rgba: Uint8ClampedArray, size: number, px: number, py: number) => {
  const o = (py * size + px) * 4;
  return (rgba[o] | (rgba[o + 1] << 8) | (rgba[o + 2] << 16) | (rgba[o + 3] << 24)) >>> 0;
};

const pixelOver = (lat: number, lon: number, z: number, size: number) => ({ z, ...tileOf(lat, lon, z, size) });
const colorAt = (rgba: Uint8ClampedArray, px: number, py: number, size = 256) => pixel(rgba, size, px, py);

describe('sampleField on a real field', () => {
  it.each(golden.samples.map(s => [s.i, s] as const))('matches ecCodes at %i', (_i, s) => {
    expect(sampleField(real, s.lat, s.lon)).toBeCloseTo(s.v, 6);
  });

  it('reads the same cell with either longitude range', () => {
    for (const s of golden.samples) expect(sampleField(real, s.lat, s.lon - 360)).toBe(sampleField(real, s.lat, s.lon));
  });

  it('matches the color the tile painter uses', () => {
    const s = golden.samples.find(x => x.v > 0)!;
    const { z, x, y, px, py } = pixelOver(s.lat, s.lon, 11, 256);
    const painted = paintForecastTile(real, realLut, z, x, y, 256);
    expect(colorAt(painted, px, py)).toBe(realLut[real.values[s.i]]);
  });

  it('is null outside the grid', () => expect(sampleField(real, 0, 0)).toBeNull());
});

describe('gridIndex', () => {
  const at = Float64Array.of(1.4, 2.6);
  it('rounds to the nearest cell', () => expect(gridIndex(5, 5, at)).toBe(3 * 5 + 1));
  it('is -1 off either edge', () => {
    expect(gridIndex(5, 5, Float64Array.of(-0.6, 0))).toBe(-1);
    expect(gridIndex(5, 5, Float64Array.of(0, 4.6))).toBe(-1);
    expect(gridIndex(5, 5, Float64Array.of(4.4, 4.4))).toBe(4 * 5 + 4);
  });
});

describe('paintForecastTile on a real field', () => {
  it('paints the color of the cell each ecCodes sample sits in', () => {
    for (const s of golden.samples) {
      const size = 8, z = 12, t = tileOf(s.lat, s.lon, z, size);
      const rgba = paintForecastTile(real, realLut, z, t.x, t.y, size);
      expect(pixel(rgba, size, t.px, t.py)).toBe(realLut[real.values[s.i]]);
    }
  });

  it('never paints a color that is not a field value', () => {
    const t = tileOf(40, -95, 5, 512);
    const rgba = paintForecastTile(real, realLut, 5, t.x, t.y, 512);
    const allowed = new Set([...new Set(real.values)].map(x => realLut[x]));
    for (let i = 0; i < rgba.length; i += 4) expect(allowed.has(pixel(rgba, 1, 0, i / 4))).toBe(true);
  });
});

describe('paintForecastTile on a small grid', () => {
  // Two 200 km cells side by side, starting at 38.5N 97.5W.
  const field: GribField = {
    ...real, maxX: 2,
    grid: { ...real.grid, ni: 2, nj: 1, lat1: 38.5, lon1: 262.5, dx: 200_000, dy: 200_000 },
    values: Uint16Array.of(1, 2),
  };
  const lut = Uint32Array.of(0, 0xff0000ff, 0xff00ff00);

  it('uses solid cell colors with no third color along the edge', () => {
    const size = 256, t = tileOf(38.5, -96.5, 5, size);
    const rgba = paintForecastTile(field, lut, 5, t.x, t.y, size);
    const seen = new Set<number>();
    for (let i = 0; i < size * size; i++) seen.add(pixel(rgba, 1, 0, i));
    expect([...seen].sort()).toEqual([0, 0xff0000ff, 0xff00ff00].sort());
  });

  it('leaves pixels outside the grid transparent', () => {
    const size = 16, t = tileOf(38.5, -97.5, 5, size);
    const rgba = paintForecastTile({ ...field, grid: { ...field.grid, lat1: 10, lon1: 200 } }, lut, 5, t.x, t.y, size);
    expect(rgba.every(v => v === 0)).toBe(true);
  });
});

describe('forecastTileSize', () => {
  // A 256 px raster tile can show as small as 181 CSS px. A texture bigger than
  // that on screen is shrunk, and MapLibre always blends when shrinking.
  it.each([[1, 128], [1.5, 256], [2, 256], [3, 512]])('fits a display ratio of %d in %d pixels', (ratio, size) => {
    expect(forecastTileSize(ratio)).toBe(size);
    expect(size).toBeLessThanOrEqual(181 * ratio);
  });
});
