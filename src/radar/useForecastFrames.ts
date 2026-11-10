import { useEffect, useState } from 'react';
import type { RadarFrame } from '@/api/weather';
import { onForecastWorkerFailed, startForecastWorker } from './forecastTiles';
import { getForecastFrames } from './hrrr';

const NOTHING = { frames: [] as RadarFrame[], failed: false };

/** Forecast frames for a timeline. Never throws: radar must not depend on this. */
export async function loadForecast({ enabled, latestScanAt, hours, now, signal }: { enabled: boolean; latestScanAt?: number; hours: number; now: number; signal: AbortSignal }) {
  if (!enabled || latestScanAt === undefined) return NOTHING;
  if (!startForecastWorker()) return { frames: [] as RadarFrame[], failed: true };
  try {
    const frames = await getForecastFrames(latestScanAt, hours, now, signal);
    if (signal.aborted) return NOTHING;
    return { frames, failed: !frames.length };
  } catch {
    return signal.aborted ? NOTHING : { frames: [] as RadarFrame[], failed: true };
  }
}

export function useForecastFrames({ enabled, latestScanAt, hours, tick }: { enabled: boolean; latestScanAt?: number; hours: number; tick: number }) {
  const [frames, setFrames] = useState<RadarFrame[]>([]);
  const [failed, setFailed] = useState(false);

  useEffect(() => onForecastWorkerFailed(() => setFailed(true)), []);

  useEffect(() => {
    if (!enabled) { setFrames([]); setFailed(false); return; }
    const abort = new AbortController();
    loadForecast({ enabled, latestScanAt, hours, now: Date.now(), signal: abort.signal }).then(result => {
      if (abort.signal.aborted) return;
      if (!result.failed) setFrames(result.frames); // a failed refresh keeps the frames already loaded
      setFailed(result.failed);
    });
    return () => abort.abort();
  }, [enabled, latestScanAt, hours, tick]);

  return { frames, failed };
}
