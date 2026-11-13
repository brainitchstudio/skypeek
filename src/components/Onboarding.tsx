'use client';

import { CalendarDays, ChartNoAxesColumn, Radar, Sun, TriangleAlert, type LucideIcon } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Screen } from '@/lib/settings';
import type { Release } from '@/lib/releases';
import { APP_VERSION } from '@/lib/releases';
import { BetaScene } from '@/app/access/BetaScene';
import type { Scene } from '@/lib/betaScene';
import type { Place } from '@/lib/types';
import { usePlaceSearch } from '@/lib/usePlaceSearch';
import { LocationMapPreview } from './LocationMapPreview';
import '@/app/access/beta-scene.css';
import './onboarding.css';

type TourStep = { screen: Screen; title: string; description: string; icon: LucideIcon; preview: string; previewAlt: string };
export const TOUR_STEPS: TourStep[] = [
  { screen: 'today', title: 'Your weather at a glance', description: 'See current conditions, the day’s range, and what is coming next for your chosen place.', icon: Sun, preview: 'today', previewAlt: 'Today screen showing current conditions and the next hours for Brooklyn, New York' },
  { screen: 'hourly', title: 'Follow the next hours', description: 'Move through temperature, precipitation chances, and wind as the day changes.', icon: ChartNoAxesColumn, preview: 'hourly', previewAlt: 'Hourly screen showing an hour-by-hour forecast' },
  { screen: 'days', title: 'Plan farther ahead', description: 'Compare the next ten days and open a day for a closer look.', icon: CalendarDays, preview: 'days', previewAlt: '10 Day screen comparing daily temperatures and rain chances' },
  { screen: 'radar', title: 'Explore the radar', description: 'Watch recent rain, switch map layers, and use SpotCheck to inspect a place or storm.', icon: Radar, preview: 'radar', previewAlt: 'Radar screen showing the map, timeline, and map layer controls' },
  { screen: 'alerts', title: 'Know when weather matters', description: 'Read official warnings and advisories that affect your area.', icon: TriangleAlert, preview: 'alerts', previewAlt: 'Alerts screen showing the no active alerts state for Brooklyn, New York' },
];

function useModal() {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    dialog.showModal();
    return () => { if (dialog.open) dialog.close(); };
  }, []);
  return ref;
}

function OnboardingFrame({ children, scene, titleId, onCancel, location = false, locationSelected = false, tour = false }: {
  children: ReactNode; scene: Scene; titleId: string; onCancel: () => void; location?: boolean; locationSelected?: boolean; tour?: boolean;
}) {
  const ref = useModal();
  return <dialog ref={ref} className="onboard-dialog" aria-labelledby={titleId}
    onCancel={event => { event.preventDefault(); onCancel(); }}>
    <BetaScene time={scene.time} weather={scene.weather} backdropOnly />
    <div className={`onboard-panel${location ? ' onboard-location-panel' : ''}${locationSelected ? ' onboard-location-selected-panel' : ''}${tour ? ' onboard-tour-panel' : ''}`}>{children}</div>
  </dialog>;
}

export function LocationWelcome({ scene, onChoose }: { scene: Scene; onChoose: (place: Place) => void }) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Place | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const { results, status } = usePlaceSearch(query);
  const showResults = query.trim().length >= 2 && !selected;
  const select = (place: Place) => { setSelected(place); setQuery(place.name); };
  return <OnboardingFrame scene={scene} titleId="location-title" onCancel={() => {}} location locationSelected={!!selected}>
    <div className="onboard-overline">WELCOME TO SKY PEEK</div>
    <h2 id="location-title">Where should we look first?</h2>
    <p>Choose a city or ZIP code to build your forecast, center the radar, and show nearby alerts.</p>
    <label className="onboard-search-label" htmlFor="onboard-place">Your first location</label>
    <div className="onboard-search-wrap">
      <input ref={input} id="onboard-place" className="onboard-search" autoFocus value={query}
        onChange={event => { setQuery(event.target.value); setSelected(null); }}
        onKeyDown={event => { if (event.key === 'Enter' && showResults && results[0]) select(results[0]); }}
        placeholder="Search city or ZIP code" autoComplete="off" aria-controls={showResults ? 'onboard-results' : undefined} aria-expanded={showResults} />
      {showResults && <div id="onboard-results" className="onboard-results" aria-live="polite">
        {results.slice(0, 5).map(place => <button type="button" key={place.id} onClick={() => select(place)}>
          <strong>{place.name}</strong><span>{place.region}</span>
        </button>)}
        {!results.length && <div className="onboard-search-status">{status === 'failed' ? 'Search is unavailable right now. Try again shortly.' : status === 'done' ? 'No places found. Try a nearby city.' : 'Searching…'}</div>}
      </div>}
    </div>
    {selected && <div className="onboard-selected">
      <div className="onboard-selected-head"><strong>{selected.name}</strong><span>{selected.region}</span></div>
      <LocationMapPreview place={selected} />
      <div className="onboard-actions onboard-location-actions">
        <button type="button" className="onboard-quiet" onClick={() => { setSelected(null); input.current?.focus(); }}>Choose another</button>
        <button type="button" className="onboard-primary" onClick={() => onChoose(selected)}>Confirm location <span aria-hidden>→</span></button>
      </div>
    </div>}
    <p className="onboard-location-note">You can add more places later in Settings.</p>
  </OnboardingFrame>;
}

export function WelcomeTour({ scene, step, onBack, onNext, onSkip }: {
  scene: Scene; step: number; onBack: () => void; onNext: () => void; onSkip: () => void;
}) {
  const current = TOUR_STEPS[step];
  const Icon = current.icon;
  return <OnboardingFrame scene={scene} titleId="tour-title" onCancel={onSkip} tour>
    <div className="onboard-preview" data-screen={current.screen}>
      <picture>
        <source media="(max-width: 600px)" srcSet={`/onboarding/${current.preview}-mobile.jpg`} />
        <img src={`/onboarding/${current.preview}.jpg`} width={1280} height={720} alt={current.previewAlt} />
      </picture>
    </div>
    <div className="onboard-preview-caption">Sample screen · Your weather and location will differ</div>
    <div className="onboard-overline onboard-step-label"><Icon size={15} strokeWidth={2} aria-hidden /> WELCOME TO SKY PEEK · {step + 1} OF {TOUR_STEPS.length}</div>
    <h2 id="tour-title">{current.title}</h2>
    <p>{current.description}</p>
    <div className="onboard-progress" aria-label={`Step ${step + 1} of ${TOUR_STEPS.length}`}>
      {TOUR_STEPS.map((_, i) => <span key={i} className={i === step ? 'active' : ''} />)}
    </div>
    <div className="onboard-actions">
      <button type="button" className="onboard-quiet" onClick={onSkip}>Skip tour</button>
      <div>
        {step > 0 && <button type="button" className="onboard-quiet" onClick={onBack}>Back</button>}
        <button type="button" className="onboard-primary" onClick={onNext} autoFocus>{step === TOUR_STEPS.length - 1 ? 'Finish' : 'Next'} <span aria-hidden>→</span></button>
      </div>
    </div>
  </OnboardingFrame>;
}

export function WhatsNew({ scene, releases, onClose }: { scene: Scene; releases: Release[]; onClose: () => void }) {
  return <OnboardingFrame scene={scene} titleId="release-title" onCancel={onClose}>
    <div className="onboard-icon"><Sun size={24} strokeWidth={1.8} aria-hidden /></div>
    <div className="onboard-overline">SKY PEEK · VERSION {APP_VERSION}</div>
    <h2 id="release-title">What’s new</h2>
    {releases.length ? releases.map(release => <section key={release.version} className="onboard-release-entry">
      <h3>{release.title} <small>v{release.version}</small></h3>
      <ul>{release.changes.map(change => <li key={change}>{change}</li>)}</ul>
    </section>) : <p>SkyPeek has been updated. Take a look around to see what’s new.</p>}
    <div className="onboard-actions"><span /><button type="button" className="onboard-primary" onClick={onClose} autoFocus>Explore SkyPeek <span aria-hidden>→</span></button></div>
  </OnboardingFrame>;
}
