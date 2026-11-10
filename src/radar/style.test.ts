import { describe, expect, it } from 'vitest';
import { buildStyle, SLOT } from './style';

describe('flat radar map style', () => {
  it('keeps white land, blue water, and black map linework', () => {
    const layers = buildStyle(0).layers;
    const layer = (id: string) => layers.find(x => x.id === id)!;
    expect(layer('background').paint).toMatchObject({ 'background-color': '#ffffff' });
    expect(layer('water').paint).toMatchObject({ 'fill-color': '#cfe9f8' });
    expect(layer('road-minor-edge').paint).toMatchObject({ 'line-color': '#111111' });
    expect(layer('building-outline').paint).toMatchObject({ 'line-color': '#111111' });
    expect(layer('road-name').paint).toMatchObject({ 'text-color': '#111111' });
    expect(layer('house-number').paint).toMatchObject({ 'text-color': '#111111' });
    expect(layers.findIndex(x => x.id === 'building-outline')).toBeGreaterThan(layers.findIndex(x => x.id === SLOT));
  });

  it('does not add imagery to the flat style', () => {
    expect(buildStyle(0).sources).not.toHaveProperty('imagery');
    expect(buildStyle(2).sources).toHaveProperty('imagery');
  });

  it('renders the retired Streets preference as Flat', () => {
    expect(buildStyle(1)).toEqual(buildStyle(0));
  });
});
