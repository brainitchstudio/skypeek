import { describe, expect, it } from 'vitest';
import type { StormObject } from '@/lib/probSevere';
import { checkPrompt, forecastLine, nearestStep, outlineAt } from './checkMode';
import type { StormTrack } from './usePointCheck';

const obj = { id: '1', ring: [[-91, 39], [-89, 39], [-89, 41], [-91, 41], [-91, 39]] } as StormObject;
const tracking: StormTrack = { state: 'tracking', storm: obj, arrival: null, stale: false };
const gone: StormTrack = { state: 'gone', storm: obj, asOf: 1_800_000_000_000 };
const base = { picking: true, hasSpot: false, failed: false, loaded: true, count: 4, noOutline: false, track: null };

describe('checkPrompt', () => {
  it('prompts for a storm', () => { expect(checkPrompt(base)).toEqual({ text: 'Click a storm', skip: true, again: false }); });
  it('says when outlines are loading', () => { expect(checkPrompt({ ...base, loaded: false, count: 0 })).toEqual({ text: 'Loading storm outlines…', skip: true, again: false }); });
  it('reports an empty feed', () => { expect(checkPrompt({ ...base, count: 0 })?.text).toBe('No storms reported right now'); });
  it('reports a failed feed', () => { expect(checkPrompt({ ...base, failed: true, count: 0 })?.text).toBe('Storm outlines unavailable'); });
  it('keeps prompting when a refresh fails with storms on the map', () => { expect(checkPrompt({ ...base, failed: true })?.text).toBe('Click a storm'); });
  it('notes a storm card with no outline', () => { expect(checkPrompt({ ...base, noOutline: true })?.text).toBe('No outline for this storm. Click a storm'); });
  it('prompts for a location after selecting', () => { expect(checkPrompt({ ...base, picking: false, track: tracking })?.text).toBe('Click a location'); });
  it('offers picking again when the storm is lost before a pin', () => {
    const p = checkPrompt({ ...base, picking: false, track: gone });
    expect(p?.text).toMatch(/^No longer tracked as of /);
    expect(p?.again).toBe(true);
    expect(p?.skip).toBe(false);
  });
  it('shows nothing once a pin is down', () => { expect(checkPrompt({ ...base, picking: false, hasSpot: true, track: tracking })).toBeNull(); });
});

describe('outlineAt', () => {
  it('finds the outline containing a point', () => {
    expect(outlineAt([obj], { lat: 40, lon: -90 })).toBe(obj);
    expect(outlineAt([obj], { lat: 45, lon: -90 })).toBeNull();
  });
});

describe('nearestStep', () => {
  const steps = [{ at: 0, dbz: 10 }, { at: 900_000, dbz: 20 }];
  it('finds the nearest forecast step within 7.5 minutes', () => {
    expect(nearestStep(steps, 7 * 60_000)?.dbz).toBe(10);
    expect(nearestStep(steps, 8 * 60_000)?.dbz).toBe(20);
    expect(nearestStep(steps, 900_000 + 8 * 60_000)).toBeNull();
    expect(nearestStep([], 0)).toBeNull();
  });
});

describe('forecastLine', () => {
  const at = new Date(2026, 10, 7, 16, 15).getTime();
  it('names the first step of 35 dBZ or more', () => {
    expect(forecastLine([{ at: at - 900_000, dbz: 34.9 }, { at, dbz: 35 }, { at: at + 900_000, dbz: 60 }])).toBe('Forecast: HRRR shows storms here around 4:15 PM');
  });
  it('says none when every value is below the cutoff', () => {
    expect(forecastLine([{ at, dbz: 10 }, { at, dbz: 30 }])).toBe('Forecast: HRRR shows no storms here in the next 3 hours');
  });
  it('does not claim none across gaps', () => {
    expect(forecastLine([{ at, dbz: 10 }, { at, dbz: null }])).toBe('Forecast: HRRR has gaps, with no storms in the values it has');
    expect(forecastLine([{ at, dbz: null }, { at: at + 1, dbz: 40 }])).toBe('Forecast: HRRR shows storms here around 4:15 PM');
  });
});
