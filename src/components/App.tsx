'use client';

import dynamic from 'next/dynamic';
import { useEffect, useMemo, useState } from 'react';
import { Switcher } from './Switcher';
import { MobileNav } from './MobileNav';
import { LocationWelcome, TOUR_STEPS, WelcomeTour, WhatsNew } from './Onboarding';
import { routeAlert } from '@/lib/alerts';
import { APP_VERSION, compareVersions, RELEASES, unseenReleases } from '@/lib/releases';
import { hasChosenLocation, hasCompletedTour, markLocationChosen, markTourComplete } from '@/lib/onboardingState';
import { BETA_SCENE_COOKIE, parseScene, pickScene, type Scene } from '@/lib/betaScene';
import { SETTINGS_KEY, SettingsProvider, useSettings, type Screen } from '@/lib/settings';
import type { Place } from '@/lib/types';
import { useAlertDelivery, useWeather } from '@/lib/useWeather';
import { AlertDetailScreen, AlertsScreen } from '@/screens/Alerts';
import { DaysScreen } from '@/screens/Days';
import { HourlyScreen } from '@/screens/Hourly';
import { SettingsScreen } from '@/screens/Settings';
import { TodayScreen } from '@/screens/Today';

// MapLibre is about 1 MB, so only the Radar screen loads it.
const RadarScreen = dynamic(() => import('@/screens/Radar').then(m => m.RadarScreen), { ssr: false });
const VERSION_KEY = 'sky-peek-last-seen-version';
const SCENE_KEY = 'sky-peek-onboarding-scene';

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
  const [intro, setIntro] = useState<'location' | 'tour' | 'release' | null>(null);
  const [tourStep, setTourStep] = useState(0);
  const [lastSeenVersion, setLastSeenVersion] = useState<string | null>(null);
  const [scene, setScene] = useState<Scene>({ time: 'afternoon', weather: 'clear' });

  useEffect(() => {
    const sceneCookie = document.cookie.split('; ').find(cookie => cookie.startsWith(`${BETA_SCENE_COOKIE}=`))?.split('=')[1];
    const [cookieTime, cookieWeather] = sceneCookie?.split('.') ?? [];
    let savedScene: string | null = null;
    try { savedScene = sessionStorage.getItem(SCENE_KEY); } catch { /* storage may be disabled */ }
    const [savedTime, savedWeather] = savedScene?.split('.') ?? [];
    const chosenScene = parseScene(cookieTime, cookieWeather) ?? parseScene(savedTime, savedWeather) ?? pickScene();
    try { sessionStorage.setItem(SCENE_KEY, `${chosenScene.time}.${chosenScene.weather}`); } catch { /* storage may be disabled */ }
    setScene(chosenScene);

    let seen: string | null = null;
    let tourComplete = false;
    let locationChosen = false;
    try {
      seen = localStorage.getItem(VERSION_KEY);
      tourComplete = hasCompletedTour(localStorage);
      locationChosen = hasChosenLocation(localStorage);
    } catch { /* start onboarding if storage is unavailable */ }
    setLastSeenVersion(seen);
    if (!tourComplete) setIntro(locationChosen ? 'tour' : 'location');
    else if (!seen || compareVersions(APP_VERSION, seen) > 0) setIntro('release');
  }, []);

  const [direction, setDirection] = useState(1);
  const nav = (screen: Screen, extra?: Partial<typeof s>) => {
    const order: Screen[] = ['today', 'hourly', 'days', 'radar', 'alerts', 'alertDetail', 'settings'];
    if (screen !== s.screen) setDirection(order.indexOf(screen) >= order.indexOf(s.screen) ? 1 : -1);
    set({ screen, ...extra });
  };
  const rememberVersion = () => {
    try { localStorage.setItem(VERSION_KEY, APP_VERSION); } catch { /* private browsing may block storage */ }
    setLastSeenVersion(APP_VERSION);
  };
  const finishTour = () => {
    try { markTourComplete(localStorage); } catch { /* private browsing may block storage */ }
    rememberVersion();
    setIntro(null);
    nav('today');
  };
  const moveTour = (next: number) => {
    if (next >= TOUR_STEPS.length) { finishTour(); return; }
    setTourStep(next);
    nav(TOUR_STEPS[next].screen);
  };
  const startTour = () => { setTourStep(0); nav('today'); setIntro('tour'); };
  const chooseFirstPlace = (chosen: Place) => {
    const next = { ...s, places: [chosen], defaultPlace: chosen.id, gps: false, screen: 'today' as const };
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
      markLocationChosen(localStorage);
    } catch { /* the app still works for this visit if storage is unavailable */ }
    set(next);
    setTourStep(0);
    setIntro('tour');
  };
  const closeRelease = () => { rememberVersion(); setIntro(null); };
  const banner = s.delivery[0] ? weather.alerts.find(a => routeAlert(a.level, a.title, s) !== 'off') : undefined;
  const common = { weather, place, nav };

  const showBrand = ['today', 'hourly', 'days'].includes(s.screen);

  return (
    <main className={`app${showBrand ? ' app-branded' : ''}${s.screen === 'today' ? ' app-today' : ''}`} data-direction={direction}>
      {showBrand && <header className="app-brand" aria-label="SkyPeek">
        <span aria-hidden="true">SkyPeek</span>
      </header>}
      {s.screen === 'today' && <TodayScreen {...common} banner={banner} onHour={i => { setHour(i); nav('hourly'); }} />}
      {s.screen === 'hourly' && <HourlyScreen weather={weather} selected={hour} onSelect={setHour} />}
      {s.screen === 'days' && <DaysScreen weather={weather} />}
      {s.screen === 'radar' && <RadarScreen {...common} />}
      {s.screen === 'alerts' && <AlertsScreen {...common} />}
      {s.screen === 'alertDetail' && <AlertDetailScreen {...common} />}
      {s.screen === 'settings' && <SettingsScreen {...common} gpsError={gpsError} onReplayTour={startTour} onShowWhatsNew={() => setIntro('release')} />}
      <div className="switcher-wrap">
        <Switcher
          active={s.screen === 'alertDetail' ? 'alerts' : s.screen}
          badge={weather.alerts.length > 0}
          place={place}
          onManagePlaces={() => nav('settings', { setTab: 'locations' })}
          onSelect={k => { if (k === 'settings') nav(k, { setTab: 'alerts' }); else nav(k); }}
        />
      </div>
      <MobileNav
        active={s.screen}
        badge={weather.alerts.length > 0}
        place={place}
        onManagePlaces={() => nav('settings', { setTab: 'locations' })}
        onSelect={k => { if (k === 'settings') nav(k, { setTab: 'alerts' }); else nav(k); }}
      />
      {intro === 'location' && <LocationWelcome scene={scene} onChoose={chooseFirstPlace} />}
      {intro === 'tour' && <WelcomeTour scene={scene} step={tourStep} onBack={() => moveTour(tourStep - 1)} onNext={() => moveTour(tourStep + 1)} onSkip={finishTour} />}
      {intro === 'release' && <WhatsNew scene={scene} releases={unseenReleases(lastSeenVersion).length ? unseenReleases(lastSeenVersion) : RELEASES.slice(0, 1)} onClose={closeRelease} />}
    </main>
  );
}

export default function App() {
  return <SettingsProvider><Shell /></SettingsProvider>;
}
