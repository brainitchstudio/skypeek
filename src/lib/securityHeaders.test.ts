import { expect, it } from 'vitest';
import { contentSecurityPolicy } from './securityHeaders';

it('blocks foreign/inline scripts and event attributes without weakening production for development', () => {
  const policy = contentSecurityPolicy('unique-nonce');
  expect(policy).toContain("script-src 'nonce-unique-nonce' 'strict-dynamic';");
  expect(policy).toContain("script-src-attr 'none'");
  expect(policy).toContain("frame-ancestors 'none'");
  expect(policy).not.toContain("'unsafe-eval'");
  expect(policy).not.toMatch(/script-src[^;]*unsafe-inline/);
  expect(policy).toContain('https://tiles.openfreemap.org');
  expect(contentSecurityPolicy('dev', true)).toContain("'unsafe-eval'");
});
