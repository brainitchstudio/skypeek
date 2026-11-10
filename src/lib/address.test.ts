import { describe, expect, it } from 'vitest';
import { censusPlaces, looksLikeStreetAddress } from './address';

describe('radar address lookup', () => {
  it('recognizes street addresses without diverting city or ZIP searches', () => {
    expect(looksLikeStreetAddress('1600 Pennsylvania Ave NW, Washington, DC')).toBe(true);
    expect(looksLikeStreetAddress('Chicago')).toBe(false);
    expect(looksLikeStreetAddress('60601')).toBe(false);
  });

  it('keeps only valid Census coordinate matches', () => {
    expect(censusPlaces([
      { matchedAddress: '1600 PENNSYLVANIA AVE NW, WASHINGTON, DC, 20500', coordinates: { x: -77.0365, y: 38.8977 } },
      { matchedAddress: 'Bad', coordinates: { x: 200, y: 0 } },
    ])).toEqual([{
      id: 'census:1600 pennsylvania ave nw, washington, dc, 20500',
      name: '1600 PENNSYLVANIA AVE NW, WASHINGTON, DC, 20500',
      region: 'US street address · approximate', lat: 38.8977, lon: -77.0365,
    }]);
  });
});
