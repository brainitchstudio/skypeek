import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export const BETA_COOKIE = '__Host-sky-peek-beta';
export const BETA_COOKIE_DEV = 'sky-peek-beta-dev';
export const BETA_ADMIN_COOKIE = '__Host-sky-peek-beta-admin';
export const BETA_ADMIN_COOKIE_DEV = 'sky-peek-beta-admin-dev';
export const BETA_SESSION_SECONDS = 7 * 24 * 60 * 60;
export const BETA_ADMIN_SESSION_SECONDS = 12 * 60 * 60;
export const MAX_INVITE_DAYS = 90;

type GateConfig = { code: string; secret: string; hashes: string[] | null };
const HASH_PATTERN = /^scrypt\$([a-f0-9]{32})\$([a-f0-9]{64})$/;

function configuredHashes() {
  const value = process.env.BETA_ACCESS_CODE_HASHES;
  return value ? value.split(',').map(hash => hash.trim()) : null;
}

export function betaCookieName() {
  return process.env.NODE_ENV === 'production' ? BETA_COOKIE : BETA_COOKIE_DEV;
}

export function betaAdminCookieName() {
  return process.env.NODE_ENV === 'production' ? BETA_ADMIN_COOKIE : BETA_ADMIN_COOKIE_DEV;
}

export function betaGateState(): 'open' | 'ready' | 'misconfigured' {
  const code = process.env.BETA_ACCESS_CODE;
  const hashes = configuredHashes();
  const secret = process.env.BETA_SESSION_SECRET;
  if (process.env.NODE_ENV !== 'production' && !code && !hashes && !secret) return 'open';
  const credentialReady = hashes ? hashes.every(hash => HASH_PATTERN.test(hash)) : !!code && code.length >= 12;
  return credentialReady && !!secret && secret.length >= 32 ? 'ready' : 'misconfigured';
}

function config(): GateConfig | null {
  if (betaGateState() !== 'ready') return null;
  const hashes = configuredHashes();
  return { code: hashes?.join(',') || process.env.BETA_ACCESS_CODE!, secret: process.env.BETA_SESSION_SECRET!, hashes };
}

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
  return betaGateState() === 'ready' && (process.env.BETA_ADMIN_CODE?.length ?? 0) >= 20;
}

export function acceptsBetaAdminCode(input: string) {
  return betaAdminReady() && input.length <= 128 && equal(input, process.env.BETA_ADMIN_CODE!);
}

export function issueBetaAdminSession(now = Date.now()) {
  if (!betaAdminReady()) throw new Error('Beta code manager is not configured');
  const expires = now + BETA_ADMIN_SESSION_SECONDS * 1000;
  const payload = `a1.${expires}.${randomBytes(16).toString('base64url')}`;
  const secret = `${process.env.BETA_SESSION_SECRET!}:${process.env.BETA_ADMIN_CODE!}`;
  return `${payload}.${signed(payload, 'admin', secret)}`;
}

export function validBetaAdminSession(value: string | undefined, now = Date.now()) {
  if (!betaAdminReady() || !value || value.length > 200) return false;
  const match = /^a1\.(\d{13})\.([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{43})$/.exec(value);
  if (!match) return false;
  const expires = Number(match[1]);
  if (expires <= now || expires > now + BETA_ADMIN_SESSION_SECONDS * 1000) return false;
  const payload = value.slice(0, value.lastIndexOf('.'));
  const secret = `${process.env.BETA_SESSION_SECRET!}:${process.env.BETA_ADMIN_CODE!}`;
  return equal(match[3], signed(payload, 'admin', secret));
}

export function generateBetaInvite(days: number, now = Date.now()) {
  if (!betaAdminReady() || !Number.isInteger(days) || days < 1 || days > MAX_INVITE_DAYS) {
    throw new Error('Invalid beta invite configuration');
  }
  const expires = now + days * 24 * 60 * 60 * 1000;
  const payload = `i1.${expires}.${randomBytes(16).toString('base64url')}`;
  return `${payload}.${signed(payload, 'invite', process.env.BETA_SESSION_SECRET!)}`;
}

export function validBetaInvite(value: string, now = Date.now()) {
  if (betaGateState() !== 'ready' || value.length > 128) return false;
  const match = /^i1\.(\d{13})\.([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{43})$/.exec(value);
  if (!match) return false;
  const expires = Number(match[1]);
  if (expires <= now || expires > now + MAX_INVITE_DAYS * 24 * 60 * 60 * 1000) return false;
  const payload = value.slice(0, value.lastIndexOf('.'));
  return equal(match[3], signed(payload, 'invite', process.env.BETA_SESSION_SECRET!));
}

export function acceptsBetaCode(input: string, now = Date.now()) {
  const current = config();
  return !!current && input.length <= 128 && (matchesSharedCode(input, current) || validBetaInvite(input, now));
}

function signature(payload: string, current: GateConfig) {
  const key = createHmac('sha256', current.secret).update(current.code).digest();
  return createHmac('sha256', key).update(payload).digest('base64url');
}

export function issueBetaSession(now = Date.now()) {
  const current = config();
  if (!current) throw new Error('Beta gate is not configured');
  const expires = now + BETA_SESSION_SECONDS * 1000;
  const payload = `v1.${expires}.${randomBytes(16).toString('base64url')}`;
  return `${payload}.${signature(payload, current)}`;
}

export function validBetaSession(value: string | undefined, now = Date.now()) {
  const current = config();
  if (!current || !value || value.length > 200) return false;
  const match = /^v1\.(\d{13})\.([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{43})$/.exec(value);
  if (!match) return false;
  const expires = Number(match[1]);
  if (expires <= now || expires > now + BETA_SESSION_SECONDS * 1000) return false;
  const payload = value.slice(0, value.lastIndexOf('.'));
  return equal(match[3], signature(payload, current));
}
