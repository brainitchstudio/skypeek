import { NextRequest, NextResponse } from 'next/server';
import {
  acceptsBetaAdminCode, betaAdminCookieName, betaAdminReady, BETA_ADMIN_SESSION_SECONDS,
  generateBetaInvite, MAX_INVITE_DAYS, issueBetaAdminSession, validBetaAdminSession,
} from '@/lib/betaGate';

export const runtime = 'nodejs';

type Attempt = { count: number; until: number };
const attempts = new Map<string, Attempt>();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 8;

function visitorKey(request: NextRequest) {
  return request.headers.get('x-real-ip') ?? request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
}

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
  if (Number(request.headers.get('content-length') ?? 0) > 2048) {
    return noStore(new NextResponse('Invalid request.', { status: 400 }));
  }

  const type = request.headers.get('content-type') ?? '';
  if (type.includes('application/json')) {
    if (!validBetaAdminSession(request.cookies.get(betaAdminCookieName())?.value)) {
      return noStore(NextResponse.json({ error: 'Owner sign-in required.' }, { status: 401 }));
    }
    let days: number;
    try {
      const body: unknown = await request.json();
      days = typeof body === 'object' && body !== null && 'days' in body ? Number(body.days) : NaN;
    } catch {
      return noStore(NextResponse.json({ error: 'Invalid request.' }, { status: 400 }));
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
    const form = await request.formData();
    intent = String(form.get('intent') ?? '');
    code = String(form.get('code') ?? '').trim();
  } catch {
    return noStore(new NextResponse('Invalid request.', { status: 400 }));
  }
  if (intent === 'logout') {
    const response = redirect('/beta-admin');
    response.cookies.set(betaAdminCookieName(), '', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', path: '/', maxAge: 0 });
    return noStore(response);
  }
  if (intent !== 'login' || code.length > 128) return noStore(new NextResponse('Invalid request.', { status: 400 }));

  const visitor = visitorKey(request);
  const now = Date.now();
  const previous = attempts.get(visitor);
  if (previous && previous.until > now && previous.count >= MAX_ATTEMPTS) {
    return noStore(new NextResponse('Too many attempts. Try again later.', { status: 429 }));
  }
  if (!acceptsBetaAdminCode(code)) {
    const count = previous && previous.until > now ? previous.count + 1 : 1;
    if (!attempts.has(visitor) && attempts.size >= 500) attempts.delete(attempts.keys().next().value!);
    attempts.set(visitor, { count, until: now + WINDOW_MS });
    return noStore(redirect('/beta-admin?invalid=1'));
  }
  attempts.delete(visitor);
  const response = redirect('/beta-admin');
  response.cookies.set(betaAdminCookieName(), issueBetaAdminSession(now), {
    httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', path: '/', maxAge: BETA_ADMIN_SESSION_SECONDS,
  });
  return noStore(response);
}
