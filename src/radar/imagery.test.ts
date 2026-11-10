import { afterEach, describe, expect, it, vi } from 'vitest';
import { imageryTiles, loadImageryTile } from './imagery';
import { bench, spend } from '@/api/budget';

vi.mock('@/api/budget', () => ({ spend: vi.fn(), bench: vi.fn(), remaining: vi.fn(() => 100) }));
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
const tile = imageryTiles('rainviewer', 'https://example.test/{z}/{x}/{y}/2/0_1.png')
  .replace('{z}', '7').replace('{x}', '25').replace('{y}', '48');

describe('native radar imagery', () => {
  it('returns original image bytes without decoding colors or losing snow and alpha', async () => {
    const bytes = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
    const fetcher = vi.fn().mockResolvedValue(new Response(bytes));
    vi.stubGlobal('fetch', fetcher);
    const abort = new AbortController();
    const result = await loadImageryTile({ url: tile }, abort);
    expect(new Uint8Array(result.data)).toEqual(bytes);
    expect(fetcher).toHaveBeenCalledWith('https://example.test/7/25/48/2/0_1.png', { signal: abort.signal });
    expect(spend).toHaveBeenCalledWith('rainviewer');
  });
  it('backs off on rate limits without returning an error body as imagery', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('slow down', { status: 429 })));
    await expect(loadImageryTile({ url: tile }, new AbortController())).rejects.toThrow('429');
    expect(bench).toHaveBeenCalledWith('rainviewer');
  });
  it('expands NOAA tiles to Web Mercator bounds and rejects XML error images', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('<ServiceException/>', {headers: {'content-type': 'text/xml'}}));
    vi.stubGlobal('fetch', fetcher);
    const url = imageryTiles('noaa', 'https://opengeo.ncep.noaa.gov/geoserver/klot/ows?bbox={bbox-epsg-3857}')
      .replace('{z}', '0').replace('{x}', '0').replace('{y}', '0');
    await expect(loadImageryTile({url}, new AbortController())).rejects.toThrow('invalid radar image');
    expect(fetcher.mock.calls[0][0]).toContain('bbox=-20037508.342789244,-20037508.342789244,20037508.342789244,20037508.342789244');
    expect(spend).toHaveBeenCalledWith('noaa');
  });
  it('does not spend or fetch a cancelled tile', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const abort = new AbortController(); abort.abort();
    await expect(loadImageryTile({ url: tile }, abort)).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled(); expect(spend).not.toHaveBeenCalled();
  });
});
