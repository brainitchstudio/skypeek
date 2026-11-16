import { NextRequest, NextResponse } from 'next/server';
import { acceptsBetaCode, betaCodeIdentity, betaCookieName, betaGateState, BETA_IDENTITY_COOKIE, BETA_SESSION_SECONDS, issueBetaSession, revokeBetaSession } from '@/lib/betaGate';
import { BETA_SCENE_COOKIE, parseScene } from '@/lib/betaScene';
import { boundedForm, bodyErrorStatus } from '@/lib/requestBody';
import { admitLogin } from '@/lib/loginLimit';

export const runtime = 'nodejs';

function redirect(path: string) {
  return new NextResponse(null, { status: 303, headers: { Location: path } });
}

export async function POST(request: NextRequest) {
  const gate = betaGateState();
  // The local development gate is already open; old login tabs need no session.
  if (gate === 'open') return redirect('/app');
  if (gate !== 'ready') {
    return new NextResponse('Beta access is temporarily unavailable.', { status: 503 });
  }
  const now = Date.now();
  const admission = admitLogin(request, 'visitor', now);
  if (admission !== 200) return new NextResponse('Sign-in is temporarily limited. Try again later.', { status: admission, headers: { 'Cache-Control': 'no-store', 'Retry-After': '900' } });

  let code = '';
  let scene: ReturnType<typeof parseScene> = null;
  try {
    const form = await boundedForm(request, 1024);
    const input = form.get('code');
    if (typeof input === 'string') code = input.trim();
    const time = form.get('sceneTime');
    const weather = form.get('sceneWeather');
    scene = parseScene(typeof time === 'string' ? time : undefined, typeof weather === 'string' ? weather : undefined);
  } catch (error) {
    return new NextResponse('Invalid request.', { status: bodyErrorStatus(error), headers: { 'Cache-Control': 'no-store' } });
  }
  if (!acceptsBetaCode(code)) {
    const suffix = scene ? `&time=${scene.time}&weather=${scene.weather}` : '';
    const response = redirect(`/access?invalid=1${suffix}`);
    response.headers.set('Cache-Control', 'no-store');
    return response;
  }
  const response = redirect('/app');
  let session: string;
  try {
    session = issueBetaSession(now, code);
    revokeBetaSession(request.cookies.get(betaCookieName())?.value);
  } catch { return new NextResponse('Sign-in is temporarily unavailable.', { status: 503, headers: { 'Cache-Control': 'no-store' } }); }
  response.cookies.set(betaCookieName(), session, {
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

export async function DELETE(request: NextRequest) {
  // Custom header forces a same-origin browser request (no permissive CORS).
  if (request.headers.get('x-sky-peek-action') !== 'logout') return NextResponse.json({ error: 'Invalid request.' }, { status: 403 });
  try { revokeBetaSession(request.cookies.get(betaCookieName())?.value, request.nextUrl.searchParams.get('all') === '1'); }
  catch { return NextResponse.json({ error: 'Could not sign out. Try again.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } }); }
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
