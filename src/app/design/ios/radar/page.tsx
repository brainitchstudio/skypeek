import {
  Bell, CalendarDays, ChevronDown, ChevronLeft, ChevronRight, Clock3,
  CloudRain, Crosshair, Droplets, Layers3, MapPin, Navigation,
  Pause, Play, Radar, Search, ShieldAlert, SlidersHorizontal, Sun,
  Wind,
} from 'lucide-react';
import '../ios.css';
import './radar-options.css';

function MapBase({ variant = 'blue' }: { variant?: 'blue' | 'dark' | 'light' }) {
  return <div className={`radar-option-map radar-option-map-${variant}`} aria-hidden="true">
    <svg viewBox="0 0 380 760" preserveAspectRatio="xMidYMid slice">
      <rect width="380" height="760" fill="currentColor" />
      <path className="water" d="M-40 150 C76 175 119 248 180 293 S348 326 423 388 M-28 615 C91 562 130 597 218 648 S345 698 425 653" fill="none" strokeWidth="47" />
      <g className="minor-roads" fill="none" strokeWidth="3"><path d="M-25 80 L405 515 M-10 250 L389 606 M35 -20 L297 789 M-12 483 L386 249 M-10 704 L393 408 M118 -20 L380 764" /></g>
      <g className="major-roads" fill="none" strokeWidth="9"><path d="M-30 370 L412 371 M208 -20 L171 789 M-20 687 L394 129" /></g>
      <g className="road-centers" fill="none" strokeWidth="2"><path d="M-30 370 L412 371 M208 -20 L171 789 M-20 687 L394 129" /></g>
      <g className="map-labels" fontSize="13" fontFamily="Arial, sans-serif"><text x="35" y="197">Centerton</text><text x="228" y="276">Bentonville</text><text x="34" y="517">Cave Springs</text><text x="250" y="673">Rogers</text></g>
      <g className="rain-fields"><path d="M-14 245 C14 168 104 172 146 201 C196 187 245 242 228 286 C250 321 225 374 175 379 C135 354 76 383 37 353 C-7 326-27 282-14 245Z"/><path d="M130 380 C160 341 230 326 270 367 C322 376 348 426 327 468 C339 512 291 546 250 529 C197 544 154 519 143 482 C113 456 107 411 130 380Z"/><path d="M18 572 C54 543 112 557 137 600 C158 645 97 680 56 660 C11 648-6 606 18 572Z"/></g>
      <g className="rain-cores"><path d="M58 238 C84 218 131 226 145 258 C173 283 143 319 109 307 C70 316 42 277 58 238Z"/><path d="M204 405 C230 388 275 405 282 436 C303 461 271 488 237 477 C203 481 181 436 204 405Z"/></g>
    </svg>
  </div>;
}

function Status() {
  return <div className="ios-status"><b>9:41</b><div className="ios-island"/><span className="ios-status-icons">▂▄▆ &nbsp;◕&nbsp; ▰</span></div>;
}

function TabBar() {
  return <nav className="radar-option-tabs"><div><Sun size={21}/><span>Today</span></div><div><Wind size={21}/><span>Hourly</span></div><div><CalendarDays size={21}/><span>10 Day</span></div><div className="selected"><Radar size={21}/><span>Radar</span></div><div><Bell size={21}/><span>Alerts</span><i/></div></nav>;
}

function Phone({ eyebrow, title, description, children, mode }: { eyebrow: string; title: string; description: string; children: React.ReactNode; mode: string }) {
  return <article className="radar-option-study"><div className="radar-option-caption"><span>{eyebrow}</span><h2>{title}</h2><p>{description}</p></div><div className={`ios-phone radar-option-phone ${mode}`} aria-label={`${title} radar mockup`}><Status/><div className="radar-option-screen">{children}</div><TabBar/><div className="ios-home-indicator"/></div></article>;
}

function Legend() {
  return <div className="radar-option-legend"><span>LIGHT</span><div/><span>HEAVY</span></div>;
}

function Immersive() {
  return <Phone eyebrow="OPTION 01 / MAP FIRST" title="The immersive map" description="The largest map, with playback and tools as compact floating controls. Best for tracking a storm as it moves." mode="radar-immersive">
    <MapBase variant="blue"/><div className="radar-immersive-top"><div className="radar-immersive-title"><span>SKY PEEK / RADAR</span><h3>Bentonville <ChevronDown size={17}/></h3></div><div className="radar-immersive-layer"><Layers3 size={20}/></div></div><div className="radar-immersive-search"><Search size={17}/><span>Search map</span></div><div className="radar-immersive-pin"><MapPin size={27} fill="currentColor"/></div><div className="radar-immersive-actions"><div><Crosshair size={19}/></div><div><Navigation size={19}/></div></div><div className="radar-immersive-bottom"><div className="radar-immersive-live"><span><i/> LIVE RADAR</span><span>NOAA · 3:35 PM</span></div><div className="radar-immersive-play"><Play size={21} fill="currentColor"/><span>3:00</span><div className="radar-timeline"><i/></div><span>3:35</span></div><Legend/><div className="radar-immersive-pills"><span><Layers3 size={15}/> Layers</span><span><CloudRain size={15}/> Precipitation</span><span><SlidersHorizontal size={15}/> More</span></div></div>
  </Phone>;
}

function ForecastSplit() {
  return <Phone eyebrow="OPTION 02 / MAP + DETAIL" title="The forecast lens" description="A balanced map and information sheet. Best for checking what radar means for a saved place." mode="radar-forecast">
    <MapBase variant="light"/><div className="radar-forecast-top"><div className="radar-forecast-heading"><div><span>RADAR FOR</span><h3>Bentonville <ChevronDown size={16}/></h3></div><span className="radar-forecast-button"><Layers3 size={18}/></span></div><div className="radar-forecast-time"><span><i/> OBSERVED</span><span>NOAA NATIONAL · 3:35 PM</span></div></div><div className="radar-forecast-pin"><MapPin size={25} fill="currentColor"/></div><div className="radar-forecast-sheet"><div className="radar-sheet-handle"/><div className="radar-sheet-top"><div><span>AT YOUR PLACE</span><h4>Rain approaching</h4></div><CloudRain size={33}/></div><p>Scattered showers are moving northeast. Light rain may reach Bentonville around 4:20 PM.</p><div className="radar-forecast-metrics"><div><Clock3 size={17}/><b>~45 min</b><span>estimated arrival</span></div><div><Droplets size={17}/><b>Light</b><span>expected rain</span></div><div><Wind size={17}/><b>NE 12</b><span>mph movement</span></div></div><div className="radar-forecast-play"><Pause size={17} fill="currentColor"/><span>3:00 PM</span><div className="radar-timeline"><i/></div><span>3:35 PM</span></div><div className="radar-forecast-footer"><span>Radar observed at 3:35 PM</span><span>Details <ChevronRight size={15}/></span></div><div className="radar-forecast-spot"><MapPin size={17}/><span>Check another spot</span><ChevronRight size={16}/></div></div>
  </Phone>;
}

function Safety() {
  return <Phone eyebrow="OPTION 03 / ALERT AWARE" title="The safety view" description="Weather hazards and storm tools take priority. Best for warning situations and spot checks." mode="radar-safety">
    <MapBase variant="dark"/><div className="radar-safety-top"><div className="radar-safety-title"><div><span>SKY PEEK</span><h3>Radar</h3></div><span><Layers3 size={20}/></span></div><div className="radar-safety-search"><Search size={17}/> Bentonville, Arkansas <ChevronDown size={16}/></div></div><div className="radar-safety-warning-shape"/><div className="radar-safety-warning-label"><ShieldAlert size={17}/><span>Severe thunderstorm warning area</span></div><div className="radar-safety-pin"><MapPin size={26} fill="currentColor"/></div><div className="radar-safety-tools"><span><Crosshair size={18}/></span><span><Navigation size={18}/></span></div><div className="radar-safety-bottom"><div className="radar-safety-alert"><div><ShieldAlert size={20}/><b>Warning nearby</b><span>Until 4:15 PM</span></div><p>Severe thunderstorm warning west of Bentonville. Your selected place is outside the warning area.</p><span>View official alert <ChevronRight size={15}/></span></div><div className="radar-safety-control"><Play size={17} fill="currentColor"/><span>3:35 PM</span><div className="radar-timeline"><i/></div><span>Now</span></div><div className="radar-safety-spot"><MapPin size={18}/><span>SpotCheck a place on the map</span><ChevronRight size={16}/></div></div>
  </Phone>;
}

export default function RadarOptionsPage() {
  return <main className="radar-options-page"><header className="radar-options-nav"><a href="/design/ios"><ChevronLeft size={17}/> iOS screens</a><span>SKY PEEK / RADAR STUDIES</span><a href="/">Open app ↗</a></header><section className="radar-options-intro"><span>THREE DIRECTIONS / ONE RADAR</span><h1>How should the<br/>storm <em>feel?</em></h1><p>Each option keeps observation time, source, playback, layers, and place context visible. The emphasis shifts between map exploration, an actionable forecast, and alert awareness.</p><a className="radar-options-desktop-link" href="/design/ios/radar/desktop">See options matched to the desktop UI <ChevronRight size={17}/></a></section><div className="radar-options-grid"><Immersive/><ForecastSplit/><Safety/></div><footer className="radar-options-footer"><span>SKY PEEK / iOS RADAR</span><span>Concept mockups · Illustrative weather and alerts</span></footer></main>;
}
