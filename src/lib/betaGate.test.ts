import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { scryptSync } from 'node:crypto';
import { acceptsBetaAdminCode, acceptsBetaCode, betaAdminReady, betaCodeIdentity, betaGateState, BETA_SESSION_SECONDS, generateBetaInvite, issueBetaAdminSession, issueBetaSession, validBetaAdminSession, validBetaInvite, validBetaSession } from './betaGate';

const CODE = 'rainy-foxes-visit-2026';
const SECRET = 'a-long-private-signing-secret-that-stays-on-the-server';

describe('beta gate', () => {
  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('BETA_ACCESS_CODE', CODE);
    vi.stubEnv('BETA_ACCESS_CODE_HASHES', '');
    vi.stubEnv('BETA_SESSION_SECRET', SECRET);
    vi.stubEnv('BETA_ADMIN_CODE', 'owner-only-code-with-high-entropy-2026');
  });
  afterEach(() => vi.unstubAllEnvs());

  it('fails closed in production without valid configuration', () => {
    vi.stubEnv('BETA_ACCESS_CODE', 'short');
    expect(betaGateState()).toBe('misconfigured');
    expect(acceptsBetaCode('short')).toBe(false);
    expect(validBetaSession('anything')).toBe(false);
  });

  it('accepts only the configured code and signs an expiring cookie', () => {
    const now = 1_800_000_000_000;
    expect(acceptsBetaCode(CODE)).toBe(true);
    expect(acceptsBetaCode('wrong-code-123')).toBe(false);
    const cookie = issueBetaSession(now);
    expect(cookie).not.toContain(CODE);
    expect(validBetaSession(cookie, now + 1000)).toBe(true);
    expect(validBetaSession(cookie, now + BETA_SESSION_SECONDS * 1000)).toBe(false);
    expect(validBetaSession(cookie.slice(0, -1) + (cookie.endsWith('A') ? 'B' : 'A'), now + 1000)).toBe(false);
  });

  it('gives each valid access code a stable opaque onboarding identity', () => {
    expect(betaCodeIdentity(CODE)).toMatch(/^[a-f0-9]{32}$/);
    expect(betaCodeIdentity(CODE)).toBe(betaCodeIdentity(CODE));
    expect(betaCodeIdentity(CODE)).not.toBe(betaCodeIdentity('another-code'));
    expect(betaCodeIdentity(CODE)).not.toContain(CODE);
  });

  it('invalidates sessions when the code rotates', () => {
    const cookie = issueBetaSession();
    vi.stubEnv('BETA_ACCESS_CODE', 'a-new-code-for-the-beta');
    expect(validBetaSession(cookie)).toBe(false);
  });

  it('accepts multiple salted hashes instead of the old plaintext code', () => {
    const replacement = 'another-private-beta-code';
    const salt = '0123456789abcdef0123456789abcdef';
    const hash = scryptSync(replacement, Buffer.from(salt, 'hex'), 32).toString('hex');
    const second = 'rainfox';
    const secondSalt = 'fedcba9876543210fedcba9876543210';
    const secondHash = scryptSync(second, Buffer.from(secondSalt, 'hex'), 32).toString('hex');
    const oldSession = issueBetaSession();
    vi.stubEnv('BETA_ACCESS_CODE_HASHES', `scrypt$${salt}$${hash},scrypt$${secondSalt}$${secondHash}`);
    expect(betaGateState()).toBe('ready');
    expect(acceptsBetaCode(replacement)).toBe(true);
    expect(acceptsBetaCode(second)).toBe(true);
    expect(acceptsBetaCode(CODE)).toBe(false);
    expect(validBetaSession(oldSession)).toBe(false);
    expect(validBetaSession(issueBetaSession())).toBe(true);
    expect(betaAdminReady()).toBe(true);
    expect(acceptsBetaCode(generateBetaInvite(7))).toBe(true);
  });

  it('fails closed for a malformed hash even when a plaintext code exists', () => {
    vi.stubEnv('BETA_ACCESS_CODE_HASHES', 'invalid-hash');
    expect(betaGateState()).toBe('misconfigured');
    expect(acceptsBetaCode(CODE)).toBe(false);
  });

  it('leaves local development open when no gate is configured', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('BETA_ACCESS_CODE', '');
    vi.stubEnv('BETA_ACCESS_CODE_HASHES', '');
    vi.stubEnv('BETA_SESSION_SECRET', '');
    expect(betaGateState()).toBe('open');
  });

  it('generates distinct expiring invite codes that can enter the beta', () => {
    const now = 1_800_000_000_000;
    const first = generateBetaInvite(7, now);
    const second = generateBetaInvite(7, now);
    expect(first).not.toBe(second);
    expect(validBetaInvite(first, now)).toBe(true);
    expect(acceptsBetaCode(first, now)).toBe(true);
    expect(validBetaInvite(first, now + 7 * 86400_000)).toBe(false);
    expect(acceptsBetaCode(first.slice(0, -1) + (first.endsWith('x') ? 'y' : 'x'), now)).toBe(false);
    expect(() => generateBetaInvite(91, now)).toThrow();
    vi.stubEnv('BETA_SESSION_SECRET', 'a-different-private-signing-secret-that-stays-on-server');
    expect(validBetaInvite(first, now)).toBe(false);
  });

  it('keeps code management behind its own expiring owner session', () => {
    const now = 1_800_000_000_000;
    expect(betaAdminReady()).toBe(true);
    expect(acceptsBetaAdminCode('owner-only-code-with-high-entropy-2026')).toBe(true);
    expect(acceptsBetaAdminCode(CODE)).toBe(false);
    const cookie = issueBetaAdminSession(now);
    expect(validBetaAdminSession(cookie, now + 1000)).toBe(true);
    expect(validBetaAdminSession(cookie, now + 12 * 3600_000)).toBe(false);
    vi.stubEnv('BETA_ADMIN_CODE', 'different-owner-code-with-high-entropy');
    expect(validBetaAdminSession(cookie, now + 1000)).toBe(false);
  });
});
