import { describe, expect, it } from 'vitest';
import type { StormObject } from '@/lib/probSevere';
import { outlineFeatures } from './stormOutlines';

const storm = (id: string) => ({ id, ring: [[0, 0], [1, 0], [1, 1], [0, 0]] }) as StormObject;

describe('outlineFeatures', () => {
  it('maps storms to polygons and marks the selected one', () => {
    const [a, b] = outlineFeatures([storm('1'), storm('2')], '2');
    expect(a.properties).toEqual({ id: '1', selected: false });
    expect(b.properties).toEqual({ id: '2', selected: true });
    expect(a.geometry.coordinates[0]).toEqual(storm('1').ring);
  });
  it('selects nothing with no ID', () => {
    expect(outlineFeatures([storm('1')], null)[0].properties.selected).toBe(false);
  });
});
