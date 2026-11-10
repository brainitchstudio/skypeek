import type { Screen, Settings } from '@/lib/settings';
import type { Hour, Place } from '@/lib/types';
import type { Weather } from '@/lib/useWeather';
import { PROVIDER_NAMES } from '@/weather/service';

const KIND = { rain: 'Rain chance counts rain only.', '3h': 'Rain chance covers a 3-hour window.' };

/** Where one hour's numbers came from, in words. */
export function hourSources(h: Hour): string {
  const list = h.sources?.length
    ? h.sources.map(x => `${PROVIDER_NAMES[x.provider]} ${Math.round(x.weight * 100)}%`).join(', ')
    : 'National Weather Service';
  const notes = [h.popKind ? KIND[h.popKind] : '', h.flags?.includes('interpolated') ? 'Some values are estimated between 3-hour forecasts.' : ''].filter(Boolean);
  return [`Sources: ${list}.`, ...notes].join(' ');
}

export type ScreenProps = {
  weather: Weather;
  place: Place;
  nav: (screen: Screen, extra?: Partial<Settings>) => void;
};

/** Shown in place of a screen until its forecast exists. */
export function Pending({ weather }: { weather: Weather }) {
  return (
    <div className="screen pending">
      {weather.error
        ? <><div>{weather.error}</div><button type="button" className="link" onClick={weather.refresh}>Try again</button></>
        : <div className="loading-label" role="status">Loading forecast<span className="loading-dots" aria-hidden="true">…</span></div>}
    </div>
  );
}

/** Keeps old data on screen but says what's out of date. */
export function StaleNote({ weather }: { weather: Weather }) {
  const { alertFeed: feed } = weather;
  const text = feed.status === 'stale' && feed.checkedAt
    ? `Alerts last checked ${new Date(feed.checkedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}. Showing the last known alerts. Try again`
    : weather.staleSince ? `Forecast from ${weather.staleSince.toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}. Couldn’t refresh. Try again`
    : weather.error ? 'Couldn’t refresh the forecast. Try again' : null;
  if (!text) return null;
  return <button type="button" className="stale" onClick={weather.refresh}>{text}</button>;
}
