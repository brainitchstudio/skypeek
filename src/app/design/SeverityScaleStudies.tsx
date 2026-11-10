'use client';

import { useState, type CSSProperties } from 'react';
import { ChevronDown, CloudRain, CloudSnow, MapPin, Tornado, type LucideIcon } from 'lucide-react';
import { PRECIP_HEX } from '@/radar/flat';
import './severity-scale-studies.css';

type Mode = 'rain' | 'snow' | 'storm';
type Orientation = 'horizontal' | 'vertical';
type Variant = 'spectrum' | 'edge' | 'steps' | 'reveal';
type Level = { name: string; detail: string; color: string };
type Scale = { label: string; icon: LucideIcon; levels: Level[]; note: string };

const scales: Record<Mode, Scale> = {
  rain: {
    label: 'Rain intensity', icon: CloudRain,
    levels: [
      { name: 'Light', detail: 'Scattered, light rain', color: PRECIP_HEX[0] },
      { name: 'Moderate', detail: 'Steady rain', color: PRECIP_HEX[1] },
      { name: 'Heavy', detail: 'Heavy downpour', color: PRECIP_HEX[2] },
      { name: 'Very heavy', detail: 'Intense downpour', color: PRECIP_HEX[3] },
    ],
    note: 'Uses Sky Peek’s existing four flat rain bands.',
  },
  snow: {
    label: 'Snow intensity', icon: CloudSnow,
    levels: [
      { name: 'Light', detail: 'Light snowfall', color: '#cce8f5' },
      { name: 'Moderate', detail: 'Steady snowfall', color: '#83c6e6' },
      { name: 'Heavy', detail: 'Heavy snowfall', color: '#398bc6' },
      { name: 'Very heavy', detail: 'Intense snowfall', color: '#234f9a' },
    ],
    note: 'Snow colors are a design proposal; source data and thresholds still need a mapping.',
  },
  storm: {
    label: 'Storm intensity', icon: Tornado,
    levels: [
      { name: 'Developing', detail: 'Developing storm activity', color: '#f3d350' },
      { name: 'Strong', detail: 'Strong storm activity', color: '#fa8927' },
      { name: 'Severe', detail: 'Severe storm activity', color: '#de3c37' },
      { name: 'Extreme', detail: 'Most intense tier', color: '#8d2e77' },
    ],
    note: 'Storm tiers are a design proposal; they are not a weather warning classification.',
  },
};

const studies: { variant: Variant; number: string; title: string; description: string; point: string }[] = [
  { variant: 'spectrum', number: '01', title: 'Compact spectrum', description: 'One continuous key with a selected band and short reading.', point: 'Fastest overall read' },
  { variant: 'edge', number: '02', title: 'Edge ruler', description: 'A compact key that can sit on either edge of the map.', point: 'Best beside the map' },
  { variant: 'steps', number: '03', title: 'Intensity steps', description: 'Separate, tappable categories with full text labels.', point: 'Most explicit categories' },
  { variant: 'reveal', number: '04', title: 'On-demand key', description: 'A small control expands the scale only when needed.', point: 'Cleanest map canvas' },
];

function ScaleDemo({ variant, mode, orientation }: { variant: Variant; mode: Mode; orientation: Orientation }) {
  const [selected, setSelected] = useState(1);
  const [expanded, setExpanded] = useState(false);
  const scale = scales[mode];
  const current = scale.levels[selected];
  const Icon = scale.icon;
  const buttons = <div className="sss-scale" role="group" aria-label={`${scale.label} scale`}>
    {scale.levels.map((level, index) => <button type="button" key={level.name} className={selected === index ? 'is-selected' : ''} aria-pressed={selected === index} aria-label={`${level.name}: ${level.detail}`} onClick={() => setSelected(index)}><i style={{ background: level.color }} /><span>{level.name}</span></button>)}
  </div>;

  return <div className={`sss-stage sss-${variant} is-${orientation}`} style={{ '--sss-map-accent': current.color } as CSSProperties}>
    <div className="sss-map" aria-hidden="true"><i /><i /><span className="sss-city">BENTONVILLE</span><MapPin size={15} className="sss-pin" /></div>
    {variant === 'spectrum' && <div className="sss-display sss-surface"><div className="sss-head"><span><Icon size={15} /> {scale.label.toUpperCase()}</span><strong>{current.name}</strong></div>{buttons}<p>{current.detail}</p></div>}
    {variant === 'edge' && <div className="sss-display sss-surface"><div className="sss-head"><span><Icon size={15} /> {scale.label.toUpperCase()}</span></div>{buttons}<p>{current.detail}</p></div>}
    {variant === 'steps' && <div className="sss-display sss-surface"><div className="sss-head"><span><Icon size={15} /> {scale.label.toUpperCase()}</span></div>{buttons}<p><strong>{current.name}</strong> · {current.detail}</p></div>}
    {variant === 'reveal' && <div className="sss-reveal"><button type="button" className="sss-reveal-trigger" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}><span className="sss-mini-scale">{scale.levels.map(level => <i key={level.name} style={{ background: level.color }} />)}</span><span>{scale.label}</span><ChevronDown size={15} /></button>{expanded && <div className="sss-display sss-surface"><div className="sss-head"><span>{scale.label.toUpperCase()}</span><strong>{current.name}</strong></div>{buttons}<p>{current.detail}</p></div>}</div>}
    <span className="sss-map-stamp">RADAR / SAMPLE VIEW</span>
  </div>;
}

export function SeverityScaleStudies() {
  const [mode, setMode] = useState<Mode>('rain');
  const [orientation, setOrientation] = useState<Orientation>('horizontal');
  return <section className="sss-section" aria-labelledby="sss-title">
    <div className="fl-section-title"><span>05 / SEVERITY SCALE STUDIES</span><h2 id="sss-title">One scale, three weather modes.</h2><p>Compare rain, snow, and storm intensity in horizontal or vertical layouts. Select a band to see how its reading appears.</p></div>
    <div className="sss-controls"><div><span>WEATHER MODE</span><div className="sss-control-group" role="group" aria-label="Weather mode">{(['rain', 'snow', 'storm'] as const).map(item => { const Icon = scales[item].icon; return <button type="button" key={item} className={mode === item ? 'is-selected' : ''} aria-pressed={mode === item} onClick={() => setMode(item)}><Icon size={16} />{item === 'storm' ? 'Severe weather' : item[0].toUpperCase() + item.slice(1)}</button>; })}</div></div><div><span>ORIENTATION</span><div className="sss-control-group" role="group" aria-label="Scale orientation">{(['horizontal', 'vertical'] as const).map(item => <button type="button" key={item} className={orientation === item ? 'is-selected' : ''} aria-pressed={orientation === item} onClick={() => setOrientation(item)}>{item === 'horizontal' ? <i className="sss-orientation-icon sss-horizontal-icon" /> : <i className="sss-orientation-icon sss-vertical-icon" />}{item[0].toUpperCase() + item.slice(1)}</button>)}</div></div></div>
    <div className="sss-grid">{studies.map(study => <article className="sss-card" key={study.variant}><div className="sss-caption"><span>{study.number} / SCALE STUDY</span><h3>{study.title}</h3><p>{study.description}</p></div><ScaleDemo variant={study.variant} mode={mode} orientation={orientation} /><div className="sss-takeaway"><span>{study.point}</span><span>{orientation.toUpperCase()}</span></div></article>)}</div>
    <p className="sss-note">{scales[mode].note} Provider-native imagery should display its matching source legend.</p>
  </section>;
}
