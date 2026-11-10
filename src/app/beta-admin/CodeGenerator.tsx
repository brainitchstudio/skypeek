'use client';

import { useState } from 'react';

type Generated = { code: string; expires: string };

export function CodeGenerator() {
  const [days, setDays] = useState(30);
  const [generated, setGenerated] = useState<Generated | null>(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  async function generate() {
    setGenerated(null);
    setError('');
    setCopied(false);
    try {
      const response = await fetch('/api/beta-admin', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ days }), cache: 'no-store',
      });
      if (!response.ok) throw new Error(response.status === 401 ? 'Owner sign-in expired. Refresh this page and sign in again.' : 'Could not generate a code. Try again.');
      setGenerated(await response.json() as Generated);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not generate a code. Try again.');
    }
  }

  return <div className="access-generator">
    <label htmlFor="invite-days">Code valid for</label>
    <select id="invite-days" value={days} onChange={event => setDays(Number(event.target.value))}>
      <option value={7}>7 days</option><option value={30}>30 days</option><option value={90}>90 days</option>
    </select>
    <button type="button" onClick={() => void generate()}>Generate access code</button>
    {error && <p className="access-error" role="alert">{error}</p>}
    {generated && <div className="access-generated" role="status">
      <span>New access code</span>
      <code>{generated.code}</code>
      <small>Valid until {new Date(generated.expires).toLocaleString()}. Anyone with this code can enter the beta until then.</small>
      <button type="button" className="access-secondary" onClick={() => void navigator.clipboard.writeText(generated.code).then(() => setCopied(true)).catch(() => setError('Copy failed. Select the code above to copy it.'))}>{copied ? 'Copied' : 'Copy code'}</button>
    </div>}
  </div>;
}
