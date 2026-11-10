import type { Place } from './types';

const same = (a: Place, b: Place) => a.id === b.id || (a.lat === b.lat && a.lon === b.lon);

export const findSaved = (places: Place[], p: Place) => places.find(x => same(x, p));

/** Favorites first, otherwise in the order they were saved. */
export const orderPlaces = (places: Place[]) => [...places].sort((a, b) => Number(!!b.favorite) - Number(!!a.favorite));

export const savePlace = (places: Place[], p: Place) => (findSaved(places, p) ? places : [...places, p]);

/** Stars a place, saving it first if needed; unstarring keeps it saved. */
export function toggleFavorite(places: Place[], p: Place) {
  const saved = findSaved(places, p);
  if (!saved) return [...places, { ...p, favorite: true }];
  return places.map(x => (x === saved ? { ...x, favorite: !x.favorite } : x));
}
