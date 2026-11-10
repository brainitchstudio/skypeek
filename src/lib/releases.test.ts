import { describe, expect, it } from 'vitest';
import { APP_VERSION, compareVersions, unseenReleases } from './releases';

describe('beta onboarding versions', () => {
  it('compares numeric versions rather than text', () => {
    expect(compareVersions('0.10.0', '0.9.0')).toBe(1);
    expect(compareVersions('0.2.0', '0.2')).toBe(0);
    expect(compareVersions('0.1.9', '0.2.0')).toBe(-1);
  });

  it('shows release notes only for newer versions', () => {
    expect(unseenReleases('0.1.0').map(release => release.version)).toContain(APP_VERSION);
    expect(unseenReleases(APP_VERSION)).toEqual([]);
    expect(unseenReleases('9.0.0')).toEqual([]);
  });
});
