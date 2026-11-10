import { describe, expect, it } from 'vitest';
import { orderPlaces, savePlace, toggleFavorite } from './places';
import type { Place } from './types';

const place = (id: string, o: Partial<Place> = {}): Place => ({ id, name: id, region: '', lat: id.charCodeAt(0), lon: 1, ...o });

describe('places', () => {
  it('lists favorites first and keeps saved order otherwise', () => {
    const list = [place('a'), place('b', { favorite: true }), place('c'), place('d', { favorite: true })];
    expect(orderPlaces(list).map(p => p.id)).toEqual(['b', 'd', 'a', 'c']);
  });

  it('does not save the same place twice, even under a different id', () => {
    const list = [place('a')];
    expect(savePlace(list, place('a'))).toBe(list);
    expect(savePlace(list, { ...place('a'), id: 'other' })).toBe(list);
    expect(savePlace(list, place('b'))).toHaveLength(2);
  });

  it('starring an unsaved place saves it as a favorite', () => {
    const [p] = toggleFavorite([], place('a'));
    expect(p.favorite).toBe(true);
  });

  it('unstarring keeps the place saved', () => {
    const list = toggleFavorite([place('a', { favorite: true })], place('a'));
    expect(list).toHaveLength(1);
    expect(list[0].favorite).toBe(false);
  });
});
