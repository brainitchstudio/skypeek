import { afterEach, expect, it, vi } from 'vitest';
import { getStormCellsAt } from './layers';
vi.mock('./budget', async importOriginal => ({ ...await importOriginal<typeof import('./budget')>(), admit: vi.fn(() => true), cooldownFor429: vi.fn() }));
afterEach(() => vi.unstubAllGlobals());
it('requests the selected UTC time, caches it, and rejects distant reports', async () => {
  const at = Date.parse('2026-11-05T17:40:00Z');
  const properties = { nexrad:'LOT', storm_id:'A0', tvs:'NONE', poh:0, max_dbz:35, drct:230, sknt:20 };
  const features = ['2026-11-05T17:40:43Z','2026-11-05T18:00:00Z'].map((valid,i) => ({ properties:{...properties,storm_id:String(i),valid},geometry:{coordinates:[-88-i,42]} }));
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({features})));
  vi.stubGlobal('fetch',fetcher);
  const result = await getStormCellsAt(at);
  expect(result).toHaveLength(1);
  expect(result[0].at).toBe(Date.parse('2026-11-05T17:40:43Z'));
  expect(fetcher.mock.calls[0][0]).toContain('valid=2026-11-05T17%3A40%3A00.000Z');
  await getStormCellsAt(at);
  expect(fetcher).toHaveBeenCalledTimes(1);
});
