// The flat radar pipeline. Every source's tiles are decoded back to a number,
// then repainted as hard-edged bands in one palette, so radar looks the same
// whichever source drew it and stays crisp past the source's own zoom limit.
// No MapLibre import here: weather.ts needs this and must stay out of the map chunk.

import { bench, spend, type SourceId } from '@/api/budget';
import { fieldValue, type GribField } from './grib2';
import scale from './reflectivityScale.json';

export const FLAT_SCHEME = 'flat';

type Rgb = [number, number, number];
export type Kind = 'rainviewer' | 'openweather' | 'tomorrow' | 'lightning';

export const PRECIP_HEX = ['#75d78d', '#f3d350', '#fa8927', '#de3c37'];
const hex = (h: string): Rgb => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)) as Rgb;
const PRECIP_RGB = PRECIP_HEX.map(hex);
const PRECIP_CUTS = [1, 2, 3, 4];

/** Piecewise-linear lookup; flat past both ends. */
const ramp = (stops: [number, number][], x: number) => {
  if (x <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    const [x0, y0] = stops[i - 1], [x1, y1] = stops[i];
    if (x <= x1) return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
  }
  return stops[stops.length - 1][1];
};

// Each decoder returns band units: 1 starts light rain, 2 moderate, 3 heavy, 4 very heavy.
const DBZ_UNITS: [number, number][] = [[0, 0], [10, 1], [30, 2], [40, 3], [50, 4]];
const OW_ALPHA_UNITS: [number, number][] = [[0, 0], [12, 1], [94, 2], [130, 3], [165, 4]]; // about 0.1, 2.5, 5 and 8 mm/h

// RainViewer's published "Universal Blue" table, dBZ 0 to 64. Its radar tiles only come in this scheme.
const RV_TABLE = ('827b6949 857d6a4e 88806c54 8b826d59 8e856f5e 92887164 9e93756e aa9e7978 b6a97e82 c2b4828c cec08796 d2c48ba0 d6c88faa dacc93b4 ded097be ' +
  '88ddeeff 6cd1ebff 51c5e8ff 36bae5ff 1baee2ff 00a3e0ff 009ad5ff 0091caff 0088bfff 007fb4ff 0077aaff 0070a3ff 00699cff 006295ff 005b8eff 005588ff 005180ff 004e78ff 004a70ff 004768ff ' +
  'ffee00ff ffe000ff ffd200ff ffc500ff ffb700ff ffaa00ff ff9f00ff ff9500ff ff8b00ff ff8100ff ff4400ff f23600ff e62800ff d91b00ff cd0d00ff c10000ff a80000ff 8f0000ff 760000ff 5d0000ff ' +
  'ffaaffff ff9fffff ff95ffff ff8bffff ff81ffff ff77ffff ff6cffff ff62ffff ff58ffff ff4effff').split(' ')
  .map(c => [1, 3, 5, 7].map(i => parseInt(c.slice(i - 1, i + 1), 16)));

const rvMemo = new Map<number, number>();
function rainViewerDbz(r: number, g: number, b: number, a: number) {
  const key = ((r << 24) | (g << 16) | (b << 8) | a) >>> 0;
  let dbz = rvMemo.get(key);
  if (dbz === undefined) {
    let best = Infinity;
    dbz = 0;
    RV_TABLE.forEach((c, i) => {
      const d = (c[0] - r) ** 2 + (c[1] - g) ** 2 + (c[2] - b) ** 2 + (c[3] - a) ** 2;
      if (d < best) { best = d; dbz = i; }
    });
    rvMemo.set(key, dbz);
  }
  return dbz;
}

export const DECODE: Record<Kind, (r: number, g: number, b: number, a: number) => number> = {
  rainviewer: (r, g, b, a) => (a ? ramp(DBZ_UNITS, rainViewerDbz(r, g, b, a)) : 0),
  openweather: (_r, _g, _b, a) => ramp(OW_ALPHA_UNITS, a),
  tomorrow: (_r, _g, _b, a) => (a / 255) * 4,
  lightning: (_r, _g, _b, a) => (a ? 2 : 0),
};

const LIGHTNING_RGB = hex('#7a3ff2');
const STYLE: Record<Kind, { cuts: number[]; colors: Rgb[] }> = {
  rainviewer: { cuts: PRECIP_CUTS, colors: PRECIP_RGB },
  openweather: { cuts: PRECIP_CUTS, colors: PRECIP_RGB },
  tomorrow: { cuts: PRECIP_CUTS, colors: PRECIP_RGB },
  lightning: { cuts: [1], colors: [LIGHTNING_RGB] },
};

export type Crop = { x: number; y: number; size: number };

/** Paints `field` into RGBA pixels: bilinear on the values, then hard bands. */
export function paintBands(field: Float32Array, width: number, height: number, crop: Crop, outW: number, outH: number, cuts: number[], colors: Rgb[]) {
  const px = new Uint8ClampedArray(outW * outH * 4);
  const cropH = crop.size * (height / width);
  for (let oy = 0; oy < outH; oy++) {
    const fy = Math.min(height - 1.001, Math.max(0, crop.y + ((oy + 0.5) / outH) * cropH - 0.5));
    const y0 = Math.floor(fy), ty = fy - y0;
    for (let ox = 0; ox < outW; ox++) {
      const fx = Math.min(width - 1.001, Math.max(0, crop.x + ((ox + 0.5) / outW) * crop.size - 0.5));
      const x0 = Math.floor(fx), tx = fx - x0, i = y0 * width + x0;
      const v = (field[i] * (1 - tx) + field[i + 1] * tx) * (1 - ty) + (field[i + width] * (1 - tx) + field[i + width + 1] * tx) * ty;
      let band = -1;
      while (band + 1 < cuts.length && v >= cuts[band + 1]) band++;
      if (band < 0) continue;
      const o = (oy * outW + ox) * 4, c = colors[band];
      px[o] = c[0]; px[o + 1] = c[1]; px[o + 2] = c[2]; px[o + 3] = 255;
    }
  }
  return px;
}

// HRRR writes -10 dBZ where it has no reflectivity at all. NOAA's scale runs below
// zero, so every value above that is real signal and stays visible.
const NO_ECHO_DBZ = -10;

/** The legend color of a dBZ value as CSS hex; null at or below no reflectivity. */
export function reflectivityColor(dbz: number): string | null {
  if (dbz <= NO_ECHO_DBZ) return null;
  return scale.colors[Math.max(0, Math.min(scale.colors.length - 1, Math.round((dbz - scale.minDbz) / scale.stepDbz)))];
}

/** Colors for every raw integer in a field, as little-endian RGBA; 0 is transparent.
 * The colors are NOAA's own legend, so forecast frames match the radar and its key. */
export function reflectivityLut(f: Pick<GribField, 'r' | 'e' | 'd' | 'maxX'>): Uint32Array {
  const lut = new Uint32Array(f.maxX + 1);
  for (let x = 0; x <= f.maxX; x++) {
    const color = reflectivityColor(fieldValue(f, x));
    if (!color) continue;
    const [r, g, b] = hex(color);
    lut[x] = (255 << 24 | b << 16 | g << 8 | r) >>> 0;
  }
  return lut;
}

const SOURCE_OF: Partial<Record<Kind, SourceId>> = { rainviewer: 'rainviewer', openweather: 'openweather', tomorrow: 'tomorrow' };

/** A tile URL for the map. `maxZoom` is the deepest tile fetched; past it, tiles are redrawn from their parent. */
export const flatTiles = (kind: Kind, template: string, maxZoom: number) =>
  `${FLAT_SCHEME}://${kind}/${maxZoom}/{z}/{x}/{y}?u=${encodeURIComponent(template)}`;

const MERCATOR = 20037508.342789244;

function expand(template: string, z: number, x: number, y: number) {
  const span = (2 * MERCATOR) / 2 ** z;
  const bbox = [-MERCATOR + x * span, MERCATOR - (y + 1) * span, -MERCATOR + (x + 1) * span, MERCATOR - y * span].join(',');
  return template.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y)).replace('{bbox-epsg-3857}', bbox);
}

const FIELD_CACHE_MAX = 128;
const fields = new Map<string, Promise<Float32Array>>(); // children of one tile share its fetch

async function fetchField(kind: Kind, url: string): Promise<Float32Array> {
  const source = SOURCE_OF[kind];
  if (source) spend(source);
  const res = await fetch(url);
  if (res.status === 429 && source) bench(source);
  if (!res.ok) throw new Error(`Tile failed: ${res.status}`);
  const bitmap = await createImageBitmap(await res.blob());
  const canvas = new OffscreenCanvas(256, 256);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bitmap, 0, 0, 256, 256);
  bitmap.close();
  const d = ctx.getImageData(0, 0, 256, 256).data, decode = DECODE[kind];
  const field = new Float32Array(256 * 256);
  for (let i = 0; i < field.length; i++) field[i] = decode(d[i * 4], d[i * 4 + 1], d[i * 4 + 2], d[i * 4 + 3]);
  return field;
}

function getField(kind: Kind, url: string) {
  let f = fields.get(url);
  if (!f) {
    f = fetchField(kind, url);
    f.catch(() => fields.delete(url));
    fields.set(url, f);
    if (fields.size > FIELD_CACHE_MAX) fields.delete(fields.keys().next().value!);
  }
  return f;
}

/** MapLibre protocol handler for `flat://` tiles. */
export async function loadFlatTile(params: { url: string }, abort: AbortController) {
  const u = new URL(params.url);
  const kind = u.hostname as Kind;
  const [maxZoom, z, x, y] = u.pathname.slice(1).split('/').map(Number);
  const up = Math.max(0, z - maxZoom), pz = z - up, px = x >> up, py = y >> up;
  const field = await getField(kind, expand(u.searchParams.get('u')!, pz, px, py));
  if (abort.signal.aborted) throw new DOMException('Aborted', 'AbortError');
  const size = 256 / 2 ** up, OUT = 512;
  const { cuts, colors } = STYLE[kind];
  const data = paintBands(field, 256, 256, { x: (x - (px << up)) * size, y: (y - (py << up)) * size, size }, OUT, OUT, cuts, colors);
  const canvas = new OffscreenCanvas(OUT, OUT);
  canvas.getContext('2d')!.putImageData(new ImageData(data as Uint8ClampedArray<ArrayBuffer>, OUT, OUT), 0, 0);
  const png = await canvas.convertToBlob({ type: 'image/png' });
  return { data: await png.arrayBuffer() };
}

const TEMP_CUTS = [-100, 32, 50, 60, 70, 80, 90];
const TEMP_RGB = ['#a9c5f5', '#c6e4f5', '#d9f0cf', '#f7eca6', '#fbd08a', '#f7a36b', '#e8695a'].map(hex);

type GridSample = { lat: number; lon: number; tempF: number };

/** Banded temperature picture for the view: a PNG and the corners it covers. */
export function temperatureImage(grid: GridSample[]) {
  const lats = [...new Set(grid.map(p => p.lat))].sort((a, b) => b - a);
  const lons = [...new Set(grid.map(p => p.lon))].sort((a, b) => a - b);
  if (lats.length < 2 || lons.length < 2) return null;
  const field = new Float32Array(lats.length * lons.length).fill(NaN);
  for (const p of grid) field[lats.indexOf(p.lat) * lons.length + lons.indexOf(p.lon)] = p.tempF;
  if (field.some(Number.isNaN)) return null;
  const outW = 512, outH = Math.round((512 * lats.length) / lons.length);
  const data = paintBands(field, lons.length, lats.length, { x: 0.5, y: 0.5, size: lons.length - 1 }, outW, outH, TEMP_CUTS, TEMP_RGB);
  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  canvas.getContext('2d')!.putImageData(new ImageData(data as Uint8ClampedArray<ArrayBuffer>, outW, outH), 0, 0);
  const n = lats[0], s = lats[lats.length - 1], w = lons[0], e = lons[lons.length - 1];
  return { url: canvas.toDataURL('image/png'), coordinates: [[w, n], [e, n], [e, s], [w, s]] as [[number, number], [number, number], [number, number], [number, number]] };
}
