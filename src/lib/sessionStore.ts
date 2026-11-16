import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { configDirectory } from './installation';

type Role = 'visitor' | 'owner';
type Session = { role: Role; principal: string; generation: string; binding: string; created: number; expires: number };
const TOKEN = /^s2\.[A-Za-z0-9_-]{43}$/;
const PRINCIPAL = /^[a-f0-9]{64}$/;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const directory = () => join(configDirectory(), '.sky-peek-sessions');
const sessionPath = (token: string) => join(directory(), `${hash(token)}.json`);
const generationPath = (principal: string) => join(directory(), `${principal}.generation`);

function generation(principal: string) {
  if (!PRINCIPAL.test(principal)) throw new Error('Invalid session principal');
  const path = generationPath(principal);
  try { return readFileSync(path, 'utf8'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    try { writeFileSync(path, randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o600 }); }
    catch (race) { if ((race as NodeJS.ErrnoException).code !== 'EEXIST') throw race; }
    return readFileSync(path, 'utf8');
  }
}

/** Shared private filesystem required on all Node workers. No in-memory fallback. */
export function createSession(role: Role, identity: string, binding: string, expires: number, now: number) {
  mkdirSync(directory(), { recursive: true, mode: 0o700 });
  const principal = hash(`${role}:${identity}`);
  const token = `s2.${randomBytes(32).toString('base64url')}`;
  const row: Session = { role, principal, generation: generation(principal), binding: hash(binding), created: now, expires };
  // Opportunistic bounded-by-login-rate cleanup; only session records, never generation state.
  for (const name of readdirSync(directory())) {
    if (!/^[a-f0-9]{64}\.json$/.test(name)) continue;
    try {
      const path = join(directory(), name);
      if (JSON.parse(readFileSync(path, 'utf8')).expires <= now) unlinkSync(path);
    } catch { /* A concurrent logout may already have removed it. */ }
  }
  writeFileSync(sessionPath(token), JSON.stringify(row), { flag: 'wx', mode: 0o600 });
  utimesSync(sessionPath(token), new Date(now), new Date(now));
  return token;
}

export function readSession(token: string | undefined, role: Role, binding: string, now: number, idleMs?: number): Session | null {
  if (!token || !TOKEN.test(token)) return null; // Reject legacy signed cookies at rollout.
  try {
    const path = sessionPath(token);
    const row: Session = JSON.parse(readFileSync(path, 'utf8'));
    if (row.role !== role || row.binding !== hash(binding) || !PRINCIPAL.test(row.principal)
      || !Number.isFinite(row.created) || !Number.isFinite(row.expires) || row.created > now || row.expires <= now
      || row.generation !== readFileSync(generationPath(row.principal), 'utf8')) return null;
    if (idleMs) {
      const lastUsed = statSync(path).mtimeMs;
      if (now - lastUsed >= idleMs) return null;
      // Touch existing inode only: never rewrite a session that logout has removed.
      if (now > lastUsed) utimesSync(path, new Date(now), new Date(now));
    }
    return row;
  } catch { return null; } // Unavailable/corrupt store denies authorization.
}

export function revokeSession(token: string | undefined) {
  if (!token || !TOKEN.test(token)) return;
  try { unlinkSync(sessionPath(token)); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
}

export function revokePrincipal(principal: string) {
  if (!PRINCIPAL.test(principal)) throw new Error('Invalid session principal');
  const path = generationPath(principal);
  const temporary = `${path}.${randomBytes(16).toString('hex')}.tmp`;
  writeFileSync(temporary, randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o600 });
  renameSync(temporary, path);
}
