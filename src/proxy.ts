import { NextRequest, NextResponse } from 'next/server';
import { betaCookieName, betaGateState, validBetaSession } from '@/lib/betaGate';

export function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  if (path === '/access' || path === '/api/access' || path === '/beta-admin' || path === '/api/beta-admin') return NextResponse.next();

  const state = betaGateState();
  if (state === 'open') return NextResponse.next();
  if (state === 'misconfigured') return new NextResponse('Beta access is temporarily unavailable.', { status: 503 });
  if (validBetaSession(request.cookies.get(betaCookieName())?.value)) return NextResponse.next();

  if (path.startsWith('/api/')) {
    return NextResponse.json({ error: 'Beta access required' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
  }
  return NextResponse.redirect(new URL('/access', request.url));
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icons/|maplibre-gl-worker.js).*)'],
};
