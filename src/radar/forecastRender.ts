import { fieldValue, type GribField } from './grib2';
import { createLambert } from './lambert';

// A 256 px raster tile can show as small as this many CSS pixels.
const SMALLEST_TILE_ON_SCREEN = 181;

/** The largest tile that is never shrunk on screen. MapLibre's nearest setting only
 * covers enlarging: shrinking always blends, which would paint colors not in the file. */
export const forecastTileSize = (pixelRatio: number) => 2 ** Math.floor(Math.log2(SMALLEST_TILE_ON_SCREEN * pixelRatio));

/** The values index of a fractional grid position, rounded to its cell; -1 outside the grid. */
export function gridIndex(ni: number, nj: number, at: Float64Array): number {
  const col = Math.round(at[0]), row = Math.round(at[1]);
  return col < 0 || col >= ni || row < 0 || row >= nj ? -1 : row * ni + col;
}

/** The field's dBZ in the cell a point falls in, as stored in the file; null outside the grid. */
export function sampleField(field: GribField, lat: number, lon: number): number | null {
  const at = new Float64Array(2);
  createLambert(field.grid)(lat, lon, at);
  const i = gridIndex(field.grid.ni, field.grid.nj, at);
  return i < 0 ? null : fieldValue(field, field.values[i]);
}

/** One map tile of a field, as RGBA pixels. Each pixel takes the color of the grid
 * cell its center falls in, unblended, so every color on screen is a value in the file. */
export function paintForecastTile(field: GribField, lut: Uint32Array, z: number, x: number, y: number, size: number): Uint8ClampedArray {
  const { ni, nj } = field.grid, tiles = 2 ** z;
  const project = createLambert(field.grid), at = new Float64Array(2);
  const pixels = new Uint32Array(size * size);
  const lons = new Float64Array(size);
  for (let px = 0; px < size; px++) lons[px] = ((x + (px + 0.5) / size) / tiles) * 360 - 180;
  for (let py = 0; py < size; py++) {
    const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + (py + 0.5) / size)) / tiles))) * 180) / Math.PI;
    for (let px = 0; px < size; px++) {
      project(lat, lons[px], at);
      const i = gridIndex(ni, nj, at);
      if (i >= 0) pixels[py * size + px] = lut[field.values[i]];
    }
  }
  return new Uint8ClampedArray(pixels.buffer);
}
