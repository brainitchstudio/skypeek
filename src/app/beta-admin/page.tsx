import type { Metadata } from 'next';
import { CloudSun } from 'lucide-react';
import { cookies } from 'next/headers';
import { betaAdminCookieName, betaAdminReady, validBetaAdminSession } from '@/lib/betaGate';
import { CodeGenerator } from './CodeGenerator';
import '../access/access.css';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Sky Peek beta code manager', robots: { index: false, follow: false } };

export default async function BetaAdminPage({ searchParams }: { searchParams: Promise<{ invalid?: string }> }) {
  const ready = betaAdminReady();
  const signedIn = ready && validBetaAdminSession((await cookies()).get(betaAdminCookieName())?.value);
  const invalid = (await searchParams).invalid === '1';
  return <main className="access-page">
    <section className="access-card access-admin-card">
      <div className="access-mark" aria-hidden="true"><CloudSun size={30} strokeWidth={1.8} /></div>
      <p className="access-eyebrow">SKY PEEK · BETA OWNER</p>
      <h1>Beta codes</h1>
      {!ready ? <p className="access-error" role="alert">Code management is unavailable. Add BETA_ADMIN_CODE in the hosting environment.</p> : signedIn ? <>
        <p>Generate a new code to share with a tester. Codes work until their expiry date.</p>
        <CodeGenerator />
        <form action="/api/beta-admin" method="post"><input type="hidden" name="intent" value="logout" /><button type="submit" className="access-secondary">Sign out of code manager</button></form>
      </> : <>
        <p>Sign in with your private owner code. Keep it separate from the codes you share.</p>
        <form action="/api/beta-admin" method="post">
          <input type="hidden" name="intent" value="login" />
          <label htmlFor="owner-code">Owner code</label>
          <input id="owner-code" name="code" type="password" autoComplete="off" required minLength={20} maxLength={128} aria-invalid={invalid} aria-describedby={invalid ? 'admin-error' : undefined} />
          {invalid && <p id="admin-error" className="access-error" role="alert">That owner code didn’t work.</p>}
          <button type="submit">Open code manager</button>
        </form>
      </>}
    </section>
  </main>;
}
