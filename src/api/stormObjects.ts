// The radar mode's storm outlines, read through our own route because the feed sends no cross-origin header.

import type { StormFeed } from '@/lib/probSevere';
import { remaining, spend } from './budget';

export const MAX_FEED_AGE_MS = 20 * 60_000; // past this the feed has stalled: don't push old outlines forward

export function validFeed(json: unknown, now: number): StormFeed {
  const feed = json as Partial<StormFeed> | null;
  if (!feed || typeof feed.at !== 'number' || !Array.isArray(feed.storms)) throw new Error('Invalid storm outlines');
  if (now - feed.at > MAX_FEED_AGE_MS) throw new Error('Storm outlines are stale');
  return feed as StormFeed;
}

/** What to keep after a failed fetch: the last feed, until it's too old to pick from. */
export const keepFeed = (feed: StormFeed | null, now: number) => (feed && now - feed.at <= MAX_FEED_AGE_MS ? feed : null);

export async function getStormObjects(signal?: AbortSignal, now = Date.now()): Promise<StormFeed> {
  if (remaining('probsevere') < 1) throw new Error('Storm outline budget reached');
  spend('probsevere');
  const r = await fetch('/api/storm-objects', { signal });
  if (!r.ok) throw new Error(`Storm outlines failed: ${r.status}`);
  return validFeed(await r.json(), now);
}
