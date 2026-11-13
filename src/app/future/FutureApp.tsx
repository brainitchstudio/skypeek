'use client';

import dynamic from 'next/dynamic';
import { useEffect, useMemo, useState } from 'react';
import {
  Bell, CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight,
  CloudRain, Droplets, MapPin, Plus, Radar, RefreshCw, Search,
  Settings2, ShieldCheck, Star, Sun, Trash2, Wind, X,
} from 'lucide-react';
import { Icon } from '@/components/ui';
import { TodayBackground } from '@/components/TodayBackground';
import { dailyOutlook, hourlyOutlook, todaySummary } from '@/lib/forecast';
import { clock, dateKey, temp, weekdayLong } from '@/lib/format';
import { findSaved, orderPlaces, savePlace, toggleFavorite } from '@/lib/places';
import { REFRESH_OPTIONS, SettingsProvider, useSettings, type Screen } from '@/lib/settings';
import { todayScene } from '@/lib/todayScene';
import type { Day, Place, WeatherAlert } from '@/lib/types';
import { usePlaceSearch } from '@/lib/usePlaceSearch';
import { useWeather, type Weather } from '@/lib/useWeather';

const RadarScreen = dynamic(() => import('@/screens/Radar').then(module => module.RadarScreen), { ssr: false });
type Tab = 'today' | 'hourly' | 'days' | 'radar' | 'alerts';
type View = Tab | 'settings';

const TABS = [
  ['today', 'Today', Sun], ['hourly', 'Hourly', Wind], ['days', '10 Day', CalendarDays],
  ['radar', 'Radar', Radar], ['alerts', 'Alerts', Bell],
] as const;

function TabBar({ view, alerts, onSelect }: { view: View; alerts: number; onSelect: (tab: Tab) => void }) {
  return <nav className="future-tabs" aria-label="Main navigation">{TABS.map(([id, label, Glyph]) =>
    <button type="button" key={id} className={view === id ? 'active' : ''} aria-current={view === id ? 'page' : undefined}
      onClick={() => onSelect(id)}><Glyph size={22} strokeWidth={view === id ? 2.4 : 1.8} aria-hidden/><span>{label}</span>{id === 'alerts' && alerts > 0 && <i aria-label={`${alerts} active alerts`}/>}</button>
  )}</nav>;
}

function WeatherStatus({ weather }: { weather: Weather }) {
  if (!weather.error && !weather.staleSince) return null;
  return <button type="button" className="future-status" onClick={weather.refresh}>
    {weather.staleSince ? 'Forecast may be out of date.' : weather.error} Tap to retry.
  </button>;
}

function ScreenHeader({ title, subtitle, onPlaces, onSettings, onBack }: {
  title: string; subtitle?: string; onPlaces?: () => void; onSettings?: () => void; onBack?: () => void;
}) {
  return <header className="future-header"><div className="future-header-main">
    {onBack && <button type="button" className="future-back" aria-label="Back" onClick={onBack}><ChevronLeft size={23}/></button>}
    <div><span className="future-brand">SKY PEEK <b>✦</b></span>
      {onPlaces ? <button type="button" className="future-title-place" onClick={onPlaces}>{title}<ChevronDown size={18}/></button> : <h1>{title}</h1>}
      {subtitle && <p>{subtitle}</p>}
    </div>
    </div>{onSettings && <button type="button" className="future-header-action" aria-label="Settings" onClick={onSettings}><Settings2 size={21}/></button>}
  </header>;
}

function Loading({ weather }: { weather: Weather }) {
  return <div className="future-loading"><CloudRain size={34}/><strong>{weather.error ? 'Forecast unavailable' : 'Checking the weather…'}</strong>
    <p>{weather.error ?? 'Getting the latest forecast for your place.'}</p>
    {weather.error && <button type="button" onClick={weather.refresh}><RefreshCw size={16}/> Try again</button>}</div>;
}

function PlaceSheet({ current, close }: { current: Place; close: () => void }) {
  const { s, set } = useSettings();
  const [query, setQuery] = useState('');
  const { results, status } = usePlaceSearch(query);
  const searching = query.trim().length >= 2;
  const choose = (place: Place) => {
    set(previous => ({ places: savePlace(previous.places, place), defaultPlace: findSaved(previous.places, place)?.id ?? place.id, gps: false }));
    close();
  };
  return <div className="future-modal" role="presentation"><button className="future-modal-backdrop" type="button" aria-label="Close places" onClick={close}/>
    <section className="future-sheet" role="dialog" aria-modal="true" aria-label="Choose a place"><div className="future-sheet-handle"/>
      <div className="future-sheet-title"><h2>My places</h2><button type="button" aria-label="Close places" onClick={close}><X size={20}/></button></div>
      <label className="future-search"><Search size={19}/><input autoFocus value={query} onChange={event => setQuery(event.target.value)} placeholder="Search city or ZIP" aria-label="Search city or ZIP"/></label>
      <div className="future-place-list">{searching ? results.map(place => <button type="button" key={place.id} onClick={() => choose(place)}><MapPin size={18}/><span><b>{place.name}</b><small>{place.region}</small></span><Plus size={18}/></button>)
        : orderPlaces(s.places).map(place => <button type="button" key={place.id} onClick={() => choose(place)}><MapPin size={18}/><span><b>{place.name}</b><small>{place.region || 'Saved place'}</small></span>{place.id === current.id && <Check size={18}/>}</button>)}
        {searching && !results.length && <p className="future-empty-small">{status === 'searching' ? 'Searching…' : status === 'failed' ? 'Place search is unavailable.' : 'No US places found.'}</p>}
      </div>
    </section>
  </div>;
}

function TodayView({ weather, place, onPlaces, onSettings, onHourly, onAlerts }: {
  weather: Weather; place: Place; onPlaces: () => void; onSettings: () => void; onHourly: (index: number) => void; onAlerts: (id: string) => void;
}) {
  const { s } = useSettings();
  const [clockNow, setClockNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setClockNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const forecast = weather.forecast;
  if (!forecast?.hours.length) return <><ScreenHeader title={place.name} onPlaces={onPlaces} onSettings={onSettings}/><Loading weather={weather}/></>;
  const hour = forecast.hours[0];
  const day = forecast.days[0];
  const now = weather.now;
  const condition = now?.condition || hour.condition;
  const scene = todayScene(clockNow, forecast.timeZone, condition, now?.windMph ?? hour.windMph, now?.tempF ?? hour.tempF,
    !now || now.kind === 'forecast', hour.isDaytime);
  return <div className={`future-today future-today-${scene.time}`} data-weather={scene.weather}>
    <TodayBackground scene={scene}/>
    <ScreenHeader title={place.name} subtitle={weekdayLong(clockNow, forecast.timeZone)} onPlaces={onPlaces} onSettings={onSettings}/>
    <div className="future-scroll"><WeatherStatus weather={weather}/>
      {s.delivery[0] && weather.alerts.length > 0 && <button type="button" className="future-alert-banner" onClick={() => onAlerts(weather.alerts[0].id)}><Bell size={18}/><span>{weather.alerts[0].title}</span><ChevronRight size={17}/></button>}
      <div className="future-hero"><div className="future-hero-temp">{temp(now?.tempF ?? hour.tempF, s.units)}</div><strong>{condition}</strong><p>{todaySummary(forecast, s.units).join(' ')}</p><span>H: {temp(day?.hiF, s.units)} &nbsp; L: {temp(day?.loF, s.units)}</span></div>
      <section className="future-section future-today-hours"><div className="future-section-title"><span>THE NEXT FEW HOURS</span><button type="button" onClick={() => onHourly(0)} aria-label="View hourly forecast"><ChevronRight size={18}/></button></div><div className="future-hour-scroll">{forecast.hours.slice(0, 12).map((item, index) => <button type="button" key={item.start} onClick={() => onHourly(index)}><span>{index === 0 ? 'Now' : clock(new Date(item.start), forecast.timeZone)}</span><Icon kind={item.icon}/><b>{temp(item.tempF, s.units)}</b></button>)}</div></section>
      <section className="future-fact-grid"><div><Wind size={18}/><span>Wind</span><b>{hour.windMph == null ? '—' : `${hour.windMph} mph`}</b></div><div><Droplets size={18}/><span>Rain chance</span><b>{hour.pop == null ? '—' : `${hour.pop}%`}</b></div></section>
      <p className="future-provenance">Forecast from the National Weather Service and connected sources.</p>
    </div>
  </div>;
}

function HourlyView({ weather, place, selected, onSelect, onPlaces, onSettings }: {
  weather: Weather; place: Place; selected: number; onSelect: (index: number) => void; onPlaces: () => void; onSettings: () => void;
}) {
  const { s } = useSettings();
  const forecast = weather.forecast;
  const [dayKey, setDayKey] = useState<string | null>(null);
  if (!forecast?.hours.length) return <><ScreenHeader title="Hourly" onSettings={onSettings}/><Loading weather={weather}/></>;
  const days = [...new Set(forecast.hours.map(hour => dateKey(new Date(hour.start), forecast.timeZone)))].slice(0, 4);
  const selectedDay = dateKey(new Date(forecast.hours[Math.min(selected, forecast.hours.length - 1)].start), forecast.timeZone);
  const activeDay = dayKey && days.includes(dayKey) ? dayKey : selectedDay;
  const hours = forecast.hours.map((hour, index) => ({ hour, index })).filter(({ hour }) => dateKey(new Date(hour.start), forecast.timeZone) === activeDay);
  const featured = activeDay === days[0] ? forecast.hours[0] : hours[0]?.hour ?? forecast.hours[0];
  return <><ScreenHeader title="Hourly" subtitle={`${place.name} · ${hourlyOutlook(forecast.hours, iso => clock(new Date(iso), forecast.timeZone))}`} onPlaces={onPlaces} onSettings={onSettings}/><div className="future-scroll future-plain-scroll"><WeatherStatus weather={weather}/>
    <div className="future-day-tabs" role="tablist" aria-label="Forecast day">{days.map((key, index) => <button type="button" role="tab" aria-selected={key === activeDay} className={key === activeDay ? 'active' : ''} key={key} onClick={() => setDayKey(key)}>{index === 0 ? 'Today' : new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: forecast.timeZone }).format(new Date(`${key}T12:00:00Z`))}</button>)}</div>
    <div className="future-hour-feature"><div><span>{activeDay === days[0] ? 'RIGHT NOW' : 'START OF DAY'}</span><strong>{temp(activeDay === days[0] ? weather.now?.tempF ?? featured.tempF : featured.tempF, s.units)}</strong><small>{activeDay === days[0] ? weather.now?.condition ?? featured.condition : featured.condition}</small></div><Icon kind={featured.icon}/></div>
    <div className="future-list-title">{activeDay === days[0] ? 'TODAY' : activeDay} <span>RAIN · WIND</span></div>
    <div className="future-hour-list">{hours.map(({ hour, index }) => <button type="button" className={selected === index ? 'selected' : ''} key={hour.start} onClick={() => onSelect(index)} aria-expanded={selected === index}><span className="future-hour-time">{index === 0 ? 'Now' : clock(new Date(hour.start), forecast.timeZone)}</span><Icon kind={hour.icon}/><strong>{temp(hour.tempF, s.units)}</strong><span className="future-rain"><Droplets size={13}/>{hour.pop == null ? '—' : `${hour.pop}%`}</span><span className="future-wind">{hour.windMph == null ? '—' : `${hour.windMph} mph`}</span>{selected === index && <div className="future-hour-detail">{hour.condition} · {hour.popKind ? 'Precipitation chance spans multiple hours.' : 'Hourly forecast'}</div>}</button>)}</div>
  </div></>;
}

function DaysView({ weather, place, onPlaces, onSettings }: { weather: Weather; place: Place; onPlaces: () => void; onSettings: () => void }) {
  const { s } = useSettings();
  const forecast = weather.forecast;
  const [selected, setSelected] = useState(0);
  if (!forecast?.days.length) return <><ScreenHeader title="10 Day" onSettings={onSettings}/><Loading weather={weather}/></>;
  const values = forecast.days.flatMap(day => [day.hiF, day.loF]).filter((value): value is number => value != null);
  const min = Math.min(...values), span = Math.max(1, Math.max(...values) - min);
  return <><ScreenHeader title="10 Day" subtitle={`${place.name} · ${dailyOutlook(forecast.days, value => temp(value, s.units))}`} onPlaces={onPlaces} onSettings={onSettings}/><div className="future-scroll future-plain-scroll"><WeatherStatus weather={weather}/>
    <div className="future-list-title">DAILY FORECAST <span>LOW — HIGH</span></div><div className="future-days-list">{forecast.days.map((day: Day, index) => <div key={day.date} className={selected === index ? 'selected' : ''}><button type="button" onClick={() => setSelected(selected === index ? -1 : index)} aria-expanded={selected === index}><b>{day.short}</b><Icon kind={day.icon}/><small>{day.pop == null ? '—' : `${day.pop}%`}</small><span>{temp(day.loF, s.units)}</span><i className="future-range"><i style={{ left: `${(((day.loF ?? day.hiF ?? min) - min) / span) * 100}%`, width: `${(((day.hiF ?? day.loF ?? min) - (day.loF ?? day.hiF ?? min)) / span) * 100}%` }}/></i><strong>{day.hiEstimated ? '~' : ''}{temp(day.hiF, s.units)}</strong></button>{selected === index && <div className="future-day-detail"><strong>{day.dateLabel}</strong><p>{day.summary}</p><div>Rain {day.pop == null ? '—' : `${day.pop}%`} &nbsp;·&nbsp; Wind {day.windMph == null ? '—' : `${day.windMph} mph`}</div><small>{day.source ? `Source: ${day.source}` : 'Forecast source unavailable'}</small></div>}</div>)}</div>
  </div></>;
}

function AlertDetail({ alert, onBack, onRadar }: { alert: WeatherAlert; onBack: () => void; onRadar: () => void }) {
  return <div className="future-alert-detail"><button type="button" className="future-text-back" onClick={onBack}><ChevronLeft size={18}/> All alerts</button><span className="future-alert-level" style={{ background: alert.color, color: alert.fg }}>{alert.level}</span><h2>{alert.title}</h2><p className="future-alert-meta">{alert.when} · {alert.area}</p><div className="future-alert-body">{alert.body}</div>{alert.todo.length > 0 && <section><h3>What to do</h3>{alert.todo.map(step => <p key={step}>{step}</p>)}</section>}<button type="button" className="future-primary-action" onClick={onRadar}>View on radar <ChevronRight size={17}/></button></div>;
}

function AlertsView({ weather, place, selected, onSelect, onRadar, onSettings }: {
  weather: Weather; place: Place; selected: string | null; onSelect: (id: string | null) => void; onRadar: () => void; onSettings: () => void;
}) {
  const alert = weather.alerts.find(item => item.id === selected);
  const feed = weather.alertFeed.status;
  return <><ScreenHeader title="Alerts" subtitle={place.name} onSettings={onSettings}/><div className="future-scroll future-plain-scroll"><WeatherStatus weather={weather}/>
    {alert ? <AlertDetail alert={alert} onBack={() => onSelect(null)} onRadar={onRadar}/> : weather.alerts.length ? <div className="future-alert-list"><div className="future-list-title">ACTIVE FOR THIS PLACE</div>{weather.alerts.map(item => <button type="button" key={item.id} onClick={() => onSelect(item.id)}><span className="future-alert-marker" style={{ background: item.color }}/><span><b>{item.title}</b><small>{item.when} · {item.area}</small></span><ChevronRight size={18}/></button>)}</div> : <div className="future-alert-empty"><div><ShieldCheck size={32}/></div><span>YOUR AREA</span><h2>{feed === 'fresh' ? 'No active alerts' : feed === 'stale' ? 'Alert status is out of date' : feed === 'unsupported' ? 'Alerts unavailable here' : 'Checking for alerts'}</h2><p>{feed === 'fresh' ? `The National Weather Service has nothing active for ${place.name}.` : feed === 'stale' ? `Sky Peek could not reach the National Weather Service. The latest status for ${place.name} may be out of date.` : feed === 'unsupported' ? 'National Weather Service alerts cover US locations.' : `Checking National Weather Service alerts for ${place.name}.`}</p><button type="button" onClick={weather.refresh}><RefreshCw size={15}/> Refresh alerts</button></div>}
    <div className="future-alert-helper"><Bell size={19}/><span>Alert banner preference</span><button type="button" onClick={onSettings}>Open <ChevronRight size={15}/></button></div>
  </div></>;
}

function SettingsView({ place, onBack, onPlaces }: { place: Place; onBack: () => void; onPlaces: () => void }) {
  const { s, set } = useSettings();
  const remove = (placeId: string) => {
    set(previous => {
      const places = previous.places.filter(item => item.id !== placeId);
      const next = places[0] ?? previous.places.find(item => item.id === placeId)!;
      return { places: places.length ? places : [next], defaultPlace: previous.defaultPlace === placeId ? next.id : previous.defaultPlace };
    });
  };
  return <><ScreenHeader title="Settings" onBack={onBack}/><div className="future-scroll future-plain-scroll future-settings"><div className="future-list-title">MY PLACES <button type="button" onClick={onPlaces}>ADD <Plus size={15}/></button></div><div className="future-settings-group">{orderPlaces(s.places).map(item => <div className="future-settings-place" key={item.id}><button type="button" onClick={() => set({ defaultPlace: item.id, gps: false })}><MapPin size={19}/><span><b>{item.name}</b><small>{item.id === place.id ? 'Current place' : item.region || 'Saved place'}</small></span>{item.id === place.id && <Check size={18}/>}</button><button type="button" className="future-place-star" aria-label={`Favorite ${item.name}`} aria-pressed={!!item.favorite} onClick={() => set(previous => ({ places: toggleFavorite(previous.places, item) }))}><Star size={17} fill={item.favorite ? 'currentColor' : 'none'}/></button>{s.places.length > 1 && <button type="button" className="future-place-remove" aria-label={`Remove ${item.name}`} onClick={() => remove(item.id)}><Trash2 size={16}/></button>}</div>)}</div>
    <div className="future-list-title">PREFERENCES</div><div className="future-settings-group"><div className="future-setting-row"><span><b>Temperature</b><small>Show degrees in the forecast</small></span><div className="future-setting-segment"><button type="button" className={s.units === 'F' ? 'active' : ''} onClick={() => set({ units: 'F' })}>°F</button><button type="button" className={s.units === 'C' ? 'active' : ''} onClick={() => set({ units: 'C' })}>°C</button></div></div><div className="future-setting-row"><span><b>Refresh interval</b><small>How often to check for new data</small></span><select aria-label="Refresh interval" value={s.refreshI} onChange={event => set({ refreshI: Number(event.target.value) })}>{REFRESH_OPTIONS.map(([label], index) => <option value={index} key={label}>{label}</option>)}</select></div><div className="future-setting-row"><span><b>Alert banner</b><small>Show active alerts on Today</small></span><button type="button" role="switch" aria-checked={s.delivery[0]} className={`future-switch${s.delivery[0] ? ' on' : ''}`} onClick={() => set(previous => ({ delivery: previous.delivery.map((item, index) => index === 0 ? !item : item) }))}><i/></button></div></div>
    <div className="future-list-title">RADAR</div><div className="future-settings-group"><div className="future-setting-row"><span><b>Map style</b><small>Choose the radar basemap</small></span><select aria-label="Radar map style" value={s.basemap} onChange={event => set({ basemap: Number(event.target.value) })}><option value={0}>Flat</option><option value={2}>Satellite</option></select></div><div className="future-setting-row"><span><b>Radar source</b><small>Imagery shown on the map</small></span><select aria-label="Radar source" value={s.radarSrc} onChange={event => set({ radarSrc: Number(event.target.value) })}><option value={4}>NOAA</option><option value={1}>RainViewer</option><option value={0}>Demo</option></select></div></div><p className="future-settings-note">Forecasts and alerts come from the app’s existing weather services. Saved places and preferences stay in this browser.</p></div></>;
}

function FutureShell() {
  const { s, set } = useSettings();
  const [view, setView] = useState<View>('today');
  const [lastTab, setLastTab] = useState<Tab>('today');
  const [showPlaces, setShowPlaces] = useState(false);
  const [selectedHour, setSelectedHour] = useState(0);
  const [selectedAlert, setSelectedAlert] = useState<string | null>(null);
  const place = useMemo(() => s.places.find(item => item.id === s.defaultPlace) ?? s.places[0], [s.places, s.defaultPlace]);
  const weather = useWeather(place, s);
  const selectTab = (tab: Tab) => { setView(tab); setLastTab(tab); if (tab !== 'alerts') setSelectedAlert(null); };
  const openSettings = () => { if (view !== 'settings') setLastTab(view); setView('settings'); };
  const navigate = (screen: Screen, extra?: Partial<typeof s>) => {
    if (extra) set(extra);
    if (screen === 'alertDetail') { setSelectedAlert(extra?.alertId ?? null); selectTab('alerts'); }
    else if (screen === 'settings') openSettings();
    else selectTab(screen);
  };
  return <div className="future-page"><main className="future-app" aria-label="Sky Peek iOS prototype">
    <div className="future-view" key={view}>
      {view === 'today' && <TodayView weather={weather} place={place} onPlaces={() => setShowPlaces(true)} onSettings={openSettings} onHourly={index => { setSelectedHour(index); selectTab('hourly'); }} onAlerts={id => { setSelectedAlert(id); selectTab('alerts'); }}/ >}
      {view === 'hourly' && <HourlyView weather={weather} place={place} selected={selectedHour} onSelect={setSelectedHour} onPlaces={() => setShowPlaces(true)} onSettings={openSettings}/ >}
      {view === 'days' && <DaysView weather={weather} place={place} onPlaces={() => setShowPlaces(true)} onSettings={openSettings}/ >}
      {view === 'radar' && <div className="future-radar"><RadarScreen weather={weather} place={place} nav={navigate}/></div>}
      {view === 'alerts' && <AlertsView weather={weather} place={place} selected={selectedAlert} onSelect={setSelectedAlert} onRadar={() => selectTab('radar')} onSettings={openSettings}/ >}
      {view === 'settings' && <SettingsView place={place} onBack={() => setView(lastTab)} onPlaces={() => setShowPlaces(true)}/ >}
    </div>
    <TabBar view={view} alerts={weather.alerts.length} onSelect={selectTab}/>
    {showPlaces && <PlaceSheet current={place} close={() => setShowPlaces(false)}/>}
  </main></div>;
}

export function FutureApp() {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  if (!ready) return <div className="future-page"><div className="future-app future-boot" role="status">Opening Sky Peek…</div></div>;
  return <SettingsProvider><FutureShell/></SettingsProvider>;
}
