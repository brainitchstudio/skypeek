import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { installedConfig } from './installation';
import { createSession, readSession, revokePrincipal, revokeSession } from './sessionStore';

export const BETA_COOKIE = '__Host-sky-peek-beta';
export const BETA_COOKIE_DEV = 'sky-peek-beta-dev';
export const BETA_ADMIN_COOKIE = '__Host-sky-peek-beta-admin';
export const BETA_ADMIN_COOKIE_DEV = 'sky-peek-beta-admin-dev';
export const BETA_SESSION_SECONDS = 7 * 24 * 60 * 60;
export const BETA_IDENTITY_COOKIE = 'sky-peek-beta-identity';
export const BETA_ADMIN_SESSION_SECONDS = 4 * 60 * 60;
export const BETA_ADMIN_IDLE_MS = 15 * 60_000;
export const BETA_ADMIN_FRESH_MS = 5 * 60_000;
export const MAX_INVITE_DAYS = 90;

type GateConfig = { code: string; secret: string; hashes: string[] | null };
const HASH_PATTERN = /^scrypt\$([a-f0-9]{32})\$([a-f0-9]{64})$/;

function configuredHashes() {
  const value = installedConfig()?.accessHash ?? process.env.BETA_ACCESS_CODE_HASHES;
  return value ? value.split(',').map(hash => hash.trim()) : null;
}

export function betaCookieName() {
  return process.env.NODE_ENV === 'production' ? BETA_COOKIE : BETA_COOKIE_DEV;
}

export function betaAdminCookieName() {
  return process.env.NODE_ENV === 'production' ? BETA_ADMIN_COOKIE : BETA_ADMIN_COOKIE_DEV;
}

export function betaGateState(): 'open' | 'ready' | 'misconfigured' {
  const installed = installedConfig();
  const code = installed ? undefined : process.env.BETA_ACCESS_CODE;
  const hashes = configuredHashes();
  const secret = installed?.sessionSecret ?? process.env.BETA_SESSION_SECRET;
  if (process.env.NODE_ENV !== 'production' && !code && !hashes && !secret) return 'open';
  const credentialReady = hashes ? hashes.every(hash => HASH_PATTERN.test(hash)) : !!code && code.length >= 12;
  return credentialReady && !!secret && secret.length >= 32 ? 'ready' : 'misconfigured';
}

function config(): GateConfig | null {
  if (betaGateState() !== 'ready') return null;
  const hashes = configuredHashes();
  return { code: hashes?.join(',') || process.env.BETA_ACCESS_CODE!, secret: installedConfig()?.sessionSecret ?? process.env.BETA_SESSION_SECRET!, hashes };
}

function sessionSecret() { return installedConfig()?.sessionSecret ?? process.env.BETA_SESSION_SECRET!; }
function adminCode() { return installedConfig()?.adminCode ?? process.env.BETA_ADMIN_CODE; }

function matchesSharedCode(input: string, current: GateConfig) {
  if (!current.hashes) return equal(input, current.code);
  return current.hashes.some(hash => {
    const match = HASH_PATTERN.exec(hash)!;
    const actual = scryptSync(input, Buffer.from(match[1], 'hex'), 32);
    return timingSafeEqual(actual, Buffer.from(match[2], 'hex'));
  });
}

function equal(a: string, b: string) {
  const first = createHash('sha256').update(a).digest();
  const second = createHash('sha256').update(b).digest();
  return timingSafeEqual(first, second);
}

function signed(payload: string, purpose: string, secret: string) {
  return createHmac('sha256', secret).update(`${purpose}:${payload}`).digest('base64url');
}

export function betaAdminReady() {
  return betaGateState() === 'ready' && (adminCode()?.length ?? 0) >= 20;
}

export function acceptsBetaAdminCode(input: string) {
  if (!betaAdminReady() || input.length > 128) return false;
  const stored = adminCode()!;
  const match = HASH_PATTERN.exec(stored);
  if (!match) return equal(input, stored);
  return timingSafeEqual(scryptSync(input, Buffer.from(match[1], 'hex'), 32), Buffer.from(match[2], 'hex'));
}

export function issueBetaAdminSession(now = Date.now()) {
  if (!betaAdminReady()) throw new Error('Beta code manager is not configured');
  return createSession('owner', 'owner', `${sessionSecret()}:${adminCode()!}`, now + BETA_ADMIN_SESSION_SECONDS * 1000, now);
}

export function validBetaAdminSession(value: string | undefined, now = Date.now()) {
  return !!ownerSession(value, now);
}

function ownerSession(value: string | undefined, now: number) {
  return betaAdminReady() ? readSession(value, 'owner', `${sessionSecret()}:${adminCode()!}`, now, BETA_ADMIN_IDLE_MS) : null;
}

export function freshBetaAdminSession(value: string | undefined, now = Date.now()) {
  const session = ownerSession(value, now);
  return !!session && now - session.created < BETA_ADMIN_FRESH_MS;
}

export function revokeBetaAdminSession(value: string | undefined, all = false) {
  const session = ownerSession(value, Date.now());
  if (all && session) revokePrincipal(session.principal);
  revokeSession(value);
}

export function generateBetaInvite(days: number, now = Date.now()) {
  if (!betaAdminReady() || !Number.isInteger(days) || days < 1 || days > MAX_INVITE_DAYS) {
    throw new Error('Invalid beta invite configuration');
  }
  const expires = now + days * 24 * 60 * 60 * 1000;
  const payload = `i1.${expires}.${randomBytes(16).toString('base64url')}`;
  return `${payload}.${signed(payload, 'invite', sessionSecret())}`;
}

export function validBetaInvite(value: string, now = Date.now()) {
  if (betaGateState() !== 'ready' || value.length > 128) return false;
  const match = /^i1\.(\d{13})\.([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{43})$/.exec(value);
  if (!match) return false;
  const expires = Number(match[1]);
  if (expires <= now || expires > now + MAX_INVITE_DAYS * 24 * 60 * 60 * 1000) return false;
  const payload = value.slice(0, value.lastIndexOf('.'));
  return equal(match[3], signed(payload, 'invite', sessionSecret()));
}

export function acceptsBetaCode(input: string, now = Date.now()) {
  const current = config();
  return !!current && input.length <= 128 && (matchesSharedCode(input, current) || validBetaInvite(input, now));
}

/** Opaque browser-visible identifier for per-code onboarding state; never reveals the code. */
export function betaCodeIdentity(input: string) {
  const current = config();
  if (!current) throw new Error('Beta gate is not configured');
  return createHmac('sha256', current.secret).update(`onboarding:${input}`).digest('hex').slice(0, 32);
}

export function issueBetaSession(now = Date.now(), accessCode?: string) {
  const current = config();
  if (!current) throw new Error('Beta gate is not configured');
  const inviteExpiry = accessCode && validBetaInvite(accessCode, now) ? Number(accessCode.split('.')[1]) : Infinity;
  const expires = Math.min(now + BETA_SESSION_SECONDS * 1000, inviteExpiry);
  return createSession('visitor', betaCodeIdentity(accessCode ?? current.code), `${current.secret}:${current.code}`, expires, now);
}

export function validBetaSession(value: string | undefined, now = Date.now()) {
  const current = config();
  return !!current && !!readSession(value, 'visitor', `${current.secret}:${current.code}`, now);
}

export function revokeBetaSession(value: string | undefined, all = false) {
  const current = config();
  const session = current ? readSession(value, 'visitor', `${current.secret}:${current.code}`, Date.now()) : null;
  if (all && session) revokePrincipal(session.principal);
  revokeSession(value);
}
