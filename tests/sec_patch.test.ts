// SEC-PATCH — regression coverage for the security-hardening release.
//
// Verifies:
//   • SEC-002 next.config.js exports the correct restrictive header set.
//   • SEC-003 handleServiceError never leaks internal error text on 5xx.
//   • SEC-005 verifyCronSecret is fail-closed, header-only, and constant-time.
//   • SEC-004 the smoke-campaign fixture is not part of the tracked repo and
//     the pattern is gitignored.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { handleServiceError } from '@/lib/utils/response';
import { HttpError } from '@/lib/auth/rbac';
import { verifyCronSecret } from '@/lib/auth/cronAuth';

const REPO = path.resolve(__dirname, '..');

// ─────────────────────────────────────────────────────────────────────────────
// SEC-002 — security headers configuration
// ─────────────────────────────────────────────────────────────────────────────
describe('SEC-002 next.config.js security headers', () => {
  it('exports a restrictive, non-framable, hardened header set', async () => {
    const cfgPath = path.join(REPO, 'next.config.js');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const cfg = require(cfgPath);
    const rules = await cfg.headers();
    expect(Array.isArray(rules)).toBe(true);
    const rule = rules.find((r: { source: string }) => r.source === '/(.*)');
    expect(rule).toBeTruthy();
    const map = new Map<string, string>();
    for (const h of rule.headers as Array<{ key: string; value: string }>) {
      map.set(h.key.toLowerCase(), h.value);
    }

    // No permissive framing survives.
    expect(map.get('x-frame-options')).toBe('DENY');
    const csp = map.get('content-security-policy') || '';
    expect(csp).toMatch(/frame-ancestors\s+'none'/);
    expect(csp).not.toMatch(/\*/);

    // HSTS present, but NOT includeSubDomains (subdomain HTTPS not asserted).
    const hsts = map.get('strict-transport-security') || '';
    expect(hsts).toMatch(/max-age=31536000/);
    expect(hsts).not.toMatch(/includeSubDomains/i);
    expect(hsts).not.toMatch(/preload/i);

    // Standard hardening headers.
    expect(map.get('x-content-type-options')).toBe('nosniff');
    expect(map.get('referrer-policy')).toBe('strict-origin-when-cross-origin');

    // Conservative Permissions-Policy: dangerous capabilities denied, but
    // payment=(self) preserved so PayPal / provider redirects keep working.
    const pp = map.get('permissions-policy') || '';
    expect(pp).toMatch(/camera=\(\)/);
    expect(pp).toMatch(/microphone=\(\)/);
    expect(pp).toMatch(/geolocation=\(\)/);
    expect(pp).toMatch(/payment=\(self\)/);
    expect(pp).toMatch(/interest-cohort=\(\)/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SEC-003 — 5xx error hygiene
// ─────────────────────────────────────────────────────────────────────────────
describe('SEC-003 handleServiceError never leaks internal 5xx text', () => {
  it('returns a generic message for unexpected Error(500)', async () => {
    const spy = ((): { restore: () => void; called: boolean } => {
      const original = console.error;
      let called = false;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      console.error = (..._args: any[]) => { called = true; };
      return { restore: () => { console.error = original; }, get called() { return called; } };
    })();

    try {
      const boom = new Error('MongoServerError: E11000 duplicate key /var/run/secret');
      const res = handleServiceError(boom);
      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.ok).toBe(false);
      expect(body.error).toBe('Internal server error');
      expect(body.error).not.toMatch(/MongoServerError/);
      expect(body.error).not.toMatch(/E11000/);
      expect(body.error).not.toMatch(/\/var\/run\/secret/);
      expect(spy.called).toBe(true); // still logged server-side
    } finally {
      spy.restore();
    }
  });

  it('preserves safe HttpError 4xx public messages', async () => {
    const err = new HttpError(403, 'Insufficient role');
    const res = handleServiceError(err);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('Insufficient role');
  });

  it('preserves explicit 4xx publicMessage from a plain error-like object', async () => {
    const shaped = { status: 400, publicMessage: 'Bad Campaign budget', message: 'internal: budget<=0 rejected' };
    const res = handleServiceError(shaped);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Bad Campaign budget');
  });

  it('does not use anyErr.message on >=500 even if provided', async () => {
    const shaped = { status: 500, message: 'stack:/app/lib/services/x line 42 SECRET=abc' };
    const res = handleServiceError(shaped);
    const body = await res.json();
    expect(body.error).toBe('Internal server error');
    expect(body.error).not.toMatch(/SECRET/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SEC-005 — constant-time CRON_SECRET compare
// ─────────────────────────────────────────────────────────────────────────────
describe('SEC-005 verifyCronSecret', () => {
  const ORIGINAL = process.env.CRON_SECRET;
  beforeEach(() => { delete process.env.CRON_SECRET; });
  afterEach(() => { if (ORIGINAL === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = ORIGINAL; });

  it('fails closed when CRON_SECRET env is missing (503 semantic)', () => {
    expect(verifyCronSecret('anything')).toBe('missing');
    expect(verifyCronSecret(null)).toBe('missing');
  });

  it('rejects a missing / empty caller header when env is set', () => {
    process.env.CRON_SECRET = 'valid-secret-abc-123';
    expect(verifyCronSecret(null)).toBe('unauthorized');
    expect(verifyCronSecret('')).toBe('unauthorized');
  });

  it('rejects a wrong-length caller header (constant-time-safe)', () => {
    process.env.CRON_SECRET = 'valid-secret-abc-123';
    expect(verifyCronSecret('short')).toBe('unauthorized');
    expect(verifyCronSecret('valid-secret-abc-123-EXTRA')).toBe('unauthorized');
  });

  it('rejects an equal-length wrong secret', () => {
    process.env.CRON_SECRET = 'valid-secret-abc-123';
    expect(verifyCronSecret('WRONG-secret-abc-123')).toBe('unauthorized');
  });

  it('accepts the exact configured secret', () => {
    process.env.CRON_SECRET = 'valid-secret-abc-123';
    expect(verifyCronSecret('valid-secret-abc-123')).toBe('ok');
  });

  it('uses crypto.timingSafeEqual (no plain !== in helper source)', () => {
    const src = readFileSync(path.join(REPO, 'lib/auth/cronAuth.ts'), 'utf8');
    expect(src).toMatch(/crypto\.timingSafeEqual/);
    // Guard against regressions to naive `provided !== secret` comparisons.
    expect(src).not.toMatch(/provided\s*!==\s*secret/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SEC-004 — fixture credential is not committed & is gitignored
// ─────────────────────────────────────────────────────────────────────────────
describe('SEC-004 smoke_campaign_ephemeral.txt', () => {
  it('is removed from the current tree', () => {
    expect(existsSync(path.join(REPO, 'memory/smoke_campaign_ephemeral.txt'))).toBe(false);
  });

  it('is covered by .gitignore', () => {
    const ig = readFileSync(path.join(REPO, '.gitignore'), 'utf8');
    // Explicit line or the *_ephemeral.txt wildcard both satisfy the invariant.
    expect(
      /memory\/smoke_campaign_ephemeral\.txt/.test(ig) || /memory\/\*_ephemeral\.txt/.test(ig),
    ).toBe(true);
  });

  it('seed script still refuses NODE_ENV=production', () => {
    const src = readFileSync(path.join(REPO, 'scripts/seed_smoke_campaign.mjs'), 'utf8');
    expect(src).toMatch(/NODE_ENV.*production/);
    expect(src).toMatch(/process\.exit\(2\)/);
  });
});
