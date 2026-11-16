'use client';

import { useState, type FormEvent } from 'react';

export default function InstallForm() {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError('');
    const data = new FormData(event.currentTarget);
    try {
      const response = await fetch('/api/install', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Object.fromEntries(data)), cache: 'no-store',
      });
      const result = await response.json();
      if (!response.ok) { setError(result.error || 'Setup failed.'); return; }
      window.location.replace('/access');
    } catch { setError('Could not connect to the server. Try again.'); }
    finally { setBusy(false); }
  }
  return <form onSubmit={submit} className="install-form">
    <label>Installation token<input name="token" type="password" required minLength={64} autoComplete="off" /></label>
    <label>Visitor access code<input name="accessCode" type="password" required minLength={12} maxLength={128} autoComplete="new-password" /></label>
    <label>Owner code<input name="adminCode" type="password" required minLength={20} maxLength={128} autoComplete="new-password" /></label>
    {error && <p className="install-error" role="alert">{error}</p>}
    <button type="submit" disabled={busy}>{busy ? 'Installing…' : 'Install Sky Peek'}</button>
  </form>;
}
