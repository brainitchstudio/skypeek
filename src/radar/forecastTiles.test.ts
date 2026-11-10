import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bench, remaining, spend } from '@/api/budget';
import { recordDiagnostic } from '@/weather/diagnostics';
import type { RadarFrame } from '@/api/weather';

vi.mock('@/api/budget', () => ({ spend: vi.fn(), bench: vi.fn(), remaining: vi.fn(() => 100) }));
vi.mock('@/weather/diagnostics', () => ({ recordDiagnostic: vi.fn() }));

class FakeWorker {
  static last: FakeWorker;
  static throws = false;
  posted: Record<string, unknown>[] = [];
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() {
    if (FakeWorker.throws) throw new Error('blocked');
    FakeWorker.last = this;
  }
  postMessage(m: Record<string, unknown>) { this.posted.push(m); }
  reply(data: unknown) { this.onmessage!({ data }); }
}

const URL_5 = 'hrrr-forecast://tile/5/7/12?u=https%3A%2F%2Fexample.test%2Ff&s=10&e=19&r=1000&l=15';
const KEY = { url: 'https://example.test/f', start: 10, end: 19, run: 1000, leadMin: 15 };

async function load() {
  vi.resetModules();
  return import('./forecastTiles');
}

describe('forecast tiles', () => {
  beforeEach(() => {
    FakeWorker.throws = false;
    vi.stubGlobal('Worker', FakeWorker);
    vi.mocked(spend).mockClear(); vi.mocked(bench).mockClear(); vi.mocked(recordDiagnostic).mockClear();
    vi.mocked(remaining).mockReturnValue(100);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('asks the worker for the tile in the URL', async () => {
    const { loadForecastTile } = await load();
    const tile = loadForecastTile({ url: URL_5 }, new AbortController());
    const sent = FakeWorker.last.posted[0];
    expect(sent).toMatchObject({ type: 'tile', key: KEY, z: 5, x: 7, y: 12 });
    const data = new ArrayBuffer(4);
    FakeWorker.last.reply({ id: sent.id, data });
    await expect(tile).resolves.toEqual({ data });
  });

  it('lets the worker serve held fields during a cooldown', async () => {
    vi.mocked(remaining).mockReturnValue(0);
    const { loadForecastTile } = await load();
    void loadForecastTile({ url: URL_5 }, new AbortController()).catch(() => undefined);
    expect(FakeWorker.last.posted[0]).toMatchObject({ type: 'tile', canFetch: false });
  });

  it('asks for a tile that will not be shrunk on this display', async () => {
    vi.stubGlobal('devicePixelRatio', 2);
    const { loadForecastTile } = await load();
    void loadForecastTile({ url: URL_5 }, new AbortController()).catch(() => undefined);
    expect(FakeWorker.last.posted[0]).toMatchObject({ size: 256, canFetch: true });
  });

  it('cancels in the worker when the map aborts', async () => {
    const { loadForecastTile } = await load();
    const abort = new AbortController();
    const tile = loadForecastTile({ url: URL_5 }, abort);
    const { id } = FakeWorker.last.posted[0];
    abort.abort();
    await expect(tile).rejects.toMatchObject({ name: 'AbortError' });
    expect(FakeWorker.last.posted[1]).toEqual({ id, type: 'cancel' });
  });

  it('applies worker request reports to the ledger', async () => {
    const { startForecastWorker } = await load();
    startForecastWorker();
    FakeWorker.last.reply({ type: 'charge' });
    FakeWorker.last.reply({ type: 'bench' });
    expect(spend).toHaveBeenCalledWith('hrrr');
    expect(bench).toHaveBeenCalledWith('hrrr', 60_000);
  });

  it('rejects a tile the worker could not make', async () => {
    const { loadForecastTile } = await load();
    const tile = loadForecastTile({ url: URL_5 }, new AbortController());
    FakeWorker.last.reply({ id: FakeWorker.last.posted[0].id, error: 'offline' });
    await expect(tile).rejects.toThrow('offline');
    expect(recordDiagnostic).not.toHaveBeenCalled();
  });

  it('records a GRIB refusal', async () => {
    const { loadForecastTile } = await load();
    const tile = loadForecastTile({ url: URL_5 }, new AbortController());
    FakeWorker.last.reply({ id: FakeWorker.last.posted[0].id, error: 'Scanning mode is not 64', code: 'unsupported-grid' });
    await expect(tile).rejects.toThrow();
    expect(recordDiagnostic).toHaveBeenCalledTimes(1);
  });

  it('fails pending tiles and tells listeners when the worker dies', async () => {
    const { loadForecastTile, onForecastWorkerFailed } = await load();
    const heard = vi.fn();
    onForecastWorkerFailed(heard);
    const tile = loadForecastTile({ url: URL_5 }, new AbortController());
    FakeWorker.last.onerror!();
    await expect(tile).rejects.toThrow();
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it('reports when a worker cannot start', async () => {
    FakeWorker.throws = true;
    const { startForecastWorker } = await load();
    expect(startForecastWorker()).toBe(false);
  });

  it('prefetches forecast frames only', async () => {
    const { prefetchForecast } = await load();
    const template = URL_5.replace('/5/7/12', '/{z}/{x}/{y}');
    prefetchForecast([{ label: '', url: template }, { label: '', url: null }, { label: '', url: 'radar-image://x' }] as RadarFrame[]);
    expect(FakeWorker.last.posted).toEqual([expect.objectContaining({ type: 'prefetch', key: KEY })]);
  });

  it('prefetches a frame once per run', async () => {
    const { prefetchForecast } = await load();
    const frame = { label: '', url: URL_5.replace('/5/7/12', '/{z}/{x}/{y}'), run: 1000 } as RadarFrame;
    prefetchForecast([frame]); prefetchForecast([frame]);
    expect(FakeWorker.last.posted.length).toBe(1);
  });

  it('prefetches again for a new run', async () => {
    const { prefetchForecast } = await load();
    const frame = { label: '', url: URL_5.replace('/5/7/12', '/{z}/{x}/{y}'), run: 1000 } as RadarFrame;
    prefetchForecast([frame]); prefetchForecast([{ ...frame, run: 2000 }]); prefetchForecast([frame]);
    expect(FakeWorker.last.posted.length).toBe(3);
  });

  it('skips prefetching when it could not download', async () => {
    vi.mocked(remaining).mockReturnValue(0);
    const { prefetchForecast, startForecastWorker } = await load();
    startForecastWorker();
    prefetchForecast([{ label: '', url: URL_5, run: 1000 } as RadarFrame]);
    expect(FakeWorker.last.posted).toEqual([]);
  });

  it('resolves a sample and keeps null', async () => {
    const { sampleForecast } = await load();
    const frame = { label: '', url: URL_5, run: 1000 } as RadarFrame;
    const got = sampleForecast(frame, 40, -95, new AbortController().signal);
    const sent = FakeWorker.last.posted[0];
    expect(sent).toMatchObject({ type: 'sample', key: KEY, lat: 40, lon: -95, canFetch: true });
    FakeWorker.last.reply({ id: sent.id, sample: null });
    await expect(got).resolves.toBeNull();
    const again = sampleForecast(frame, 40, -95, new AbortController().signal);
    FakeWorker.last.reply({ id: FakeWorker.last.posted[1].id, sample: 12.5 });
    await expect(again).resolves.toBe(12.5);
  });

  it('rejects a sample that the worker refuses', async () => {
    const { sampleForecast } = await load();
    const got = sampleForecast({ label: '', url: URL_5 } as RadarFrame, 40, -95, new AbortController().signal);
    FakeWorker.last.reply({ id: FakeWorker.last.posted[0].id, error: 'offline' });
    await expect(got).rejects.toThrow('offline');
  });

  it('cancels the worker on abort', async () => {
    const { sampleForecast } = await load();
    const abort = new AbortController();
    const got = sampleForecast({ label: '', url: URL_5 } as RadarFrame, 40, -95, abort.signal);
    const { id } = FakeWorker.last.posted[0];
    abort.abort();
    await expect(got).rejects.toMatchObject({ name: 'AbortError' });
    expect(FakeWorker.last.posted[1]).toEqual({ id, type: 'cancel' });
  });
});
