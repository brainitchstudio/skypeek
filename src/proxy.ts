import { NextRequest, NextResponse } from 'next/server';
import { betaCookieName, betaGateState, validBetaSession } from '@/lib/betaGate';
import { isInstalled } from '@/lib/installation';
import { randomBytes } from 'node:crypto';
import { contentSecurityPolicy } from '@/lib/securityHeaders';

export function proxy(request: NextRequest) {
  const nonce = randomBytes(16).toString('base64');
  const policy = contentSecurityPolicy(nonce, process.env.NODE_ENV !== 'production');
  const headers = new Headers(request.headers);
  // Overwrite caller values; Next reads this policy when applying script nonces.
  headers.set('Content-Security-Policy', policy);
  headers.set('x-nonce', nonce);
  const response = gate(request, () => NextResponse.next({ request: { headers } }));
  response.headers.set('Content-Security-Policy', policy);
  if (!request.nextUrl.pathname.startsWith('/api/')) response.headers.set('Cache-Control', 'private, no-store');
  return response;
}

function gate(request: NextRequest, proceed: () => NextResponse) {
  const path = request.nextUrl.pathname;
  if (!isInstalled() && process.env.NODE_ENV === 'production') {
    if (path === '/install' || path === '/api/install') return proceed();
    if (path.startsWith('/api/')) return NextResponse.json({ error: 'Installation required' }, { status: 503 });
    return NextResponse.redirect(new URL('/install', request.url));
  }
  if (path === '/install' || path === '/api/install') return NextResponse.redirect(new URL('/', request.url));
  if (path === '/') return proceed();
  if (path === '/access' || path === '/api/access' || path === '/privacy' || path.startsWith('/beta-admin') || path === '/api/beta-admin' || path === '/api/home-content') return proceed();

  const state = betaGateState();
  if (state === 'open') return proceed();
  if (state === 'misconfigured') return new NextResponse('Beta access is temporarily unavailable.', { status: 503 });
  if (validBetaSession(request.cookies.get(betaCookieName())?.value)) return proceed();

  if (path.startsWith('/api/')) {
    return NextResponse.json({ error: 'Beta access required' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
  }
  return NextResponse.redirect(new URL('/access', request.url));
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icons/|onboarding/|beta-sky.svg|maplibre-gl-worker.js).*)'],
};
