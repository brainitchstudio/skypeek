'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { readSnapshot, tick, type AlertFeed, type NowConditions, type SourceStatus, type WeatherRequest, type WeatherSnapshot } from '@/weather/service';
import { ALERT_POLL_MS } from '@/weather/config';
import type { Provider } from '@/weather/types';
import { routeAlert } from './alerts';
import { REFRESH_OPTIONS, type Settings } from './settings';
import type { Forecast, Place, WeatherAlert } from './types';

export type Weather = {
  forecast: Forecast | null;
  alerts: WeatherAlert[];
  alertFeed: AlertFeed;
  now: NowConditions | null;
  sources: SourceStatus[];
  loading: boolean;
  error: string | null;
  updatedAt: Date | null;
  /** When the shown forecast is from, if it should be newer by now. */
  staleSince: Date | null;
  refresh: () => void;
};

const PROVIDER_AT: Record<number, Provider> = { 1: 'openweather', 2: 'tomorrow', 3: 'weatherapi' };

export function useWeather(place: Place, s: Settings): Weather {
  const [snap, setSnap] = useState<WeatherSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const run = useRef(0);
  const minutes = REFRESH_OPTIONS[s.refreshI]?.[1] ?? 15;

  // Only keys that passed their connection test take part.
  const keysId = JSON.stringify(Object.fromEntries(
    Object.entries(s.keys).filter(([p, k]) => s.verified[+p] && k.trim() && PROVIDER_AT[+p]).map(([p, k]) => [PROVIDER_AT[+p], k.trim()]),
  ));
  const req = useMemo<WeatherRequest>(() => ({
    place: { lat: place.lat, lon: place.lon }, keys: JSON.parse(keysId), userMinutes: minutes,
  }), [place.lat, place.lon, keysId, minutes]);

  const update = useCallback(async (manual: boolean) => {
    const id = ++run.current;
    const background = typeof document !== 'undefined' && document.hidden;
    if (manual) setLoading(true);
    try {
      const out = await tick({ ...req, manual, background, onUpdate: x => { if (id === run.current) setSnap(x); } });
      if (id !== run.current) return;
      setSnap(out);
      setError(out.error);
    } catch {
      if (id === run.current) setError('Could not refresh the forecast. Check your connection and try again.');
    } finally {
      if (id === run.current) setLoading(false);
    }
  }, [req]);

  useEffect(() => {
    setSnap(readSnapshot(req));
    setError(null);
    setLoading(true);
    void update(false);
    // The tick is cheap: the planner only fetches what's due, so this mostly decides nothing.
    const t = setInterval(() => void update(false), ALERT_POLL_MS);
    const back = () => { if (!document.hidden) void update(false); };
    document.addEventListener('visibilitychange', back);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', back); };
  }, [req, update]);

  const refresh = useCallback(() => void update(true), [update]);
  return {
    forecast: snap?.forecast ?? null,
    alerts: snap?.alerts ?? [],
    alertFeed: snap?.alertFeed ?? { status: 'unknown', checkedAt: null },
    now: snap?.now ?? null,
    sources: snap?.sources ?? [],
    loading, error, refresh,
    updatedAt: snap?.forecastFetchedAt ? new Date(snap.forecastFetchedAt) : null,
    staleSince: snap?.staleSince ? new Date(snap.staleSince) : null,
  };
}

const SEEN = 'sky-peek-seen-alerts';

function beep() {
  try {
    const ctx = new AudioContext();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = 880;
    g.gain.value = 0.08;
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 0.35);
    o.onended = () => void ctx.close();
  } catch { /* audio blocked until the user interacts */ }
}

/** Fires a notification and sound once per event, and again if its severity changes. */
export function useAlertDelivery(alerts: WeatherAlert[], s: Settings) {
  useEffect(() => {
    let seen: string[] = [];
    try { seen = JSON.parse(localStorage.getItem(SEEN) ?? '[]'); } catch { /* start fresh */ }
    const keyOf = (a: WeatherAlert) => a.notifyKey ?? a.id;
    const fresh = alerts.filter(a => !seen.includes(keyOf(a)) && routeAlert(a.level, a.title, s) === 'notify');
    if (!fresh.length) return;
    if (s.delivery[1] && 'Notification' in window && Notification.permission === 'granted') {
      fresh.forEach(a => new Notification(a.title, { body: `${a.area} · ${a.when}`, tag: a.id }));
    }
    if (s.delivery[2]) beep();
    localStorage.setItem(SEEN, JSON.stringify([...seen, ...fresh.map(keyOf)].slice(-100)));
  }, [alerts, s]);
}
