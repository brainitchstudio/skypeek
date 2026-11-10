import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { BETA_ADMIN_COOKIE, issueBetaAdminSession, validBetaInvite } from '@/lib/betaGate';
import { POST } from './route';

const ORIGIN = 'https://skypeek.brainitch.studio';

describe('beta code manager', () => {
  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('BETA_ACCESS_CODE', 'rainy-foxes-visit-2026');
    vi.stubEnv('BETA_SESSION_SECRET', 'a-long-private-signing-secret-that-stays-on-the-server');
    vi.stubEnv('BETA_ADMIN_CODE', 'owner-only-code-with-high-entropy-2026');
  });
  afterEach(() => vi.unstubAllEnvs());

  it('requires same-origin owner login before issuing a code', async () => {
    const request = (origin: string | null, cookie?: string) => new NextRequest(`${ORIGIN}/api/beta-admin`, {
      method: 'POST', body: JSON.stringify({ days: 30 }),
      headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}), ...(cookie ? { cookie } : {}) },
    });
    expect((await POST(request(null))).status).toBe(403);
    expect((await POST(request('https://other.example'))).status).toBe(403);
    expect((await POST(request(ORIGIN))).status).toBe(401);
    const adminCookie = `${BETA_ADMIN_COOKIE}=${issueBetaAdminSession()}`;
    const response = await POST(request(ORIGIN, adminCookie));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(validBetaInvite((await response.json()).code)).toBe(true);
  });

  it('sets a secure owner cookie only for the owner code', async () => {
    const request = (code: string) => new NextRequest(`${ORIGIN}/api/beta-admin`, {
      method: 'POST', body: new URLSearchParams({ intent: 'login', code }),
      headers: { origin: ORIGIN, 'x-real-ip': 'admin-test' },
    });
    const wrong = await POST(request('incorrect-code-123456789'));
    expect(wrong.headers.get('location')).toContain('/beta-admin?invalid=1');
    expect(wrong.headers.get('location')).toBe('/beta-admin?invalid=1');
    expect(wrong.headers.get('set-cookie')).toBeNull();
    const right = await POST(request('owner-only-code-with-high-entropy-2026'));
    expect(right.headers.get('location')).toBe('/beta-admin');
    expect(right.headers.get('set-cookie')).toContain(BETA_ADMIN_COOKIE);
    expect(right.headers.get('set-cookie')).toContain('HttpOnly');
    expect(right.headers.get('set-cookie')).toContain('Secure');
    expect(right.headers.get('set-cookie')?.toLowerCase()).toContain('samesite=strict');
  });
});
