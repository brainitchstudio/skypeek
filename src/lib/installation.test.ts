import { afterEach, expect, it, vi } from 'vitest';
import { configDirectory } from './installation';
import { defaultHomeContent, validateHomeContent } from './homeContent';

afterEach(() => vi.unstubAllEnvs());

it('stores Hostinger setup outside the replaced deployment folder', () => {
  vi.stubEnv('SKY_PEEK_DATA_DIR', '');
  expect(configDirectory('/home/user/domains/skypeek.brainitch.studio/hbuilds/current/nodejs'))
    .toBe('/home/user/domains/skypeek.brainitch.studio/.sky-peek-data');
  expect(configDirectory('/home/user/domains/skypeek.brainitch.studio/hbuilds/versions/123/nodejs'))
    .toBe('/home/user/domains/skypeek.brainitch.studio/.sky-peek-data');
});

it('allows a private data location override for other hosts', () => {
  vi.stubEnv('SKY_PEEK_DATA_DIR', '/private/sky-peek');
  expect(configDirectory('/app')).toBe('/private/sky-peek');
});

it('accepts complete homepage edits and rejects missing or oversized text', () => {
  expect(validateHomeContent(defaultHomeContent)).toEqual(defaultHomeContent);
  expect(validateHomeContent({ ...defaultHomeContent, headline: '' })).toBeNull();
  expect(validateHomeContent({ ...defaultHomeContent, forecast: 'x'.repeat(501) })).toBeNull();
});
