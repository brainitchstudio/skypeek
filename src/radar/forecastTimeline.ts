import type { RadarFrame } from '@/api/weather';
import { isForecast, latestObservedIndex } from './tools';

/** Marks follow the frame's own URL, which names its run and step, not its clock time. */
export const frameUnavailable = (frame: RadarFrame | undefined, failed: ReadonlySet<string>) =>
  isForecast(frame) && !!frame?.url && failed.has(frame.url);

/** Where a frame sits relative to the latest real scan. `nowPct` is that scan's rail position. */
export function timelineState(frames: RadarFrame[], frame: number) {
  const latest = latestObservedIndex(frames);
  const forecastFrames = latest >= 0 && latest < frames.length - 1;
  return {
    latest,
    historical: frame < latest,
    forecast: isForecast(frames[frame]),
    nowPct: forecastFrames ? (latest / (frames.length - 1)) * 100 : null,
  };
}
