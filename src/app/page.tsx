import type { Metadata } from 'next';
import { CloudSun } from 'lucide-react';
import { readHomeContent } from '@/lib/homeContent';
import './home.css';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Sky Peek — Weather in context',
  description: 'Forecasts, radar, and official alerts in one clear view for the places you care about.',
};

export default function HomePage() {
  const copy = readHomeContent();
  return <main className="desk">
    <header className="desk-header"><div className="container desk-header-inner">
      <a className="desk-brand" href="/" aria-label="Sky Peek home"><CloudSun size={30} strokeWidth={1.7} aria-hidden="true"/><span>Sky Peek</span></a>
      <nav aria-label="Main navigation"><a href="#features">Features</a><a href="#radar">Radar</a><a href="#about">About</a><a className="desk-login" href="/access">Log in</a></nav>
    </div></header>

    <section className="desk-front"><div className="container">
      <h1>{copy.headline}</h1>
      <div className="desk-front-grid">
        <figure><img src="/onboarding/today.jpg" alt="The Today forecast in Sky Peek" width="1280" height="720" fetchPriority="high"/><figcaption>Sky Peek, Today forecast</figcaption></figure>
        <div className="desk-front-brief"><p className="desk-deck">{copy.introduction}</p><a className="desk-primary" href="/access">Enter the beta</a><a className="desk-quiet-link" href="#features">Explore features</a><p className="desk-access-note">{copy.announcement}</p></div>
      </div>
    </div></section>

    <section id="features" className="desk-features"><div className="container">
      <h2>{copy.eyebrow}</h2>
      <div className="desk-feature-row"><div><h3>Forecasts for your places</h3><p>{copy.forecast}</p></div><figure><img src="/onboarding/hourly.jpg" alt="Hourly forecast in Sky Peek" width="1280" height="720" loading="lazy"/><figcaption>Sky Peek, Hourly forecast</figcaption></figure></div>
    </div></section>

    <section id="radar" className="desk-radar"><div className="container">
      <div className="desk-radar-head"><div><h2>Radar with context</h2><p>{copy.radar}</p></div><a href="/access">Take a look inside</a></div>
      <figure><img src="/onboarding/radar.jpg" alt="Sky Peek radar with map layers and playback" width="1280" height="720" loading="lazy"/><figcaption>Observed radar frames and map layers in Sky Peek</figcaption></figure>
      <div className="desk-radar-note"><h3>See what is headed your way.</h3><p>Step through real radar scans, inspect a storm, and check a point on the map. Observation time and model forecasts stay clearly labeled.</p></div>
    </div></section>

    <section className="desk-alerts"><div className="container desk-alerts-inner"><div><h2>Alerts in the picture</h2><p>{copy.alerts}</p></div><figure><img src="/onboarding/alerts.jpg" alt="National Weather Service alerts in Sky Peek" width="1280" height="720" loading="lazy"/><figcaption>Sky Peek, Alerts view</figcaption></figure></div></section>

    <section id="about" className="desk-about"><div className="container"><h2>Every forecast deserves context.</h2><div><p>Sky Peek brings forecasts, observed radar, and official alerts together so you can see the weather in context. It currently focuses on US locations.</p><p>For severe weather decisions, follow official National Weather Service guidance.</p></div></div></section>

    <footer className="desk-footer"><div className="container"><div><strong>Sky Peek</strong><span>Look up. Look ahead.</span></div><a href="/access">Log in to the beta</a><small>© {new Date().getFullYear()} Sky Peek</small></div></footer>
  </main>;
}
