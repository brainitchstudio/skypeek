// The HRRR forecast reflectivity at one map point, one value per forecast step.

import { remaining } from '@/api/budget';
import { gridIndex } from './forecastRender';
import { sampleForecast } from './forecastTiles';
import type { LambertGrid } from './grib2';
import { getForecastFrames } from './hrrr';
import { createLambert } from './lambert';
import type { MapPoint } from './tools';

export const HRRR_GRID: LambertGrid = { ni: 1799, nj: 1059, lat1: 21.138123, lon1: 237.280472, lov: 262.5, latin1: 38.5, latin2: 38.5, dx: 3000, dy: 3000, radius: 6371229 };
const HOURS = 3;

export type PointStep = { at: number; dbz: number | null }; // null is a gap
export type PointForecast = { run: number; steps: PointStep[] };

const project = createLambert(HRRR_GRID);

/** Whether the model grid has a cell at this point, by the same rule sampling uses. */
export function insideHrrr(lat: number, lon: number): boolean {
  const at = new Float64Array(2);
  project(lat, lon, at);
  return gridIndex(HRRR_GRID.ni, HRRR_GRID.nj, at) >= 0;
}

const aborted = (e: unknown) => e instanceof Error && e.name === 'AbortError';

export async function loadPointForecast(spot: MapPoint, latestScanAt: number, now: number, signal: AbortSignal,
  deps: { frames?: typeof getForecastFrames; sample?: typeof sampleForecast } = {}): Promise<PointForecast> {
  const { frames = getForecastFrames, sample = sampleForecast } = deps;
  if (!insideHrrr(spot.lat, spot.lon)) throw new Error('Outside HRRR coverage');
  const list = await frames(latestScanAt, HOURS, now, signal);
  if (!list.length) throw new Error(remaining('hrrr') < 1 ? 'HRRR request budget reached' : 'No HRRR run available');
  const results = await Promise.allSettled(list.map(f => sample(f, spot.lat, spot.lon, signal)));
  const abort = results.find(r => r.status === 'rejected' && aborted(r.reason));
  if (abort) throw (abort as PromiseRejectedResult).reason;
  const failed = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
  if (failed.length === results.length) throw failed[0].reason;
  return {
    run: list[0].run as number,
    steps: list.map((f, i) => {
      const r = results[i];
      return { at: f.at as number, dbz: r.status === 'fulfilled' ? r.value : null };
    }),
  };
}
