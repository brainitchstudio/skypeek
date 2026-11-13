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
    expect(saved.units).toBe('C');
    expect(saved.screen).toBe('today');
    expect(saved.radarForecastHours).toBe(DEFAULTS.radarForecastHours);
    expect(saved.delivery).toEqual([false, ...DEFAULTS.delivery.slice(1)]);
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
});
