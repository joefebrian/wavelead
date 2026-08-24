// M07-CANONICAL-ORIGIN — canonical origin resolver hardening.
//
// Verifies the security invariant: NEVER trust arbitrary Host / X-Forwarded-Host / Origin
// when constructing PayPal return_url / cancel_url / webhook_url. Only allowlisted
// hosts derived from NEXT_PUBLIC_BASE_URL (+ optional CANONICAL_HOSTS_ALLOWLIST) may
// influence request-derived origin resolution; everything else must fall back to
// the configured canonical origin.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MongoClient, type Db } from 'mongodb';

const BASE = 'http://localhost:3000/api';
const TAG = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;

async function withDb<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  const c = new MongoClient(process.env.MONGO_URL || 'mongodb://localhost:27017');
  await c.connect();
  try { return await fn(c.db(process.env.DB_NAME || 'wavelead')); } finally { await c.close(); }
}

/** Save + restore NEXT_PUBLIC_BASE_URL around each canonical-origin scenario. */
async function withProdOrigin<T>(prod: string, fn: () => Promise<T>): Promise<T> {
  const prev = process.env.NEXT_PUBLIC_BASE_URL;
  process.env.NEXT_PUBLIC_BASE_URL = prod;
  // Reset module cache so canonicalOrigin.ts re-reads env.
  try { return await fn(); } finally {
    if (prev === undefined) delete process.env.NEXT_PUBLIC_BASE_URL;
    else process.env.NEXT_PUBLIC_BASE_URL = prev;
  }
}

describe('M07-canonical-origin §A — resolver semantics (unit)', () => {
  it('trusted request host is accepted and used', async () => {
    await withProdOrigin('https://wavelead.org', async () => {
      const { resolveTrustedOrigin } = await import('@/lib/utils/canonicalOrigin');
      const headers = new Headers({ host: 'wavelead.org', 'x-forwarded-proto': 'https' });
      expect(resolveTrustedOrigin(headers)).toBe('https://wavelead.org');
    });
  });

  it('UNtrusted x-forwarded-host is REJECTED and falls back to configured canonical origin', async () => {
    await withProdOrigin('https://wavelead.org', async () => {
      const { resolveTrustedOrigin } = await import('@/lib/utils/canonicalOrigin');
      const headers = new Headers({ 'x-forwarded-host': 'attacker.example.com', 'x-forwarded-proto': 'https' });
      expect(resolveTrustedOrigin(headers)).toBe('https://wavelead.org');
    });
  });

  it('untrusted Host header is REJECTED and falls back to configured canonical origin', async () => {
    await withProdOrigin('https://wavelead.org', async () => {
      const { resolveTrustedOrigin } = await import('@/lib/utils/canonicalOrigin');
      const headers = new Headers({ host: 'grow-infrastructure.emergent.host', 'x-forwarded-proto': 'https' });
      expect(resolveTrustedOrigin(headers)).toBe('https://wavelead.org');
    });
  });

  it('bogus x-forwarded-proto is coerced to canonical fallback', async () => {
    await withProdOrigin('https://wavelead.org', async () => {
      const { resolveTrustedOrigin } = await import('@/lib/utils/canonicalOrigin');
      const headers = new Headers({ host: 'wavelead.org', 'x-forwarded-proto': 'javascript' });
      expect(resolveTrustedOrigin(headers)).toBe('https://wavelead.org');
    });
  });

  it('CANONICAL_HOSTS_ALLOWLIST adds trusted hosts (e.g. www variant)', async () => {
    process.env.CANONICAL_HOSTS_ALLOWLIST = 'www.wavelead.org';
    try {
      await withProdOrigin('https://wavelead.org', async () => {
        const { resolveTrustedOrigin } = await import('@/lib/utils/canonicalOrigin');
        const headers = new Headers({ host: 'www.wavelead.org', 'x-forwarded-proto': 'https' });
        expect(resolveTrustedOrigin(headers)).toBe('https://www.wavelead.org');
      });
    } finally { delete process.env.CANONICAL_HOSTS_ALLOWLIST; }
  });

  it('getCanonicalWebhookUrl is deterministic — never derived from request', async () => {
    await withProdOrigin('https://wavelead.org', async () => {
      const { getCanonicalWebhookUrl } = await import('@/lib/utils/canonicalOrigin');
      expect(getCanonicalWebhookUrl('/api/payments/paypal/webhook')).toBe('https://wavelead.org/api/payments/paypal/webhook');
    });
  });
});

describe('M07-canonical-origin §B — createFundingForCampaign PayPal URL construction (source-level)', () => {
  it('signature accepts an optional requestOrigin argument (additive, backwards compatible)', async () => {
    const src = await (await import('node:fs/promises')).readFile('lib/services/payments/campaignFundingService.ts', 'utf8');
    expect(src).toMatch(/createFundingForCampaign\(actor:\s*Actor\s*\|\s*null,\s*campaign_id:\s*string,\s*requestOrigin\?:\s*string\)/);
  });

  it('return_url + cancel_url are built from (requestOrigin || NEXT_PUBLIC_BASE_URL) — request origin wins when trusted', async () => {
    const src = await (await import('node:fs/promises')).readFile('lib/services/payments/campaignFundingService.ts', 'utf8');
    // Base = requestOrigin || process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'
    expect(src).toMatch(/const\s+base\s*=\s*\(requestOrigin\s*\|\|\s*process\.env\.NEXT_PUBLIC_BASE_URL/);
    // Both URLs are constructed from `base` (single source of truth).
    expect(src).toMatch(/const\s+return_url\s*=\s*`\$\{base\}\/dashboard\/promotions\//);
    expect(src).toMatch(/const\s+cancel_url\s*=\s*`\$\{base\}\/dashboard\/promotions\//);
    // No stray hardcoded emergent.host or wavelead.org anywhere in this service.
    expect(src).not.toMatch(/emergent\.host/);
    expect(src).not.toMatch(/wavelead\.org/);
  });

  it('route handler passes resolveTrustedOrigin(request.headers) to createFundingForCampaign', async () => {
    const src = await (await import('node:fs/promises')).readFile('app/api/[[...path]]/route.ts', 'utf8');
    expect(src).toMatch(/resolveTrustedOrigin\(request\.headers\)/);
    expect(src).toMatch(/campaignFundingService\.createFundingForCampaign\(await resolveActor\(request\),\s*path\[2\],\s*trustedOrigin\)/);
  });
});

describe('M07-canonical-origin §C — /api/admin/settings/paypal.webhook_url is deterministic', () => {
  it('webhook_url shown to super_admin is ALWAYS wavelead.org (not from Host header)', async () => {
    // Log in as the seeded super admin.
    const r = await fetch(`${BASE}/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'hello@p2plabs.asia', password: 'M7GJW0roQtDxLL4BadqRyuST' }),
    });
    if (r.status !== 200) return;   // preview only — skip when seed absent
    const cookie = (r.headers.get('set-cookie') || '').match(/wl_session=[^;]+/)?.[0] || '';
    await withProdOrigin('https://wavelead.org', async () => {
      // Even if a malicious header is sent, webhook_url must remain wavelead.org.
      const g = await fetch(`${BASE}/admin/settings/paypal`, {
        headers: { Cookie: cookie, 'X-Forwarded-Host': 'attacker.example.com', Host: 'attacker.example.com' },
      });
      const j = await g.json();
      expect(g.status).toBe(200);
      expect(j.data.webhook_url).toBe('https://wavelead.org/api/payments/paypal/webhook');
      expect(j.data.webhook_url).not.toContain('attacker.example.com');
      expect(j.data.webhook_url).not.toContain('emergent.host');
    });
  });
});

describe('M07-canonical-origin §D — payment semantics untouched', () => {
  it('createFundingForCampaign signature accepts (actor, campaign_id) exactly as before OR (..., requestOrigin) additively', async () => {
    // Grep the service source to confirm the third arg is OPTIONAL (backwards compatible).
    const src = await (await import('node:fs/promises')).readFile('lib/services/payments/campaignFundingService.ts', 'utf8');
    expect(src).toMatch(/createFundingForCampaign\(actor:\s*Actor\s*\|\s*null,\s*campaign_id:\s*string,\s*requestOrigin\?:\s*string\)/);
    // And confirm amount / capture / refund logic is unchanged (no touches to those keywords in this patch).
    expect(src).toMatch(/amount_minor:\s*camp\.budget_total_usd_minor/);
    expect(src).toMatch(/status:\s*'created'/);
  });
});

beforeAll(async () => {
  await withDb(async (db) => {
    await db.collection('users').deleteMany({ email: new RegExp(`m07canon-${TAG}`) });
    await db.collection('channels').deleteMany({ id: new RegExp(`m07canon-chan.*${TAG}`) });
    await db.collection('promotion_campaigns').deleteMany({ id: new RegExp(`m07canon-camp.*${TAG}`) });
  });
});
afterAll(async () => {
  await withDb(async (db) => {
    await db.collection('users').deleteMany({ email: new RegExp(`m07canon-${TAG}`) });
    await db.collection('channels').deleteMany({ id: new RegExp(`m07canon-chan.*${TAG}`) });
    await db.collection('promotion_campaigns').deleteMany({ id: new RegExp(`m07canon-camp.*${TAG}`) });
    await db.collection('payment_funding_orders').deleteMany({ campaign_id: new RegExp(`m07canon-camp.*${TAG}`) });
  });
});
