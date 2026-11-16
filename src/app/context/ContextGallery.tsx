'use client';

import { useEffect, useState } from 'react';
import { ArrowLeft, CalendarDays, ChartNoAxesColumn, ChevronDown, ChevronRight, Info, Radar, Settings, Sun, TriangleAlert, X } from 'lucide-react';
import { TodayBackground } from '@/components/TodayBackground';
import { Icon, Segmented } from '@/components/ui';

type Scenario = 'unusual' | 'typical' | 'unclear' | 'unavailable';
type Placement = 'summary' | 'strip' | 'sheet' | 'panel';

const placements: { id: Placement; name: string; location: string; benefit: string; tradeoff: string }[] = [
  { id: 'summary', name: 'Under the summary', location: 'A single line in Today', benefit: 'Keeps the forecast as the focus. Good starting point for an insight worth noticing.', tradeoff: 'Needs concise copy so it does not compete with the forecast summary.' },
  { id: 'strip', name: 'Inside the forecast strip', location: 'Beside the next few hours', benefit: 'Makes context feel like part of the existing forecast controls.', tradeoff: 'The strip has limited room on smaller screens.' },
  { id: 'sheet', name: 'Open a detail sheet', location: 'On request from Today', benefit: 'Leaves Today almost untouched until someone asks to learn more.', tradeoff: 'Less discoverable unless the entry point is clear.' },
  { id: 'panel', name: 'A contextual side panel', location: 'Desktop panel, mobile sheet', benefit: 'Room for sources, ranges, and definitions without compressing the forecast.', tradeoff: 'Should appear only after a deliberate tap.' },
];
const states: [Scenario, string][] = [['unusual', 'Unusual'], ['typical', 'Typical'], ['unclear', 'Unclear'], ['unavailable', 'Unavailable']];
const wording: Record<Scenario, { headline: string; short: string; detail: string; source: string }> = {
  unusual: { headline: 'Warmer than usual for this date', short: 'The forecast high is above the usual range for mid-November.', detail: 'A forecast daily high is compared with historical daily highs for the same time of year. This is a projection, not an observed record.', source: 'Illustrative NOAA 1991 to 2020 baseline' },
  typical: { headline: 'Within the usual range', short: 'The forecast high is within the usual range for this date.', detail: 'An ordinary high can still come with unusual wind, rain, or a fast change later in the day.', source: 'Illustrative NOAA 1991 to 2020 baseline' },
  unclear: { headline: 'Comparison unclear', short: 'Forecast sources disagree enough that an unusualness claim could mislead.', detail: 'Sky Peek can still show the forecast. It waits to describe how unusual the day is until the likely range supports a clear statement.', source: 'Comparison withheld' },
  unavailable: { headline: 'Local history unavailable', short: 'The forecast is available, but a reliable local comparison is not.', detail: 'The weather view remains available. Sky Peek leaves the comparison blank until a suitable baseline returns.', source: 'No suitable local baseline' },
};
const hours = [['Now', 'sun', '67°'], ['11 AM', 'sun', '68°'], ['12 PM', 'partly', '69°'], ['1 PM', 'partly', '68°'], ['2 PM', 'sun', '67°']] as const;

function DetailContent({ scenario }: { scenario: Scenario }) {
  const copy = wording[scenario];
  const hasComparison = scenario === 'unusual' || scenario === 'typical';
  return <><div className="cx-detail-label">Today’s context</div><h3>{copy.headline}</h3><p>{copy.short}</p>
    {hasComparison && <div className="cx-detail-range" aria-label={scenario === 'unusual' ? 'Illustrative marker above the usual range' : 'Illustrative marker within the usual range'}><span>Cooler</span><div className="cx-range-track"><i /><b className={scenario} /></div><span>Warmer</span></div>}
    <div className="cx-detail-explanation">{copy.detail}</div><div className="cx-detail-source">{copy.source}</div></>;
}

function Preview({ placement, scenario }: { placement: Placement; scenario: Scenario }) {
  const [open, setOpen] = useState(false);
  const selected = placements.find(item => item.id === placement)!;
  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [open]);
  return <div className="cx-preview-wrap"><div className="cx-preview-top"><span>Sky Peek Today preview</span><span>Tap the context control in the preview</span></div>
    <div className={`cx-stage app app-branded app-today${placement === 'panel' && open ? ' cx-panel-open' : ''}`}><header className="app-brand" aria-label="SkyPeek"><span aria-hidden="true">SkyPeek</span></header>
      <div className="screen today today-afternoon" data-weather="partly"><TodayBackground scene={{ time: 'afternoon', weather: 'partly' }} />
        <div className="today-hero"><div className="today-temp">67°</div><div className="today-location"><div className="today-loc cx-place">Bentonville, AR <ChevronDown size={18} aria-hidden="true" /></div><div className="live-note">Thursday</div></div>
          <div className="today-cond"><Icon kind="partly" /><div>Partly sunny</div><div className="muted">69° / 44°</div></div><div className="today-summary">Clear through the afternoon. A cool evening ahead.</div>
          {placement === 'summary' && <button type="button" className="cx-summary-entry" aria-expanded={open} onClick={() => setOpen(true)}><Info size={16} aria-hidden="true" /><span>{scenario === 'unusual' ? wording[scenario].headline : 'Explore this weather'}</span><ChevronRight size={16} aria-hidden="true" /></button>}
          {(placement === 'sheet' || placement === 'panel') && <button type="button" className="cx-explore-entry" aria-expanded={open} onClick={() => setOpen(true)}><Info size={16} aria-hidden="true" /> Explore this weather</button>}
        </div>
        <div className="today-hours cx-hours">{hours.map(([time, kind, temp]) => <div className="cx-hour" key={time}><span className="t">{time}</span><Icon kind={kind} /><span className="v">{temp}</span></div>)}{placement === 'strip' && <button type="button" className="cx-strip-entry" aria-expanded={open} onClick={() => setOpen(true)}><Info size={18} aria-hidden="true" /><span>Context</span></button>}</div>
      </div>
      {placement !== 'panel' && open && <><button type="button" className="cx-sheet-scrim" onClick={() => setOpen(false)} aria-label="Close context" /><div className="cx-detail-sheet" role="dialog" aria-modal="true" aria-label="Weather context"><button type="button" className="cx-close" onClick={() => setOpen(false)} aria-label="Close context"><X size={20} /></button><DetailContent scenario={scenario} /></div></>}
      {placement === 'panel' && open && <div className="cx-side-panel" role="dialog" aria-label="Weather context"><button type="button" className="cx-close" onClick={() => setOpen(false)} aria-label="Close context"><X size={20} /></button><DetailContent scenario={scenario} /></div>}
      <div className="cx-preview-dock" aria-hidden="true"><Sun size={18} /><ChartNoAxesColumn size={18} /><CalendarDays size={18} /><Radar size={18} /><TriangleAlert size={18} /><Settings size={18} /></div>
    </div><div className="cx-preview-caption"><strong>{selected.name}</strong><span>{selected.location}</span></div></div>;
}

export function ContextGallery() {
  const [placement, setPlacement] = useState<Placement>('summary');
  const [scenario, setScenario] = useState<Scenario>('unusual');
  const selected = placements.find(item => item.id === placement)!;
  return <main className="context-page"><header className="cx-header"><div className="cx-header-inner"><a href="/app" className="cx-brand">SkyPeek</a><span>Context design study</span><a href="/app" className="cx-back"><ArrowLeft size={16} aria-hidden="true" /> Back to app</a></div></header>
    <div className="cx-page-inner"><div className="cx-intro"><div><h1>Weather context</h1><p>Four placements for useful explanations and local history, designed inside Sky Peek.</p></div><span>Concept preview. No live climate comparison.</span></div>
      <section className="cx-workbench" aria-label="Context design options"><div className="cx-controls"><h2>Choose a placement</h2><div className="cx-placement-list" role="radiogroup" aria-label="Context placement">{placements.map((item, index) => <button key={item.id} type="button" role="radio" aria-checked={placement === item.id} onClick={() => setPlacement(item.id)}><span className="cx-option-number">{String(index + 1).padStart(2, '0')}</span><span><strong>{item.name}</strong><small>{item.location}</small></span><ChevronRight size={17} aria-hidden="true" /></button>)}</div>
        <div className="cx-state-control"><h2>Try a data state</h2><Segmented options={states} value={scenario} onChange={setScenario} className="cx-segment" /><p>See how each placement handles ordinary, uncertain, or unavailable data.</p><p className="cx-preview-status" role="status">Previewing {selected.name.toLowerCase()} with {scenario} data.</p><p className="cx-interaction-note">The placement choices, data states, and context prompt are interactive. Forecast and navigation details are illustrative.</p></div>
        </div><Preview key={placement} placement={placement} scenario={scenario} /><div className="cx-option-reading"><h2>{selected.name}</h2><p><strong>Why it fits</strong>{selected.benefit}</p><p><strong>Design risk</strong>{selected.tradeoff}</p></div></section>
      <section className="cx-info-section" aria-labelledby="cx-pitch-title"><div><h2 id="cx-pitch-title">Why add context?</h2><p>Sky Peek shows what the weather is. Context can explain what it means for this place and time, while staying out of the way until it helps.</p></div><div className="cx-info-list"><article><h3>More meaningful forecasts</h3><p>“Warm” gains local meaning when a daily high can be compared with a trustworthy historical range.</p></article><article><h3>Learning at the right moment</h3><p>Short explanations live beside the forecast, radar feature, or term that prompted the question.</p></article><article><h3>Trust through restraint</h3><p>When a comparison is weak or missing, the core weather view remains intact and the claim is withheld.</p></article></div></section>
      <section className="cx-info-section" aria-labelledby="cx-plan-title"><div><h2 id="cx-plan-title">Project plan</h2><p>Start with one defined comparison, then expand the knowledge layer after the data and wording rules hold up.</p></div><div className="cx-info-list cx-plan-list"><article><span>First</span><h3>Daily temperature</h3><p>Match forecast highs and lows to NOAA daily normals for a suitable station or area. Label forecast comparisons as projections.</p></article><article><span>Next</span><h3>Weather explanations</h3><p>Add reviewed definitions to rain chance, radar reflectivity, and storm movement where people inspect those features.</p></article><article><span>Later</span><h3>Historical events</h3><p>Use dated nearby reports only when relevant. Show distance and source; never suggest a past storm predicts today’s outcome.</p></article></div></section>
      <section className="cx-info-section" aria-labelledby="cx-rules-title"><div><h2 id="cx-rules-title">Accuracy rules</h2><p>Every insight needs a matching measure, date, place, source, and observation or forecast label.</p></div><div className="cx-info-list"><article><h3>Compare like with like</h3><p>Daily high to daily high. Current observation to a matching time of day. Rain chance is not rainfall amount.</p></article><article><h3>Show the reference</h3><p>Give the baseline period and station or area in the expanded view, with any meaningful data limitation.</p></article><article><h3>Handle failure quietly</h3><p>Missing, stale, or unrepresentative history removes the comparison. Definitions remain available on request.</p></article></div></section>
      <footer className="cx-footer"><span>Mock weather and comparisons are illustrative.</span><a href="https://www.ncei.noaa.gov/products/land-based-station/us-climate-normals" target="_blank" rel="noreferrer">NOAA climate normals</a></footer></div></main>;
}
