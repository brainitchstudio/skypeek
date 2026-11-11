import { describe, expect, it } from 'vitest';
import { timeForPlace, weatherForPlace } from './todayScene';

describe('Today background scene', () => {
  it('uses the active place time zone instead of the device clock', () => {
    const instant = new Date('2026-11-11T01:00:00Z');
    expect(timeForPlace(instant, 'America/Chicago')).toBe('evening');
    expect(timeForPlace(instant, 'Europe/London')).toBe('night');
    expect(timeForPlace(instant, 'Asia/Tokyo')).toBe('morning');
  });

  it('honors the forecast daylight flag near sunrise and sunset', () => {
    expect(timeForPlace(new Date('2026-11-11T13:00:00Z'), 'America/Chicago', false)).toBe('night');
  });

  it('prioritizes active events over wind and heat', () => {
    expect(weatherForPlace('Thunderstorms and rain', 30, 100)).toBe('storm');
    expect(weatherForPlace('Freezing rain', 30, 100)).toBe('sleet');
    expect(weatherForPlace('Hail', 30, 100)).toBe('hail');
    expect(weatherForPlace('Light snow', 30, 100)).toBe('snow');
    expect(weatherForPlace('Light drizzle', 30, 100)).toBe('drizzle');
    expect(weatherForPlace('Showers', 30, 100)).toBe('rain');
  });

  it('uses fair weather accents and avoids treating chances as active rain', () => {
    expect(weatherForPlace('Clear', 28, 100)).toBe('windy');
    expect(weatherForPlace('Sunny', 2, 99)).toBe('heat');
    expect(weatherForPlace('Chance Rain Showers', 3, 65, true)).toBe('cloudy');
    expect(weatherForPlace('Chance Rain Showers', 3, 65, false)).toBe('rain');
    expect(weatherForPlace('Partly cloudy', 2, 70)).toBe('partly');
  });
});
