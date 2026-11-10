'use client';

import { useState, type CSSProperties } from 'react';
import {
  Check, ChevronDown, CloudRain, Layers3, RadioTower, Ruler, Search,
  Thermometer, Tornado, TriangleAlert, Wind, X, Zap,
  type LucideIcon,
} from 'lucide-react';
import './icon-bar-studies.css';

type Tool = { name: string; icon: LucideIcon; color: string; group: 'weather' | 'utility' | 'action' };
const tools: Tool[] = [
  { name: 'Precipitation', icon: CloudRain, color: '#2563eb', group: 'weather' },
  { name: 'Storm tracks', icon: Tornado, color: '#7c3aed', group: 'weather' },
  { name: 'Lightning', icon: Zap, color: '#facc15', group: 'weather' },
  { name: 'Wind', icon: Wind, color: '#0f766e', group: 'weather' },
  { name: 'Temperature', icon: Thermometer, color: '#ea580c', group: 'weather' },
  { name: 'Measure', icon: Ruler, color: '#475569', group: 'utility' },
  { name: 'Coverage', icon: RadioTower, color: '#416453', group: 'utility' },
  { name: 'Radar source', icon: Layers3, color: '#334155', group: 'utility' },
  { name: 'Search', icon: Search, color: '#475569', group: 'action' },
  { name: 'Alerts', icon: TriangleAlert, color: '#dc2626', group: 'action' },
];

type Style = 'outline' | 'accent' | 'grouped' | 'underline';
const studies: { style: Style; number: string; title: string; description: string; point: string }[] = [
  { style: 'outline', number: '01', title: 'Quiet circles', description: 'White circles hold the familiar rhythm. Hover reveals each tool’s original color; the active layer stays black at rest.', point: 'Color appears on hover' },
  { style: 'accent', number: '02', title: 'Color signals', description: 'White buttons and fine rules. Weather icons carry their layer color; tool and utility icons stay black.', point: 'Easiest layer recognition' },
  { style: 'grouped', number: '03', title: 'Grouped dock', description: 'Layers, map tools, and actions sit in three compact groups. Each icon fills with its original color on hover.', point: 'Color appears on hover' },
  { style: 'underline', number: '04', title: 'Bare minimum', description: 'A thin baseline replaces button shapes. A short accent mark shows active layers without coloring the whole toolbar.', point: 'Most map visibility' },
];

function IconBar({ style }: { style: Style }) {
  const [open, setOpen] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(['Precipitation']);
  const [opacity, setOpacity] = useState(75);
  const [source, setSource] = useState('NOAA national');
  const [query, setQuery] = useState('');
  const current = tools.find(tool => tool.name === open);
  const isLayer = current?.group === 'weather';
  const isEnabled = current ? enabled.includes(current.name) : false;

  function toggleLayer(name: string) { setEnabled(items => items.includes(name) ? items.filter(item => item !== name) : [...items, name]); }

  return <div className={`ibs-demo ibs-${style}`}>
    <div className="ibs-map" aria-hidden="true"><i /><i /><span>ROGERS</span><span>BENTONVILLE</span></div>
    <div className="ibs-bar-scroll"><div className="ibs-bar" role="toolbar" aria-label={`${style} radar toolbar preview`}>
      {tools.map((tool, index) => {
        const Icon = tool.icon;
        return <button type="button" key={tool.name} className={`ibs-tool${open === tool.name ? ' is-open' : ''}${enabled.includes(tool.name) ? ' is-enabled' : ''} ibs-${tool.group}${index === 5 || index === 8 ? ' ibs-group-start' : ''}`} style={{ '--accent': tool.color, '--accent-ink': tool.name === 'Lightning' ? '#111' : '#fff' } as CSSProperties} aria-label={`Open ${tool.name.toLowerCase()} menu`} aria-expanded={open === tool.name} onClick={() => setOpen(current => current === tool.name ? null : tool.name)}>
          <Icon size={21} strokeWidth={1.9} aria-hidden="true" />
          <span className="ibs-tooltip">{tool.name}</span>
          {tool.name === 'Alerts' && <i className="ibs-alert-dot" />}
        </button>;
      })}
    </div></div>
    {current && <div className="ibs-menu" aria-label={`${current.name} menu`}>
      <div className="ibs-menu-head"><div><small>{isLayer ? 'MAP LAYER' : 'RADAR TOOL'}</small><strong>{current.name}</strong></div><button type="button" aria-label="Close menu" onClick={() => setOpen(null)}><X size={16} /></button></div>
      {isLayer && <div className="ibs-menu-body"><button type="button" className="ibs-check-row" aria-pressed={isEnabled} onClick={() => toggleLayer(current.name)}><span>Show on map</span><i className={isEnabled ? 'is-checked' : ''}>{isEnabled && <Check size={12} strokeWidth={3} />}</i></button><label htmlFor={`ibs-opacity-${style}`}>Opacity <b>{opacity}%</b></label><input id={`ibs-opacity-${style}`} type="range" min="0" max="100" value={opacity} onChange={event => setOpacity(Number(event.target.value))} /></div>}
      {open === 'Radar source' && <div className="ibs-menu-body"><label htmlFor={`ibs-source-${style}`}>Source</label><div className="ibs-select"><select id={`ibs-source-${style}`} value={source} onChange={event => setSource(event.target.value)}><option>NOAA national</option><option>NOAA station</option><option>RainViewer</option><option>Demo</option></select><ChevronDown size={16} /></div><small>Choose imagery provider and station.</small></div>}
      {open === 'Search' && <div className="ibs-menu-body"><label htmlFor={`ibs-search-${style}`}>Find a place</label><input id={`ibs-search-${style}`} className="ibs-search" value={query} onChange={event => setQuery(event.target.value)} placeholder="City or ZIP code" /></div>}
      {open === 'Alerts' && <div className="ibs-menu-body ibs-alert"><strong>Thunderstorm watch</strong><span>Benton County · Until 7:00 PM</span></div>}
      {(open === 'Measure' || open === 'Coverage') && <div className="ibs-menu-body"><button type="button" className="ibs-menu-action" onClick={() => setOpen(null)}>{open === 'Measure' ? 'Start measuring' : 'Show coverage'}</button><small>{open === 'Measure' ? 'Pick two points on the map.' : 'View radar extent and station status.'}</small></div>}
    </div>}
    <div className="ibs-demo-label">{style === 'outline' || style === 'grouped' ? 'HOVER FOR COLOR + LABEL' : 'HOVER FOR LABEL'} <span>·</span> CLICK FOR MENU</div>
  </div>;
}

export function IconBarStudies() {
  return <section className="ibs-section" aria-labelledby="ibs-title">
    <div className="fl-section-title"><span>04 / ICON BAR STUDIES</span><h2 id="ibs-title">Same tools. Four expressions.</h2><p>Starting with the ten-icon radar bar you shared. All four keep labels on hover or focus and open a menu on click.</p></div>
    <div className="ibs-grid">{studies.map(study => <article className="ibs-card" key={study.style}><div className="ibs-caption"><span>{study.number} / TOOLBAR STUDY</span><h3>{study.title}</h3><p>{study.description}</p></div><IconBar style={study.style} /><div className="ibs-takeaway"><span>{study.point}</span><span>10 TOOLS</span></div></article>)}</div>
  </section>;
}
