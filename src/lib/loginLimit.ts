import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, rmdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { configDirectory } from './installation';

type Counts = { until: number; total: number; clients: Record<string, number> };
/** Durable budget shared by proxy/Node workers on the same private filesystem. */
export function admitLogin(request: Request, scope: 'visitor' | 'owner', now = Date.now()): 200 | 429 | 503 {
  const directory = join(configDirectory(), '.sky-peek-limits');
  const path = join(directory, `${scope}.json`);
  const lock = join(directory, `${scope}.lock`);
  let locked = false;
  try {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    mkdirSync(lock, { mode: 0o700 });
    locked = true;
    let counts: Counts;
    try { counts = JSON.parse(readFileSync(path, 'utf8')); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return 503;
      counts = { until: 0, total: 0, clients: {} };
    }
    if (!Number.isFinite(counts.until) || !Number.isFinite(counts.total) || !counts.clients || typeof counts.clients !== 'object') return 503;
    if (counts.until <= now) counts = { until: now + 15 * 60_000, total: 0, clients: {} };
    // Never trust forwarding headers by default. Enable only after the edge is
    // verified to overwrite the selected header and direct Node access is denied.
    const trusted = process.env.SKY_PEEK_TRUSTED_IP_HEADER;
    const ip = trusted === 'x-real-ip' || trusted === 'x-forwarded-for' ? request.headers.get(trusted)?.split(',')[0].trim() : null;
    const key = ip ? createHash('sha256').update(ip).digest('hex') : null;
    const totalLimit = scope === 'owner' ? 40 : 120;
    const clientLimit = scope === 'owner' ? 8 : 10;
    if (counts.total >= totalLimit || (key && (counts.clients[key] ?? 0) >= clientLimit)) return 429;
    counts.total++;
    if (key) counts.clients[key] = (counts.clients[key] ?? 0) + 1;
    const temporary = `${path}.tmp`;
    writeFileSync(temporary, JSON.stringify(counts), { mode: 0o600 });
    renameSync(temporary, path);
    return 200;
  } catch { return 503; }
  finally { if (locked) { try { rmdirSync(lock); } catch { /* Fail closed on subsequent attempts. */ } } }
}
