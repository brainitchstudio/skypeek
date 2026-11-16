import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

export function configDirectory(cwd = process.cwd()) {
  if (process.env.SKY_PEEK_DATA_DIR) return resolve(process.env.SKY_PEEK_DATA_DIR);
  const marker = `${sep}hbuilds${sep}`;
  const position = cwd.indexOf(marker);
  // Hostinger replaces hbuilds on each deploy. Store setup beside it.
  return position < 0 ? cwd : join(cwd.slice(0, position), '.sky-peek-data');
}

const configPath = () => join(configDirectory(), '.sky-peek-config.json');
const tokenPath = () => join(process.cwd(), '.sky-peek-install-token');

type InstalledConfig = {
  version: 1;
  accessHash: string;
  sessionSecret: string;
  adminCode: string;
};

export function installedConfig(): InstalledConfig | null {
  try {
    const data = JSON.parse(readFileSync(configPath(), 'utf8')) as InstalledConfig;
    return data.version === 1 && typeof data.accessHash === 'string' &&
      typeof data.sessionSecret === 'string' && typeof data.adminCode === 'string' ? data : null;
  } catch { return null; }
}

export function isInstalled() {
  return existsSync(configPath()) || Boolean(process.env.BETA_SESSION_SECRET &&
    (process.env.BETA_ACCESS_CODE || process.env.BETA_ACCESS_CODE_HASHES));
}

function equal(a: string, b: string) {
  const x = createHash('sha256').update(a).digest();
  const y = createHash('sha256').update(b).digest();
  return timingSafeEqual(x, y);
}

export function install(token: string, accessCode: string, adminCode: string): { ok: boolean; error?: string } {
  if (isInstalled()) return { ok: false, error: 'Sky Peek is already configured.' };
  if (token.length > 256 || accessCode.length < 12 || accessCode.length > 128 ||
      adminCode.length < 20 || adminCode.length > 128 || accessCode === adminCode) {
    return { ok: false, error: 'Use distinct codes of at least 12 and 20 characters.' };
  }
  let expected: string;
  try { expected = readFileSync(tokenPath(), 'utf8').trim(); }
  catch { return { ok: false, error: 'The installation token is missing from the upload folder.' }; }
  if (!/^[a-f0-9]{64}$/.test(expected) || !equal(token.trim(), expected)) {
    return { ok: false, error: 'The installation token is incorrect.' };
  }
  const salt = randomBytes(16).toString('hex');
  const accessHash = `scrypt$${salt}$${scryptSync(accessCode, Buffer.from(salt, 'hex'), 32).toString('hex')}`;
  const adminSalt = randomBytes(16).toString('hex');
  const adminHash = `scrypt$${adminSalt}$${scryptSync(adminCode, Buffer.from(adminSalt, 'hex'), 32).toString('hex')}`;
  const data: InstalledConfig = { version: 1, accessHash, sessionSecret: randomBytes(32).toString('hex'), adminCode: adminHash };
  try {
    mkdirSync(configDirectory(), { recursive: true, mode: 0o700 });
    writeFileSync(configPath(), JSON.stringify(data), { flag: 'wx', mode: 0o600 });
  } catch {
    return { ok: false, error: 'Unable to save the private configuration. Check folder write permissions.' };
  }
  try { unlinkSync(tokenPath()); } catch { /* The saved config still locks setup. */ }
  return { ok: true };
}
