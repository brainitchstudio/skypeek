import { describe, expect, it, vi } from 'vitest';
import { keepFeed, validFeed } from './stormObjects';

vi.mock('./budget', () => ({ remaining: vi.fn(() => 100), spend: vi.fn() }));

const NOW = 1_800_000_000_000, MIN = 60_000;

describe('validFeed', () => {
  it('rejects a feed older than 20 minutes', () => {
    expect(() => validFeed({ at: NOW - 21 * MIN, storms: [] }, NOW)).toThrow();
  });
  it('accepts a feed exactly 20 minutes old', () => {
    expect(validFeed({ at: NOW - 20 * MIN, storms: [] }, NOW).storms).toEqual([]);
  });
  it('rejects a feed with no storm list', () => {
    expect(() => validFeed({ at: NOW }, NOW)).toThrow();
    expect(() => validFeed(null, NOW)).toThrow();
  });
});

describe('keepFeed', () => {
  const feed = (at: number) => ({ at, storms: [] });
  it('keeps a recent feed through a failed fetch', () => {
    expect(keepFeed(feed(NOW - 19 * MIN), NOW)).not.toBeNull();
  });
  it('drops a feed that has gone stale, so nobody picks from a dead feed', () => {
    expect(keepFeed(feed(NOW - 21 * MIN), NOW)).toBeNull();
    expect(keepFeed(null, NOW)).toBeNull();
  });
});
