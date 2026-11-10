import { describe, expect, it } from 'vitest';
import { parseWarningMotion } from './warningMotion';

// Real NWS values captured on 2026-11-06.
const ONE = '2026-11-06T20:19:00-00:00...storm...236DEG...14KT...32.04,-109.85';
const LINE = '2026-11-03T19:31:00-00:00...storm...236DEG...21KT...32.42,-93.38 32.41,-93.34 32.37,-93.29 32.3,-93.3 32.23,-93.34';
const LATER = '2026-11-03T20:00:00-00:00...storm...236DEG...21KT...32.52,-93.21 32.51,-93.17 32.46,-93.12 32.4,-93.13 32.32,-93.17';

describe('parseWarningMotion', () => {
  it('parses one point', () => expect(parseWarningMotion(ONE)).toMatchObject({ heading: 56, points: [{ lat: 32.04, lon: -109.85 }], at: Date.parse('2026-11-06T20:19:00Z') }));
  it('converts knots to mph', () => expect(parseWarningMotion(ONE)!.mph).toBeCloseTo(16.11, 2));
  it('parses a line', () => expect(parseWarningMotion(LINE)!.points).toHaveLength(5));
  it('points the heading where the storm went', () => {
    // The same storm 29 minutes later sits along the flipped heading, which proves 236DEG means "from".
    const a = parseWarningMotion(LINE)!, b = parseWarningMotion(LATER)!;
    const north = b.points[0].lat - a.points[0].lat, east = (b.points[0].lon - a.points[0].lon) * Math.cos(32.4 * Math.PI / 180);
    expect(Math.abs((Math.atan2(east, north) * 180 / Math.PI + 360) % 360 - a.heading)).toBeLessThan(10);
  });
  it.each([undefined, '', 'nonsense', '2026-11-06T20:19:00-00:00...storm...236DEG...14KT...', 'bad-date...storm...236DEG...14KT...32.04,-109.85', '2026-11-06T20:19:00-00:00...storm...236DEG...14KT...95.0,-109.85', '2026-11-06T20:19:00-00:00...storm...236DEG...14KT...32.04,', '2026-11-06T20:19:00-00:00...storm...999DEG...14KT...32.04,-109.85'])
    ('refuses %s', text => expect(parseWarningMotion(text)).toBeNull());
});
