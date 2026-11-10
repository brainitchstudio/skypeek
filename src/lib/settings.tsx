'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Units } from './format';
import type { Place } from './types';

export type Screen = 'today' | 'hourly' | 'days' | 'radar' | 'alerts' | 'alertDetail' | 'settings';
export type SettingsTab = 'general' | 'alerts' | 'locations' | 'radar' | 'data';

const DEFAULTS = {
  screen: 'today' as Screen,
  day: 0,
  alertId: null as string | null,
  setTab: 'alerts' as SettingsTab,
  mode: 'types' as 'types' | 'tiers',
  types: [true, true, true, true, true, true, false, true, false],
  delivery: [true, false, false], // banner, system notification, sound
  tiers: [0, 0, 1],
  gps: false,
  places: [
    { id: 'brooklyn', name: 'Brooklyn, NY', region: 'Kings County', lat: 40.6782, lon: -73.9442 },
    { id: 'manhattan', name: 'Manhattan, NY', region: 'New York County', lat: 40.7831, lon: -73.9712 },
    { id: 'chicago', name: 'Chicago, IL', region: 'Cook County', lat: 41.8781, lon: -87.6298 },
    { id: 'portland-me', name: 'Portland, ME', region: 'Cumberland County', lat: 43.6591, lon: -70.2568 },
  ] as Place[],
  defaultPlace: 'brooklyn',
  provider: 0,
  keys: {} as Record<number, string>,
  verified: {} as Record<number, boolean>,
  refreshI: 1,
  basemap: 0,
  radarSrc: 4, // 0 demo, 1 RainViewer, 2 OpenWeather, 3 Tomorrow.io, 4 NOAA national, 5 NOAA station
  radarStation: '', // empty selects nearest to the forecast location
  radarProduct: 'sr_bref',
  radarForecastHours: 6, // 2, 6 or 18
  units: 'F' as Units,
};

export type Settings = typeof DEFAULTS;
export type SetSettings = (patch: Partial<Settings> | ((s: Settings) => Partial<Settings>)) => void;

const KEY = 'sky-peek-settings';

function load(): Settings {
  try {
    const saved = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') } as Settings;
    return { ...saved, screen: 'today', basemap: saved.basemap === 2 ? 2 : 0 };
  } catch {
    return DEFAULTS;
  }
}

const Ctx = createContext<{ s: Settings; set: SetSettings } | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [s, setState] = useState(load);
  const set = useCallback<SetSettings>(patch => {
    setState(cur => ({ ...cur, ...(typeof patch === 'function' ? patch(cur) : patch) }));
  }, []);
  useEffect(() => { localStorage.setItem(KEY, JSON.stringify(s)); }, [s]);
  const value = useMemo(() => ({ s, set }), [s, set]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSettings() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSettings needs SettingsProvider');
  return v;
}

export const REFRESH_OPTIONS: [string, number][] = [['5 min', 5], ['15 min', 15], ['30 min', 30], ['1 hr', 60]];
