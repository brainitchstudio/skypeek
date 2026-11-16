import { describe, expect, it } from 'vitest';
import { bearingFrom, describeLocation, distanceM, gpsErrorMessage, shouldAcceptFix } from './locationDescription';

const town = { name: 'Ozark, AR', distanceM: 20_000, bearing: 90 };
const fix = { lat: 35.5, lon: -93.8, accuracy: 20, at: 100_000 };

describe('natural location descriptions', () => {
  it('uses a town as a nearby reference, never infers city containment', () => {
    expect(describeLocation({ town: { ...town, distanceM: 100 } }, 20, 'F').name).toBe('Near Ozark, AR');
  });
  it('gives rural distance and direction in the preferred units', () => {
    expect(describeLocation({ town }, 20, 'F').detail).toBe('About 12 miles east of town');
    expect(describeLocation({ town }, 20, 'C').detail).toBe('About 20 km east of town');
    expect(describeLocation({ town: { ...town, bearing: 359 } }, 20, 'F').detail).toContain('north');
  });
  it('uses roads and nearby landmarks only with suitable device accuracy', () => {
    expect(describeLocation({ town, road: 'I-40' }, 20, 'F')).toEqual({ name: 'Near Ozark, AR', detail: 'Along I-40' });
    expect(describeLocation({ town, landmark: 'Rest Area' }, 20, 'F').name).toBe('Near Rest Area');
    expect(describeLocation({ town, road: 'I-40', landmark: 'Rest Area' }, 2000, 'F')).toEqual({ name: 'Near Ozark, AR', detail: '' });
    expect(describeLocation({ town, road: 'I-40', landmark: 'Rest Area' }, 80, 'F').name).toBe('Near Ozark, AR');
    expect(describeLocation({ town, road: 'I-40' }, 500, 'F').detail).not.toContain('I-40');
  });
  it('falls back to a county, then a clear unnamed-location state', () => {
    expect(describeLocation({ region: 'Madison County, AR' }, 20, 'F').name).toBe('Madison County, AR');
    expect(describeLocation({}, 20, 'F')).toEqual({ name: 'Your location', detail: 'Place name unavailable' });
  });
  it('calculates reference-to-device direction and physical distance', () => {
    expect(bearingFrom({ lat: 0, lon: 0 }, { lat: 1, lon: 0 })).toBeCloseTo(0);
    expect(bearingFrom({ lat: 0, lon: 0 }, { lat: 0, lon: 1 })).toBeCloseTo(90);
    expect(distanceM({ lat: 0, lon: 0 }, { lat: 0, lon: 1 })).toBeCloseTo(111195, -1);
  });
});

describe('device movement policy', () => {
  it('accepts initial fixes and rejects malformed or out-of-order fixes', () => {
    expect(shouldAcceptFix(null, fix)).toBe(true);
    expect(shouldAcceptFix(null, { ...fix, lat: NaN })).toBe(false);
    expect(shouldAcceptFix(null, { ...fix, accuracy: -1 })).toBe(false);
    expect(shouldAcceptFix(fix, { ...fix, at: 0 })).toBe(false);
  });
  it('ignores drift and frequent movement but accepts meaningful travel', () => {
    expect(shouldAcceptFix(fix, { ...fix, lat: 35.5001, at: 180_000 })).toBe(false);
    expect(shouldAcceptFix(fix, { ...fix, lat: 35.6, at: 110_000 })).toBe(false);
    expect(shouldAcceptFix(fix, { ...fix, lat: 35.6, at: 180_000 })).toBe(true);
    expect(shouldAcceptFix({ ...fix, accuracy: 5000 }, { ...fix, lat: 35.51, accuracy: 5000, at: 180_000 })).toBe(false);
  });
  it('accepts substantially improved accuracy and a foreground reacquisition', () => {
    expect(shouldAcceptFix({ ...fix, accuracy: 5000 }, fix)).toBe(true);
    expect(shouldAcceptFix(fix, { ...fix, lat: 36 }, true)).toBe(true);
  });
  it('distinguishes permission, timeout and unavailable failures', () => {
    expect(gpsErrorMessage(1)).toContain('blocked');
    expect(gpsErrorMessage(3)).toContain('timed out');
    expect(gpsErrorMessage(2)).toContain('could not determine');
  });
});
