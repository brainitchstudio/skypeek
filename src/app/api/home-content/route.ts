import { NextRequest, NextResponse } from 'next/server';
import { betaAdminCookieName, validBetaAdminSession } from '@/lib/betaGate';
import { saveHomeContent, validateHomeContent } from '@/lib/homeContent';
import { boundedJson, bodyErrorStatus } from '@/lib/requestBody';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const headers = { 'Cache-Control': 'no-store' };
  if (!validBetaAdminSession(request.cookies.get(betaAdminCookieName())?.value)) {
    return NextResponse.json({ error: 'Owner sign-in required.' }, { status: 401, headers });
  }
  let sameOrigin = false;
  try {
    const origin = new URL(request.headers.get('origin') ?? '');
    const host = request.headers.get('host') ?? request.nextUrl.host;
    const protocol = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() ?? request.nextUrl.protocol.slice(0, -1);
    sameOrigin = origin.host === host && origin.protocol === `${protocol}:`;
  } catch { /* Reject. */ }
  if (!sameOrigin) return NextResponse.json({ error: 'Invalid origin.' }, { status: 403, headers });
  let input: unknown;
  try { input = await boundedJson(request, 8192); } catch (error) { return NextResponse.json({ error: 'Invalid request.' }, { status: bodyErrorStatus(error), headers }); }
  const content = validateHomeContent(input);
  if (!content) return NextResponse.json({ error: 'Complete all fields using up to 500 characters each.' }, { status: 400, headers });
  try { saveHomeContent(content); }
  catch { return NextResponse.json({ error: 'Could not save the homepage. Check private folder permissions.' }, { status: 500, headers }); }
  return NextResponse.json({ ok: true }, { headers });
}
