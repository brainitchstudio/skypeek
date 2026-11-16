import { beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as access, DELETE as logout } from './access/route';
import { POST as admin } from './beta-admin/route';
import { POST as homepage } from './home-content/route';
import { POST as install } from './install/route';
import { betaCookieName, betaAdminCookieName, issueBetaSession, issueBetaAdminSession, validBetaSession, validBetaAdminSession } from '@/lib/betaGate';

vi.mock('@/lib/installation', async original => ({ ...await original<typeof import('@/lib/installation')>(), isInstalled: () => false }));
const origin = 'https://skypeek.brainitch.studio';
beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('BETA_ACCESS_CODE', 'security-test-access-code');
  vi.stubEnv('BETA_ACCESS_CODE_HASHES', '');
  vi.stubEnv('BETA_SESSION_SECRET', 'security-test-secret-at-least-thirty-two-characters');
  vi.stubEnv('BETA_ADMIN_CODE', 'security-test-owner-code-over-twenty-characters');
});

it('rejects actual oversized streamed bodies on every mutation route, even without Content-Length', async () => {
  const ownerCookie = `${betaAdminCookieName()}=${issueBetaAdminSession()}`;
  const oversized = (path: string, type: string, cookie?: string) => new NextRequest(origin + path, {
    method: 'POST', headers: { origin, 'content-type': type, ...(cookie ? { cookie } : {}) },
    body: new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('x'.repeat(9000))); controller.close(); } }), duplex: 'half',
  } as ConstructorParameters<typeof NextRequest>[1]);
  expect((await access(oversized('/api/access', 'application/x-www-form-urlencoded'))).status).toBe(413);
  expect((await admin(oversized('/api/beta-admin', 'application/x-www-form-urlencoded'))).status).toBe(413);
  expect((await admin(oversized('/api/beta-admin', 'application/json', ownerCookie))).status).toBe(413);
  expect((await homepage(oversized('/api/home-content', 'application/json', ownerCookie))).status).toBe(413);
  expect((await install(oversized('/api/install', 'application/json'))).status).toBe(413);
});

it.each(['null', '[]', '1', '{"token":{},"accessCode":[],"adminCode":true}'])('returns a controlled error for installer input %s', async body => {
  const response = await install(new NextRequest(origin + '/api/install', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body }));
  expect(response.status).toBe(400);
});

it('revokes visitor and owner cookie copies through the actual logout endpoints', async () => {
  const token = issueBetaSession();
  expect((await logout(new NextRequest(origin + '/api/access', { method: 'DELETE', headers: { cookie: `${betaCookieName()}=${token}` } }))).status).toBe(403);
  expect(validBetaSession(token)).toBe(true);
  expect((await logout(new NextRequest(origin + '/api/access', { method: 'DELETE', headers: { cookie: `${betaCookieName()}=${token}`, 'x-sky-peek-action': 'logout' } }))).status).toBe(200);
  expect(validBetaSession(token)).toBe(false);
  const owner = issueBetaAdminSession();
  expect((await admin(new NextRequest(origin + '/api/beta-admin', { method: 'POST', headers: { origin, cookie: `${betaAdminCookieName()}=${owner}` }, body: new URLSearchParams({ intent: 'logout' }) }))).status).toBe(303);
  expect(validBetaAdminSession(owner)).toBe(false);
  expect((await homepage(new NextRequest(origin + '/api/home-content', { method: 'POST', headers: { origin, cookie: `${betaAdminCookieName()}=${owner}`, 'content-type': 'application/json' }, body: '{}' }))).status).toBe(401);
});
