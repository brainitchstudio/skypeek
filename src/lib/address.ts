import type { Place } from './types';

type CensusMatch = {
  matchedAddress?: string;
  coordinates?: { x?: number; y?: number };
};

/** Census returns a street-range estimate, not a surveyed building entrance. */
export function censusPlaces(matches: CensusMatch[]): Place[] {
  return matches.flatMap(match => {
    const name = match.matchedAddress?.trim();
    const lat = match.coordinates?.y, lon = match.coordinates?.x;
    if (!name || typeof lat !== 'number' || typeof lon !== 'number' ||
      !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return [];
    return [{ id: `census:${name.toLowerCase()}`, name, region: 'US street address · approximate', lat, lon }];
  });
}

export const looksLikeStreetAddress = (query: string) => /^\s*\d+[a-z]?\s+\S/i.test(query);
