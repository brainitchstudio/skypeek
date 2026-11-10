import type { Metadata } from 'next';
import { betaGateState } from '@/lib/betaGate';
import './access.css';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Sky Peek beta access', robots: { index: false, follow: false } };

export default async function AccessPage({ searchParams }: { searchParams: Promise<{ invalid?: string }> }) {
  const invalid = (await searchParams).invalid === '1';
  const unavailable = betaGateState() === 'misconfigured';
  return <main className="access-page">
    <section className="access-card">
      <div className="access-mark" aria-hidden="true">◉</div>
      <p className="access-eyebrow">SKY PEEK · PRIVATE BETA</p>
      <h1>Take a look at the sky.</h1>
      {unavailable ? <p className="access-error" role="alert">Beta access is temporarily unavailable.</p> : <>
        <p>Enter the beta code you were given to explore Sky Peek.</p>
        <form action="/api/access" method="post">
          <label htmlFor="beta-code">Beta code</label>
          <input id="beta-code" name="code" type="password" autoComplete="off" required minLength={12} maxLength={128} aria-invalid={invalid} aria-describedby={invalid ? 'access-error' : undefined} />
          {invalid && <p id="access-error" className="access-error" role="alert">That code didn’t work. Please try again.</p>}
          <button type="submit">Enter Sky Peek</button>
        </form>
      </>}
    </section>
  </main>;
}
