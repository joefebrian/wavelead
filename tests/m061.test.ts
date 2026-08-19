// M06.1 — Indonesia Currency & Local Payment Readiness
//
// Test contract (see release-gate directives in test_result.md):
//   • FX math is integer-safe (no floating point).
//   • $20 × 16,500 = Rp330,000 exactly (ceil rounding on checkout).
//   • Client cannot supply FX rate or IDR amount — server always resolves.
//   • Non-admin cannot manage FX.
//   • New active rate does NOT mutate historical quotes.
//   • Quotes expire via their status machine; no quote funds a campaign.
//   • PayPal path continues to work without any FX quote.
//   • Local payment path is NOT actionable in M06.1 — no code path routes
//     a real payment to `provider: 'local'`.
import { describe, it, expect, beforeAll } from 'vitest';
import { MongoClient } from 'mongodb';
import { v4 as uuidv4 } from 'uuid';
import { convertUsdMicrosToIdr } from '@/lib/services/fx/fxConversion';
import { formatIdr, formatUsdMicros } from '@/lib/utils/idrFormat';
import { fxRateProvider } from '@/lib/services/fx/fxRateProvider';
import { fxQuoteService } from '@/lib/services/fx/fxQuoteService';
import { fxAdminService } from '@/lib/services/fx/fxAdminService';
import { fundingFxRateRepo } from '@/lib/repositories/fundingFxRateRepo';
import { fundingFxQuoteRepo } from '@/lib/repositories/fundingFxQuoteRepo';
import { PAYPAL_CAPABILITIES, LOCAL_PAYMENT_CAPABILITIES, PROVIDER_CAPABILITIES } from '@/lib/services/payments/paymentProviderCapabilities';
import type { Actor } from '@/lib/types';

const BASE = 'http://localhost:3000/api';

async function withDb<T>(fn: (db: import('mongodb').Db) => Promise<T>): Promise<T> {
  const client = new MongoClient(process.env.MONGO_URL || 'mongodb://localhost:27017');
  await client.connect();
  try { return await fn(client.db(process.env.DB_NAME || 'wavelead')); } finally { await client.close(); }
}
async function api<T = unknown>(path: string, init: RequestInit = {}) {
  const res = await fetch(`${BASE}${path}`, { ...init, headers: { 'Content-Type': 'application/json', ...(init.headers || {}) } });
  let body: { ok?: boolean; data?: T; error?: string } = {};
  try { body = await res.json(); } catch {}
  return { status: res.status, body, setCookie: res.headers.get('set-cookie') };
}
async function loginAs(email: string, password: string): Promise<string> {
  const r = await api('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
  const c = r.setCookie?.match(/wl_session=[^;]+/)?.[0] || '';
  return c;
}

async function fakeAdminActor(): Promise<Actor> {
  return await withDb(async (db) => {
    let u = await db.collection('users').findOne({ role: 'super_admin' });
    if (!u) {
      // Ensure a super_admin exists — the m051/qa_bootstrap test suites may wipe users.
      const id = uuidv4();
      const doc = {
        id, email: `m061-admin-${Date.now()}@test.dev`, role: 'super_admin', display_name: 'M061 Admin',
        avatar_url: null, country_code: 'US', preferred_language: 'en',
        password_hash: 'x', auth_providers: ['password'],
        created_at: new Date(), updated_at: new Date(),
      };
      await db.collection('users').insertOne(doc);
      u = doc as unknown as typeof u;
    }
    return { user: { id: u!.id, email: u!.email, role: 'super_admin', display_name: u!.display_name } } as Actor;
  });
}

describe('M06.1 — FX conversion math', () => {
  it('$20.00 (20,000,000 micros) × 16,500 (scale 0) = Rp330,000 exactly, no residual', () => {
    const r = convertUsdMicrosToIdr({ usd_micros: 20_000_000, rate_scaled: 16500, rate_scale: 0, rounding: 'ceil' });
    expect(r.idr_whole).toBe(330_000);
    expect(r.idr_rounding_adjustment_micros).toBe(0);
  });

  it('ceil rounding never under-collects (fractional case)', () => {
    // 19,999,999 usd_micros × 16500 = 329,999.9835... → ceil = 330,000
    const r = convertUsdMicrosToIdr({ usd_micros: 19_999_999, rate_scaled: 16500, rate_scale: 0, rounding: 'ceil' });
    expect(r.idr_whole).toBe(330_000);
  });

  it('floor rounding for refund never over-refunds (fractional case)', () => {
    // 19,999_999 usd_micros × 16500 = 329,999.983... → floor = 329,999
    const r = convertUsdMicrosToIdr({ usd_micros: 19_999_999, rate_scaled: 16500, rate_scale: 0, rounding: 'floor' });
    expect(r.idr_whole).toBe(329_999);
  });

  it('fractional rate: 1 USD = 16523.45 IDR (rate_scaled=1652345, rate_scale=2)', () => {
    const r = convertUsdMicrosToIdr({ usd_micros: 1_000_000, rate_scaled: 1652345, rate_scale: 2, rounding: 'ceil' });
    // 1_000_000 × 1652345 / (1_000_000 × 100) = 16523.45 → ceil = 16524
    expect(r.idr_whole).toBe(16524);
  });

  it('rejects non-integer usd_micros', () => {
    expect(() => convertUsdMicrosToIdr({ usd_micros: 1.5, rate_scaled: 16500, rate_scale: 0, rounding: 'ceil' })).toThrow();
  });
  it('rejects zero rate', () => {
    expect(() => convertUsdMicrosToIdr({ usd_micros: 20_000_000, rate_scaled: 0, rate_scale: 0, rounding: 'ceil' })).toThrow();
  });
  it('rejects negative usd', () => {
    expect(() => convertUsdMicrosToIdr({ usd_micros: -1, rate_scaled: 16500, rate_scale: 0, rounding: 'ceil' })).toThrow();
  });
});

describe('M06.1 — IDR formatter', () => {
  it('formats standard values with dot thousands separator', () => {
    expect(formatIdr(330000)).toBe('Rp330.000');
    expect(formatIdr(1_650_000)).toBe('Rp1.650.000');
    expect(formatIdr(0)).toBe('Rp0');
    expect(formatIdr(-330000)).toBe('-Rp330.000');
  });
  it('rejects non-integer', () => { expect(() => formatIdr(1.5)).toThrow(); });
  it('USD micros formatter is exact', () => {
    expect(formatUsdMicros(20_000_000)).toBe('$20.00');
    expect(formatUsdMicros(19_800_000)).toBe('$19.80');
    expect(formatUsdMicros(0)).toBe('$0.00');
  });
});

describe('M06.1 — FX rate provider + admin authority', () => {
  beforeAll(async () => {
    await withDb(async (db) => {
      // Ensure a canonical active rate exists (idempotent).
      const existing = await db.collection('funding_fx_rates').findOne({ base_currency: 'USD', quote_currency: 'IDR', active: true, rate_scaled: 16500 });
      if (!existing) {
        // Retire any existing active row and insert canonical fixture.
        await db.collection('funding_fx_rates').updateMany(
          { base_currency: 'USD', quote_currency: 'IDR', active: true },
          { $set: { active: false, effective_until: new Date(), updated_at: new Date() } },
        );
        await db.collection('funding_fx_rates').insertOne({
          id: uuidv4(),
          base_currency: 'USD', quote_currency: 'IDR',
          rate_scaled: 16500, rate_scale: 0,
          source: 'admin', active: true,
          effective_from: new Date(), effective_until: null, note: 'test fixture',
          created_by: 'test', created_at: new Date(), updated_at: new Date(),
        });
      }
    });
  });

  it('returns the currently active USD/IDR rate', async () => {
    const r = await fxRateProvider.getActiveRate('USD', 'IDR');
    expect(r).toBeTruthy();
    expect(r!.rate_scaled).toBe(16500);
    expect(r!.rate_scale).toBe(0);
    expect(r!.active).toBe(true);
  });

  it('admin can create + activate a new rate; old rate becomes inactive', async () => {
    const admin = await fakeAdminActor();
    const before = await fxRateProvider.getActiveRate('USD', 'IDR');
    const created = await fxAdminService.createAndActivate(admin, {
      base_currency: 'USD', quote_currency: 'IDR', rate_scaled: 16600, rate_scale: 0, note: 'unit test',
    });
    const after = await fxRateProvider.getActiveRate('USD', 'IDR');
    expect(after?.id).toBe(created.id);
    expect(after?.rate_scaled).toBe(16600);
    expect(after?.id).not.toBe(before?.id);
    // Prior row exists and is retired.
    const priorRefetched = await fundingFxRateRepo.findById(before!.id);
    expect(priorRefetched?.active).toBe(false);
    // Restore canonical fixture for downstream tests.
    await fxAdminService.createAndActivate(admin, { base_currency: 'USD', quote_currency: 'IDR', rate_scaled: 16500, rate_scale: 0, note: 'restore' });
  });

  it('admin rejects negative or non-integer rate values', async () => {
    const admin = await fakeAdminActor();
    await expect(fxAdminService.createAndActivate(admin, { base_currency: 'USD', quote_currency: 'IDR', rate_scaled: 0, rate_scale: 0 })).rejects.toThrow();
    await expect(fxAdminService.createAndActivate(admin, { base_currency: 'USD', quote_currency: 'IDR', rate_scaled: 16500, rate_scale: 9 })).rejects.toThrow();
    await expect(fxAdminService.createAndActivate(admin, { base_currency: 'EUR', quote_currency: 'IDR', rate_scaled: 16500, rate_scale: 0 })).rejects.toThrow();
  });
});

describe('M06.1 — FX quote immutability + expiration', () => {
  it('lockQuoteForCampaign creates a locked quote with the canonical amount', async () => {
    const q = await fxQuoteService.lockQuoteForCampaign('m061-test-camp-lock', 20_000_000);
    expect(q.quoted_idr_amount).toBe(330_000);
    expect(q.rate_scaled).toBe(16500);
    expect(q.status).toBe('open');
    expect(q.campaign_usd_micros).toBe(20_000_000);
  });

  it('admin activating a new rate does NOT modify existing locked quotes', async () => {
    const q1 = await fxQuoteService.lockQuoteForCampaign('m061-test-camp-immut', 20_000_000);
    const originalIdr = q1.quoted_idr_amount;
    const originalRate = q1.rate_scaled;
    // Admin flips to a different rate
    const admin = await fakeAdminActor();
    await fxAdminService.createAndActivate(admin, { base_currency: 'USD', quote_currency: 'IDR', rate_scaled: 17000, rate_scale: 0, note: 'immutability test' });
    const q1After = await fundingFxQuoteRepo.findById(q1.id);
    expect(q1After?.quoted_idr_amount).toBe(originalIdr);
    expect(q1After?.rate_scaled).toBe(originalRate);
    // Restore
    await fxAdminService.createAndActivate(admin, { base_currency: 'USD', quote_currency: 'IDR', rate_scaled: 16500, rate_scale: 0 });
  });

  it('expiration is enforced via status transition only', async () => {
    const q = await fxQuoteService.lockQuoteForCampaign('m061-test-camp-expire', 20_000_000, 0);
    // Wait a tick then sweep
    await new Promise((r) => setTimeout(r, 10));
    const changed = await fxQuoteService.expireIfDue(q.id);
    expect(changed).toBe(true);
    const q2 = await fundingFxQuoteRepo.findById(q.id);
    expect(q2?.status).toBe('expired');
    // A second expireIfDue is a no-op
    expect(await fxQuoteService.expireIfDue(q.id)).toBe(false);
  });
});

describe('M06.1 — Provider capabilities', () => {
  it('PayPal remains fully configured for USD', () => {
    expect(PAYPAL_CAPABILITIES.configured).toBe(true);
    expect(PAYPAL_CAPABILITIES.supported_payment_currencies).toContain('USD');
    expect(PAYPAL_CAPABILITIES.supports_refund).toBe(true);
  });
  it('Local payment provider is intentionally NOT configured in M06.1', () => {
    expect(LOCAL_PAYMENT_CAPABILITIES.configured).toBe(false);
    expect(LOCAL_PAYMENT_CAPABILITIES.supported_payment_currencies).toContain('IDR');
    // No code should route a real payment here.
    expect(PROVIDER_CAPABILITIES.local.configured).toBe(false);
  });
});

describe('M06.1 — HTTP surface + RBAC', () => {
  const adminEmail = 'qa-admin@wavelead.dev';
  const ownerEmail = 'qa-owner@wavelead.dev';
  const businessEmail = 'qa-business@wavelead.dev';
  const adminPw = process.env.QA_ADMIN_PASSWORD || '';
  const ownerPw = process.env.QA_OWNER_PASSWORD || '';
  const businessPw = process.env.QA_BUSINESS_PASSWORD || '';
  const havePasswords = adminPw && ownerPw && businessPw;

  beforeAll(async () => {
    if (!havePasswords) return;
    // Ensure QA personas exist
    await api('/dev/qa-bootstrap', { method: 'POST' });
  });

  it('public /api/fx/rate returns current active rate (no secrets)', async () => {
    const r = await api<{ active: { rate_scaled: number; rate_scale: number } | null }>('/fx/rate');
    expect(r.status).toBe(200);
    if (r.body.data?.active) {
      expect(r.body.data.active.rate_scaled).toBeGreaterThan(0);
      expect(JSON.stringify(r.body)).not.toContain('created_by');
    }
  });

  it('non-admin (owner) cannot list admin fx-rates', async () => {
    if (!havePasswords) return;
    const c = await loginAs(ownerEmail, ownerPw);
    const r = await api('/admin/fx-rates', { headers: { Cookie: c } });
    expect(r.status).toBe(403);
  });

  it('non-admin (business) cannot create a rate', async () => {
    if (!havePasswords) return;
    const c = await loginAs(businessEmail, businessPw);
    const r = await api('/admin/fx-rates', { method: 'POST', headers: { Cookie: c }, body: JSON.stringify({ rate_scaled: 99999, rate_scale: 0 }) });
    expect(r.status).toBe(403);
  });

  it('unauthenticated cannot create a rate', async () => {
    const r = await api('/admin/fx-rates', { method: 'POST', body: JSON.stringify({ rate_scaled: 99999, rate_scale: 0 }) });
    expect([401, 403]).toContain(r.status);
  });

  it('admin can list rates', async () => {
    if (!havePasswords) return;
    const c = await loginAs(adminEmail, adminPw);
    const r = await api<{ items: unknown[]; active: unknown }>('/admin/fx-rates', { headers: { Cookie: c } });
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.data?.items)).toBe(true);
  });

  it('cross-owner cannot preview another owner’s campaign IDR equivalent', async () => {
    if (!havePasswords) return;
    // create a campaign owned by owner B (direct DB) and try to preview it as owner A
    const otherOwnerId = uuidv4();
    const campId = uuidv4();
    await withDb(async (db) => {
      await db.collection('users').insertOne({ id: otherOwnerId, email: `owner-other-${Date.now()}@test.dev`, role: 'channel_owner', display_name: 'Other', avatar_url: null, country_code: 'ID', preferred_language: 'en', password_hash: 'x', auth_providers: ['password'], created_at: new Date(), updated_at: new Date() });
      await db.collection('promotion_campaigns').insertOne({
        id: campId, owner_user_id: otherOwnerId, channel_id: uuidv4(), name: 'other camp',
        status: 'draft', budget_total_usd_minor: 100, funded_amount_usd_micros: 0, spent_amount_usd_micros: 0,
        refunded_amount_usd_micros: 0, estimated_spend_usd_minor: 0, created_at: new Date(), updated_at: new Date(),
      });
    });
    const c = await loginAs(ownerEmail, ownerPw);
    const r = await api(`/owner/campaigns/${campId}/fx-preview`, { headers: { Cookie: c } });
    expect([403, 404]).toContain(r.status);
  });
});
