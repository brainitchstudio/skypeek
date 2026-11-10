import { describe, expect, it } from 'vitest';
import { nearestStation, noaaLayer, selectTimes, NOAA_STATIONS } from './noaa';

describe('NOAA radar products', () => {
  it('finds local radar stations without guessing station identifiers', () => {
    expect(NOAA_STATIONS.length).toBeGreaterThan(150);
    expect(nearestStation(41.8781, -87.6298).id).toBe('KLOT');
    const okx = NOAA_STATIONS.find(s => s.id === 'KOKX')!;
    expect(nearestStation(okx.lat, okx.lon).id).toBe('KOKX');
  });
  it('keeps station velocity separate from national reflectivity', () => {
    expect(noaaLayer(4, 'KLOT', 'sr_bvel').layer).toBe('conus_bref_qcd');
    expect(noaaLayer(5, 'KLOT', 'sr_bvel')).toEqual({ endpoint: 'klot/ows', layer: 'klot_sr_bvel' });
    expect(() => noaaLayer(5, 'unknown', 'sr_bvel')).toThrow();
    expect(() => noaaLayer(5, 'KLOT', 'invalid')).toThrow();
  });
  it('uses exact sorted timestamps, retaining oldest and latest within a bounded loop', () => {
    const now = Date.parse('2026-11-05T17:00:00Z');
    const all = Array.from({length: 60}, (_, i) => now - (59 - i) * 120000);
    const selected = selectTimes(all.map(t => new Date(t).toISOString()).reverse().join(','), now);
    expect(selected).toHaveLength(12);
    expect(selected[0]).toBe(all[0]); expect(selected.at(-1)).toBe(now);
    expect(selected.every(t => all.includes(t))).toBe(true);
  });
  it('rejects stale, future, invalid and interval data rather than inventing scans', () => {
    const now = Date.parse('2026-11-05T17:00:00Z');
    expect(selectTimes('bad,2026-11-05T00:00:00Z,2026-11-06T17:00:00Z,2026-11-05T16:00:00Z/2026-11-05T17:00:00Z/PT2M', now)).toEqual([]);
  });
});
