import {
  Bell, ChevronDown, ChevronRight, Cloud, CloudRain, CloudSun,
  Compass, Droplets, Layers3, MapPin,
  Settings2, ShieldCheck,
  Sun, Wind,
} from 'lucide-react';
import { IOSMockupTabBar, type MockupScreen } from './IOSMockupTabBar';
import { CondensedRadarContent } from './radar/desktop/CondensedRadar';
import './ios.css';
import './radar/desktop/desktop-radar.css';

type Icon = typeof Sun;

function StatusBar({ light = false }: { light?: boolean }) {
  return <div className={`ios-status${light ? ' ios-status-light' : ''}`}><b>9:41</b><div className="ios-island" /><span className="ios-status-icons">▂▄▆ <span className="ios-wifi">◕</span> ▰</span></div>;
}

function Phone({ name, active, children, className = '' }: { name: string; active: MockupScreen; children: React.ReactNode; className?: string }) {
  return <article className="ios-study"><div className="ios-study-label"><span>{name}</span><span>iOS / {active.toUpperCase()}</span></div>
    <div className={`ios-phone ${className}`} aria-label={`${name} iOS mockup`}>
      <StatusBar /><div className="ios-screen">{children}</div><IOSMockupTabBar active={active} /><div className="ios-home-indicator" />
    </div>
  </article>;
}

function PlaceHeader({ title = 'Bentonville', right }: { title?: string; right?: React.ReactNode }) {
  return <header className="ios-place-header"><div><span className="ios-eyebrow">SKY PEEK <span className="ios-spark">✦</span></span><h2>{title} <ChevronDown size={18} /></h2></div>{right ?? <div className="ios-circle"><Settings2 size={19} /></div>}</header>;
}

function Today() {
  return <Phone name="01 / The daily view" active="Today" className="ios-today">
    <PlaceHeader /><div className="ios-today-hero"><div className="ios-hero-sun"><Sun size={96} strokeWidth={1.2} /></div><div className="ios-today-temp">67<span>°</span></div><div className="ios-condition">Mostly sunny</div><p>Clear skies through the afternoon.<br />A cool evening ahead.</p><div className="ios-high-low">H:69° &nbsp; L:44°</div></div>
    <div className="ios-today-bottom"><div className="ios-section-heading"><span>THE NEXT FEW HOURS</span><ChevronRight size={16} /></div><div className="ios-hour-strip">{[['Now',Sun,'67°'],['11 AM',Sun,'68°'],['12 PM',CloudSun,'69°'],['1 PM',CloudSun,'68°'],['2 PM',Sun,'67°']].map(([time, Glyph, temp]) => { const WeatherIcon = Glyph as Icon; return <div key={time as string}><span>{time as string}</span><WeatherIcon size={24} strokeWidth={1.7}/><b>{temp as string}</b></div>; })}</div><div className="ios-now-card"><span>Today feels like</span><strong>the perfect time to get outside.</strong><span>Sunset at 5:15 PM <ChevronRight size={14}/></span></div></div>
  </Phone>;
}

const hourly = [
  ['Now', Sun, '67°', '0%', '6 mph'], ['11 AM', Sun, '68°', '0%', '7 mph'],
  ['12 PM', CloudSun, '69°', '0%', '8 mph'], ['1 PM', CloudSun, '68°', '0%', '9 mph'],
  ['2 PM', Sun, '67°', '0%', '9 mph'], ['3 PM', CloudSun, '65°', '2%', '7 mph'],
];

function Hourly() {
  return <Phone name="02 / Hour by hour" active="Hourly" className="ios-paper">
    <PlaceHeader title="Hourly" /><div className="ios-content"><p className="ios-subtitle">Bentonville · Dry for the next 24 hours</p><div className="ios-segment"><b>Today</b><span>Tomorrow</span><span>Saturday</span></div><div className="ios-hour-focus"><div><span className="ios-eyebrow">RIGHT NOW</span><strong>67°</strong><span>Mostly sunny</span></div><Sun size={60} strokeWidth={1.35}/></div><div className="ios-list-heading">THURSDAY, NOVEMBER 5 <span>RAIN · WIND</span></div><div className="ios-hour-list">{hourly.map(([time, Glyph, temp, rain, wind]) => { const WeatherIcon = Glyph as Icon; return <div key={time as string}><b>{time as string}</b><WeatherIcon size={23} strokeWidth={1.6}/><strong>{temp as string}</strong><span><Droplets size={13}/>{rain as string}</span><small>{wind as string}</small></div>; })}</div><div className="ios-source">Forecast from the National Weather Service</div></div>
  </Phone>;
}

const days = [
  ['Today', Sun, '0%', '44°', '69°', 77, 100], ['Fri', CloudSun, '10%', '48°', '66°', 60, 91],
  ['Sat', CloudRain, '72%', '52°', '61°', 48, 78], ['Sun', CloudRain, '84%', '49°', '59°', 40, 73],
  ['Mon', CloudSun, '20%', '43°', '64°', 53, 86], ['Tue', Sun, '0%', '42°', '67°', 55, 94],
  ['Wed', Cloud, '15%', '46°', '62°', 57, 81],
];

function Days() {
  return <Phone name="03 / The next ten days" active="10 Day" className="ios-paper">
    <PlaceHeader title="10 Day" /><div className="ios-content"><p className="ios-subtitle">Bentonville · A rainy weekend ahead</p><div className="ios-days-summary"><CloudRain size={29} strokeWidth={1.6}/><div><b>Rain arrives Saturday</b><span>Plan for a dry Friday and a cooler, wet weekend.</span></div></div><div className="ios-list-heading">DAILY FORECAST <span>LOW — HIGH</span></div><div className="ios-days-list">{days.map(([day, Glyph, rain, low, high, start, end], index) => { const WeatherIcon = Glyph as Icon; return <div className={index === 0 ? 'current' : ''} key={day as string}><b>{day as string}</b><WeatherIcon size={24} strokeWidth={1.6}/><small>{rain as string}</small><span>{low as string}</span><div className="ios-temp-track"><i style={{left:`${start as number - 40}%`,width:`${(end as number) - (start as number)}%`}} /></div><strong>{high as string}</strong></div>; })}</div><div className="ios-uv-card"><div><Sun size={21}/><b>Sun & daylight</b></div><p>UV index 4 · Moderate</p><span>Sunrise 6:43 AM &nbsp; · &nbsp; Sunset 5:15 PM</span></div></div>
  </Phone>;
}

function RadarScreen() {
  return <Phone name="04 / Live radar" active="Radar" className="ios-radar-condensed dm-condensed"><CondensedRadarContent/></Phone>;
}

function Alerts() {
  return <Phone name="05 / Weather alerts" active="Alerts" className="ios-paper"><PlaceHeader title="Alerts" right={<div className="ios-circle"><Settings2 size={19}/></div>}/><div className="ios-content"><p className="ios-subtitle">Bentonville and nearby places</p><div className="ios-alert-feature"><div className="ios-alert-icon"><ShieldCheck size={29}/></div><span className="ios-eyebrow">YOUR AREA</span><h3>No active alerts</h3><p>There are no National Weather Service alerts for Bentonville right now.</p><div><span className="ios-live-dot"/> Monitoring for updates</div></div><div className="ios-list-heading">NEARBY ACTIVITY <span>VIEW MAP <ChevronRight size={15}/></span></div><div className="ios-nearby"><div className="ios-nearby-icon"><CloudRain size={22}/></div><div><b>Special Weather Statement</b><span>Washington County · 28 mi away</span></div><ChevronRight size={18}/></div><div className="ios-nearby"><div className="ios-nearby-icon amber"><Wind size={22}/></div><div><b>Wind Advisory</b><span>Eastern Oklahoma · 44 mi away</span></div><ChevronRight size={18}/></div><div className="ios-alert-note"><Bell size={18}/><span>Get notified when an alert affects a saved place.</span><ChevronRight size={17}/></div></div></Phone>;
}

function Settings() {
  return <Phone name="06 / Places & preferences" active="Settings" className="ios-paper ios-settings"><header className="ios-settings-header"><span className="ios-eyebrow">SKY PEEK</span><h2>Settings</h2></header><div className="ios-content"><div className="ios-list-heading">MY PLACES <span>EDIT</span></div><div className="ios-settings-group"><div><span className="ios-settings-icon blue"><MapPin size={18}/></span><span><b>Bentonville, AR</b><small>Current place · 67° and sunny</small></span><ChevronRight size={18}/></div><div><span className="ios-settings-icon"><MapPin size={18}/></span><span><b>Brooklyn, NY</b><small>Saved place · 63° and sunny</small></span><ChevronRight size={18}/></div><div className="ios-add-place">+ &nbsp; Add a place</div></div><div className="ios-list-heading">PREFERENCES</div><div className="ios-settings-group"><div><span className="ios-settings-icon"><Droplets size={18}/></span><span><b>Units</b></span><small>°F, mph</small><ChevronRight size={18}/></div><div><span className="ios-settings-icon"><Bell size={18}/></span><span><b>Notifications</b></span><small>Severe weather on</small><ChevronRight size={18}/></div><div><span className="ios-settings-icon"><Layers3 size={18}/></span><span><b>Radar layers</b></span><ChevronRight size={18}/></div></div><div className="ios-list-heading">ABOUT</div><div className="ios-settings-group"><div><span className="ios-settings-icon"><Compass size={18}/></span><span><b>Data sources</b></span><ChevronRight size={18}/></div><div><span className="ios-settings-icon"><ShieldCheck size={18}/></span><span><b>About Sky Peek</b></span><ChevronRight size={18}/></div></div><p className="ios-settings-footnote">Weather data from trusted public sources.<br/>Sky Peek for iOS · Concept preview</p></div></Phone>;
}

export default function IOSMockupsPage() {
  return <main className="ios-gallery"><header className="ios-gallery-header"><a href="/design">← Design studies</a><span>SKY PEEK / PRODUCT EXPLORATIONS</span><a href="/future">Try prototype ↗</a></header><div className="ios-gallery-intro"><span className="ios-eyebrow">A FULL iOS CONCEPT</span><h1>Weather, made<br/><em>for the moment.</em></h1><p>Six connected screens carry Sky Peek into a native iPhone experience. One quiet visual system for everyday forecasts, live radar, official alerts, and the places that matter.</p><a className="ios-gallery-radar-link" href="/design/ios/radar/desktop">Compare radar options matched to desktop <ChevronRight size={17}/></a></div><div className="ios-gallery-grid"><Today/><Hourly/><Days/><RadarScreen/><Alerts/><Settings/></div><footer className="ios-gallery-footer"><span>SKY PEEK / iOS</span><span>Concept mockups · Illustrative sample weather</span></footer></main>;
}
