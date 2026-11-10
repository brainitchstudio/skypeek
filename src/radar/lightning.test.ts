import { describe, expect, it } from 'vitest';
import { LIGHTNING_SAFETY_MI, mapLightning, mapOpenWeatherLightning, nearestStrike } from './lightning';

const NOW = Date.parse('2026-11-05T20:00:00Z');

describe('lightning reports', () => {
  it('maps OpenWeather events and excludes stale or invalid coordinates', () => {
    const strikes = mapOpenWeatherLightning({ lightnings: [
      { id: 'recent', datetime: '2026-11-05T19:55:00Z', lat: 41, lon: -87, quality: 'good', error: 4.8 },
      { id: 'old', datetime: '2026-11-05T19:40:00Z', lat: 41, lon: -87 },
      { id: 'bad', datetime: '2026-11-05T19:55:00Z', lat: 100, lon: -87 },
    ] }, NOW);
    expect(strikes).toHaveLength(1);
    expect(strikes[0]).toMatchObject({ id: 'recent', source: 'OpenWeather', quality: 'good', accuracyMi: expect.closeTo(2.9826, 3) });
  });

  it('uses aligned provider fields and computes distance from the saved place', () => {
    const strikes = mapLightning({ lightning: {
      latitude: [41, 42], longitude: [-87, -87], validTimeUtc: ['2026-11-05T19:58:00Z', '2026-11-05T19:58:00Z'],
      strikeTypeCode: [0, 1], intensity: [-10000, 5000], errorMajor: [1, 2],
    } }, NOW);
    expect(strikes).toHaveLength(2);
    expect(strikes[0]).toMatchObject({ kind: 'ground', intensity: -10000, source: 'The Weather Company' });
    expect(nearestStrike(strikes, 41.05, -87)?.miles).toBeLessThan(LIGHTNING_SAFETY_MI);
    expect(nearestStrike(strikes, 40, -87)?.miles).toBeGreaterThan(LIGHTNING_SAFETY_MI);
  });
});
