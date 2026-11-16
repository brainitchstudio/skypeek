import { describe, expect, it } from 'vitest';
import { DEFAULTS } from './settings';
import { loadSettings, saveSettings, SETTINGS_BACKUP_KEY, SETTINGS_KEY } from './settingsPersistence';

function storage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key: string) { return values.get(key) ?? null; },
    setItem(key: string, value: string) { values.set(key, value); },
  };
}

const home = { id: 'home', name: 'Bentonville, AR', region: 'Benton County', lat: 36.37, lon: -94.21 };

describe('browser settings persistence', () => {
  it('loads a returning visitor after an app update and fills new defaults', () => {
    const old = { places: [home], defaultPlace: home.id, units: 'C', screen: 'radar', delivery: [false] };
    const saved = loadSettings(storage({ [SETTINGS_KEY]: JSON.stringify(old) }), DEFAULTS);
    expect(saved.places).toEqual([home]);
    expect(saved.defaultPlace).toBe(home.id);
    expect(saved.viewingPlace).toBeNull();
    expect(saved.units).toBe('C');
    expect(saved.screen).toBe('today');
    expect(saved.radarForecastHours).toBe(DEFAULTS.radarForecastHours);
    expect(saved.delivery).toEqual([false, ...DEFAULTS.delivery.slice(1)]);
  });

  it('keeps the viewing selection separate from the main saved place and GPS preference', () => {
    const away = { ...home, id: 'away', name: 'Tulsa, OK', lat: 36.15, lon: -95.99 };
    const selected = { ...DEFAULTS, places: [home, away], defaultPlace: home.id, viewingPlace: away.id, gps: false };
    const loaded = loadSettings(storage({ [SETTINGS_KEY]: JSON.stringify(selected) }), DEFAULTS);
    expect(loaded.defaultPlace).toBe(home.id);
    expect(loaded.viewingPlace).toBe(away.id);
    expect(loaded.gps).toBe(false);
    expect(loadSettings(storage({ [SETTINGS_KEY]: JSON.stringify({ ...selected, gps: true }) }), DEFAULTS).gps).toBe(true);
  });

  it('falls back to the main place when a previously viewed saved place was removed', () => {
    const loaded = loadSettings(storage({ [SETTINGS_KEY]: JSON.stringify({ places: [home], defaultPlace: home.id, viewingPlace: 'removed' }) }), DEFAULTS);
    expect(loaded.viewingPlace).toBeNull();
    expect(loaded.defaultPlace).toBe(home.id);
  });

  it('recovers a selected place and preferences from the previous valid save', () => {
    const previous = { ...DEFAULTS, places: [home], defaultPlace: home.id, units: 'C' as const };
    const saved = storage({ [SETTINGS_KEY]: '{broken json', [SETTINGS_BACKUP_KEY]: JSON.stringify(previous) });
    const recovered = loadSettings(saved, DEFAULTS);
    expect(recovered.places).toEqual([home]);
    expect(recovered.units).toBe('C');
    saveSettings(saved, recovered);
    expect(loadSettings(saved, DEFAULTS).places).toEqual([home]);
  });

  it('keeps a valid previous copy before updating settings', () => {
    const saved = storage();
    const first = { ...DEFAULTS, places: [home], defaultPlace: home.id };
    saveSettings(saved, first);
    saveSettings(saved, { ...first, units: 'C' });
    expect(JSON.parse(saved.getItem(SETTINGS_BACKUP_KEY)!)).toEqual(first);
    expect(loadSettings(saved, DEFAULTS).units).toBe('C');
  });

  it('does not retain provider keys in the previous copy', () => {
    const saved = storage();
    const first = { ...DEFAULTS, keys: { 1: 'private-key' }, verified: { 1: true } };
    saveSettings(saved, first);
    saveSettings(saved, { ...first, keys: {}, verified: {} });
    const backup = JSON.parse(saved.getItem(SETTINGS_BACKUP_KEY)!);
    expect(backup.keys).toEqual({});
    expect(backup.verified).toEqual({});
  });

  it('keeps unremembered keys only in session storage, including legacy keys', () => {
    const local = storage();
    const session = storage();
    const settings = { ...DEFAULTS, keys: { 1: 'session-key' }, verified: { 1: true } };
    saveSettings(local, settings, session);
    expect(JSON.parse(local.getItem(SETTINGS_KEY)!).keys).toEqual({});
    expect(loadSettings(local, DEFAULTS, session).keys).toEqual({ 1: 'session-key' });
    expect(loadSettings(local, DEFAULTS, storage()).keys).toEqual({});
    saveSettings(local, { ...settings, rememberKeys: { 1: true } }, session);
    expect(loadSettings(local, DEFAULTS, storage()).keys).toEqual({ 1: 'session-key' });
    saveSettings(local, { ...settings, keys: {}, verified: {} }, session);
    expect(loadSettings(local, DEFAULTS, session).keys).toEqual({});
  });

  it('does not recover a removed place from the settings backup', () => {
    const local = storage();
    saveSettings(local, { ...DEFAULTS, places: [...DEFAULTS.places, home] });
    saveSettings(local, DEFAULTS);
    expect(JSON.parse(local.getItem(SETTINGS_BACKUP_KEY)!).places).toEqual(DEFAULTS.places);
  });
});
