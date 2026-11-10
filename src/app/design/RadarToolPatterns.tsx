'use client';

import { useState } from 'react';
import {
  Check, ChevronDown, CloudRain, Layers3, LocateFixed, MapPin,
  Play, RadioTower, Ruler, Search, Settings2, SlidersHorizontal,
  Thermometer, TriangleAlert, Wind, X, Zap,
  type LucideIcon,
} from 'lucide-react';
import './radar-tool-patterns.css';
import './radar-tool-patterns-hover.css';

type Panel = 'Layers' | 'Tools' | 'Source' | 'Alerts' | 'Search';
type Variant = 'rail' | 'bar' | 'sheet';

const radarLayers: { name: string; icon: LucideIcon; color: string }[] = [
  { name: 'Precipitation', icon: CloudRain, color: '#3078d4' },
  { name: 'Storm tracks', icon: Layers3, color: '#7762bc' },
  { name: 'Lightning', icon: Zap, color: '#b68a1d' },
  { name: 'Wind', icon: Wind, color: '#318a80' },
  { name: 'Temperature', icon: Thermometer, color: '#d36e3e' },
];

const panelIcons: Record<Panel, LucideIcon> = {
  Layers: Layers3, Tools: Ruler, Source: RadioTower, Alerts: TriangleAlert, Search,
};

function RadarPattern({ variant }: { variant: Variant }) {
  const [panel, setPanel] = useState<Panel | null>('Layers');
  const [active, setActive] = useState(['Precipitation', 'Lightning']);
  const [selectedLayer, setSelectedLayer] = useState('Precipitation');
  const [opacity, setOpacity] = useState(75);
  const [source, setSource] = useState('NOAA national');
  const [ruler, setRuler] = useState(false);
  const [coverage, setCoverage] = useState(false);
  const [query, setQuery] = useState('');

  function togglePanel(next: Panel) { setPanel(current => current === next ? null : next); }
  function toggleLayer(name: string) {
    setSelectedLayer(name);
    setActive(current => current.includes(name) ? current.filter(item => item !== name) : [...current, name]);
  }

  const nav = (name: Panel) => {
    const Icon = panelIcons[name];
    return <button key={name} type="button" className={panel === name ? 'rtp-selected' : ''} aria-label={`Open ${name.toLowerCase()}`} aria-expanded={panel === name} aria-controls={panel === name ? `rtp-panel-${variant}` : undefined} onClick={() => togglePanel(name)}>
      <Icon size={17} strokeWidth={1.8} /><span className="rtp-tip">{name}</span>{name === 'Alerts' && <i className="rtp-alert-dot" />}
    </button>;
  };

  const panelContent = panel && <div className="rtp-panel" id={`rtp-panel-${variant}`} aria-label={`${panel} preview`}>
    <div className="rtp-panel-head"><div><small>{panel === 'Layers' ? `${active.length} OF 5 ACTIVE` : 'RADAR CONTROLS'}</small><strong>{panel}</strong></div><button type="button" aria-label="Close panel" onClick={() => setPanel(null)}><X size={16} /></button></div>
    {panel === 'Layers' && <>
      <div className="rtp-layer-list">{radarLayers.map(({ name, icon: Icon, color }) => <button type="button" key={name} className={selectedLayer === name ? 'rtp-layer-selected' : ''} aria-pressed={active.includes(name)} onClick={() => toggleLayer(name)}><Icon size={17} style={{ color }} /><span>{name}</span><i className={active.includes(name) ? 'rtp-checked' : ''}>{active.includes(name) && <Check size={11} strokeWidth={3} />}</i></button>)}</div>
      <div className="rtp-layer-settings"><div><Settings2 size={15} /><strong>{selectedLayer} settings</strong></div><label htmlFor={`opacity-${variant}`}>Opacity <span>{opacity}%</span></label><input id={`opacity-${variant}`} type="range" min="0" max="100" value={opacity} onChange={event => setOpacity(Number(event.target.value))} /></div>
    </>}
    {panel === 'Tools' && <div className="rtp-options"><button type="button" aria-pressed={ruler} onClick={() => setRuler(!ruler)}><Ruler size={17} /><span><strong>Distance & bearing</strong><small>Measure between map points</small></span><i className={ruler ? 'rtp-checked' : ''}>{ruler && <Check size={11} strokeWidth={3} />}</i></button><button type="button" aria-pressed={coverage} onClick={() => setCoverage(!coverage)}><RadioTower size={17} /><span><strong>Coverage & status</strong><small>Show radar availability</small></span><i className={coverage ? 'rtp-checked' : ''}>{coverage && <Check size={11} strokeWidth={3} />}</i></button></div>}
    {panel === 'Source' && <div className="rtp-source"><label htmlFor={`source-${variant}`}>RADAR SOURCE</label><div className="rtp-select"><select id={`source-${variant}`} value={source} onChange={event => setSource(event.target.value)}><option>NOAA national</option><option>NOAA station</option><option>RainViewer</option><option>Demo</option></select><ChevronDown size={15} /></div>{source === 'NOAA station' && <><label htmlFor={`station-${variant}`}>STATION</label><div className="rtp-select"><select id={`station-${variant}`} defaultValue="KSRX · Fort Smith"><option>KSRX · Fort Smith</option><option>KTLX · Oklahoma City</option><option>KLZK · Little Rock</option></select><ChevronDown size={15} /></div></>}<p>Source and station belong here, one level below the everyday layers.</p></div>}
    {panel === 'Alerts' && <div className="rtp-alert"><span><TriangleAlert size={18} /> WATCH</span><strong>Thunderstorm watch</strong><p>Benton County · Until 7:00 PM</p><button type="button" onClick={() => setPanel(null)}>Back to map</button></div>}
    {panel === 'Search' && <div className="rtp-search"><label htmlFor={`search-${variant}`}>FIND A PLACE</label><div><Search size={16} /><input id={`search-${variant}`} value={query} onChange={event => setQuery(event.target.value)} placeholder="City or ZIP code" /></div><button type="button" onClick={() => { setQuery('Bentonville, AR'); setPanel(null); }}><MapPin size={15} />{query || 'Bentonville, AR'}</button></div>}
  </div>;

  return <div className={`rtp-stage rtp-${variant}`}>
    <div className="rtp-map" aria-hidden="true"><div className="rtp-map-road rtp-road-one" /><div className="rtp-map-road rtp-road-two" /><div className="rtp-map-road rtp-road-three" /><div className="rtp-rain rtp-rain-one" /><div className="rtp-rain rtp-rain-two" /><span className="rtp-map-label rtp-map-benton">BENTONVILLE</span><span className="rtp-map-label rtp-map-rogers">ROGERS</span><span className="rtp-map-pin"><MapPin size={15} fill="currentColor" /></span></div>
    {variant === 'rail' && <><div className="rtp-rail">{nav('Layers')}{nav('Tools')}{nav('Source')}<span />{nav('Search')}{nav('Alerts')}</div>{panelContent}<div className="rtp-rail-map-actions"><button type="button" aria-label="Center map" title="Center map"><LocateFixed size={17} /></button></div></>}
    {variant === 'bar' && <><div className="rtp-command"><div className="rtp-command-title"><span>RADAR</span><small>Bentonville, AR</small></div><div className="rtp-command-nav">{nav('Layers')}{nav('Tools')}{nav('Source')}{nav('Alerts')}</div>{nav('Search')}</div>{panelContent}</>}
    {variant === 'sheet' && <><div className="rtp-mobile-top"><strong>Radar</strong><button type="button" aria-label="Search" onClick={() => togglePanel('Search')}><Search size={18} /></button></div><div className="rtp-mobile-dock">{nav('Layers')}{nav('Tools')}{nav('Source')}{nav('Alerts')}</div>{panelContent}</>}
    <div className="rtp-time"><button type="button" aria-label="Play radar preview"><Play size={12} fill="currentColor" /></button><span>4:30 PM</span><i /><strong>NOW</strong></div>
  </div>;
}

export function RadarToolPatterns() {
  return <section className="rtp-section" aria-labelledby="rtp-title">
    <div className="fl-section-title"><span>03 / RADAR WORKSPACES</span><h2 id="rtp-title">Where should the tools live?</h2><p>Hover or focus an icon to see its label. Click to open the matching menu and try the layer settings.</p></div>
    <div className="rtp-grid">
      <article className="rtp-concept"><div className="rtp-caption"><span>01 / DESKTOP</span><h3>Layer rail</h3><p>Icon-only rail with hover labels. A click opens the chosen tool group in a compact popover beside it.</p></div><RadarPattern variant="rail" /><div className="rtp-note"><strong>Best for</strong><span>Large screens and frequent layer changes</span></div></article>
      <article className="rtp-concept"><div className="rtp-caption"><span>02 / COMPACT</span><h3>Icon command bar</h3><p>Minimal top toolbar with labels on hover. Click an icon for its dropdown menu.</p></div><RadarPattern variant="bar" /><div className="rtp-note"><strong>Best for</strong><span>Medium screens and a clean map edge</span></div></article>
      <article className="rtp-concept"><div className="rtp-caption"><span>03 / MOBILE</span><h3>Bottom sheet</h3><p>Icon-only dock opens a labeled sheet, since touch screens have no reliable hover.</p></div><RadarPattern variant="sheet" /><div className="rtp-note"><strong>Best for</strong><span>Phones and one-handed use</span></div></article>
    </div>
    <p className="rtp-guidance"><SlidersHorizontal size={16} /> Keep layers one tap away. Put source, station, coverage, and measurement in a second level. Keep playback anchored to the map in every layout.</p>
  </section>;
}
