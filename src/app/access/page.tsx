import type { Metadata } from 'next';
import { betaGateState } from '@/lib/betaGate';
import { BetaScene } from './BetaScene';
import { pickScene } from '@/lib/betaScene';
import './beta-scene.css';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Sky Peek beta access', robots: { index: false, follow: false } };

export default async function AccessPage({ searchParams }: { searchParams: Promise<{ invalid?: string; time?: string; weather?: string }> }) {
  const params = await searchParams;
  const { time, weather } = pickScene(params.time, params.weather);
  return <BetaScene
    time={time}
    weather={weather}
    invalid={params.invalid === '1'}
    unavailable={betaGateState() === 'misconfigured'}
  />;
}
