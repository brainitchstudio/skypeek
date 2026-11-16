import { expect, it, vi } from 'vitest';
import { admitLogin } from './loginLimit';

it('does not let spoofed forwarding headers bypass the durable global budget', async () => {
  vi.stubEnv('SKY_PEEK_TRUSTED_IP_HEADER', '');
  const now = Date.now();
  for (let i = 0; i < 40; i++) expect(admitLogin(new Request('https://example.test', { headers: { 'x-real-ip': String(i) } }), 'owner', now)).toBe(200);
  vi.resetModules();
  const restarted = await import('./loginLimit');
  expect(restarted.admitLogin(new Request('https://example.test', { headers: { 'x-real-ip': 'fresh' } }), 'owner', now)).toBe(429);
  expect(restarted.admitLogin(new Request('https://example.test'), 'owner', now + 15 * 60_000)).toBe(200);
  vi.unstubAllEnvs();
});

it('adds per-client limits only for an explicitly configured trusted header', () => {
  vi.stubEnv('SKY_PEEK_TRUSTED_IP_HEADER', 'x-real-ip');
  const request = new Request('https://example.test', { headers: { 'x-real-ip': '198.51.100.1' } });
  for (let i = 0; i < 8; i++) expect(admitLogin(request, 'owner')).toBe(200);
  expect(admitLogin(request, 'owner')).toBe(429);
  expect(admitLogin(new Request('https://example.test', { headers: { 'x-real-ip': '198.51.100.2' } }), 'owner')).toBe(200);
  vi.unstubAllEnvs();
});
