import { redirect } from 'next/navigation';

export default async function AccessPage({ searchParams }: { searchParams: Promise<{ invalid?: string; time?: string; weather?: string }> }) {
  const params = await searchParams;
  const query = new URLSearchParams();
  if (params.invalid === '1') query.set('invalid', '1');
  if (params.time) query.set('time', params.time);
  if (params.weather) query.set('weather', params.weather);
  redirect(`/${query.size ? `?${query}` : ''}`);
}
