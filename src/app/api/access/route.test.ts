import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { BETA_COOKIE, BETA_IDENTITY_COOKIE, validBetaSession } from '@/lib/betaGate';
import { BETA_SCENE_COOKIE } from '@/lib/betaScene';
import { POST, DELETE } from './route';

describe('access submission', () => {
  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('BETA_ACCESS_CODE', 'rainy-foxes-visit-2026');
    vi.stubEnv('BETA_SESSION_SECRET', 'a-long-private-signing-secret-that-stays-on-the-server');
  });
  afterEach(() => vi.unstubAllEnvs());

  it('sets a secure cookie only for the right code', async () => {
    const make = (code: string) => new NextRequest('https://skypeek.brainitch.studio/api/access', {
      method: 'POST', body: new URLSearchParams({ code }), headers: { 'x-real-ip': 'test-good-code' },
    });
    const wrong = await POST(make('incorrect-guess'));
    expect(wrong.status).toBe(303);
    expect(wrong.headers.get('location')).toContain('/access?invalid=1');
    expect(wrong.headers.get('location')).toBe('/access?invalid=1');
    expect(wrong.headers.get('set-cookie')).toBeNull();

    const correct = await POST(make('rainy-foxes-visit-2026'));
    expect(correct.status).toBe(303);
    expect(correct.headers.get('location')).toBe('/');
    const setCookie = correct.headers.get('set-cookie')!;
    expect(setCookie).toContain(`${BETA_COOKIE}=`);
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('Secure');
    expect(setCookie.toLowerCase()).toContain('samesite=lax');
    expect(validBetaSession(correct.cookies.get(BETA_COOKIE)?.value)).toBe(true);
    const identity = correct.cookies.get(BETA_IDENTITY_COOKIE)?.value;
    expect(identity).toMatch(/^[a-f0-9]{32}$/);
    expect(identity).not.toContain('rainy-foxes');
  });

  it('clears the cookie on leave', async () => {
    const response = await DELETE(new NextRequest('https://skypeek.brainitch.studio/api/access', { method: 'DELETE' }));
    expect(response.cookies.get(BETA_COOKIE)?.value).toBe('');
    expect(response.cookies.get(BETA_IDENTITY_COOKIE)?.value).toBe('');
    expect(response.cookies.get(BETA_SCENE_COOKIE)?.value).toBe('');
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
  });

  it('carries the beta gate scene through login and failed attempts', async () => {
    const make = (code: string) => new NextRequest('https://skypeek.brainitch.studio/api/access', {
      method: 'POST',
      body: new URLSearchParams({ code, sceneTime: 'evening', sceneWeather: 'rain' }),
      headers: { 'x-real-ip': 'test-scene-code' },
    });
    const invalid = await POST(make('incorrect-guess'));
    expect(invalid.headers.get('location')).toBe('/access?invalid=1&time=evening&weather=rain');
    const accepted = await POST(make('rainy-foxes-visit-2026'));
    expect(accepted.cookies.get(BETA_SCENE_COOKIE)?.value).toBe('evening.rain');
  });
});
