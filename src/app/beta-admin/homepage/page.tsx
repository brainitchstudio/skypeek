import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { betaAdminCookieName, validBetaAdminSession } from '@/lib/betaGate';
import { readHomeContent } from '@/lib/homeContent';
import HomeEditor from './HomeEditor';
import './editor.css';

export const dynamic = 'force-dynamic';

export default async function HomeEditorPage() {
  if (!validBetaAdminSession((await cookies()).get(betaAdminCookieName())?.value)) redirect('/beta-admin');
  return <main className="home-editor-page"><div className="home-editor-card"><a href="/beta-admin">← Beta owner</a><h1>Public homepage</h1><p>Edit the words visitors see at the domain. Saved changes appear on the next page load, with no app redeployment.</p><HomeEditor initial={readHomeContent()} /></div></main>;
}
