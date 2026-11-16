import { NextRequest, NextResponse } from 'next/server';
import {
  acceptsBetaAdminCode, betaAdminCookieName, betaAdminReady, BETA_ADMIN_SESSION_SECONDS,
  generateBetaInvite, MAX_INVITE_DAYS, issueBetaAdminSession, validBetaAdminSession, freshBetaAdminSession, revokeBetaAdminSession,
} from '@/lib/betaGate';
import { boundedForm, boundedJson, bodyErrorStatus } from '@/lib/requestBody';
import { admitLogin } from '@/lib/loginLimit';

export const runtime = 'nodejs';

function noStore(response: NextResponse) {
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

function redirect(path: string) {
  return new NextResponse(null, { status: 303, headers: { Location: path } });
}

function sameOrigin(request: NextRequest) {
  try {
    const origin = new URL(request.headers.get('origin') ?? '');
    const host = request.headers.get('host') ?? request.nextUrl.host;
    const protocol = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() ?? request.nextUrl.protocol.slice(0, -1);
    return origin.host === host && origin.protocol === `${protocol}:`;
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest) {
  if (!betaAdminReady()) return noStore(new NextResponse('Beta code manager is unavailable.', { status: 503 }));
  if (!sameOrigin(request)) return noStore(new NextResponse('Invalid origin.', { status: 403 }));

  const type = request.headers.get('content-type') ?? '';
  if (type.includes('application/json')) {
    if (!validBetaAdminSession(request.cookies.get(betaAdminCookieName())?.value)) {
      return noStore(NextResponse.json({ error: 'Owner sign-in required.' }, { status: 401 }));
    }
    if (!freshBetaAdminSession(request.cookies.get(betaAdminCookieName())?.value)) {
      return noStore(NextResponse.json({ error: 'Sign in again before generating an invite.', reauthenticate: true }, { status: 401 }));
    }
    let days: number;
    try {
      const body = await boundedJson(request, 2048);
      days = typeof body === 'object' && body !== null && 'days' in body ? Number(body.days) : NaN;
    } catch (error) {
      return noStore(NextResponse.json({ error: 'Invalid request.' }, { status: bodyErrorStatus(error) }));
    }
    if (!Number.isInteger(days) || days < 1 || days > MAX_INVITE_DAYS) {
      return noStore(NextResponse.json({ error: 'Choose 1 to 90 days.' }, { status: 400 }));
    }
    const now = Date.now();
    return noStore(NextResponse.json({ code: generateBetaInvite(days, now), expires: new Date(now + days * 86400_000).toISOString() }));
  }

  if (!type.includes('application/x-www-form-urlencoded')) {
    return noStore(new NextResponse('Invalid request.', { status: 400 }));
  }
  let intent = '', code = '';
  try {
    const form = await boundedForm(request, 2048);
    intent = String(form.get('intent') ?? '');
    code = String(form.get('code') ?? '').trim();
  } catch (error) {
    return noStore(new NextResponse('Invalid request.', { status: bodyErrorStatus(error) }));
  }
  if (intent === 'logout' || intent === 'logout-all') {
    try { revokeBetaAdminSession(request.cookies.get(betaAdminCookieName())?.value, intent === 'logout-all'); }
    catch { return noStore(new NextResponse('Could not sign out. Try again.', { status: 503 })); }
    const response = redirect('/beta-admin');
    response.cookies.set(betaAdminCookieName(), '', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', path: '/', maxAge: 0 });
    return noStore(response);
  }
  if (intent !== 'login' || code.length > 128) return noStore(new NextResponse('Invalid request.', { status: 400 }));

  const now = Date.now();
  const admission = admitLogin(request, 'owner', now);
  if (admission !== 200) return noStore(new NextResponse('Owner sign-in is temporarily limited. Try again later.', { status: admission, headers: { 'Retry-After': '900' } }));
  if (!acceptsBetaAdminCode(code)) {
    return noStore(redirect('/beta-admin?invalid=1'));
  }
  const response = redirect('/beta-admin');
  let session: string;
  try {
    session = issueBetaAdminSession(now);
    revokeBetaAdminSession(request.cookies.get(betaAdminCookieName())?.value);
  } catch { return noStore(new NextResponse('Owner sign-in is temporarily unavailable.', { status: 503 })); }
  response.cookies.set(betaAdminCookieName(), session, {
    httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', path: '/', maxAge: BETA_ADMIN_SESSION_SECONDS,
  });
  return noStore(response);
}
