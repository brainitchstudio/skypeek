import { ArrowUpRight, Sun, CloudSun, Wind, Droplets, Sunrise, Radar, CalendarDays, SlidersHorizontal, ChartNoAxesColumn } from 'lucide-react';
import './design.css';
import { FlatLibrary } from './FlatLibrary';

const concepts = [
  { theme: 'paper', name: 'Quiet light', category: 'Minimalist / 01', description: 'Air, fine rules, and a single soft blue accent. The forecast gets all the attention.', tagline: 'A little sunshine. A lot of possibility.' },
  { theme: 'ink', name: 'After hours', category: 'Minimalist / 02', description: 'An inky canvas, luminous type, and a compact forecast. Quiet enough for your nightstand.', tagline: 'Your day, in a good light.' },
  { theme: 'ochre', name: 'Sunroom', category: 'Mid-century modern / 03', description: 'Butter yellow, burnt orange, and an oversized graphic sun. A sunny little daily ritual.', tagline: 'A bright outlook for a slower day.' },
  { theme: 'olive', name: 'Field notes', category: 'Mid-century modern / 04', description: 'Botanical green, warm paper, and editorial serif type. A forecast with a natural rhythm.', tagline: 'Good weather for getting outside.' },
  { theme: 'terra', name: 'Desert radio', category: 'Mid-century modern / 05', description: 'Terracotta, dusty pink, and geometric color blocking. Weather with a little personality.', tagline: 'Tune in to the day ahead.' },
];

export default function DesignPage() {
  return <main className="design-page">
    <header className="design-heading"><a href="/">SkyPeek <ArrowUpRight size={15} /></a><span>THE MOBILE EDITION · DESIGN STUDIES</span></header>
    <FlatLibrary />
    <section className="design-intro" id="concepts"><p>FIVE WAYS TO MEET THE DAY</p><h1>A forecast.<br />A feeling.</h1><div>Two quiet essentials. Three with a mid-century soul. Exploring Today on mobile, with the same sample forecast in every direction.</div></section>
    <div className="design-grid">{concepts.map((concept, index) => <article className="design-study" key={concept.theme}>
      <div className="design-caption"><span>{concept.category}</span><h2>{concept.name}</h2><p>{concept.description}</p></div>
      <div className={`phone ${concept.theme}`} aria-label={`${concept.name} mobile Today mockup`}>
        <div className="phone-status"><b>9:41</b><span aria-label="Full signal and battery">▮▮▮ &nbsp; ▰</span></div>
        <header className="phone-brand"><span>SkyPeek</span><span className="edition">{index > 1 ? 'DAILY / 05' : 'Today'}</span></header>
        <div className="phone-place"><span>Bentonville, AR</span><span>Thursday, November 5</span></div>
        <div className="phone-hero"><div className="sun-art" aria-hidden="true"><Sun strokeWidth={1} /></div><div className="phone-temp">67<span>°</span></div><div className="phone-condition">Sunny <span>H 69° &nbsp; L 44°</span></div></div>
        <div className="phone-summary"><span className="tiny-label">THE OUTLOOK</span><p>{concept.tagline}</p><small>Clear skies through the afternoon.<br />A cool, comfortable evening ahead.</small></div>
        <section className="phone-hourly" aria-label="Hourly sample forecast"><div className="forecast-label"><span>THE NEXT FEW HOURS</span><ArrowUpRight size={14} /></div><div className="hour-grid">{['Now', '11 AM', '12 PM', '1 PM'].map((hour, i) => <div key={hour}><span>{hour}</span>{i === 2 ? <CloudSun size={23} strokeWidth={1.4} /> : <Sun size={23} strokeWidth={1.4} />}<b>{[67, 68, 69, 68][i]}°</b></div>)}</div></section>
        <div className="phone-details"><div><Wind size={17} /><span>Wind<b>SW 6 mph</b></span></div><div><Droplets size={17} /><span>Rain chance<b>0%</b></span></div><div><Sunrise size={17} /><span>Sunset<b>5:15 PM</b></span></div></div>
        <nav className="phone-nav" aria-label={`${concept.name} navigation preview`}>{[[Sun, 'Today'], [ChartNoAxesColumn, 'Hourly'], [CalendarDays, '10 days'], [Radar, 'Radar'], [SlidersHorizontal, 'Settings']].map(([Glyph, label], i) => { const Icon = Glyph as typeof Sun; return <span className={i === 0 ? 'active' : ''} key={String(label)}><Icon size={19} strokeWidth={1.5} /><small>{String(label)}</small></span>; })}</nav>
        <div className="home-indicator" />
      </div>
    </article>)}</div>
    <footer className="design-footer">SKYPEEK / MOBILE EXPLORATIONS<span>Concept mockups · Sample weather</span></footer>
  </main>;
}
