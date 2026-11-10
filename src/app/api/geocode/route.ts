import { censusPlaces } from '@/lib/address';

export async function GET(request: Request) {
  const address = new URL(request.url).searchParams.get('address')?.trim() ?? '';
  if (!address || address.length > 100 || !/^\d+[a-z]?\s+\S/i.test(address)) {
    return Response.json({ error: 'Enter a US street address with city and state or ZIP code.' }, { status: 400 });
  }

  const url = new URL('https://geocoding.geo.census.gov/geocoder/locations/onelineaddress');
  url.search = new URLSearchParams({ address, benchmark: 'Public_AR_Current', format: 'json' }).toString();
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(10000), cache: 'no-store' });
    if (!response.ok) throw new Error(`Census geocoder returned ${response.status}`);
    const data = await response.json() as { result?: { addressMatches?: unknown[] } };
    const places = censusPlaces((data.result?.addressMatches ?? []) as Parameters<typeof censusPlaces>[0]);
    return Response.json({ places }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json({ error: 'Address search is unavailable right now.' }, { status: 502 });
  }
}
