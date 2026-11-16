import type { Settings } from './settings';
import type { Place } from './types';

export const SETTINGS_KEY = 'sky-peek-settings';
export const SETTINGS_BACKUP_KEY = 'sky-peek-settings-backup';
export const SESSION_KEYS_KEY = 'sky-peek-session-keys';

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

export function loadSettings(storage: Reader, defaults: Settings, session?: Reader): Settings {
  let saved: Partial<Settings> | null = null;
  try {
    saved = parseSettings(storage.getItem(SETTINGS_KEY), defaults)
      ?? parseSettings(storage.getItem(SETTINGS_BACKUP_KEY), defaults);
  } catch { /* storage may be disabled */ }
  const merged = { ...defaults, ...saved };
  try {
    const transient = JSON.parse(session?.getItem(SESSION_KEYS_KEY) ?? 'null');
    if (transient && typeof transient === 'object') {
      const keys = Object.fromEntries(Object.entries(transient.keys ?? {}).filter(([id, key]) => /^\d+$/.test(id) && typeof key === 'string'));
      const verified = Object.fromEntries(Object.entries(transient.verified ?? {}).filter(([id, value]) => id in keys && typeof value === 'boolean'));
      merged.keys = { ...merged.keys, ...keys };
      merged.verified = { ...merged.verified, ...verified };
    }
  } catch { /* Invalid session credentials are ignored. */ }
  return {
    ...merged,
    types: defaults.types.map((value, index) => saved?.types?.[index] ?? value),
    delivery: defaults.delivery.map((value, index) => saved?.delivery?.[index] ?? value),
    tiers: defaults.tiers.map((value, index) => saved?.tiers?.[index] ?? value),
    screen: 'today',
    basemap: merged.basemap === 2 ? 2 : 0,
    defaultPlace: merged.places.some(place => place.id === merged.defaultPlace)
      ? merged.defaultPlace : merged.places[0].id,
    viewingPlace: merged.places.some(place => place.id === merged.viewingPlace) ? merged.viewingPlace : null,
  };
}

export function saveSettings(storage: Writer, settings: Settings, session?: Writer) {
  // Legacy remembered keys become session-only on the next save unless the
  // user explicitly chooses to remember them. Keep the active connection.
  const keys = Object.fromEntries(Object.entries(settings.keys).filter(([id]) => settings.rememberKeys?.[Number(id)]));
  const verified = Object.fromEntries(Object.entries(settings.verified).filter(([id]) => id in keys));
  try { session?.setItem(SESSION_KEYS_KEY, JSON.stringify({ keys: settings.keys, verified: settings.verified })); } catch { /* Memory-only when session storage is unavailable. */ }
  const previous = storage.getItem(SETTINGS_KEY);
  const parsed = parseSettings(previous, settings);
  if (parsed) storage.setItem(SETTINGS_BACKUP_KEY, JSON.stringify({ ...parsed, places: settings.places, keys: {}, verified: {} }));
  storage.setItem(SETTINGS_KEY, JSON.stringify({ ...settings, keys, verified }));
}
