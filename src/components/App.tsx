'use client';

import dynamic from 'next/dynamic';
import { Binoculars } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Switcher } from './Switcher';
import { routeAlert } from '@/lib/alerts';
import { SettingsProvider, useSettings, type Screen } from '@/lib/settings';
import type { Place } from '@/lib/types';
import { useAlertDelivery, useWeather } from '@/lib/useWeather';
import { AlertDetailScreen, AlertsScreen } from '@/screens/Alerts';
import { DaysScreen } from '@/screens/Days';
import { HourlyScreen } from '@/screens/Hourly';
import { SettingsScreen } from '@/screens/Settings';
import { TodayScreen } from '@/screens/Today';

// MapLibre is about 1 MB, so only the Radar screen loads it.
const RadarScreen = dynamic(() => import('@/screens/Radar').then(m => m.RadarScreen), { ssr: false });

function useActivePlace(): { place: Place; gpsError: string | null } {
  const { s, set } = useSettings();
  const [coords, setCoords] = useState<{ lat: number; lon: number } | null>(null);
  const [gpsError, setGpsError] = useState<string | null>(null);

  useEffect(() => {
    if (!s.gps) { setCoords(null); return; }
    setGpsError(null);
    navigator.geolocation.getCurrentPosition(
      p => setCoords({ lat: p.coords.latitude, lon: p.coords.longitude }),
      () => { setGpsError('Location access was denied, so the default place is in use.'); set({ gps: false }); },
    );
  }, [s.gps, set]);

  const place = useMemo<Place>(() => {
    if (coords) return { id: 'gps', name: 'Current location', region: '', ...coords };
    return s.places.find(p => p.id === s.defaultPlace) ?? s.places[0] ?? {
      id: 'brooklyn', name: 'Brooklyn, NY', region: 'Kings County', lat: 40.6782, lon: -73.9442,
    };
  }, [coords, s.places, s.defaultPlace]);

  return { place, gpsError };
}

function Shell() {
  const { s, set } = useSettings();
  const { place, gpsError } = useActivePlace();
  const weather = useWeather(place, s);
  useAlertDelivery(weather.alerts, s);
  const [hour, setHour] = useState<number | null>(null);

  const [direction, setDirection] = useState(1);
  const nav = (screen: Screen, extra?: Partial<typeof s>) => {
    const order: Screen[] = ['today', 'hourly', 'days', 'radar', 'alerts', 'alertDetail', 'settings'];
    if (screen !== s.screen) setDirection(order.indexOf(screen) >= order.indexOf(s.screen) ? 1 : -1);
    set({ screen, ...extra });
  };
  const banner = s.delivery[0] ? weather.alerts.find(a => routeAlert(a.level, a.title, s) !== 'off') : undefined;
  const common = { weather, place, nav };

  const showBrand = ['today', 'hourly', 'days'].includes(s.screen);

  return (
    <main className={`app${showBrand ? ' app-branded' : ''}`} data-direction={direction}>
      {showBrand && <header className="app-brand" aria-label="Sky Peek">
        <span className="app-brand-glyph" aria-hidden="true"><Binoculars size={28} strokeWidth={1.8} /></span>
        <span aria-hidden="true">Sky Peek</span>
      </header>}
      {s.screen === 'today' && <TodayScreen {...common} banner={banner} onHour={i => { setHour(i); nav('hourly'); }} />}
      {s.screen === 'hourly' && <HourlyScreen weather={weather} selected={hour} onSelect={setHour} />}
      {s.screen === 'days' && <DaysScreen weather={weather} />}
      {s.screen === 'radar' && <RadarScreen {...common} />}
      {s.screen === 'alerts' && <AlertsScreen {...common} />}
      {s.screen === 'alertDetail' && <AlertDetailScreen {...common} />}
      {s.screen === 'settings' && <SettingsScreen {...common} gpsError={gpsError} />}
      <div className="switcher-wrap">
        <Switcher
          active={s.screen === 'alertDetail' ? 'alerts' : s.screen}
          badge={weather.alerts.length > 0}
          place={place}
          onManagePlaces={() => nav('settings', { setTab: 'locations' })}
          onSelect={k => { if (k === 'settings') nav(k, { setTab: 'alerts' }); else nav(k); }}
        />
      </div>
    </main>
  );
}

export default function App() {
  return <SettingsProvider><Shell /></SettingsProvider>;
}
