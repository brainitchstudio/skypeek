import { describe, expect, it } from 'vitest';
import { alignedCells, contains, forecastBanner, frameAfterRefresh, isForecast, latestObservedIndex, layersToDrop, measure, mergeTimeline } from './tools';
import type { RadarFrame } from '@/api/weather';
import type { StormCell } from '@/api/layers';
import { readStationStatus } from './status';

describe('radar ruler', () => {
  it('measures great-circle distance and initial bearing', () => {
    const result = measure({lat:0,lon:0}, {lat:0,lon:1});
    expect(result.km).toBeCloseTo(111.195, 2);
    expect(result.miles).toBeCloseTo(69.093, 2);
    expect(result.bearing).toBeCloseTo(90);
    expect(measure({lat:40,lon:-90}, {lat:40,lon:-90}).km).toBe(0);
  });
  it('takes the short route across the date line', () => {
    expect(measure({lat:0,lon:179}, {lat:0,lon:-179}).km).toBeCloseTo(222.39, 1);
  });
});
describe('radar time alignment', () => {
  it('excludes reports outside the selected frame tolerance', () => {
    const cells = [-301000,-300000,0,300000,301000].map((delta, i) => ({ id:String(i), at:1000000+delta }) as StormCell);
    expect(alignedCells(cells,1000000).map(c => c.id)).toEqual(['1','2','3']);
  });
  it('preserves a historical selection when metadata refreshes', () => {
    expect(frameAfterRefresh([{at:200},{at:300},{at:400}],290,false)).toBe(1);
    expect(frameAfterRefresh([{at:200},{at:300},{at:400}],290,true)).toBe(2);
    expect(frameAfterRefresh([],undefined,true)).toBe(0);
  });
});
describe('coverage and station reports', () => {
  it('distinguishes outside the published extent', () => {
    const e = {west:-100,east:-80,south:30,north:45};
    expect(contains(e,{lat:40,lon:-90})).toBe(true);
    expect(contains(e,{lat:40,lon:-70})).toBe(false);
  });
  it('keeps status missing rather than asserting a station is online', () => {
    expect(readStationStatus({})).toEqual({at:null,status:'Unknown',mode:'Unknown',alarm:null});
    expect(readStationStatus({properties:{rda:{timestamp:'2026-11-05T17:00:00Z',properties:{status:'Standby',mode:'Maintenance',alarmSummary:'Receiver'}}}})).toMatchObject({status:'Standby',mode:'Maintenance',alarm:'Receiver'});
  });
});

describe('forecast timeline', () => {
  const obs = (at: number): RadarFrame => ({ label: '', url: 'o', at });
  const cast = (at: number): RadarFrame => ({ label: '', url: 'f', at, kind: 'forecast' });
  const timeline = [obs(1), obs(2), cast(3), cast(4)];

  it('finds the latest scan, not the last frame', () => {
    expect(latestObservedIndex(timeline)).toBe(1);
  });

  it('treats a frame with no kind as observed', () => {
    expect(latestObservedIndex([{}, {}])).toBe(1);
  });

  it('has no latest scan in an empty or forecast-only list', () => {
    expect(latestObservedIndex([])).toBe(-1);
    expect(latestObservedIndex([cast(1)])).toBe(-1);
  });

  it('tells forecast frames apart', () => {
    expect(isForecast(cast(1))).toBe(true);
    expect(isForecast(obs(1))).toBe(false);
    expect(isForecast(undefined)).toBe(false);
  });

  it('follows the latest scan', () => {
    expect(frameAfterRefresh(timeline, undefined, true)).toBe(1);
  });

  it('keeps a forecast clock time across a refresh', () => {
    expect(frameAfterRefresh(timeline, 3, false)).toBe(2);
  });

  it('keeps the same clock time when a new scan shifts every frame', () => {
    expect(frameAfterRefresh([obs(0), ...timeline], 3, false)).toBe(3);
  });

  it('puts observed frames first', () => {
    expect(mergeTimeline([obs(1), obs(5)], [cast(6)]).map(f => f.at)).toEqual([1, 5, 6]);
  });

  it('drops forecast frames at or before the latest scan', () => {
    expect(mergeTimeline([obs(5)], [cast(4), cast(5), cast(6)]).map(f => f.at)).toEqual([5, 6]);
  });

  it('describes a forecast frame', () => {
    const frame = { ...cast(1), run: new Date(2026, 10, 5, 15).getTime(), leadMin: 135 };
    expect(forecastBanner(frame)).toBe('HRRR simulated radar · Run 3 PM · +2 h 15 min');
  });

  it('leaves out zero minutes', () => {
    expect(forecastBanner({ ...cast(1), run: new Date(2026, 10, 5, 9).getTime(), leadMin: 120 })).toBe('HRRR simulated radar · Run 9 AM · +2 h');
  });

  it('leaves out zero hours', () => {
    expect(forecastBanner({ ...cast(1), run: new Date(2026, 10, 5, 12).getTime(), leadMin: 45 })).toBe('HRRR simulated radar · Run 12 PM · +45 min');
  });
});

describe('layersToDrop', () => {
  it('keeps everything under the limit', () => {
    expect(layersToDrop(['a', 'b'], 2, 'b')).toEqual([]);
  });

  it('drops the frames seen longest ago', () => {
    expect(layersToDrop(['a', 'b', 'c', 'd'], 2, 'd')).toEqual(['a', 'b']);
  });

  it('never drops the frame on screen', () => {
    expect(layersToDrop(['a', 'b', 'c'], 2, 'a')).toEqual(['b']);
  });
});
