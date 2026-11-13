import { describe, expect, it } from 'vitest';
import { hasChosenLocation, hasCompletedTour, markLocationChosen, markTourComplete, TOUR_KEY } from './onboardingState';

function storage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    get length() { return values.size; },
    key(index: number) { return [...values.keys()][index] ?? null; },
    getItem(key: string) { return values.get(key) ?? null; },
    setItem(key: string, value: string) { values.set(key, value); },
  };
}

describe('onboarding completion', () => {
  it('keeps the original completed tour after an app update', () => {
    const saved = storage({ 'sky-peek-tour-complete-v1': 'yes' });
    expect(hasCompletedTour(saved)).toBe(true);
    expect(saved.getItem(TOUR_KEY)).toBe('yes');
  });

  it('stays complete when a beta identity changes or expires', () => {
    const saved = storage({ 'sky-peek-tour-complete-v2:old-identity': 'yes' });
    expect(hasCompletedTour(saved)).toBe(true);
    expect(saved.getItem(TOUR_KEY)).toBe('yes');
    expect(hasCompletedTour(saved)).toBe(true);
  });

  it('does not confuse an unfinished legacy tour with a completed one', () => {
    const saved = storage({ 'sky-peek-tour-complete-v2:old-identity': 'no' });
    expect(hasCompletedTour(saved)).toBe(false);
    markTourComplete(saved);
    expect(hasCompletedTour(saved)).toBe(true);
  });

  it('remembers a confirmed location separately from tour completion', () => {
    const saved = storage();
    markLocationChosen(saved);
    expect(hasChosenLocation(saved)).toBe(true);
    expect(hasCompletedTour(saved)).toBe(false);
  });
});
