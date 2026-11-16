import {
  Bell, CalendarDays, ChevronDown, ChevronLeft, ChevronRight,
  Crosshair, Layers3, Map, MapPin, Minus, Play, Plus, RadioTower,
  Ruler, Search, Settings, SkipBack, SkipForward, Sun, Wind, X,
} from 'lucide-react';
import { IOSMockupTabBar } from '../../IOSMockupTabBar';
import { CondensedRadarContent, DesktopRadarMap } from './CondensedRadar';
import '../../ios.css';
import './desktop-radar.css';

function Status() { return <div className="dm-status"><b>9:41</b><span/><strong>▂▄▆ &nbsp;◕&nbsp; ▰</strong></div>; }

function Dock() {
  return <div className="dm-dock" aria-label="Desktop-style navigation preview">{[[MapPin,'Places'],[Sun,'Today'],[Wind,'Hourly'],[CalendarDays,'10 Day'],[RadioTower,'Radar'],[Bell,'Alerts'],[Settings,'Settings']].map(([Glyph,label]) => { const Icon = Glyph as typeof Sun; return <div className={label === 'Radar' ? 'active' : ''} key={label as string} title={label as string}><Icon size={18} strokeWidth={1.8}/></div>; })}</div>;
}

function Legend() { return <div className="dm-legend"><span>-20</span><span>-10</span><span>0</span><span>10</span><span>20</span><span>30</span><span>40</span><span>50</span><span>60</span><span>70</span><div/></div>; }

function Playback({ compact = false }: { compact?: boolean }) {
  return <div className={`dm-playback${compact ? ' compact' : ''}`}><div className="dm-playback-row"><SkipBack size={15}/><Play size={16} fill="currentColor"/><SkipForward size={15}/><span className="dm-speed">1× <ChevronDown size={12}/></span><span className="dm-range">6 h <ChevronDown size={12}/></span></div><div className="dm-playback-rail"><i/><span>3:33 PM</span></div><div className="dm-playback-latest">Now <ChevronRight size={13}/></div></div>;
}

function SearchBar() { return <div className="dm-search"><Search size={18}/><span>Search city, address, or county</span></div>; }

function Toolbar({ selected = false }: { selected?: boolean }) {
  return <div className="dm-toolbar"><SearchBar/><div className="dm-tool-icons"><span><Plus size={19}/></span><span><Minus size={19}/></span><span><Crosshair size={19}/></span><span className={selected ? 'on' : ''}><Layers3 size={19}/></span><span><RadioTower size={18}/></span><span><MapPin size={19}/></span><span><Ruler size={19}/></span></div></div>;
}

function Source() { return <div className="dm-source"><b>NOAA · National reflectivity</b><span>3:33 PM · 3 min ago · NOAA / NWS</span></div>; }

function LayersCard({ sheet = false }: { sheet?: boolean }) {
  return <div className={`dm-layers${sheet ? ' sheet' : ''}`}><div className="dm-layer-head"><div><small>MAP OVERLAYS</small><b>Layers</b></div><X size={17}/></div><div className="dm-layer-list">{['Precipitation','Storm tracks','Lightning','Wind','Temperature','Alerts'].map((item,index)=><div key={item}><span>{item}</span><i className={index === 0 ? 'checked' : ''}>{index === 0 ? '✓' : ''}</i></div>)}</div><p>Turn on Alerts to highlight affected counties and show NWS alert polygons where available.</p></div>;
}

function Frame({ number, title, description, mode, children }: { number: string; title: string; description: string; mode: string; children: React.ReactNode }) {
  const condensed = mode === 'dm-condensed';
  return <article className="dm-study"><div className="dm-caption"><span>{number}</span><h2>{title}</h2><p>{description}</p></div><div className={`dm-phone ${mode}`} aria-label={`${title} desktop-style iOS radar mockup`}><Status/><div className="dm-screen">{!condensed && <DesktopRadarMap/>}{children}</div>{condensed ? <IOSMockupTabBar active="Radar"/> : <Dock/>}<div className="dm-home"/></div></article>;
}

function DirectPort() { return <Frame number="OPTION 01 / CLOSEST TO DESKTOP" title="Direct translation" description="The desktop toolbar and Layers panel stack over the map. Familiar controls stay visible at a glance." mode="dm-direct"><div className="dm-top"><Toolbar selected/><Legend/></div><LayersCard/><div className="dm-location-dot"/><div className="dm-imagery"><Map size={15}/> Satellite</div><Source/><Playback/></Frame>; }

function CollapsedTools() { return <Frame number="OPTION 02 / SELECTED FOR iOS" title="Condensed controls" description="The desktop tools are condensed above the map, with the same bottom switcher used throughout the iOS mockups." mode="dm-condensed"><CondensedRadarContent/></Frame>; }

function SpotCheck() { return <Frame number="OPTION 03 / RADAR + SPOTCHECK" title="Inspection mode" description="A compact map toolbar leaves space for the desktop-style SpotCheck card when you select a point." mode="dm-spot"><div className="dm-top"><SearchBar/><div className="dm-condensed-tools"><span><Crosshair size={18}/></span><span><Layers3 size={18}/></span><span><RadioTower size={18}/></span><span><MapPin size={18}/></span><span><Ruler size={18}/></span><span className="dm-satellite"><Map size={18}/> Satellite</span></div><Legend/></div><div className="dm-location-dot"/><div className="dm-spot-card"><div><span>SPOTCHECK · BENTONVILLE</span><X size={16}/></div><h3>Storm moving northeast</h3><p>Estimated arrival at selected spot</p><strong>About 45 minutes</strong><div className="dm-spot-metrics"><span>Distance <b>12 mi</b></span><span>Speed <b>16 mph</b></span><span>Direction <b>NE</b></span></div><small>Movement estimate · Check official warnings</small></div><Source/><Playback compact/></Frame>; }

export default function DesktopRadarOptions() {
  return <main className="dm-page"><header className="dm-page-nav"><a href="/design/ios/radar"><ChevronLeft size={17}/> Radar studies</a><span>SKY PEEK / DESKTOP LANGUAGE</span><a href="/">Open app ↗</a></header><section className="dm-intro"><span>RADAR / DESKTOP STYLE ON iPHONE</span><h1>Same radar.<br/>Smaller canvas.</h1><p>Three mobile arrangements built from the live desktop screen’s visual language: light map, white tool surfaces, black playback, and fine rules. The chosen condensed option uses the iOS bottom switcher.</p></section><div className="dm-grid"><DirectPort/><CollapsedTools/><SpotCheck/></div><footer className="dm-footer">SKY PEEK / RADAR STUDIES <span>Concept mockups · Illustrative weather data</span></footer></main>;
}
