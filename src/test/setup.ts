import { afterAll, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Never create authentication/session test state in the actual deployment directory.
const directory = mkdtempSync(join(tmpdir(), 'sky-peek-test-'));
beforeEach(() => {
  rmSync(directory, { recursive: true, force: true });
  mkdirSync(directory);
  process.env.SKY_PEEK_DATA_DIR = directory;
});
afterAll(() => rmSync(directory, { recursive: true, force: true }));
