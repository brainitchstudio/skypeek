import { NextRequest, NextResponse } from 'next/server';
import { acceptsBetaCode, betaCodeIdentity, betaCookieName, betaGateState, BETA_IDENTITY_COOKIE, BETA_SESSION_SECONDS, issueBetaSession } from '@/lib/betaGate';
import { BETA_SCENE_COOKIE, parseScene } from '@/lib/betaScene';

export const runtime = 'nodejs';

type Attempt = { count: number; until: number };
const attempts = new Map<string, Attempt>();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;

function redirect(path: string) {
  return new NextResponse(null, { status: 303, headers: { Location: path } });
}

function visitorKey(request: NextRequest) {
  return request.headers.get('x-real-ip') ?? request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
}

function failed(response: NextResponse, visitor: string, now: number) {
  const previous = attempts.get(visitor);
  const count = previous && previous.until > now ? previous.count + 1 : 1;
  if (!previous && attempts.size >= 500) attempts.delete(attempts.keys().next().value!);
  attempts.set(visitor, { count, until: now + WINDOW_MS });
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

export async function POST(request: NextRequest) {
  if (betaGateState() !== 'ready') {
    return new NextResponse('Beta access is temporarily unavailable.', { status: 503 });
  }
  const visitor = visitorKey(request);
  const now = Date.now();
  const attempt = attempts.get(visitor);
  if (attempt && attempt.until > now && attempt.count >= MAX_ATTEMPTS) {
    return new NextResponse('Too many attempts. Try again later.', { status: 429, headers: { 'Cache-Control': 'no-store' } });
  }
  if (attempt && attempt.until <= now) attempts.delete(visitor);

  const length = Number(request.headers.get('content-length') ?? 0);
  if (length > 1024) return new NextResponse('Invalid request.', { status: 400 });
  let code = '';
  let scene: ReturnType<typeof parseScene> = null;
  try {
    const form = await request.formData();
    const input = form.get('code');
    if (typeof input === 'string') code = input.trim();
    const time = form.get('sceneTime');
    const weather = form.get('sceneWeather');
    scene = parseScene(typeof time === 'string' ? time : undefined, typeof weather === 'string' ? weather : undefined);
  } catch {
    return new NextResponse('Invalid request.', { status: 400 });
  }
  if (!acceptsBetaCode(code)) {
    const suffix = scene ? `&time=${scene.time}&weather=${scene.weather}` : '';
    return failed(redirect(`/access?invalid=1${suffix}`), visitor, now);
  }
  attempts.delete(visitor);
  const response = redirect('/');
  response.cookies.set(betaCookieName(), issueBetaSession(now), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: BETA_SESSION_SECONDS,
  });
  response.cookies.set(BETA_IDENTITY_COOKIE, betaCodeIdentity(code), {
    httpOnly: false,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: BETA_SESSION_SECONDS,
  });
  if (scene) response.cookies.set(BETA_SCENE_COOKIE, `${scene.time}.${scene.weather}`, {
    httpOnly: false,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: BETA_SESSION_SECONDS,
  });
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

export async function DELETE(_request: NextRequest) {
  const response = NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  response.cookies.set(betaCookieName(), '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
  response.cookies.set(BETA_IDENTITY_COOKIE, '', { path: '/', maxAge: 0 });
  response.cookies.set(BETA_SCENE_COOKIE, '', { path: '/', maxAge: 0 });
  return response;
}
