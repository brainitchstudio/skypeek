import type { Settings } from './settings';
import type { Place } from './types';

export const SETTINGS_KEY = 'sky-peek-settings';
export const SETTINGS_BACKUP_KEY = 'sky-peek-settings-backup';

type Reader = Pick<Storage, 'getItem'>;
type Writer = Pick<Storage, 'getItem' | 'setItem'>;

function validPlace(value: unknown): value is Place {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const place = value as Partial<Place>;
  return typeof place.id === 'string' && !!place.id && typeof place.name === 'string' && !!place.name
    && typeof place.region === 'string' && typeof place.lat === 'number' && Number.isFinite(place.lat)
    && place.lat >= -90 && place.lat <= 90 && typeof place.lon === 'number'
    && Number.isFinite(place.lon) && place.lon >= -180 && place.lon <= 180
    && (place.favorite === undefined || typeof place.favorite === 'boolean');
}

function parseSettings(raw: string | null, defaults: Settings): Partial<Settings> | null {
  if (!raw) return null;
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return null; }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const saved = value as Record<string, unknown>;
  for (const [key, fallback] of Object.entries(defaults)) {
    const current = saved[key];
    if (current === undefined) continue;
    if (key === 'places') {
      if (!Array.isArray(current) || !current.length || !current.every(validPlace)) return null;
    } else if (Array.isArray(fallback)) {
      if (!Array.isArray(current) || current.some(item => typeof item !== typeof fallback[0])) return null;
    } else if (fallback === null) {
      if (current !== null && typeof current !== 'string') return null;
    } else if (typeof fallback === 'object') {
      if (!current || typeof current !== 'object' || Array.isArray(current)) return null;
    } else if (typeof current !== typeof fallback || (typeof current === 'number' && !Number.isFinite(current))) {
      return null;
    }
  }
  return saved as Partial<Settings>;
}

export function loadSettings(storage: Reader, defaults: Settings): Settings {
  let saved: Partial<Settings> | null = null;
  try {
    saved = parseSettings(storage.getItem(SETTINGS_KEY), defaults)
      ?? parseSettings(storage.getItem(SETTINGS_BACKUP_KEY), defaults);
  } catch { /* storage may be disabled */ }
  const merged = { ...defaults, ...saved };
  return {
    ...merged,
    types: defaults.types.map((value, index) => saved?.types?.[index] ?? value),
    delivery: defaults.delivery.map((value, index) => saved?.delivery?.[index] ?? value),
    tiers: defaults.tiers.map((value, index) => saved?.tiers?.[index] ?? value),
    screen: 'today',
    basemap: merged.basemap === 2 ? 2 : 0,
    defaultPlace: merged.places.some(place => place.id === merged.defaultPlace)
      ? merged.defaultPlace : merged.places[0].id,
  };
}

export function saveSettings(storage: Writer, settings: Settings) {
  const previous = storage.getItem(SETTINGS_KEY);
  const parsed = parseSettings(previous, settings);
  if (parsed) storage.setItem(SETTINGS_BACKUP_KEY, JSON.stringify({ ...parsed, keys: {}, verified: {} }));
  storage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}
