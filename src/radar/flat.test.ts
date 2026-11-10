import { describe, expect, it } from 'vitest';
import { DECODE, flatTiles, paintBands, reflectivityColor, reflectivityLut } from './flat';
import scale from './reflectivityScale.json';

describe('DECODE', () => {
  it('reads RainViewer colors through its published dBZ table', () => {
    expect(DECODE.rainviewer(0, 0, 0, 0)).toBe(0);
    expect(DECODE.rainviewer(0xce, 0xc0, 0x87, 0x96)).toBeCloseTo(1); // 10 dBZ
    expect(DECODE.rainviewer(0x00, 0x55, 0x88, 0xff)).toBeCloseTo(2); // 30 dBZ
    expect(DECODE.rainviewer(0xff, 0xaa, 0x00, 0xff)).toBeCloseTo(3); // 40 dBZ
    expect(DECODE.rainviewer(0xc1, 0x00, 0x00, 0xff)).toBeCloseTo(4); // 50 dBZ
  });

  it('reads OpenWeather intensity from alpha, and ignores trace amounts', () => {
    expect(DECODE.openweather(110, 110, 205, 11)).toBeLessThan(1);
    expect(DECODE.openweather(110, 110, 205, 94)).toBeCloseTo(2);
    expect(DECODE.openweather(110, 110, 205, 240)).toBe(4);
  });
});

describe('paintBands', () => {
  const RED: [number, number, number] = [255, 0, 0], BLUE: [number, number, number] = [0, 0, 255];
  const paint = (field: number[], out: number) => paintBands(new Float32Array(field), 2, 2, { x: 0, y: 0, size: 2 }, out, out, [1, 2], [RED, BLUE]);

  it('leaves values under the first cut transparent', () => {
    expect([...paint([0, 0, 0, 0], 1)]).toEqual([0, 0, 0, 0]);
  });

  it('uses solid palette colors only, never blends', () => {
    const px = paint([0, 3, 0, 3], 8);
    const colors = new Set<string>();
    for (let i = 0; i < px.length; i += 4) colors.add([...px.slice(i, i + 4)].join());
    expect([...colors].sort()).toEqual(['0,0,0,0', '0,0,255,255', '255,0,0,255'].sort());
  });
});

describe('flatTiles', () => {
  it('leaves z/x/y for MapLibre and hides the source template from it', () => {
    const url = flatTiles('openweather', 'https://a/{z}/{x}/{y}.png?appid=k', 9);
    expect(url.startsWith('flat://openweather/9/{z}/{x}/{y}?u=')).toBe(true);
    expect(url.split('?u=')[1]).not.toContain('{');
  });
});

describe('reflectivityLut', () => {
  const lut = reflectivityLut({ r: -10, e: -4, d: 0, maxX: 1600 });
  const at = (dbz: number) => lut[(dbz + 10) * 16];
  const hexOf = (c: number) => `#${[c & 255, (c >>> 8) & 255, (c >>> 16) & 255].map(v => v.toString(16).padStart(2, '0')).join('')}`;

  it('leaves no echo transparent', () => {
    expect(at(-10)).toBe(0);
  });

  it('paints the weakest value above no echo', () => {
    expect(at(-9.9375) >>> 24).toBe(255);
  });

  it('uses the top color past the scale', () => {
    expect(hexOf(at(90))).toBe(scale.colors.at(-1));
  });

  it('uses the colors of the NOAA legend', () => {
    expect(hexOf(at(20))).toBe('#30d65b');
    expect(hexOf(at(50))).toBe('#d10809');
  });

  it('covers every raw integer in the field', () => {
    expect(lut.length).toBe(1601);
  });

  it('applies the field scaling, not an assumed one', () => {
    const other = reflectivityLut({ r: 200, e: 0, d: 1, maxX: 0 }); // 20 dBZ at raw 0
    expect(hexOf(other[0])).toBe('#30d65b');
  });

  it('recorded a passing check against a real scan', () => {
    expect(scale.scanCheck.pixels).toBeGreaterThan(1000);
    expect(scale.scanCheck.offScale / scale.scanCheck.pixels).toBeLessThanOrEqual(0.01);
  });
});

describe('reflectivityColor', () => {
  it('colors a value with the radar scale', () => expect(reflectivityColor(45)).toMatch(/^#[0-9a-f]{6}$/i));
  it('has no color at -10 dBZ', () => expect(reflectivityColor(-10)).toBeNull());
  it('agrees with the tile palette', () => {
    const lut = reflectivityLut({ r: 450, e: 0, d: 1, maxX: 0 }); // 45 dBZ at raw 0
    const c = lut[0], h = `#${[c & 255, (c >>> 8) & 255, (c >>> 16) & 255].map(v => v.toString(16).padStart(2, '0')).join('')}`;
    expect(h).toBe(reflectivityColor(45));
  });
});
