import { redirect } from 'next/navigation';
import { isInstalled } from '@/lib/installation';
import InstallForm from './InstallForm';
import './install.css';

export const dynamic = 'force-dynamic';

export default function InstallPage() {
  if (isInstalled()) redirect('/');
  return <main className="install-shell">
    <section className="install-card">
      <div className="install-eyebrow">SKY PEEK · SETUP</div>
      <h1>Welcome to Sky Peek</h1>
      <p>Complete this one time setup to protect your weather app and open the beta.</p>
      <ol>
        <li>Keep the installation token from the upload package handy.</li>
        <li>Choose a shared access code for visitors.</li>
        <li>Choose a separate owner code for generating invitations.</li>
      </ol>
      <InstallForm />
    </section>
  </main>;
}
