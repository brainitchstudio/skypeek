export const TOUR_KEY = 'sky-peek-tour-complete';
export const LOCATION_KEY = 'sky-peek-onboarding-location-chosen';
export const VERSION_KEY = 'sky-peek-last-seen-version';
const LEGACY_TOUR_KEY = 'sky-peek-tour-complete-v1';
const LEGACY_TOUR_KEY_V3 = 'sky-peek-tour-complete-v3';
const LEGACY_TOUR_PREFIX = 'sky-peek-tour-complete-v2:';

export function hasCompletedTour(storage: Pick<Storage, 'getItem' | 'setItem' | 'length' | 'key'>): boolean {
  if (storage.getItem(TOUR_KEY) === 'yes') return true;

  if (storage.getItem(LEGACY_TOUR_KEY_V3) === 'yes') {
    try { storage.setItem(TOUR_KEY, 'yes'); } catch { /* still honor the old completion */ }
    return true;
  }

  if (storage.getItem(LEGACY_TOUR_KEY) === 'yes') {
    try { storage.setItem(TOUR_KEY, 'yes'); } catch { /* still honor the old completion */ }
    return true;
  }

  // Every older release wrote this only after finishing or skipping the tour.
  // Keep that completion even if its separate marker was lost during an update.
  if (/^\d+\.\d+\.\d+$/.test(storage.getItem(VERSION_KEY) ?? '')) {
    try { storage.setItem(TOUR_KEY, 'yes'); } catch { /* still honor completion */ }
    return true;
  }

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

export function hasChosenLocation(storage: Pick<Storage, 'getItem'>): boolean {
  return storage.getItem(LOCATION_KEY) === 'yes';
}

export function markLocationChosen(storage: Pick<Storage, 'setItem'>) {
  storage.setItem(LOCATION_KEY, 'yes');
}
