export const TOUR_KEY = 'sky-peek-tour-complete-v3';
const LEGACY_TOUR_PREFIX = 'sky-peek-tour-complete-v2:';

export function hasCompletedTour(storage: Pick<Storage, 'getItem' | 'setItem' | 'length' | 'key'>): boolean {
  if (storage.getItem(TOUR_KEY) === 'yes') return true;

  // Earlier releases tied completion to the beta code. Carry any completed
  // tour forward when a tester renews access or the identity cookie expires.
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key?.startsWith(LEGACY_TOUR_PREFIX) && storage.getItem(key) === 'yes') {
      try { storage.setItem(TOUR_KEY, 'yes'); } catch { /* still honor the old completion */ }
      return true;
    }
  }
  return false;
}

export function markTourComplete(storage: Pick<Storage, 'setItem'>) {
  storage.setItem(TOUR_KEY, 'yes');
}
