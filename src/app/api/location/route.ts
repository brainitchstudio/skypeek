import { resolveGeography } from '@/lib/locationGeography';

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const lat = Number(params.get('lat')), lon = Number(params.get('lon')), accuracy = Number(params.get('accuracy'));
  if (!['lat', 'lon', 'accuracy'].every(key => params.get(key)?.trim()) || !Number.isFinite(lat) || !Number.isFinite(lon)
    || Math.abs(lat) > 90 || Math.abs(lon) > 180 || !Number.isFinite(accuracy) || accuracy < 0 || accuracy > 20_000_000) {
    return Response.json({ error: 'Invalid device location.' }, { status: 400 });
  }
  try {
    const description = await resolveGeography({ lat, lon }, accuracy);
    return Response.json(description, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch {
    return Response.json({ error: 'Place names are unavailable right now.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
