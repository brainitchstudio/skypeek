import { NextResponse, type NextRequest } from 'next/server';
import { install, isInstalled } from '@/lib/installation';
import { boundedJson, bodyErrorStatus } from '@/lib/requestBody';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  if (isInstalled()) return NextResponse.json({ error: 'Already installed.' }, { status: 409 });
  const origin = request.headers.get('origin');
  let sameOrigin = false;
  try {
    const parsed = new URL(origin ?? '');
    const host = request.headers.get('host') ?? request.nextUrl.host;
    const protocol = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() ?? request.nextUrl.protocol.slice(0, -1);
    sameOrigin = parsed.host === host && parsed.protocol === `${protocol}:`;
  } catch { /* Reject malformed Origin. */ }
  if (!sameOrigin) {
    return NextResponse.json({ error: 'Invalid request origin.' }, { status: 403 });
  }
  let body: unknown;
  try { body = await boundedJson(request, 2048); } catch (error) { return NextResponse.json({ error: 'Invalid form data.' }, { status: bodyErrorStatus(error), headers: { 'Cache-Control': 'no-store' } }); }
  if (!body || typeof body !== 'object' || Array.isArray(body) || !('token' in body) || !('accessCode' in body) || !('adminCode' in body)
    || typeof body.token !== 'string' || typeof body.accessCode !== 'string' || typeof body.adminCode !== 'string') {
    return NextResponse.json({ error: 'Invalid form data.' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }
  const result = install(body.token, body.accessCode, body.adminCode);
  return NextResponse.json(result.ok ? { ok: true } : { error: result.error }, {
    status: result.ok ? 200 : 400, headers: { 'Cache-Control': 'no-store' },
  });
}
