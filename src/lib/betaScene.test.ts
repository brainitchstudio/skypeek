import { describe, expect, it } from 'vitest';
import { parseScene, pickScene } from './betaScene';

describe('beta scene', () => {
  it('accepts an existing weather scene and rejects invalid values', () => {
    expect(parseScene('night', 'snow')).toEqual({ time: 'night', weather: 'snow' });
    expect(parseScene('night', 'unknown')).toBeNull();
    expect(parseScene('invalid', 'rain')).toBeNull();
    expect(pickScene('morning', 'clear')).toEqual({ time: 'morning', weather: 'clear' });
  });
});
