import { describe, expect, it } from 'vitest';
import { mapAlert, type NwsAlertFeature } from './alerts';

const ONE = '2026-11-06T20:19:00-00:00...storm...236DEG...14KT...32.04,-109.85';
const feature = (p: Partial<NwsAlertFeature['properties']> = {}): NwsAlertFeature => ({
  id: 'urn:a', geometry: null,
  properties: { event: 'Severe Thunderstorm Warning', areaDesc: 'Cochise', ...p },
});

describe('mapAlert', () => {
  it('keeps the motion text and end time', () => {
    const a = mapAlert(feature({ parameters: { eventMotionDescription: [ONE] }, ends: null, expires: '2026-11-06T21:00:00Z' }), 'UTC');
    expect(a).toMatchObject({ motionText: ONE, endsAt: Date.parse('2026-11-06T21:00:00Z') });
  });
  it('leaves them empty when the alert gives none', () => {
    expect(mapAlert(feature(), 'UTC')).toMatchObject({ motionText: undefined, endsAt: null, cancelled: false });
  });
  it('marks a cancellation', () => {
    expect(mapAlert(feature({ messageType: 'Cancel' }), 'UTC').cancelled).toBe(true);
  });
  it('maps SAME county codes to five-digit FIPS codes', () => {
    expect(mapAlert(feature({ geocode: { SAME: ['017031', '117031', 'invalid'] } }), 'UTC').countyFips).toEqual(['17031']);
  });
});
