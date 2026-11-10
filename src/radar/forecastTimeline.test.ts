import { describe, expect, it } from 'vitest';
import type { RadarFrame } from '@/api/weather';
import { frameUnavailable, timelineState } from './forecastTimeline';

const obs = (at: number): RadarFrame => ({ label: '', url: 'o', at });
const cast = (at: number): RadarFrame => ({ label: '', url: 'f', at, kind: 'forecast' });
const frames = [obs(1), obs(2), obs(3), cast(4), cast(5)];

describe('timelineState', () => {
  it('makes the latest real scan the place Latest goes', () => {
    expect(timelineState(frames, 0).latest).toBe(2);
  });

  it('calls only frames before the latest scan historical', () => {
    expect(timelineState(frames, 1).historical).toBe(true);
    expect(timelineState(frames, 2).historical).toBe(false);
    expect(timelineState(frames, 3).historical).toBe(false);
  });

  it('marks only forecast frames as forecast', () => {
    expect(timelineState(frames, 2).forecast).toBe(false);
    expect(timelineState(frames, 3).forecast).toBe(true);
  });

  it('leaves the latest scan as neither, so storm arrival shows there', () => {
    expect(timelineState(frames, 2)).toMatchObject({ historical: false, forecast: false });
  });

  it('places the Now marker on the latest scan', () => {
    expect(timelineState(frames, 0).nowPct).toBe(50);
  });

  it('has no Now marker without forecast frames', () => {
    expect(timelineState([obs(1), obs(2)], 0).nowPct).toBeNull();
  });

  it('behaves as before on a timeline with no forecast', () => {
    expect(timelineState([obs(1), obs(2)], 0)).toMatchObject({ latest: 1, historical: true, forecast: false });
    expect(timelineState([obs(1), obs(2)], 1)).toMatchObject({ latest: 1, historical: false, forecast: false });
  });

  it('copes with an empty timeline', () => {
    expect(timelineState([], 0)).toEqual({ latest: -1, historical: false, forecast: false, nowPct: null });
  });
});

describe('frameUnavailable', () => {
  it('marks a failed forecast frame', () => {
    expect(frameUnavailable(cast(4), new Set(['f']))).toBe(true);
  });

  it('does not mark a newer run at the same clock time', () => {
    expect(frameUnavailable({ ...cast(4), url: 'newer' }, new Set(['f']))).toBe(false);
  });

  it('never marks a real scan', () => {
    expect(frameUnavailable(obs(4), new Set(['o']))).toBe(false);
  });

  it('copes with a missing frame', () => {
    expect(frameUnavailable(undefined, new Set(['f']))).toBe(false);
  });
});
