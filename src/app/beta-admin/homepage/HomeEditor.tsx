'use client';

import { useState, type FormEvent } from 'react';
import type { HomeContent } from '@/lib/homeContent';

const labels: Record<keyof HomeContent, string> = {
  eyebrow: 'Features heading', headline: 'Main headline', introduction: 'Main introduction',
  announcement: 'Beta announcement', forecast: 'Forecast feature', radar: 'Radar feature', alerts: 'Alerts feature',
};

export default function HomeEditor({ initial }: { initial: HomeContent }) {
  const [content, setContent] = useState(initial);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage('');
    try {
      const response = await fetch('/api/home-content', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(content), cache: 'no-store' });
      if (!response.ok) throw new Error(response.status === 401 ? 'Owner session expired. Sign in again.' : 'Could not save the homepage.');
      setMessage('Saved. Refresh the information page to see your changes.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Save failed.'); }
    finally { setBusy(false); }
  }
  return <form onSubmit={save} className="home-editor-form">{(Object.keys(labels) as (keyof HomeContent)[]).map(key =>
    <label key={key}>{labels[key]}<textarea required maxLength={500} rows={key === 'headline' || key === 'eyebrow' ? 2 : 3} value={content[key]} onChange={event => setContent({ ...content, [key]: event.target.value })} /></label>
  )}<div className="home-editor-actions"><button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button><a href="/info" target="_blank" rel="noreferrer">View information page ↗</a></div>{message && <p role="status">{message}</p>}</form>;
}
