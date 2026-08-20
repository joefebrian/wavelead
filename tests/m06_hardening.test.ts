// M06 release hardening — REAL journey integration + lifecycle regressions.
//
// This suite exists to prevent the original approval/funding lifecycle bug
// from returning. It uses the CANONICAL production funding path
// (campaignFundingService.createFundingForCampaign + captureAndFinalize)
// via a deterministic test PaymentProvider — NOT the `legacy_waived`
// shortcut. `legacy_waived` is reserved for genuinely grandfathered pre-M06
// campaigns and is only exercised by the explicitly-named legacy test.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MongoClient } from 'mongodb';
import { v4 as uuidv4 } from 'uuid';
import { installTestPaymentProvider, restoreDefaultPaymentProvider, fundCampaignForTest } from './helpers/fundCampaign';

const BASE = 'http://localhost:3000/api';

// Per-file client IP so we don't collide with other tests' rate-limit buckets.
const CLIENT_IP = `10.${Math.floor(Math.random()*255)}.${Math.floor(Math.random()*255)}.${Math.floor(Math.random()*255)}`;

async function withDb<T>(fn: (db: import('mongodb').Db) => Promise<T>): Promise<T> {
  const client = new MongoClient(process.env.MONGO_URL || 'mongodb://localhost:27017');
  await client.connect();
  try { return await fn(client.db(process.env.DB_NAME || 'wavelead')); } finally { await client.close(); }
}
async function api<T = unknown>(path: string, init: RequestInit = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'X-Forwarded-For': CLIENT_IP,
      ...(init.headers || {}),
    },
  });
  let body: { ok?: boolean; data?: T; error?: string } = {};
  try { body = await res.json(); } catch {}
  return { status: res.status, body, setCookie: res.headers.get('set-cookie') };
}
async function loginCookie(email: string, pw: string): Promise<string> {
  const r = await api('/auth/login', { method: 'POST', body: JSON.stringify({ email, password: pw }) });
  return r.setCookie?.match(/wl_session=[^;]+/)?.[0] || '';
}
async function ensureAdmin(): Promise<string> {
  await api('/dev/qa-bootstrap', { method: 'POST' });
  return loginCookie('qa-admin@wavelead.dev', process.env.QA_ADMIN_PASSWORD || '');
}

/**
 * Legacy waiver install — ONLY used for the explicitly named legacy test.
 * Represents a genuinely pre-M06 grandfathered campaign whose funding was
 * waived by the migration. MUST NOT be used as a generic funding fixture
 * for new campaigns.
 */
async function installLegacyWaiver(campaignId: string, ownerUserId: string): Promise<void> {
  const { paymentFundingOrderRepo } = await import('@/lib/repositories/paymentRepo');
  const now = new Date();
  await paymentFundingOrderRepo.insert({
    id: uuidv4(), campaign_id: campaignId, owner_user_id: ownerUserId,
    provider: 'paypal', provider_order_id: null, provider_capture_id: null,
    currency: 'USD', amount_minor: 0, amount_captured_minor: 0, amount_refunded_minor: 0,
    amount_usd_micros: 0, status: 'legacy_waived',
    approve_url: null, return_url: null, cancel_url: null,
    paid_at: null, cancelled_at: null, refunded_at: null,
    created_at: now, updated_at: now,
  });
}

describe('M06 release hardening — approve → fund → active lifecycle', () => {
  const ownerEmail = 'qa-owner@wavelead.dev';
  const ownerPw = process.env.QA_OWNER_PASSWORD || '';
  const havePasswords = ownerPw && process.env.QA_ADMIN_PASSWORD;
  let ownerId = '';
  let channelId = '';
  let ownerCookie = '';
  let adminCookie = '';

  beforeAll(async () => {
    if (!havePasswords) return;
    // Ensure canonical QA personas + verified channel exist.
    await api('/dev/qa-bootstrap', { method: 'POST' });
    adminCookie = await ensureAdmin();
    ownerCookie = await loginCookie(ownerEmail, ownerPw);
    await withDb(async (db) => {
      const owner = await db.collection('users').findOne({ email: ownerEmail });
      const channel = await db.collection('channels').findOne({ slug: 'qa-verified-channel' });
      ownerId = owner!.id as string;
      channelId = channel!.id as string;
    });
    // Install the deterministic test PaymentProvider so canonical
    // fundCampaignForTest goes through the real service path.
    installTestPaymentProvider();
  });

  afterAll(async () => {
    restoreDefaultPaymentProvider();
    // Purge M06-hardening test campaigns to avoid polluting the shared DB.
    await withDb(async (db) => {
      await db.collection('promotion_campaigns').deleteMany({ name: /^M06-hardening-/ });
    });
  });

  /**
   * Direct-insert helper for lifecycle regression tests that focus on the
   * approval + funding transition. Bypasses the owner-controlled
   * create+submit endpoints (those are exercised end-to-end by the
   * dedicated real-journey test below) and lands the campaign in
   * pending_review — the exact state the admin approves from.
   */
  async function createPendingReviewCampaign(startOffsetMs: number, endOffsetMs: number, tag: string): Promise<string> {
    const id = uuidv4();
    await withDb(async (db) => {
      const now = Date.now();
      await db.collection('promotion_campaigns').insertOne({
        id,
        owner_user_id: ownerId,
        channel_id: channelId,
        name: `M06-hardening-${tag}-${now}`,
        objective: 'follow_intent',
        placements: ['sponsored_search'],
        targeting: { countries: ['ID'], languages: ['id'], categories: [] },
        budget_total_usd_minor: 2000,
        budget_daily_usd_minor: null,
        estimated_spend_usd_minor: 0,
        delivered_impressions: 0,
        rate_snapshot: [{ placement: 'sponsored_search', pricing_model: 'cpm', cpm_usd_minor: 200, rate_card_id: 'seed-sponsored_search', country_code: null, resolved_at: new Date(now) }],
        start_at: new Date(now + startOffsetMs),
        end_at: new Date(now + endOffsetMs),
        status: 'pending_review',
        funded_amount_usd_micros: 0,
        spent_amount_usd_micros: 0,
        refunded_amount_usd_micros: 0,
        submitted_at: new Date(now),
        reviewed_at: null, reviewed_by: null,
        rejection_reason: null, rejection_notes: null,
        activated_at: null, paused_at: null, completed_at: null, cancelled_at: null,
        created_at: new Date(now),
        updated_at: new Date(now),
      });
    });
    return id;
  }

  async function adminApprove(id: string) {
    const r = await api(`/admin/promotions/${id}/approve`, { method: 'POST', headers: { Cookie: adminCookie } });
    expect(r.status).toBe(200);
  }

  // -------------------------------------------------------------------
  // P0 canonical: approve leaves current-window campaign in approved+unfunded
  // -------------------------------------------------------------------
  it('admin approve leaves current-window campaign in `approved` + unfunded (P0 fix)', async () => {
    if (!havePasswords) return;
    const id = await createPendingReviewCampaign(-60_000, 3_600_000, 'now');
    await adminApprove(id);
    const camp = await withDb(async (db) => db.collection('promotion_campaigns').findOne({ id }));
    expect(camp?.status).toBe('approved');
    expect(camp?.funded_amount_usd_micros).toBe(0);
    const { campaignFundingService } = await import('@/lib/services/payments/campaignFundingService');
    const summary = await campaignFundingService.fundingSummary(id);
    expect(summary.funded).toBe(false);
  });

  // -------------------------------------------------------------------
  // P0 canonical: funded current-window → active (via REAL funding service)
  // -------------------------------------------------------------------
  it('funding an approved current-window campaign transitions it to `active` (canonical funding path)', async () => {
    if (!havePasswords) return;
    const id = await createPendingReviewCampaign(-60_000, 3_600_000, 'active');
    await adminApprove(id);
    // Canonical funding — drives campaignFundingService.createFundingForCampaign
    // + captureAndFinalize through the test PaymentProvider. No legacy_waived,
    // no direct status mutation.
    await fundCampaignForTest(id, ownerId);
    const after = await withDb(async (db) => db.collection('promotion_campaigns').findOne({ id }));
    expect(after?.status).toBe('active');
    expect(after?.activated_at).toBeTruthy();
  });

  // -------------------------------------------------------------------
  // P0 canonical: funded future-start → scheduled (via REAL funding service)
  // -------------------------------------------------------------------
  it('funding an approved future-start campaign transitions it to `scheduled` (canonical funding path)', async () => {
    if (!havePasswords) return;
    const id = await createPendingReviewCampaign(60 * 60_000, 2 * 60 * 60_000, 'future'); // starts in 1h
    await adminApprove(id);
    const beforeFund = await withDb(async (db) => db.collection('promotion_campaigns').findOne({ id }));
    expect(beforeFund?.status).toBe('approved'); // NOT `scheduled` yet — funding required
    await fundCampaignForTest(id, ownerId);
    const after = await withDb(async (db) => db.collection('promotion_campaigns').findOne({ id }));
    expect(after?.status).toBe('scheduled');
  });

  // -------------------------------------------------------------------
  // P0 canonical: unfunded approved current-window MUST NOT auto-activate
  // -------------------------------------------------------------------
  it('reconciliation does NOT auto-activate an unfunded approved current-window campaign', async () => {
    if (!havePasswords) return;
    const id = await createPendingReviewCampaign(-60_000, 3_600_000, 'noauto');
    await adminApprove(id);
    // No funding. Trigger reconciliation directly.
    const { reconcileCampaign } = await import('@/lib/services/promotion/campaignStateService');
    const camp = await withDb(async (db) => db.collection('promotion_campaigns').findOne({ id }));
    await reconcileCampaign(camp as unknown as import('@/lib/types').PromotionCampaign, new Date());
    const after = await withDb(async (db) => db.collection('promotion_campaigns').findOne({ id }));
    expect(after?.status).toBe('approved');
  });

  // -------------------------------------------------------------------
  // Explicit LEGACY test — the ONLY place `legacy_waived` may be used.
  // Represents a genuinely pre-M06 grandfathered campaign.
  // -------------------------------------------------------------------
  it('legacy_waived campaigns (grandfather waiver) auto-activate on approve', async () => {
    if (!havePasswords) return;
    const id = await createPendingReviewCampaign(-60_000, 3_600_000, 'legacy');
    // Pretend the M05.1 migration had already installed a waiver at submit time.
    // This is the ONE legitimate use of legacy_waived — genuinely grandfathered
    // pre-M06 campaigns.
    await installLegacyWaiver(id, ownerId);
    await adminApprove(id);
    const after = await withDb(async (db) => db.collection('promotion_campaigns').findOne({ id }));
    // Legacy_waived semantics preserved: approve → active in one step because
    // reconcileCampaign sees fundingSummary().has_legacy_waiver = true.
    expect(after?.status).toBe('active');
  });

  // -------------------------------------------------------------------
  // REAL END-TO-END JOURNEY — no shortcuts on approval OR funding.
  // Uses owner-controlled create+submit endpoints, admin approve endpoint,
  // and the canonical funding service path via the test PaymentProvider.
  // This regression exists specifically to prevent the original
  // approval/funding lifecycle bug from returning.
  // -------------------------------------------------------------------
  it('REAL journey: verified owner → create → submit → approve (approved+unfunded) → fund → active', async () => {
    if (!havePasswords) return;
    // 1. Owner creates via the real API.
    const created = await api<{ campaign: { id: string; status: string } }>(
      '/owner/promotions',
      {
        method: 'POST',
        headers: { Cookie: ownerCookie },
        body: JSON.stringify({
          channel_id: channelId,
          objective: 'visibility',
          placements: ['sponsored_search'],
          targeting: { countries: ['ID'], languages: ['id'], categories: [] },
          budget_total_usd_minor: 2000,
          start_at: new Date(Date.now() - 60_000).toISOString(),
          end_at: new Date(Date.now() + 3_600_000).toISOString(),
        }),
      },
    );
    expect(created.status).toBe(200);
    const id = created.body.data!.campaign.id;
    expect(created.body.data!.campaign.status).toBe('draft');
    // 2. Owner submits.
    const submitted = await api<{ campaign: { status: string } }>(
      `/owner/promotions/${id}/submit`, { method: 'POST', headers: { Cookie: ownerCookie } },
    );
    expect(submitted.status).toBe(200);
    expect(submitted.body.data!.campaign.status).toBe('pending_review');
    // 3. Admin approves via the real API.
    const approved = await api<{ campaign: { status: string; activated_at: string | null } }>(
      `/admin/promotions/${id}/approve`, { method: 'POST', headers: { Cookie: adminCookie } },
    );
    expect(approved.status).toBe(200);
    // Assert approved + UNFUNDED (P0 fix).
    expect(approved.body.data!.campaign.status).toBe('approved');
    expect(approved.body.data!.campaign.activated_at).toBeNull();
    const { campaignFundingService } = await import('@/lib/services/payments/campaignFundingService');
    const unfundedSummary = await campaignFundingService.fundingSummary(id);
    expect(unfundedSummary.funded).toBe(false);
    // 4. Canonical funding via the real service path.
    await fundCampaignForTest(id, ownerId);
    // 5. Reconciliation is inside captureAndFinalize — assert active.
    const afterFund = await withDb(async (db) => db.collection('promotion_campaigns').findOne({ id }));
    expect(afterFund?.status).toBe('active');
    expect(afterFund?.activated_at).toBeTruthy();
    const fundedSummary = await campaignFundingService.fundingSummary(id);
    expect(fundedSummary.funded).toBe(true);
    expect(fundedSummary.has_legacy_waiver).toBe(false); // canonical PAID, not waived
  });

  // -------------------------------------------------------------------
  // Public discovery hides test-fixture channels.
  // -------------------------------------------------------------------
  it('public discovery hides test-fixture channels (marker + slug + name)', async () => {
    // Insert THREE distinct test fixtures that each hit a different arm of
    // the canonical public-visibility policy:
    //   (a) marked with is_test_fixture=true — organic slug and name
    //   (b) legacy slug prefix — no marker, no test name
    //   (c) legacy name prefix — no marker, organic slug
    const markerSlug = `organic-slug-${Date.now()}-${Math.floor(Math.random()*1e6)}`;
    const legacySlug = `test-legacy-${Date.now()}-${Math.floor(Math.random()*1e6)}`;
    const legacyName = `nameonly-${Date.now()}-${Math.floor(Math.random()*1e6)}`;
    const fixtures = [
      { slug: markerSlug, name: 'Organic Looking Fixture', is_test_fixture: true },
      { slug: legacySlug, name: 'Legacy Fixture', is_test_fixture: undefined },
      { slug: legacyName, name: 'Test Legacy Name Fixture', is_test_fixture: undefined },
    ];
    await withDb(async (db) => {
      for (const f of fixtures) {
        const cid = uuidv4();
        const wcid = `hardening_${cid.replace(/-/g, '').slice(0, 20)}`;
        const doc: Record<string, unknown> = {
          id: cid, slug: f.slug, name: f.name,
          whatsapp_url: `https://whatsapp.com/channel/${f.slug}`, whatsapp_channel_id: wcid,
          description: null, short_description: null, logo_url: null, cover_url: null,
          website_url: null, country_code: 'US', primary_language: 'en', category_id: null,
          owner_id: null, status: 'approved', verification_status: 'unverified',
          is_official: false, is_featured: false, is_nsfw: false, is_demo: false,
          activity_level: 'active', follower_count: 1, follower_count_source: 'test',
          follower_count_updated_at: new Date(), created_at: new Date(), updated_at: new Date(), published_at: new Date(),
        };
        if (f.is_test_fixture !== undefined) doc.is_test_fixture = f.is_test_fixture;
        await db.collection('channels').insertOne(doc);
      }
    });
    // (1) Browse listing hides ALL three.
    const list = await api<{ items: Array<{ slug: string }> }>(`/channels?limit=100`);
    expect(list.status).toBe(200);
    const listSlugs = (list.body.data?.items || []).map((i) => i.slug);
    for (const f of fixtures) expect(listSlugs).not.toContain(f.slug);
    // (2) Direct slug lookup returns 404 for each.
    for (const f of fixtures) {
      const r = await api(`/channels/${f.slug}`);
      expect(r.status).toBe(404);
    }
    // (3) Search hides all three (query the shared "fixture" substring).
    const searchFix = await api<{ items: Array<{ slug: string }> }>(`/channels?q=fixture&limit=50`);
    const searchSlugs = (searchFix.body.data?.items || []).map((i) => i.slug);
    for (const f of fixtures) expect(searchSlugs).not.toContain(f.slug);
  });
});
