import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { BETA_COOKIE, issueBetaSession, revokeBetaSession } from '@/lib/betaGate';
import { proxy } from './proxy';

describe('beta proxy', () => {
  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('BETA_ACCESS_CODE', 'rainy-foxes-visit-2026');
    vi.stubEnv('BETA_SESSION_SECRET', 'a-long-private-signing-secret-that-stays-on-the-server');
  });
  afterEach(() => vi.unstubAllEnvs());

  it('keeps the gate and information page public and sends anonymous app visits to the gate', () => {
    expect(proxy(new NextRequest('https://skypeek.brainitch.studio/')).status).toBe(200);
    expect(proxy(new NextRequest('https://skypeek.brainitch.studio/info')).status).toBe(200);
    for (const path of ['/app', '/lab', '/design']) {
      const response = proxy(new NextRequest(`https://skypeek.brainitch.studio${path}`));
      expect(response.status).toBe(307);
      expect(response.headers.get('location')).toBe('https://skypeek.brainitch.studio/');
    }
  });

  it('denies anonymous API requests but lets access requests through', () => {
    expect(proxy(new NextRequest('https://skypeek.brainitch.studio/api/geocode?address=test')).status).toBe(401);
    expect(proxy(new NextRequest('https://skypeek.brainitch.studio/api/storm-objects')).status).toBe(401);
    expect(proxy(new NextRequest('https://skypeek.brainitch.studio/api/radar-warnings')).status).toBe(401);
    expect(proxy(new NextRequest('https://skypeek.brainitch.studio/access')).status).toBe(200);
    expect(proxy(new NextRequest('https://skypeek.brainitch.studio/api/access')).status).toBe(200);
    expect(proxy(new NextRequest('https://skypeek.brainitch.studio/beta-admin')).status).toBe(200);
    expect(proxy(new NextRequest('https://skypeek.brainitch.studio/api/beta-admin')).status).toBe(200);
  });

  it('allows a signed session and fails closed if configuration is missing', () => {
    const cookie = issueBetaSession();
    const request = new NextRequest('https://skypeek.brainitch.studio/lab', { headers: { cookie: `${BETA_COOKIE}=${cookie}` } });
    expect(proxy(request).status).toBe(200);
    vi.stubEnv('BETA_SESSION_SECRET', '');
    const uninstalled = proxy(request);
    expect(uninstalled.status).toBe(307);
    expect(uninstalled.headers.get('location')).toBe('https://skypeek.brainitch.studio/install');
  });

  it('denies a copied cookie after logout and overwrites forged nonce headers', () => {
    const token = issueBetaSession();
    revokeBetaSession(token);
    expect(proxy(new NextRequest('https://skypeek.brainitch.studio/api/location', { headers: { cookie: `${BETA_COOKIE}=${token}` } })).status).toBe(401);
    const request = () => new NextRequest('https://skypeek.brainitch.studio/', { headers: { 'x-nonce': 'attacker-nonce', 'Content-Security-Policy': "script-src * 'unsafe-inline'" } });
    const first = proxy(request());
    const second = proxy(request());
    expect(first.headers.get('Content-Security-Policy')).not.toContain('attacker-nonce');
    expect(first.headers.get('Content-Security-Policy')).not.toBe(second.headers.get('Content-Security-Policy'));
    expect(first.headers.get('Cache-Control')).toBe('private, no-store');
  });
});
