'use client';

import { CalendarDays, ChartNoAxesColumn, Radar, Settings, Sun, TriangleAlert, type LucideIcon } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Screen } from '@/lib/settings';
import type { Release } from '@/lib/releases';
import { APP_VERSION } from '@/lib/releases';
import { BetaScene } from '@/app/access/BetaScene';
import type { Place } from '@/lib/types';
import { usePlaceSearch } from '@/lib/usePlaceSearch';
import '@/app/access/beta-scene.css';
import './onboarding.css';

type TourStep = { screen: Screen; title: string; description: string; icon: LucideIcon };
export const TOUR_STEPS: TourStep[] = [
  { screen: 'today', title: 'Your weather at a glance', description: 'See current conditions, the day’s range, and what is coming next for your chosen place.', icon: Sun },
  { screen: 'hourly', title: 'Follow the next hours', description: 'Move through temperature, precipitation chances, and wind as the day changes.', icon: ChartNoAxesColumn },
  { screen: 'days', title: 'Plan farther ahead', description: 'Compare the next ten days and open a day for a closer look.', icon: CalendarDays },
  { screen: 'radar', title: 'Explore the radar', description: 'Watch recent rain, switch map layers, and use SpotCheck to inspect a place or storm.', icon: Radar },
  { screen: 'alerts', title: 'Know when weather matters', description: 'Read official warnings and advisories that affect your area.', icon: TriangleAlert },
  { screen: 'settings', title: 'Make Sky Peek yours', description: 'Save places, choose your units, and set alert and radar preferences.', icon: Settings },
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

const SCENES = [
  ['morning', 'clear'], ['afternoon', 'clear'], ['afternoon', 'cloudy'],
  ['evening', 'rain'], ['night', 'storm'], ['morning', 'fog'], ['night', 'clear'],
] as const;

function OnboardingFrame({ children, scene = 0, titleId, onCancel }: {
  children: ReactNode; scene?: number; titleId: string; onCancel: () => void;
}) {
  const ref = useModal();
  const [time, weather] = SCENES[scene];
  return <dialog ref={ref} className="onboard-dialog" aria-labelledby={titleId}
    onCancel={event => { event.preventDefault(); onCancel(); }}>
    <BetaScene time={time} weather={weather} backdropOnly />
    <div className="onboard-panel">{children}</div>
  </dialog>;
}

export function LocationWelcome({ onChoose }: { onChoose: (place: Place) => void }) {
  const [query, setQuery] = useState('');
  const { results, status } = usePlaceSearch(query);
  return <OnboardingFrame titleId="location-title" onCancel={() => {}}>
    <div className="onboard-overline">WELCOME TO SKY PEEK</div>
    <h2 id="location-title">Where should we look first?</h2>
    <p>Choose a city or ZIP code to build your forecast, center the radar, and show nearby alerts.</p>
    <label className="onboard-search-label" htmlFor="onboard-place">Your first location</label>
    <input id="onboard-place" className="onboard-search" autoFocus value={query} onChange={event => setQuery(event.target.value)}
      onKeyDown={event => { if (event.key === 'Enter' && results[0]) onChoose(results[0]); }}
      placeholder="Search city or ZIP code" autoComplete="off" />
    {query.trim().length >= 2 && <div className="onboard-results" aria-live="polite">
      {results.slice(0, 5).map(place => <button type="button" key={place.id} onClick={() => onChoose(place)}>
        <strong>{place.name}</strong><span>{place.region}</span>
      </button>)}
      {!results.length && <div className="onboard-search-status">{status === 'failed' ? 'Search is unavailable right now. Try again shortly.' : status === 'done' ? 'No places found. Try a nearby city.' : 'Searching…'}</div>}
    </div>}
    <p className="onboard-location-note">You can add more places later in Settings.</p>
  </OnboardingFrame>;
}

export function WelcomeTour({ step, onBack, onNext, onSkip }: {
  step: number; onBack: () => void; onNext: () => void; onSkip: () => void;
}) {
  const current = TOUR_STEPS[step];
  const Icon = current.icon;
  return <OnboardingFrame scene={step + 1} titleId="tour-title" onCancel={onSkip}>
    <div className="onboard-icon"><Icon size={24} strokeWidth={1.8} aria-hidden /></div>
    <div className="onboard-overline">WELCOME TO SKY PEEK · {step + 1} OF {TOUR_STEPS.length}</div>
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

export function WhatsNew({ releases, onClose }: { releases: Release[]; onClose: () => void }) {
  return <OnboardingFrame scene={2} titleId="release-title" onCancel={onClose}>
    <div className="onboard-icon"><Sun size={24} strokeWidth={1.8} aria-hidden /></div>
    <div className="onboard-overline">SKY PEEK · VERSION {APP_VERSION}</div>
    <h2 id="release-title">What’s new</h2>
    {releases.length ? releases.map(release => <section key={release.version} className="onboard-release-entry">
      <h3>{release.title} <small>v{release.version}</small></h3>
      <ul>{release.changes.map(change => <li key={change}>{change}</li>)}</ul>
    </section>) : <p>Sky Peek has been updated. Take a look around to see what’s new.</p>}
    <div className="onboard-actions"><span /><button type="button" className="onboard-primary" onClick={onClose} autoFocus>Explore Sky Peek <span aria-hidden>→</span></button></div>
  </OnboardingFrame>;
}
