'use client';

import { useEffect, useState } from 'react';
import {
  ArrowDown, ArrowRight, ArrowUpRight, Bell, CalendarDays, Check, CloudDrizzle,
  CloudRain, CloudSun, Crosshair, Droplets, Layers3, LocateFixed, MapPin,
  Minus, Pause, Play, Plus, Search, SlidersHorizontal, Sun, Thermometer,
  TriangleAlert, Wind, X, Zap,
  type LucideIcon,
} from 'lucide-react';
import './flat-library.css';
import './flat-library-ink.css';
import { RadarToolPatterns } from './RadarToolPatterns';
import { IconBarStudies } from './IconBarStudies';
import { SeverityScaleStudies } from './SeverityScaleStudies';

type Layer = { name: string; icon: LucideIcon; color: string };
const layers: Layer[] = [
  { name: 'Rain', icon: CloudRain, color: 'blue' },
  { name: 'Storms', icon: Layers3, color: 'violet' },
  { name: 'Lightning', icon: Zap, color: 'yellow' },
  { name: 'Wind', icon: Wind, color: 'teal' },
  { name: 'Temperature', icon: Thermometer, color: 'orange' },
];
const hours = [
  { time: 'NOW', icon: Sun, temp: '68°', rain: '0%' },
  { time: '12 PM', icon: Sun, temp: '71°', rain: '0%' },
  { time: '1 PM', icon: CloudSun, temp: '73°', rain: '5%' },
  { time: '2 PM', icon: CloudSun, temp: '74°', rain: '10%' },
  { time: '3 PM', icon: CloudDrizzle, temp: '72°', rain: '35%' },
];
const timeline = ['3:30', '4:00', '4:30', '5:00', 'NOW', '5:30', '6:00', '6:30'];

function Spec({ number, title, note, children, className = '' }: { number: string; title: string; note: string; children: React.ReactNode; className?: string }) {
  return <article className={`fl-spec ${className}`}>
    <div className="fl-spec-head"><span>{number} / {title}</span><span>{note}</span></div>
    <div className="fl-spec-body">{children}</div>
  </article>;
}

function Switch({ label, checked, onChange }: { label: string; checked: boolean; onChange: () => void }) {
  return <button type="button" className="fl-switch-row" role="switch" aria-checked={checked} onClick={onChange}>
    <span>{label}</span><span className={`fl-switch${checked ? ' is-on' : ''}`} aria-hidden="true"><i /></span>
  </button>;
}

export function FlatLibrary() {
  const [activeLayers, setActiveLayers] = useState<string[]>(['Rain', 'Lightning']);
  const [units, setUnits] = useState<'°F' | '°C'>('°F');
  const [range, setRange] = useState<'Today' | 'Hourly' | '10 days'>('Today');
  const [alerts, setAlerts] = useState(true);
  const [lightning, setLightning] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [frame, setFrame] = useState(4);
  const [search, setSearch] = useState('');
  const [selectedHour, setSelectedHour] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [notice, setNotice] = useState(true);
  const [mapAction, setMapAction] = useState('MAP CONTROLS');
  const [selectedDay, setSelectedDay] = useState('Today');
  const [activeNav, setActiveNav] = useState('Today');
  const [savedPlace, setSavedPlace] = useState(false);

  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => setFrame(current => (current + 1) % timeline.length), 850);
    return () => window.clearInterval(timer);
  }, [playing]);

  function toggleLayer(name: string) {
    setActiveLayers(current => current.includes(name) ? current.filter(item => item !== name) : [...current, name]);
  }

  return <section className="fl-library" id="library" aria-labelledby="fl-title">
    <div className="fl-topline"><span><i /> SKY PEEK / DESIGN SYSTEM EXPLORATION</span><span>01 — FLAT INTERFACE</span></div>
    <div className="fl-hero">
      <div><p className="fl-eyebrow">A WORKING COMPONENT LIBRARY</p><h1 id="fl-title">Weather, without<br /><em>the noise.</em></h1><p className="fl-lede">White canvas. Black type. Weather color only where it carries meaning. A starting kit for the moments that make a forecast feel effortless.</p><div className="fl-hero-links"><a href="#components">Explore components <ArrowDown size={16} /></a><a href="#concepts">View mobile studies <ArrowUpRight size={16} /></a></div></div>
      <div className="fl-hero-art" aria-hidden="true"><div className="fl-orbit fl-orbit-one" /><div className="fl-orbit fl-orbit-two" /><div className="fl-art-sun"><Sun size={94} strokeWidth={1.25} /></div><span className="fl-art-temp">72°</span><span className="fl-art-note">CLEAR SKIES<br />BENTONVILLE, AR</span><div className="fl-art-cloud"><CloudSun size={72} strokeWidth={1.15} /></div></div>
    </div>

    <div className="fl-section-title" id="components"><span>01 / THE BUILDING BLOCKS</span><h2>Controls with purpose.</h2><p>Small interactions, designed for quick reading and easy tapping.</p></div>
    <div className="fl-grid fl-grid-controls">
      <Spec number="01" title="RADAR LAYERS" note="MULTI SELECT" className="fl-wide"><div className="fl-layer-list">{layers.map(({ name, icon: Icon, color }) => <button key={name} type="button" aria-pressed={activeLayers.includes(name)} onClick={() => toggleLayer(name)} className={`fl-layer fl-${color}${activeLayers.includes(name) ? ' is-active' : ''}`}><Icon size={20} strokeWidth={1.8} /><span>{name}</span><span className="fl-layer-indicator">{activeLayers.includes(name) && <Check size={13} strokeWidth={3} />}</span></button>)}</div><p className="fl-microcopy">Selected layers appear on the map · {activeLayers.length} active</p></Spec>
      <Spec number="02" title="TOGGLES" note="ON / OFF"><div className="fl-toggle-stack"><Switch label="Severe weather alerts" checked={alerts} onChange={() => setAlerts(!alerts)} /><Switch label="Lightning strikes" checked={lightning} onChange={() => setLightning(!lightning)} /></div><p className="fl-microcopy">Full-row touch target with visible state.</p></Spec>
      <Spec number="03" title="SEGMENTED CONTROL" note="SINGLE SELECT"><div className="fl-segment" role="group" aria-label="Forecast range">{(['Today', 'Hourly', '10 days'] as const).map(item => <button key={item} type="button" className={range === item ? 'is-selected' : ''} aria-pressed={range === item} onClick={() => setRange(item)}>{item}</button>)}</div><div className="fl-unit-row"><span>Temperature unit</span><div className="fl-segment fl-segment-small" role="group" aria-label="Temperature unit">{(['°F', '°C'] as const).map(item => <button key={item} type="button" className={units === item ? 'is-selected' : ''} aria-pressed={units === item} onClick={() => setUnits(item)}>{item}</button>)}</div></div></Spec>
      <Spec number="04" title="SEARCH & INPUT" note="LOCATION"><label className="fl-search"><Search size={19} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search a city or ZIP" aria-label="Search a city or ZIP" />{search && <button type="button" onClick={() => setSearch('')} aria-label="Clear search"><X size={17} /></button>}</label><button type="button" className="fl-place-suggestion" onClick={() => setSearch('Bentonville, AR')}><MapPin size={16} /><span>{search ? `Use “${search}”` : 'Bentonville, AR'}</span><ArrowRight size={16} /></button></Spec>
    </div>

    <div className="fl-section-title"><span>02 / RADAR CONTROLS</span><h2>Made for the map.</h2><p>A small, legible toolset that stays out of the weather.</p></div>
    <div className="fl-grid fl-grid-map">
      <Spec number="05" title="MAP TOOLBAR" note="ICON BUTTONS" className="fl-wide"><div className="fl-toolbar"><button type="button" aria-label="Find my location" title="Find my location" onClick={() => setMapAction('LOCATION SELECTED')}><LocateFixed size={21} /></button><button type="button" aria-label="Center map" title="Center map" onClick={() => setMapAction('MAP CENTERED')}><Crosshair size={21} /></button><span className="fl-toolbar-divider" /><button type="button" aria-label="Zoom in" onClick={() => setZoom(Math.min(zoom + 1, 5))}><Plus size={21} /></button><button type="button" aria-label="Zoom out" onClick={() => setZoom(Math.max(zoom - 1, 1))}><Minus size={21} /></button><span className="fl-toolbar-divider" /><button type="button" aria-label="Map settings" title="Map settings" onClick={() => setMapAction('SETTINGS PREVIEW')}><SlidersHorizontal size={21} /></button></div><div className="fl-toolbar-meta"><span aria-live="polite">{mapAction}</span><span>ZOOM {zoom}×</span></div></Spec>
      <Spec number="06" title="RADAR TIMELINE" note="PLAYBACK" className="fl-timeline-spec"><div className="fl-timeline"><div className="fl-timeline-top"><span>RADAR PLAYBACK</span><strong>{timeline[frame]}</strong></div><div className="fl-timeline-main"><button type="button" className="fl-play" onClick={() => setPlaying(!playing)} aria-label={playing ? 'Pause radar preview' : 'Play radar preview'}>{playing ? <Pause size={17} fill="currentColor" /> : <Play size={17} fill="currentColor" />}</button><input type="range" min="0" max={timeline.length - 1} value={frame} onChange={event => setFrame(Number(event.target.value))} aria-label="Radar frame" style={{ '--fl-progress': `${frame / (timeline.length - 1) * 100}%` } as React.CSSProperties} /></div><div className="fl-timeline-labels"><span>PAST 2 HRS</span><span>NOW</span><span>NEXT HOUR</span></div></div></Spec>
      <Spec number="07" title="PRECIPITATION SCALE" note="DATA KEY"><div className="fl-legend"><div className="fl-legend-bar" /><div className="fl-legend-labels"><span>LIGHT</span><span>MODERATE</span><span>HEAVY</span></div></div><p className="fl-microcopy">Color is reserved for data and decisions.</p></Spec>
    </div>

    <RadarToolPatterns />
    <IconBarStudies />
    <SeverityScaleStudies />

    <div className="fl-section-title"><span>06 / WEATHER OBJECTS</span><h2>The forecast, distilled.</h2><p>Reusable patterns for current conditions, time, and risk.</p></div>
    <div className="fl-grid fl-grid-weather">
      <Spec number="08" title="CURRENT CONDITIONS" note="FEATURE CARD" className="fl-current-spec"><div className="fl-current"><div className="fl-current-top"><span><MapPin size={15} /> BENTONVILLE, AR</span><span>THU, NOV 5</span></div><div className="fl-current-main"><div><span className="fl-current-temp">{units === '°F' ? '72°' : '22°'}</span><span className="fl-current-condition">Mostly sunny</span></div><Sun size={76} strokeWidth={1.2} /></div><div className="fl-current-bottom"><span>FEELS LIKE {units === '°F' ? '70°' : '21°'}</span><span>H {units === '°F' ? '74°' : '23°'} &nbsp; L {units === '°F' ? '48°' : '9°'}</span></div></div></Spec>
      <Spec number="09" title="HOURLY STRIP" note="SELECTABLE" className="fl-hourly-spec"><div className="fl-hour-strip">{hours.map(({ time, icon: Icon, temp, rain }, index) => <button type="button" key={time} className={selectedHour === index ? 'is-selected' : ''} aria-pressed={selectedHour === index} onClick={() => setSelectedHour(index)}><span>{time}</span><Icon size={25} strokeWidth={1.5} /><strong>{temp}</strong><small><Droplets size={12} /> {rain}</small></button>)}</div></Spec>
      <Spec number="10" title="STATUS & ALERTS" note="PRIORITY" className="fl-status-spec"><div className="fl-status-list"><div className="fl-status fl-status-good"><span className="fl-status-icon"><Check size={18} /></span><div><strong>All clear for now</strong><small>No active alerts in your area</small></div><ArrowUpRight size={17} /></div><div className="fl-status fl-status-warn"><span className="fl-status-icon"><TriangleAlert size={18} /></span><div><strong>Thunderstorm watch</strong><small>Until 7:00 PM · Benton County</small></div><ArrowUpRight size={17} /></div>{notice && <div className="fl-status fl-status-info"><span className="fl-status-icon"><Bell size={18} /></span><div><strong>Rain is approaching</strong><small>Expected in about 35 minutes</small></div><button type="button" aria-label="Dismiss rain notice" onClick={() => setNotice(false)}><X size={17} /></button></div>}</div></Spec>
      <Spec number="11" title="METRIC TILES" note="AT A GLANCE" className="fl-metrics-spec"><div className="fl-metrics"><div><Wind size={21} /><span>WIND</span><strong>SW 8 <small>mph</small></strong></div><div><Droplets size={21} /><span>HUMIDITY</span><strong>43<small>%</small></strong></div><div><CloudRain size={21} /><span>RAIN CHANCE</span><strong>10<small>%</small></strong></div></div></Spec>
    </div>

    <div className="fl-section-title"><span>07 / MORE PATTERNS</span><h2>Ready for real weather.</h2><p>Primitives and composed pieces for the rest of the app.</p></div>
    <div className="fl-grid fl-grid-patterns">
      <Spec number="12" title="ACTIONS & BADGES" note="PRIMITIVES"><div className="fl-actions"><button type="button" className="fl-btn fl-btn-primary" onClick={() => setSavedPlace(!savedPlace)}>{savedPlace ? <Check size={16} /> : <Plus size={16} />}{savedPlace ? 'Saved location' : 'Save location'}</button><button type="button" className="fl-btn fl-btn-outline" onClick={() => setSavedPlace(!savedPlace)}>{savedPlace ? 'Remove' : 'Details'} <ArrowUpRight size={16} /></button><button type="button" className="fl-btn fl-btn-icon" aria-label="Refresh preview" onClick={() => setMapAction('PREVIEW REFRESHED')}><Crosshair size={17} /></button></div><div className="fl-badges"><span>LIVE</span><span>UPDATED 4 MIN AGO</span><span className="fl-badge-alert">WATCH</span></div></Spec>
      <Spec number="13" title="DAILY FORECAST" note="SELECTABLE ROWS" className="fl-forecast-spec"><div className="fl-day-list">{[{ day: 'Today', icon: Sun, chance: '0%', low: '48°', high: '74°', fill: '66%' }, { day: 'Friday', icon: CloudSun, chance: '10%', low: '51°', high: '71°', fill: '54%' }, { day: 'Saturday', icon: CloudRain, chance: '70%', low: '49°', high: '63°', fill: '38%' }].map(({ day, icon: Icon, chance, low, high, fill }) => <button key={day} type="button" className={selectedDay === day ? 'is-selected' : ''} aria-pressed={selectedDay === day} onClick={() => setSelectedDay(day)}><strong>{day}</strong><Icon size={22} strokeWidth={1.6} /><span className="fl-day-chance"><Droplets size={12} />{chance}</span><span>{low}</span><i><b style={{ width: fill }} /></i><strong>{high}</strong></button>)}</div></Spec>
      <Spec number="14" title="RADAR INSPECTION" note="POINT CARD"><div className="fl-inspection"><div className="fl-inspection-top"><span>MAP SELECTION</span><span>36.37° N, 94.21° W</span></div><h3>Bentonville</h3><div className="fl-inspection-data"><div><span>PRECIPITATION</span><strong>Light rain</strong></div><div><span>MOVING</span><strong>NE · 12 mph</strong></div><div><span>ARRIVAL</span><strong>~35 min</strong></div></div><button type="button" onClick={() => setActiveNav('Radar')}>View radar details <ArrowRight size={15} /></button></div></Spec>
      <Spec number="15" title="APP NAVIGATION" note="MOBILE BAR" className="fl-nav-spec"><nav className="fl-nav" aria-label="Navigation component preview">{[[Sun, 'Today'], [CalendarDays, 'Hourly'], [Layers3, 'Radar'], [TriangleAlert, 'Alerts'], [SlidersHorizontal, 'Settings']].map(([Icon, label]) => { const Glyph = Icon as LucideIcon; return <button type="button" key={String(label)} className={activeNav === label ? 'is-selected' : ''} aria-current={activeNav === label ? 'page' : undefined} onClick={() => setActiveNav(String(label))}><Glyph size={20} strokeWidth={1.6} /><span>{String(label)}</span></button>; })}</nav><p className="fl-microcopy">Selection preview · {activeNav}</p></Spec>
    </div>

    <div className="fl-section-title fl-foundation-title"><span>08 / VISUAL LANGUAGE</span><h2>A quiet foundation.</h2><p>White surfaces and black type carry the interface; weather colors explain what matters.</p></div>
    <div className="fl-foundations"><div className="fl-palette"><div className="fl-palette-head">COLOR / FUNCTION</div><div className="fl-swatches">{[['Canvas', '#FFFFFF'], ['Ink', '#111111'], ['Rule', '#E6E6E6'], ['Rain', '#3078D4'], ['Storm', '#7762BC'], ['Lightning', '#F2BF49'], ['Alert', '#D6674D']].map(([name, color]) => <div key={name}><i style={{ background: color }} /><span>{name}</span><small>{color}</small></div>)}</div></div><div className="fl-type"><span>TYPE / HIERARCHY</span><div className="fl-type-display">72° <small>Display / condition</small></div><div className="fl-type-title">Mostly sunny <small>Title / forecast</small></div><div className="fl-type-body">A clear afternoon ahead. <small>Body / summary</small></div><div className="fl-type-label">BENTONVILLE, AR <small>Label / metadata</small></div></div></div>
    <div className="fl-end"><span>SKY PEEK / COMPONENT STUDIES</span><span>Interactive samples · Exploratory direction</span></div>
  </section>;
}
