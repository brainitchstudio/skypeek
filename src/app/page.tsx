import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { betaCookieName, betaGateState, validBetaSession } from '@/lib/betaGate';
import { pickScene } from '@/lib/betaScene';
import { BetaScene } from './access/BetaScene';
import './access/beta-scene.css';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'SkyPeek beta access' };

export default async function HomePage({ searchParams }: { searchParams: Promise<{ invalid?: string; time?: string; weather?: string }> }) {
  const gate = betaGateState();
  if (gate === 'open') redirect('/app');
  if (gate === 'ready' && validBetaSession((await cookies()).get(betaCookieName())?.value)) redirect('/app');
  const params = await searchParams;
  const { time, weather } = pickScene(params.time, params.weather);
  return <BetaScene
    time={time}
    weather={weather}
    invalid={params.invalid === '1'}
    unavailable={gate === 'misconfigured'}
  />;
}
