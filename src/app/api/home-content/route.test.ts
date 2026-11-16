import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NextRequest } from 'next/server';
import { betaAdminCookieName, issueBetaAdminSession } from '@/lib/betaGate';
import { defaultHomeContent, readHomeContent } from '@/lib/homeContent';
import { POST } from './route';

let directory: string;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'sky-peek-home-test-'));
  vi.stubEnv('SKY_PEEK_DATA_DIR', directory);
  vi.stubEnv('BETA_ACCESS_CODE', 'rainy-foxes-visit-2026');
  vi.stubEnv('BETA_SESSION_SECRET', 'a-long-private-signing-secret-for-homepage-tests');
  vi.stubEnv('BETA_ADMIN_CODE', 'owner-only-homepage-test-code-2026');
});
afterEach(() => { vi.unstubAllEnvs(); rmSync(directory, { recursive: true, force: true }); });

it('requires the owner session and same origin before saving homepage copy', async () => {
  const url = 'https://skypeek.brainitch.studio/api/home-content';
  const body = JSON.stringify({ ...defaultHomeContent, headline: 'A fresh headline' });
  const make = (cookie?: string, origin = 'https://skypeek.brainitch.studio') => new NextRequest(url, {
    method: 'POST', headers: { 'content-type': 'application/json', origin, ...(cookie ? { cookie } : {}) }, body,
  });
  expect((await POST(make())).status).toBe(401);
  const cookie = `${betaAdminCookieName()}=${issueBetaAdminSession()}`;
  expect((await POST(make(cookie, 'https://elsewhere.example'))).status).toBe(403);
  expect((await POST(make(cookie))).status).toBe(200);
  expect(readHomeContent().headline).toBe('A fresh headline');
});
