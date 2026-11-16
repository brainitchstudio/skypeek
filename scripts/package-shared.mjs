import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const output = join(root, 'dist', 'sky-peek');
const archive = join(root, 'dist', 'sky-peek-shared-hosting.zip');
if (!existsSync(join(root, '.next', 'standalone', 'server.js'))) {
  throw new Error('Missing standalone build. Run npm run build first.');
}
rmSync(output, { recursive: true, force: true });
rmSync(archive, { force: true });
mkdirSync(output, { recursive: true });
cpSync(join(root, '.next', 'standalone'), output, { recursive: true });
mkdirSync(join(output, '.next'), { recursive: true });
cpSync(join(root, '.next', 'static'), join(output, '.next', 'static'), { recursive: true });
cpSync(join(root, 'public'), join(output, 'public'), { recursive: true });
const token = randomBytes(32).toString('hex');
writeFileSync(join(output, '.sky-peek-install-token'), `${token}\n`, { mode: 0o600 });
writeFileSync(join(output, 'INSTALL.txt'), readFileSync(join(root, 'docs', 'shared-hosting-install.md'), 'utf8'));
const zip = spawnSync('zip', ['-qr', archive, '.'], { cwd: output, stdio: 'inherit' });
if (zip.status !== 0) throw new Error('Could not create zip archive; install the zip utility.');
console.log(`Package: ${archive}`);
console.log('Read the installation token privately from .sky-peek-install-token inside the package. Keep the package and token private.');
if (process.platform !== 'linux') {
  console.warn('Build on the same OS and CPU architecture as the hosting server for a production upload; this local package includes platform-specific native dependencies.');
}
