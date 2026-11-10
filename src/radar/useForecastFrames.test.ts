import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RadarFrame } from '@/api/weather';
import { getForecastFrames } from './hrrr';
import { startForecastWorker } from './forecastTiles';
import { loadForecast } from './useForecastFrames';

vi.mock('./hrrr', () => ({ getForecastFrames: vi.fn() }));
vi.mock('./forecastTiles', () => ({ startForecastWorker: vi.fn(() => true), onForecastWorkerFailed: vi.fn() }));

const frame: RadarFrame = { label: '', url: 'f', at: 9, kind: 'forecast' };
const args = { enabled: true, latestScanAt: 5, hours: 6, now: 6, signal: new AbortController().signal };

describe('loadForecast', () => {
  beforeEach(() => {
    vi.mocked(getForecastFrames).mockReset().mockResolvedValue([frame]);
    vi.mocked(startForecastWorker).mockReset().mockReturnValue(true);
  });

  it('returns the frames', async () => {
    await expect(loadForecast(args)).resolves.toEqual({ frames: [frame], failed: false });
    expect(getForecastFrames).toHaveBeenCalledWith(5, 6, 6, args.signal);
  });

  it('asks for nothing on another source', async () => {
    await expect(loadForecast({ ...args, enabled: false })).resolves.toEqual({ frames: [], failed: false });
    expect(getForecastFrames).not.toHaveBeenCalled();
    expect(startForecastWorker).not.toHaveBeenCalled();
  });

  it('asks for nothing before there is a real scan', async () => {
    await expect(loadForecast({ ...args, latestScanAt: undefined })).resolves.toEqual({ frames: [], failed: false });
    expect(getForecastFrames).not.toHaveBeenCalled();
  });

  it('reports failure when the worker cannot start', async () => {
    vi.mocked(startForecastWorker).mockReturnValue(false);
    await expect(loadForecast(args)).resolves.toEqual({ frames: [], failed: true });
    expect(getForecastFrames).not.toHaveBeenCalled();
  });

  it('reports failure when a request fails', async () => {
    vi.mocked(getForecastFrames).mockRejectedValue(new Error('offline'));
    await expect(loadForecast(args)).resolves.toEqual({ frames: [], failed: true });
  });

  it('reports failure when no run is usable', async () => {
    vi.mocked(getForecastFrames).mockResolvedValue([]);
    await expect(loadForecast(args)).resolves.toEqual({ frames: [], failed: true });
  });

  it('drops a result that arrives after a source change', async () => {
    const abort = new AbortController();
    const load = loadForecast({ ...args, signal: abort.signal });
    abort.abort();
    await expect(load).resolves.toEqual({ frames: [], failed: false });
  });

  it('does not report failure for an abort', async () => {
    const abort = new AbortController();
    vi.mocked(getForecastFrames).mockImplementation(async () => { abort.abort(); throw new DOMException('Aborted', 'AbortError'); });
    await expect(loadForecast({ ...args, signal: abort.signal })).resolves.toEqual({ frames: [], failed: false });
  });
});
