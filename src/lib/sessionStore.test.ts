import { afterEach, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createSession, readSession, revokeSession, revokePrincipal } from './sessionStore';

afterEach(() => vi.unstubAllEnvs());
it('revokes a copied token durably without affecting another session', async () => {
  const now = Date.now();
  const first = createSession('visitor', 'one', 'binding', now + 10000, now);
  const other = createSession('visitor', 'two', 'binding', now + 10000, now);
  expect(readSession(first, 'visitor', 'binding', now)).not.toBeNull();
  revokeSession(first);
  revokeSession(first);
  vi.resetModules();
  const restarted = await import('./sessionStore');
  expect(restarted.readSession(first, 'visitor', 'binding', now)).toBeNull();
  expect(restarted.readSession(other, 'visitor', 'binding', now)).not.toBeNull();
});
it('signs out all sessions for the same code authority, independently of other codes', () => {
  const now = Date.now();
  const tokens = ['one', 'one', 'two'].map(id => createSession('visitor', id, 'binding', now + 10000, now));
  revokePrincipal(readSession(tokens[0], 'visitor', 'binding', now)!.principal);
  expect(tokens.map(token => !!readSession(token, 'visitor', 'binding', now))).toEqual([false, false, true]);
});
it('enforces purpose, binding, idle and absolute expiry, rejecting legacy cookies', () => {
  const now = Date.now();
  const token = createSession('owner', 'owner', 'binding', now + 10000, now);
  expect(readSession(token, 'visitor', 'binding', now)).toBeNull();
  expect(readSession(token, 'owner', 'rotated', now)).toBeNull();
  expect(readSession(token, 'owner', 'binding', now + 1000, 1000)).toBeNull();
  expect(readSession(token, 'owner', 'binding', now + 10000)).toBeNull();
  expect(readSession('a1.1800000000000.legacy.signature', 'owner', 'binding', now)).toBeNull();
});
it('stores only a digest of the token and fails closed if storage disappears', () => {
  const now = Date.now();
  const token = createSession('visitor', 'identity', 'binding', now + 10000, now);
  const directory = join(process.env.SKY_PEEK_DATA_DIR!, '.sky-peek-sessions');
  const path = join(directory, `${createHash('sha256').update(token).digest('hex')}.json`);
  expect(readFileSync(path, 'utf8')).not.toContain(token);
  expect(readdirSync(directory).join()).not.toContain(token);
  rmSync(directory, { recursive: true });
  expect(readSession(token, 'visitor', 'binding', now)).toBeNull();
});
