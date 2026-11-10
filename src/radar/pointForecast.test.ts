import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import type { RadarFrame } from '@/api/weather';
import { remaining } from '@/api/budget';
import { decodeGrib2 } from './grib2';
import { HRRR_GRID, insideHrrr, loadPointForecast } from './pointForecast';

vi.mock('@/api/budget', async orig => ({ ...await orig<typeof import('@/api/budget')>(), remaining: vi.fn(() => 100) }));

const FIXTURE = fileURLToPath(new URL('./__fixtures__/refd.grib2', import.meta.url));
const RUN = Date.UTC(2026, 10, 6, 12), SCAN = RUN + 5 * 60_000, NOW = RUN + 30 * 60_000;
const atOf = (min: number) => RUN + min * 60_000;
const frame = (min: number): RadarFrame => ({ label: `+${min}`, url: `hrrr-forecast://tile/{z}/{x}/{y}?l=${min}`, at: atOf(min), kind: 'forecast', run: RUN, leadMin: min });
const spot = { lat: 41.8, lon: -87.6 };
const never = new AbortController().signal;

describe('HRRR point forecast', () => {
  it('matches the real file grid', () => {
    expect(decodeGrib2(new Uint8Array(readFileSync(FIXTURE))).grid).toEqual(HRRR_GRID);
  });
  it('knows the lower 48 and nowhere else', () => {
    expect(insideHrrr(41.8, -87.6)).toBe(true);
    expect(insideHrrr(41.8, 272.4)).toBe(true);
    expect(insideHrrr(21.3, -157.9)).toBe(false); // Honolulu
    expect(insideHrrr(61.2, -149.9)).toBe(false); // Anchorage
  });
  it('asks for 3 hours and returns each value', async () => {
    const frames = vi.fn(async () => [frame(15), frame(30)]);
    const f = await loadPointForecast(spot, SCAN, NOW, never, { frames, sample: async () => 42 });
    expect(frames).toHaveBeenCalledWith(SCAN, 3, NOW, never);
    expect(f).toEqual({ run: RUN, steps: [{ at: atOf(15), dbz: 42 }, { at: atOf(30), dbz: 42 }] });
  });
  it('shows one failed step as a gap', async () => {
    const sample = vi.fn().mockResolvedValueOnce(40).mockRejectedValueOnce(new Error('refused'));
    const f = await loadPointForecast(spot, SCAN, NOW, never, { frames: async () => [frame(15), frame(30)], sample });
    expect(f.steps.map(s => s.dbz)).toEqual([40, null]);
  });
  it('shows a null sample inside the grid as a gap', async () => {
    const sample = vi.fn().mockResolvedValueOnce(40).mockResolvedValueOnce(null);
    const f = await loadPointForecast(spot, SCAN, NOW, never, { frames: async () => [frame(15), frame(30)], sample });
    expect(f.steps.map(s => s.dbz)).toEqual([40, null]);
  });
  it('fails when every step fails', async () => {
    const sample = vi.fn().mockRejectedValueOnce(new Error('first')).mockRejectedValueOnce(new Error('second'));
    await expect(loadPointForecast(spot, SCAN, NOW, never, { frames: async () => [frame(15), frame(30)], sample })).rejects.toThrow('first');
  });
  it('fails when no run is published', async () => {
    await expect(loadPointForecast(spot, SCAN, NOW, never, { frames: async () => [], sample: async () => 1 })).rejects.toThrow('No HRRR run available');
  });
  it('says the budget is spent when no frames come back', async () => {
    vi.mocked(remaining).mockReturnValueOnce(0);
    await expect(loadPointForecast(spot, SCAN, NOW, never, { frames: async () => [], sample: async () => 1 })).rejects.toThrow('HRRR request budget reached');
  });
  it('lets an abort through instead of a gap', async () => {
    const sample = vi.fn().mockResolvedValueOnce(40).mockRejectedValueOnce(new DOMException('Aborted', 'AbortError'));
    await expect(loadPointForecast(spot, SCAN, NOW, never, { frames: async () => [frame(15), frame(30)], sample })).rejects.toMatchObject({ name: 'AbortError' });
  });
  it('makes no request outside the grid', async () => {
    const frames = vi.fn();
    await expect(loadPointForecast({ lat: 21.3, lon: -157.9 }, SCAN, NOW, never, { frames })).rejects.toThrow('Outside HRRR coverage');
    expect(frames).not.toHaveBeenCalled();
  });
});
