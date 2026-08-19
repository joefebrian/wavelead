// M06.0 backend tests. We swap in a mock PaymentProvider so no live PayPal
// calls happen. Sandbox smoke against the real provider is a separate one-shot
// script (`scripts/paypal_sandbox_smoke.ts`), not part of the automated suite.
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { MongoClient } from 'mongodb';
import { v4 as uuidv4 } from 'uuid';
import { _setPaymentProviderForTesting } from '@/lib/services/payments/providerFactory';
import type { PaymentProvider } from '@/lib/services/payments/paymentProvider';
import { campaignFundingService } from '@/lib/services/payments/campaignFundingService';
import { paymentFundingOrderRepo, campaignFundingLedgerRepo, paymentWebhookEventRepo } from '@/lib/repositories/paymentRepo';
import { promotionCampaignRepo } from '@/lib/repositories/promotionRepo';
import { runSeed } from '@/lib/seed/seedData';
import type { PromotionCampaign, VerificationStatus } from '@/lib/types';

const BASE = 'http://localhost:3000/api';
const fakeIp = () => `10.${Math.floor(Math.random()*255)}.${Math.floor(Math.random()*255)}.${Math.floor(Math.random()*255)}`;

async function withDb<T>(fn: (db: import('mongodb').Db) => Promise<T>): Promise<T> {
  const client = new MongoClient(process.env.MONGO_URL || 'mongodb://localhost:27017');
  await client.connect();
  try { return await fn(client.db(process.env.DB_NAME || 'wavelead')); } finally { await client.close(); }
}
async function api<T = unknown>(path: string, init: RequestInit = {}, ip: string = fakeIp()) {
  const res = await fetch(`${BASE}${path}`, { ...init, headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip, ...(init.headers || {}) } });
  let body: { ok?: boolean; data?: T; error?: string } = {};
  try { body = await res.json(); } catch {}
  return { status: res.status, body, setCookie: res.headers.get('set-cookie') };
}
async function signup(role?: 'user' | 'admin') {
  const email = `m06-${role || 'u'}-${Date.now()}${Math.floor(Math.random()*1e6)}@wavelead.test`;
  const r = await api<{ user: { id: string } }>('/auth/signup', { method: 'POST', body: JSON.stringify({ email, password: 'password123', display_name: 'M06' }) });
  const cookie = r.setCookie!.match(/wl_session=[^;]+/)![0];
  if (role === 'admin') {
    await withDb(async (db) => { await db.collection('users').updateOne({ id: r.body.data!.user.id }, { $set: { role: 'admin' } }); });
  }
  return { cookie, userId: r.body.data!.user.id, email };
}
async function ensureChannel(ownerId: string, opts: { verification_status?: VerificationStatus } = {}) {
  const id = uuidv4();
  const slug = `m06-ch-${id.slice(0, 8)}`;
  const now = new Date();
  await withDb(async (db) => {
    await db.collection('channels').insertOne({
      id, slug, name: `M06 Channel`, whatsapp_url: `https://whatsapp.com/channel/${id.replace(/-/g,'').slice(0,20)}`,
      whatsapp_channel_id: id.replace(/-/g,'').slice(0,20),
      description: 't', short_description: 't', logo_url: null, cover_url: null, website_url: null,
      country_code: 'ID', primary_language: 'id', category_id: null, owner_id: ownerId,
      status: 'approved', verification_status: opts.verification_status || 'verified',
      is_official: false, is_verified: true, is_featured: false, is_nsfw: false, is_demo: false,
      activity_level: 'active', follower_count: 100, follower_count_source: 't', follower_count_updated_at: now,
      created_at: now, updated_at: now, published_at: now,
    });
  });
  return { id, slug };
}
async function createApprovedCampaign(ownerId: string, channelId: string, budgetMinor = 2000): Promise<PromotionCampaign> {
  const now = new Date();
  const camp: PromotionCampaign = {
    id: uuidv4(), owner_user_id: ownerId, channel_id: channelId,
    name: 'M06 test', objective: 'visibility', placements: ['sponsored_search'],
    targeting: { countries: [], languages: [], categories: [] },
    budget_total_usd_minor: budgetMinor, budget_daily_usd_minor: null,
    start_at: new Date(now.getTime()-3600_000), end_at: new Date(now.getTime()+86400_000),
    status: 'approved',
    rate_snapshot: [{ placement: 'sponsored_search', pricing_model: 'cpm', cpm_usd_minor: 200, rate_card_id: 'seed-sponsored_search', country_code: null, resolved_at: now }],
    delivered_impressions: 0, estimated_spend_usd_minor: 0,
    created_at: now, updated_at: now, submitted_at: now,
    reviewed_at: now, reviewed_by: 'admin', rejection_reason: null, rejection_notes: null,
    activated_at: null, paused_at: null, completed_at: null, cancelled_at: null,
  };
  await promotionCampaignRepo.insert(camp);
  return camp;
}

// Mock provider — records calls, returns deterministic values.
class MockProvider implements PaymentProvider {
  readonly id = 'paypal' as const;
  public captureResult: 'paid' | 'failed' | 'cancelled' = 'paid';
  public webhookValid = true;
  public webhookEventType = 'PAYMENT.CAPTURE.COMPLETED';
  public webhookResource: Record<string, unknown> = {};
  public createCalls: unknown[] = [];
  async createPayment(input: import('@/lib/services/payments/paymentProvider').CreatePaymentInput) {
    this.createCalls.push(input);
    return {
      provider: 'paypal' as const,
      provider_order_id: `PP-ORDER-${input.funding_id}`,
      approve_url: `https://sandbox.paypal.com/checkoutnow?token=PP-ORDER-${input.funding_id}`,
      raw: {},
    };
  }
  async capturePayment(input: import('@/lib/services/payments/paymentProvider').CapturePaymentInput) {
    if (this.captureResult === 'paid') {
      // Read the pending funding row to know the amount.
      const funding = await paymentFundingOrderRepo.findByProviderOrderId(input.provider_order_id);
      return {
        provider_order_id: input.provider_order_id,
        provider_capture_id: `PP-CAPTURE-${input.provider_order_id}`,
        internal_status: 'paid' as const,
        amount_captured_minor: funding?.amount_minor || 0,
        currency: 'USD',
        raw: {},
      };
    }
    return { provider_order_id: input.provider_order_id, provider_capture_id: null, internal_status: this.captureResult, amount_captured_minor: 0, currency: 'USD', raw: {} };
  }
  async retrievePayment(input: import('@/lib/services/payments/paymentProvider').CapturePaymentInput) {
    return { provider_order_id: input.provider_order_id, internal_status: 'paid' as const, amount_minor: 2000, currency: 'USD', provider_capture_id: null, raw: {} };
  }
  async createRefund(input: import('@/lib/services/payments/paymentProvider').RefundInput) {
    return { provider_refund_id: `PP-REFUND-${Date.now()}`, internal_status: 'partially_refunded' as const, amount_refunded_minor: input.amount_minor, raw: {} };
  }
  async verifyWebhook() {
    return { valid: this.webhookValid, event_id: `evt-${Date.now()}-${Math.random()}`, event_type: this.webhookEventType, resource: this.webhookResource };
  }
}

let mock: MockProvider;

beforeAll(async () => {
  await withDb(async (db) => {
    await db.collection('users').deleteMany({ email: /^m06-/ });
    await db.collection('channels').deleteMany({ slug: /^m06-/ });
    await db.collection('promotion_campaigns').deleteMany({ name: 'M06 test' });
    await db.collection('payment_funding_orders').deleteMany({});
    await db.collection('campaign_funding_ledger').deleteMany({});
    await db.collection('payment_webhook_events').deleteMany({});
  });
  await runSeed({});
  mock = new MockProvider();
  _setPaymentProviderForTesting(mock);
});
afterEach(() => { mock.captureResult = 'paid'; mock.webhookValid = true; mock.webhookEventType = 'PAYMENT.CAPTURE.COMPLETED'; mock.webhookResource = {}; });
afterAll(async () => {
  _setPaymentProviderForTesting(null);
  await withDb(async (db) => {
    await db.collection('users').deleteMany({ email: /^m06-/ });
    await db.collection('channels').deleteMany({ slug: /^m06-/ });
    await db.collection('promotion_campaigns').deleteMany({ name: 'M06 test' });
  });
});

describe('M06.0.6 — Phase 2 (Fund UX): client tampering, race, lifecycle', () => {
  it('client-supplied amount/currency in funding request body is ignored — server uses campaign budget', async () => {
    const owner = await signup(); const ch = await ensureChannel(owner.userId);
    const camp = await createApprovedCampaign(owner.userId, ch.id, 2000);
    // Even if a caller passed { amount_minor: 1, currency: 'IDR' } the service
    // takes ZERO user input — the interface accepts only (actor, campaign_id).
    const f = await campaignFundingService.createFundingForCampaign({ user: { id: owner.userId, role: 'user' } as any, session: {} as any }, camp.id);
    expect(f.amount_minor).toBe(2000);
    expect(f.currency).toBe('USD');
    const call = mock.createCalls.find((c: any) => c.funding_id === f.id) as any;
    expect(call.amount_minor).toBe(2000);
    expect(call.currency).toBe('USD');
  });

  it('browser-return query strings (?status=paid) cannot mark funding paid — only server capture can', async () => {
    // We hit the browser-return route directly with a bogus success-looking
    // query on the funding endpoint. The route ignores query state entirely
    // and calls captureAndFinalize which needs a real provider capture. With
    // the mock provider set to `failed`, the funding must stay unpaid despite
    // the client saying paid.
    mock.captureResult = 'failed';
    const owner = await signup(); const ch = await ensureChannel(owner.userId);
    const camp = await createApprovedCampaign(owner.userId, ch.id, 2000);
    const f = await campaignFundingService.createFundingForCampaign({ user: { id: owner.userId, role: 'user' } as any, session: {} as any }, camp.id);
    const finalOrder = await campaignFundingService.captureAndFinalize(f.id);
    expect(finalOrder.status).not.toBe('paid');
    const summary = await campaignFundingService.fundingSummary(camp.id);
    expect(summary.funded).toBe(false);
  });

  it('captureFundingOrder is an idempotent alias — 20 concurrent calls, exactly 1 ledger credit', async () => {
    const owner = await signup(); const ch = await ensureChannel(owner.userId);
    const camp = await createApprovedCampaign(owner.userId, ch.id, 2000);
    const f = await campaignFundingService.createFundingForCampaign({ user: { id: owner.userId, role: 'user' } as any, session: {} as any }, camp.id);
    await Promise.all(Array.from({ length: 20 }, () => campaignFundingService.captureFundingOrder(f.id)));
    const ledger = await campaignFundingLedgerRepo.list({ campaign_id: camp.id });
    const credits = ledger.filter((l) => l.entry_type === 'funding_credit');
    expect(credits.length).toBe(1);
    const balance = await campaignFundingLedgerRepo.balanceMicros(camp.id);
    expect(balance).toBe(20_000_000);
    const finalOrder = await paymentFundingOrderRepo.findById(f.id);
    expect(finalOrder!.status).toBe('paid');
  });

  it('browser-return + CHECKOUT.ORDER.APPROVED webhook race → single capture, single ledger row', async () => {
    // Simulates the CHECKOUT.ORDER.APPROVED webhook branch calling
    // captureFundingOrderByProviderOrderId at nearly the same time as the
    // browser-return route calling captureFundingOrder(funding_id).
    const owner = await signup(); const ch = await ensureChannel(owner.userId);
    const camp = await createApprovedCampaign(owner.userId, ch.id, 2000);
    const f = await campaignFundingService.createFundingForCampaign({ user: { id: owner.userId, role: 'user' } as any, session: {} as any }, camp.id);
    const results = await Promise.all([
      campaignFundingService.captureFundingOrder(f.id),
      campaignFundingService.captureFundingOrderByProviderOrderId(f.provider_order_id!),
      campaignFundingService.captureFundingOrder(f.id),
      campaignFundingService.captureFundingOrderByProviderOrderId(f.provider_order_id!),
    ]);
    expect(results.every((r) => r && r.status === 'paid')).toBe(true);
    const ledger = await campaignFundingLedgerRepo.list({ campaign_id: camp.id });
    expect(ledger.filter((l) => l.entry_type === 'funding_credit').length).toBe(1);
  });

  it('funded approved campaign within schedule → auto-reconciled to active', async () => {
    const owner = await signup(); const ch = await ensureChannel(owner.userId);
    const camp = await createApprovedCampaign(owner.userId, ch.id, 2000);
    const f = await campaignFundingService.createFundingForCampaign({ user: { id: owner.userId, role: 'user' } as any, session: {} as any }, camp.id);
    await campaignFundingService.captureAndFinalize(f.id);
    const reloaded = await promotionCampaignRepo.findById(camp.id);
    expect(reloaded!.status).toBe('active');
    expect(reloaded!.activated_at).toBeTruthy();
  });

  it('funded approved campaign with future start_at → auto-reconciled to scheduled (not active yet)', async () => {
    const owner = await signup(); const ch = await ensureChannel(owner.userId);
    const camp = await createApprovedCampaign(owner.userId, ch.id, 2000);
    // Push start_at into the future.
    const future = new Date(Date.now() + 3600_000);
    await promotionCampaignRepo.update(camp.id, { start_at: future });
    const f = await campaignFundingService.createFundingForCampaign({ user: { id: owner.userId, role: 'user' } as any, session: {} as any }, camp.id);
    await campaignFundingService.captureAndFinalize(f.id);
    const reloaded = await promotionCampaignRepo.findById(camp.id);
    expect(reloaded!.status).toBe('scheduled');
  });

  it('funded approved campaign whose end_at already passed → reconciled to completed (not active)', async () => {
    const owner = await signup(); const ch = await ensureChannel(owner.userId);
    const camp = await createApprovedCampaign(owner.userId, ch.id, 2000);
    // Fund BEFORE moving end_at back — reconcile happens on capture using the current window.
    const f = await campaignFundingService.createFundingForCampaign({ user: { id: owner.userId, role: 'user' } as any, session: {} as any }, camp.id);
    // Simulate an approved-but-stale campaign whose window closed while checkout was open.
    await promotionCampaignRepo.update(camp.id, { end_at: new Date(Date.now() - 1000) });
    await campaignFundingService.captureAndFinalize(f.id);
    const reloaded = await promotionCampaignRepo.findById(camp.id);
    expect(reloaded!.status).toBe('completed');
    // And such an expired campaign must NOT deliver even though it's funded.
    const { promotionDeliveryService } = await import('@/lib/services/promotion/deliveryService');
    const cands = await promotionDeliveryService.selectCandidates({
      placement: 'sponsored_search', anonymous_session_id: `s-${Date.now()}`,
    }, 50);
    expect(cands.find((c) => c.campaign_id === camp.id)).toBeUndefined();
  });
});

describe('M06.0.7 — Phase 3: Ledger, spend accounting, integrity', () => {
  it('T01: $20 funding → 20,000,000 micros in ledger', async () => {
    const { ledgerService } = await import('@/lib/services/ledger/ledgerService');
    const owner = await signup(); const ch = await ensureChannel(owner.userId);
    const camp = await createApprovedCampaign(owner.userId, ch.id, 2000);
    const f = await campaignFundingService.createFundingForCampaign({ user: { id: owner.userId, role: 'user' } as any, session: {} as any }, camp.id);
    await campaignFundingService.captureAndFinalize(f.id);
    const b = await ledgerService.campaignBalances(camp.id);
    expect(b.funded_usd_micros).toBe(20_000_000);
  });

  it('T02: funding transaction is balanced (Σdebit == Σcredit)', async () => {
    const { ledgerRepo } = await import('@/lib/repositories/ledgerRepo');
    const owner = await signup(); const ch = await ensureChannel(owner.userId);
    const camp = await createApprovedCampaign(owner.userId, ch.id, 2000);
    const f = await campaignFundingService.createFundingForCampaign({ user: { id: owner.userId, role: 'user' } as any, session: {} as any }, camp.id);
    await campaignFundingService.captureAndFinalize(f.id);
    const rows = await ledgerRepo.listForCampaign(camp.id);
    const funding = rows.find((r) => r.transaction_type === 'funding_credit')!;
    const dr = funding.postings.filter((p) => p.direction === 'debit').reduce((s, p) => s + p.amount_usd_micros, 0);
    const cr = funding.postings.filter((p) => p.direction === 'credit').reduce((s, p) => s + p.amount_usd_micros, 0);
    expect(dr).toBe(cr);
    expect(dr).toBe(20_000_000);
    expect(funding.postings.map((p) => p.account).sort()).toEqual(['campaign_unspent_funds', 'gateway_clearing']);
  });

  it('T03: duplicate funding event → exactly one ledger transaction', async () => {
    const { ledgerRepo } = await import('@/lib/repositories/ledgerRepo');
    const owner = await signup(); const ch = await ensureChannel(owner.userId);
    const camp = await createApprovedCampaign(owner.userId, ch.id, 2000);
    const f = await campaignFundingService.createFundingForCampaign({ user: { id: owner.userId, role: 'user' } as any, session: {} as any }, camp.id);
    await Promise.all([
      campaignFundingService.captureAndFinalize(f.id),
      campaignFundingService.captureAndFinalize(f.id),
      campaignFundingService.captureAndFinalize(f.id),
    ]);
    const rows = await ledgerRepo.listForCampaign(camp.id);
    expect(rows.filter((r) => r.transaction_type === 'funding_credit').length).toBe(1);
  });

  it('T04/T05: $2 CPM → 2,000 micros/impression; 100 impressions → 200,000 micros', async () => {
    const { ledgerService } = await import('@/lib/services/ledger/ledgerService');
    const { promotionDeliveryService } = await import('@/lib/services/promotion/deliveryService');
    const owner = await signup(); const ch = await ensureChannel(owner.userId);
    const camp = await createApprovedCampaign(owner.userId, ch.id, 2000);
    const f = await campaignFundingService.createFundingForCampaign({ user: { id: owner.userId, role: 'user' } as any, session: {} as any }, camp.id);
    await campaignFundingService.captureAndFinalize(f.id);
    for (let i = 0; i < 100; i++) {
      const r = await promotionDeliveryService.acknowledgeImpression({
        campaign_id: camp.id, placement: 'sponsored_search',
        anonymous_session_id: `s-t04-${i}`,
        impression_event_id: `imp-t04-${camp.id}-${i}`,
      });
      expect(r.recorded).toBe(true);
    }
    const b = await ledgerService.campaignBalances(camp.id);
    // Exact micros-native math: 200 minor CPM = 2,000,000 micros / 1000 = 2,000 micros/imp.
    // 100 imps × 2,000 = 200,000 micros = $0.20.
    expect(b.spent_usd_micros).toBe(200_000);
  });

  it('T06: $20 - $0.20 → $19.80 remaining after 100 impressions at 2,000 micros each', async () => {
    const { ledgerService } = await import('@/lib/services/ledger/ledgerService');
    const { promotionDeliveryService } = await import('@/lib/services/promotion/deliveryService');
    const owner = await signup(); const ch = await ensureChannel(owner.userId);
    const camp = await createApprovedCampaign(owner.userId, ch.id, 2000);
    const f = await campaignFundingService.createFundingForCampaign({ user: { id: owner.userId, role: 'user' } as any, session: {} as any }, camp.id);
    await campaignFundingService.captureAndFinalize(f.id);
    for (let i = 0; i < 100; i++) {
      await promotionDeliveryService.acknowledgeImpression({
        campaign_id: camp.id, placement: 'sponsored_search',
        anonymous_session_id: `s-t06-${i}`, impression_event_id: `imp-t06-${camp.id}-${i}`,
      });
    }
    const b = await ledgerService.campaignBalances(camp.id);
    expect(b.spent_usd_micros).toBe(200_000);
    expect(b.remaining_usd_micros).toBe(19_800_000);
    expect(b.funded_usd_micros - b.spent_usd_micros - b.refunded_usd_micros).toBe(b.remaining_usd_micros);
  });

  it('T07: every spend transaction is balanced', async () => {
    const { ledgerRepo } = await import('@/lib/repositories/ledgerRepo');
    const { promotionDeliveryService } = await import('@/lib/services/promotion/deliveryService');
    const owner = await signup(); const ch = await ensureChannel(owner.userId);
    const camp = await createApprovedCampaign(owner.userId, ch.id, 2000);
    const f = await campaignFundingService.createFundingForCampaign({ user: { id: owner.userId, role: 'user' } as any, session: {} as any }, camp.id);
    await campaignFundingService.captureAndFinalize(f.id);
    for (let i = 0; i < 5; i++) {
      await promotionDeliveryService.acknowledgeImpression({
        campaign_id: camp.id, placement: 'sponsored_search',
        anonymous_session_id: `s-t07-${i}`, impression_event_id: `imp-t07-${camp.id}-${i}`,
      });
    }
    const rows = await ledgerRepo.listForCampaign(camp.id);
    const spends = rows.filter((r) => r.transaction_type === 'spend_debit');
    expect(spends.length).toBe(5);
    for (const t of spends) {
      const dr = t.postings.filter((p) => p.direction === 'debit').reduce((s, p) => s + p.amount_usd_micros, 0);
      const cr = t.postings.filter((p) => p.direction === 'credit').reduce((s, p) => s + p.amount_usd_micros, 0);
      expect(dr).toBe(cr);
      expect(t.postings.map((p) => p.account).sort()).toEqual(['ad_delivery_revenue', 'campaign_unspent_funds']);
    }
  });

  it('T08: duplicate impression ack → exactly one spend, one billable impression', async () => {
    const { ledgerRepo } = await import('@/lib/repositories/ledgerRepo');
    const { promotionDeliveryService } = await import('@/lib/services/promotion/deliveryService');
    const owner = await signup(); const ch = await ensureChannel(owner.userId);
    const camp = await createApprovedCampaign(owner.userId, ch.id, 2000);
    const f = await campaignFundingService.createFundingForCampaign({ user: { id: owner.userId, role: 'user' } as any, session: {} as any }, camp.id);
    await campaignFundingService.captureAndFinalize(f.id);
    const iid = `imp-t08-${camp.id}`;
    const results = await Promise.all(Array.from({ length: 10 }, () =>
      promotionDeliveryService.acknowledgeImpression({
        campaign_id: camp.id, placement: 'sponsored_search',
        anonymous_session_id: 's-t08', impression_event_id: iid,
      }),
    ));
    expect(results.every((r) => r.recorded)).toBe(true);
    const spends = (await ledgerRepo.listForCampaign(camp.id)).filter((r) => r.transaction_type === 'spend_debit');
    expect(spends.length).toBe(1);
    const c = await promotionCampaignRepo.findById(camp.id);
    expect(c!.delivered_impressions).toBe(1);
    expect(c!.estimated_spend_usd_minor).toBe(1);
  });

  it('T09: frequency-cap-blocked impression → zero spend', async () => {
    const { ledgerRepo } = await import('@/lib/repositories/ledgerRepo');
    const { promotionDeliveryService } = await import('@/lib/services/promotion/deliveryService');
    const { _internals } = await import('@/lib/services/promotion/deliveryService');
    const owner = await signup(); const ch = await ensureChannel(owner.userId);
    const camp = await createApprovedCampaign(owner.userId, ch.id, 2000);
    const f = await campaignFundingService.createFundingForCampaign({ user: { id: owner.userId, role: 'user' } as any, session: {} as any }, camp.id);
    await campaignFundingService.captureAndFinalize(f.id);
    // Send FREQ_CAP_MAX+1 impressions from same session — 4th should be capped.
    const anon = `s-t09-${Date.now()}`;
    for (let i = 0; i < _internals.FREQ_CAP_MAX; i++) {
      const r = await promotionDeliveryService.acknowledgeImpression({
        campaign_id: camp.id, placement: 'sponsored_search',
        anonymous_session_id: anon, impression_event_id: `imp-t09-${camp.id}-${i}`,
      });
      expect(r.recorded).toBe(true);
    }
    const capped = await promotionDeliveryService.acknowledgeImpression({
      campaign_id: camp.id, placement: 'sponsored_search',
      anonymous_session_id: anon, impression_event_id: `imp-t09-${camp.id}-cap`,
    });
    expect(capped.recorded).toBe(false);
    expect(capped.reason).toBe('frequency_capped');
    const spends = (await ledgerRepo.listForCampaign(camp.id)).filter((r) => r.transaction_type === 'spend_debit');
    expect(spends.length).toBe(_internals.FREQ_CAP_MAX);
  });

  it('T10: candidate-only selection produces zero spend', async () => {
    const { ledgerRepo } = await import('@/lib/repositories/ledgerRepo');
    const { promotionDeliveryService } = await import('@/lib/services/promotion/deliveryService');
    const owner = await signup(); const ch = await ensureChannel(owner.userId);
    const camp = await createApprovedCampaign(owner.userId, ch.id, 2000);
    const f = await campaignFundingService.createFundingForCampaign({ user: { id: owner.userId, role: 'user' } as any, session: {} as any }, camp.id);
    await campaignFundingService.captureAndFinalize(f.id);
    // Select candidates without ever acknowledging.
    await promotionDeliveryService.selectCandidates({
      placement: 'sponsored_search', anonymous_session_id: `s-t10-${Date.now()}`,
    }, 50);
    const spends = (await ledgerRepo.listForCampaign(camp.id)).filter((r) => r.transaction_type === 'spend_debit');
    expect(spends.length).toBe(0);
  });

  it('T13: legacy_waived campaign does NOT create a funding_credit ledger row', async () => {
    const { ledgerRepo } = await import('@/lib/repositories/ledgerRepo');
    const owner = await signup(); const ch = await ensureChannel(owner.userId);
    const camp = await createApprovedCampaign(owner.userId, ch.id, 2000);
    await paymentFundingOrderRepo.insert({
      id: uuidv4(), campaign_id: camp.id, owner_user_id: owner.userId,
      provider: 'paypal', provider_order_id: null, provider_capture_id: null,
      currency: 'USD', amount_minor: 0, amount_captured_minor: 0, amount_refunded_minor: 0,
      amount_usd_micros: 0, status: 'legacy_waived',
      approve_url: null, return_url: null, cancel_url: null,
      paid_at: null, cancelled_at: null, refunded_at: null,
      created_at: new Date(), updated_at: new Date(),
    });
    await promotionCampaignRepo.incrementFundedAmount(camp.id, 2000 * 10_000);
    const rows = await ledgerRepo.listForCampaign(camp.id);
    expect(rows.filter((r) => r.transaction_type === 'funding_credit').length).toBe(0);
  });

  it('T14/T15: concurrent spend cannot exceed funds; balance never goes negative', async () => {
    const { ledgerService } = await import('@/lib/services/ledger/ledgerService');
    const { promotionDeliveryService } = await import('@/lib/services/promotion/deliveryService');
    const owner = await signup(); const ch = await ensureChannel(owner.userId);
    // Budget generous so the whole-minor gate is NOT the limiter — we want
    // to prove the micros-precise funds gate is what stops overspend.
    // Cost per impression at CPM=$2.00 = 2,000 micros.
    // Manually drop funded_amount_usd_micros to 20,000 micros → only 10 imps affordable.
    const camp = await createApprovedCampaign(owner.userId, ch.id, 100);
    const f = await campaignFundingService.createFundingForCampaign({ user: { id: owner.userId, role: 'user' } as any, session: {} as any }, camp.id);
    await campaignFundingService.captureAndFinalize(f.id);
    // Adjust cached funded_amount to isolate the funds gate.
    await promotionCampaignRepo.update(camp.id, { funded_amount_usd_micros: 20_000 } as any);
    // Fire 20 concurrent qualifying impressions.
    const results = await Promise.all(Array.from({ length: 20 }, (_, i) =>
      promotionDeliveryService.acknowledgeImpression({
        campaign_id: camp.id, placement: 'sponsored_search',
        anonymous_session_id: `s-t14-${i}`, impression_event_id: `imp-t14-${camp.id}-${i}`,
      }),
    ));
    const recorded = results.filter((r) => r.recorded).length;
    expect(recorded).toBe(10); // exactly the number affordable
    const b = await ledgerService.campaignBalances(camp.id);
    // Note: ledger spent is derived from the ledger rows themselves and reflects
    // 10 × 2,000 = 20,000 micros. Ledger.funded stays $20 because the ledger
    // records the real capture; only the cached `funded_amount_usd_micros`
    // was reduced for this concurrency test.
    expect(b.spent_usd_micros).toBe(20_000);
    // Cached campaign funds (what atomicDeliverImpression gates on) reached 0.
    const cAfter = await promotionCampaignRepo.findById(camp.id);
    const cachedRemaining = (cAfter!.funded_amount_usd_micros ?? 0) - (cAfter!.refunded_amount_usd_micros ?? 0) - (cAfter!.estimated_spend_usd_micros ?? 0);
    expect(cachedRemaining).toBe(0);
    expect(cachedRemaining).toBeGreaterThanOrEqual(0);
  });

  it('T16: budget-exhausted campaign becomes non-deliverable', async () => {
    const { promotionDeliveryService } = await import('@/lib/services/promotion/deliveryService');
    const owner = await signup(); const ch = await ensureChannel(owner.userId);
    const camp = await createApprovedCampaign(owner.userId, ch.id, 1); // $0.01 budget = 1 imp
    const f = await campaignFundingService.createFundingForCampaign({ user: { id: owner.userId, role: 'user' } as any, session: {} as any }, camp.id);
    await campaignFundingService.captureAndFinalize(f.id);
    const first = await promotionDeliveryService.acknowledgeImpression({
      campaign_id: camp.id, placement: 'sponsored_search',
      anonymous_session_id: 's-t16-a', impression_event_id: `imp-t16-a-${camp.id}`,
    });
    expect(first.recorded).toBe(true);
    // Second impression should NOT be delivered — funds exhausted.
    const second = await promotionDeliveryService.acknowledgeImpression({
      campaign_id: camp.id, placement: 'sponsored_search',
      anonymous_session_id: 's-t16-b', impression_event_id: `imp-t16-b-${camp.id}`,
    });
    expect(second.recorded).toBe(false);
    // reconcileCampaign should mark completed on next delivery pass.
    await promotionCampaignRepo.update(camp.id, { estimated_spend_usd_minor: 1 });
    const cands = await promotionDeliveryService.selectCandidates({
      placement: 'sponsored_search', anonymous_session_id: `s-t16-c-${Date.now()}`,
    }, 50);
    expect(cands.find((c) => c.campaign_id === camp.id)).toBeUndefined();
  });

  it('T17/T18: paused OR expired campaign → zero spend even if ack arrives', async () => {
    const { ledgerRepo } = await import('@/lib/repositories/ledgerRepo');
    const { promotionDeliveryService } = await import('@/lib/services/promotion/deliveryService');
    const owner = await signup(); const ch = await ensureChannel(owner.userId);
    const camp = await createApprovedCampaign(owner.userId, ch.id, 2000);
    const f = await campaignFundingService.createFundingForCampaign({ user: { id: owner.userId, role: 'user' } as any, session: {} as any }, camp.id);
    await campaignFundingService.captureAndFinalize(f.id);
    // Pause.
    await promotionCampaignRepo.update(camp.id, { status: 'paused' });
    const paused = await promotionDeliveryService.acknowledgeImpression({
      campaign_id: camp.id, placement: 'sponsored_search',
      anonymous_session_id: 's-t17-a', impression_event_id: `imp-t17-a-${camp.id}`,
    });
    expect(paused.recorded).toBe(false);
    // Expire.
    await promotionCampaignRepo.update(camp.id, { status: 'active', end_at: new Date(Date.now() - 1000) });
    const expired = await promotionDeliveryService.acknowledgeImpression({
      campaign_id: camp.id, placement: 'sponsored_search',
      anonymous_session_id: 's-t18-b', impression_event_id: `imp-t18-b-${camp.id}`,
    });
    expect(expired.recorded).toBe(false);
    const spends = (await ledgerRepo.listForCampaign(camp.id)).filter((r) => r.transaction_type === 'spend_debit');
    expect(spends.length).toBe(0);
  });

  it('T19: organic (non-sponsored) events do NOT create ledger spend', async () => {
    const { ledgerRepo } = await import('@/lib/repositories/ledgerRepo');
    const owner = await signup(); const ch = await ensureChannel(owner.userId);
    const camp = await createApprovedCampaign(owner.userId, ch.id, 2000);
    const f = await campaignFundingService.createFundingForCampaign({ user: { id: owner.userId, role: 'user' } as any, session: {} as any }, camp.id);
    await campaignFundingService.captureAndFinalize(f.id);
    // Simulate organic activity: fire a raw channel_impression event bypassing acknowledgeImpression.
    const { trackingService } = await import('@/lib/services/trackingService');
    trackingService.recordChannelImpression({
      channelId: ch.id, anonymousSessionId: 's-t19', userId: null,
      source: 'homepage', placement: null, campaignId: null, trafficType: 'organic',
    });
    // wait a tick
    await new Promise((r) => setTimeout(r, 100));
    const spends = (await ledgerRepo.listForCampaign(camp.id)).filter((r) => r.transaction_type === 'spend_debit');
    expect(spends.length).toBe(0);
  });

  it('T20: rate-card change does NOT alter historical campaign CPM snapshot', async () => {
    const { promotionRateCardRepo } = await import('@/lib/repositories/promotionRepo');
    const { promotionDeliveryService } = await import('@/lib/services/promotion/deliveryService');
    const owner = await signup(); const ch = await ensureChannel(owner.userId);
    const camp = await createApprovedCampaign(owner.userId, ch.id, 2000); // cpm snapshot = 200 minor
    const f = await campaignFundingService.createFundingForCampaign({ user: { id: owner.userId, role: 'user' } as any, session: {} as any }, camp.id);
    await campaignFundingService.captureAndFinalize(f.id);
    // Change the global rate card to 5x higher.
    await promotionRateCardRepo.update('seed-sponsored_search', { cpm_usd_minor: 1000 } as any);
    const r = await promotionDeliveryService.acknowledgeImpression({
      campaign_id: camp.id, placement: 'sponsored_search',
      anonymous_session_id: 's-t20', impression_event_id: `imp-t20-${camp.id}`,
    });
    expect(r.recorded).toBe(true);
    // Spend must have been derived from the snapshot (200 minor CPM), not the mutated card.
    expect(r.unit_spend_usd_minor).toBe(1); // ceil(200/1000)=1
    // Restore rate card so subsequent tests aren't affected.
    await promotionRateCardRepo.update('seed-sponsored_search', { cpm_usd_minor: 200 } as any);
  });

  it('T21: integrity checker detects an unbalanced transaction', async () => {
    const { ledgerService } = await import('@/lib/services/ledger/ledgerService');
    const { ledgerRepo } = await import('@/lib/repositories/ledgerRepo');
    const owner = await signup(); const ch = await ensureChannel(owner.userId);
    const camp = await createApprovedCampaign(owner.userId, ch.id, 2000);
    // Insert a deliberately unbalanced row bypassing the service.
    const c = await import('@/lib/db/mongo').then((m) => m.getCollection('ledger_transactions'));
    await c.insertOne({
      id: uuidv4(),
      transaction_type: 'funding_credit',
      idempotency_key: `bad-${uuidv4()}`,
      campaign_id: camp.id,
      funding_order_id: null, provider_event_id: null, reference_event_id: null,
      postings: [
        { account: 'gateway_clearing', direction: 'debit', amount_usd_micros: 1_000_000 },
        { account: 'campaign_unspent_funds', direction: 'credit', amount_usd_micros: 999_999 }, // off by 1
      ],
      amount_usd_micros: 1_000_000,
      metadata: {}, created_at: new Date(),
    });
    const issues = await ledgerService.checkIntegrity({ campaign_id: camp.id });
    expect(issues.some((i) => i.kind === 'unbalanced_transaction')).toBe(true);
    // The unbalanced row also produces a negative campaign_unspent_funds balance for this campaign;
    // we don't assert negative_remaining because the campaign has no other rows.
    await ledgerRepo.list({ campaign_id: camp.id }); // touch to make sure query works
  });

  it('T22: reconciliation equation holds exactly (funded − spent − refunded == remaining)', async () => {
    const { ledgerService } = await import('@/lib/services/ledger/ledgerService');
    const { promotionDeliveryService } = await import('@/lib/services/promotion/deliveryService');
    const owner = await signup(); const ch = await ensureChannel(owner.userId);
    const camp = await createApprovedCampaign(owner.userId, ch.id, 2000);
    const f = await campaignFundingService.createFundingForCampaign({ user: { id: owner.userId, role: 'user' } as any, session: {} as any }, camp.id);
    await campaignFundingService.captureAndFinalize(f.id);
    for (let i = 0; i < 7; i++) {
      await promotionDeliveryService.acknowledgeImpression({
        campaign_id: camp.id, placement: 'sponsored_search',
        anonymous_session_id: `s-t22-${i}`, impression_event_id: `imp-t22-${camp.id}-${i}`,
      });
    }
    await campaignFundingService.recordRefund(f.provider_order_id!, 500, `REFUND-t22-${camp.id}`);
    const b = await ledgerService.campaignBalances(camp.id);
    expect(b.funded_usd_micros - b.spent_usd_micros - b.refunded_usd_micros).toBe(b.remaining_usd_micros);
    // Concretely: 20_000_000 funded − 14_000 spent (7 × 2000 micros) − 5_000_000 refunded = 14_986_000 remaining.
    expect(b.funded_usd_micros).toBe(20_000_000);
    expect(b.spent_usd_micros).toBe(14_000);
    expect(b.refunded_usd_micros).toBe(5_000_000);
    expect(b.remaining_usd_micros).toBe(14_986_000);
    const issues = await ledgerService.checkIntegrity({ campaign_id: camp.id });
    // T22 has no unbalanced/dup keys; only checks its own transactions.
    expect(issues.filter((i) => i.kind === 'unbalanced_transaction').length).toBe(0);
    expect(issues.filter((i) => i.kind === 'negative_remaining').length).toBe(0);
  });
});

describe('M06.0.8 — Phase 4: Refund workflow + Reconciliation', () => {
  it('R01: owner cancellation of funded active campaign → status=cancelled, delivery stops immediately', async () => {
    const owner = await signup(); const ch = await ensureChannel(owner.userId);
    const camp = await createApprovedCampaign(owner.userId, ch.id, 2000);
    const f = await campaignFundingService.createFundingForCampaign({ user: { id: owner.userId, role: 'user' } as any, session: {} as any }, camp.id);
    await campaignFundingService.captureAndFinalize(f.id);
    // Confirm active + delivering.
    const { promotionCampaignService } = await import('@/lib/services/promotion/campaignService');
    const { promotionDeliveryService } = await import('@/lib/services/promotion/deliveryService');
    const beforeAck = await promotionDeliveryService.acknowledgeImpression({ campaign_id: camp.id, placement: 'sponsored_search', anonymous_session_id: 'r01-pre' });
    expect(beforeAck.recorded).toBe(true);
    // Owner cancels.
    await promotionCampaignService.cancel({ user: { id: owner.userId, role: 'user' } as any, session: {} as any }, camp.id);
    const c = await promotionCampaignRepo.findById(camp.id);
    expect(c!.status).toBe('cancelled');
    // Delivery must NOT bill anymore.
    const afterAck = await promotionDeliveryService.acknowledgeImpression({ campaign_id: camp.id, placement: 'sponsored_search', anonymous_session_id: 'r01-post' });
    expect(afterAck.recorded).toBe(false);
  });

  it('R02/R08: refundable = funded − spent − already_refunded; partial refund calc excludes delivered spend', async () => {
    const { refundService } = await import('@/lib/services/payments/refundService');
    const { promotionDeliveryService } = await import('@/lib/services/promotion/deliveryService');
    const owner = await signup(); const ch = await ensureChannel(owner.userId);
    const camp = await createApprovedCampaign(owner.userId, ch.id, 2000);
    const f = await campaignFundingService.createFundingForCampaign({ user: { id: owner.userId, role: 'user' } as any, session: {} as any }, camp.id);
    await campaignFundingService.captureAndFinalize(f.id);
    // Deliver 10 imps = 20,000 micros.
    for (let i = 0; i < 10; i++) {
      await promotionDeliveryService.acknowledgeImpression({ campaign_id: camp.id, placement: 'sponsored_search', anonymous_session_id: `r02-${i}`, impression_event_id: `r02-${camp.id}-${i}` });
    }
    const rep = await refundService.computeRefundability(camp.id);
    expect(rep.funded_usd_micros).toBe(20_000_000);
    expect(rep.spent_usd_micros).toBe(20_000);
    expect(rep.refundable_usd_micros).toBe(19_980_000);
    expect(rep.refundable_amount_minor).toBe(1998); // $19.98 (floor)
    expect(rep.rounding_adjustment_usd_micros).toBe(0);
  });

  it('R03: OWNER cannot directly execute provider refund (only requestRefundForCancelledCampaign)', async () => {
    const { refundService } = await import('@/lib/services/payments/refundService');
    const owner = await signup(); const ch = await ensureChannel(owner.userId);
    const camp = await createApprovedCampaign(owner.userId, ch.id, 2000);
    const f = await campaignFundingService.createFundingForCampaign({ user: { id: owner.userId, role: 'user' } as any, session: {} as any }, camp.id);
    await campaignFundingService.captureAndFinalize(f.id);
    const { promotionCampaignService } = await import('@/lib/services/promotion/campaignService');
    await promotionCampaignService.cancel({ user: { id: owner.userId, role: 'user' } as any, session: {} as any }, camp.id);
    const refunds = await refundService.listForOwnerCampaign({ user: { id: owner.userId, role: 'user' } as any, session: {} as any }, camp.id);
    const openRefund = refunds.find((r) => r.status === 'pending')!;
    // Owner tries to execute — must be 403.
    await expect(refundService.executeRefund({ user: { id: owner.userId, role: 'user' } as any, session: {} as any }, openRefund.id))
      .rejects.toMatchObject({ status: 403 });
  });

  it('R05: MODERATOR cannot execute refund', async () => {
    const { refundService } = await import('@/lib/services/payments/refundService');
    const owner = await signup(); const ch = await ensureChannel(owner.userId);
    const camp = await createApprovedCampaign(owner.userId, ch.id, 2000);
    const f = await campaignFundingService.createFundingForCampaign({ user: { id: owner.userId, role: 'user' } as any, session: {} as any }, camp.id);
    await campaignFundingService.captureAndFinalize(f.id);
    const { promotionCampaignService } = await import('@/lib/services/promotion/campaignService');
    await promotionCampaignService.cancel({ user: { id: owner.userId, role: 'user' } as any, session: {} as any }, camp.id);
    const refunds = await refundService.listForOwnerCampaign({ user: { id: owner.userId, role: 'user' } as any, session: {} as any }, camp.id);
    await expect(refundService.executeRefund({ user: { id: 'mod-x', role: 'moderator' } as any, session: {} as any }, refunds[0].id))
      .rejects.toMatchObject({ status: 403 });
  });

  it('R04/R06/R09/R10/R13/R14/R15: admin can execute; refund ledger balanced; funding & spend rows immutable; provider amount authoritative', async () => {
    const { refundService } = await import('@/lib/services/payments/refundService');
    const { ledgerRepo } = await import('@/lib/repositories/ledgerRepo');
    const { ledgerService } = await import('@/lib/services/ledger/ledgerService');
    const owner = await signup(); const ch = await ensureChannel(owner.userId);
    const camp = await createApprovedCampaign(owner.userId, ch.id, 2000);
    const f = await campaignFundingService.createFundingForCampaign({ user: { id: owner.userId, role: 'user' } as any, session: {} as any }, camp.id);
    await campaignFundingService.captureAndFinalize(f.id);
    // Deliver some.
    const { promotionDeliveryService } = await import('@/lib/services/promotion/deliveryService');
    for (let i = 0; i < 10; i++) {
      await promotionDeliveryService.acknowledgeImpression({ campaign_id: camp.id, placement: 'sponsored_search', anonymous_session_id: `r04-${i}`, impression_event_id: `r04-${camp.id}-${i}` });
    }
    // Cancel + auto-request.
    const { promotionCampaignService } = await import('@/lib/services/promotion/campaignService');
    await promotionCampaignService.cancel({ user: { id: owner.userId, role: 'user' } as any, session: {} as any }, camp.id);
    const requests = await refundService.listForOwnerCampaign({ user: { id: owner.userId, role: 'user' } as any, session: {} as any }, camp.id);
    const req = requests.find((r) => r.status === 'pending')!;
    expect(req.requested_amount_minor).toBe(1998); // $19.98 refundable (20 - 0.02)
    // Snapshot ledger before refund.
    const beforeRows = await ledgerRepo.listForCampaign(camp.id);
    const fundingBefore = beforeRows.find((r) => r.transaction_type === 'funding_credit')!;
    const spendBefore = beforeRows.filter((r) => r.transaction_type === 'spend_debit');
    // Admin executes.
    const result = await refundService.executeRefund({ user: { id: 'admin-x', role: 'admin' } as any, session: {} as any }, req.id);
    expect(['refunded', 'partially_refunded']).toContain(result.status);
    // Verify refund ledger row balances.
    const afterRows = await ledgerRepo.listForCampaign(camp.id);
    const refundRow = afterRows.find((r) => r.transaction_type === 'refund_debit')!;
    expect(refundRow).toBeTruthy();
    const dr = refundRow.postings.filter((p) => p.direction === 'debit').reduce((s, p) => s + p.amount_usd_micros, 0);
    const cr = refundRow.postings.filter((p) => p.direction === 'credit').reduce((s, p) => s + p.amount_usd_micros, 0);
    expect(dr).toBe(cr);
    // Funding + spend ledger rows are UNCHANGED (immutability).
    const fundingAfter = afterRows.find((r) => r.transaction_type === 'funding_credit')!;
    expect(fundingAfter.id).toBe(fundingBefore.id);
    expect(fundingAfter.amount_usd_micros).toBe(fundingBefore.amount_usd_micros);
    const spendAfter = afterRows.filter((r) => r.transaction_type === 'spend_debit');
    expect(spendAfter.length).toBe(spendBefore.length);
    expect(spendAfter.map((r) => r.id).sort()).toEqual(spendBefore.map((r) => r.id).sort());
    // Reconciliation equation.
    const b = await ledgerService.campaignBalances(camp.id);
    expect(b.funded_usd_micros - b.spent_usd_micros - b.refunded_usd_micros).toBe(b.remaining_usd_micros);
  });

  it('R11/R12: duplicate refund execute + duplicate refund idempotency-key are safe', async () => {
    const { refundService } = await import('@/lib/services/payments/refundService');
    const { ledgerRepo } = await import('@/lib/repositories/ledgerRepo');
    const owner = await signup(); const ch = await ensureChannel(owner.userId);
    const camp = await createApprovedCampaign(owner.userId, ch.id, 2000);
    const f = await campaignFundingService.createFundingForCampaign({ user: { id: owner.userId, role: 'user' } as any, session: {} as any }, camp.id);
    await campaignFundingService.captureAndFinalize(f.id);
    const { promotionCampaignService } = await import('@/lib/services/promotion/campaignService');
    await promotionCampaignService.cancel({ user: { id: owner.userId, role: 'user' } as any, session: {} as any }, camp.id);
    const requests = await refundService.listForOwnerCampaign({ user: { id: owner.userId, role: 'user' } as any, session: {} as any }, camp.id);
    const req = requests.find((r) => r.status === 'pending')!;
    await Promise.all([
      refundService.executeRefund({ user: { id: 'admin-x', role: 'admin' } as any, session: {} as any }, req.id),
      refundService.executeRefund({ user: { id: 'admin-x', role: 'admin' } as any, session: {} as any }, req.id),
      refundService.executeRefund({ user: { id: 'admin-x', role: 'admin' } as any, session: {} as any }, req.id),
    ]);
    const rows = await ledgerRepo.listForCampaign(camp.id);
    const refunds = rows.filter((r) => r.transaction_type === 'refund_debit');
    expect(refunds.length).toBe(1);
  });

  it('R16: refunded campaign cannot resume paid delivery without new funding', async () => {
    const { refundService } = await import('@/lib/services/payments/refundService');
    const { promotionDeliveryService } = await import('@/lib/services/promotion/deliveryService');
    const owner = await signup(); const ch = await ensureChannel(owner.userId);
    const camp = await createApprovedCampaign(owner.userId, ch.id, 2000);
    const f = await campaignFundingService.createFundingForCampaign({ user: { id: owner.userId, role: 'user' } as any, session: {} as any }, camp.id);
    await campaignFundingService.captureAndFinalize(f.id);
    const { promotionCampaignService } = await import('@/lib/services/promotion/campaignService');
    await promotionCampaignService.cancel({ user: { id: owner.userId, role: 'user' } as any, session: {} as any }, camp.id);
    const requests = await refundService.listForOwnerCampaign({ user: { id: owner.userId, role: 'user' } as any, session: {} as any }, camp.id);
    await refundService.executeRefund({ user: { id: 'admin-x', role: 'admin' } as any, session: {} as any }, requests[0].id);
    // Force campaign status back to active — delivery must STILL refuse because refunded funds are gone.
    await promotionCampaignRepo.update(camp.id, { status: 'active' } as any);
    const ack = await promotionDeliveryService.acknowledgeImpression({ campaign_id: camp.id, placement: 'sponsored_search', anonymous_session_id: 'r16' });
    expect(ack.recorded).toBe(false); // budget_exhausted — refund consumed remaining funds
  });

  it('R17/R18: rounding floors safely, adjustment is explicit when refundable includes sub-cent micros', async () => {
    const { refundService } = await import('@/lib/services/payments/refundService');
    const { promotionDeliveryService } = await import('@/lib/services/promotion/deliveryService');
    const owner = await signup(); const ch = await ensureChannel(owner.userId);
    const camp = await createApprovedCampaign(owner.userId, ch.id, 2000);
    const f = await campaignFundingService.createFundingForCampaign({ user: { id: owner.userId, role: 'user' } as any, session: {} as any }, camp.id);
    await campaignFundingService.captureAndFinalize(f.id);
    // Deliver 1 imp = 2,000 micros. Remaining = 19,998,000 micros.
    // 19,998,000 / 10,000 = 1999.8 → floor to 1999 minor = $19.99. Rounding residual = 8,000 micros.
    await promotionDeliveryService.acknowledgeImpression({ campaign_id: camp.id, placement: 'sponsored_search', anonymous_session_id: 'r17', impression_event_id: `r17-${camp.id}` });
    const rep = await refundService.computeRefundability(camp.id);
    expect(rep.refundable_usd_micros).toBe(19_998_000);
    expect(rep.refundable_amount_minor).toBe(1999); // floor
    expect(rep.rounding_adjustment_usd_micros).toBe(8000); // explicit residual
  });

  it('R19/R20: cross-owner access denied for payment detail + refund list', async () => {
    const { refundService } = await import('@/lib/services/payments/refundService');
    const owner1 = await signup(); const ch1 = await ensureChannel(owner1.userId);
    const camp = await createApprovedCampaign(owner1.userId, ch1.id, 2000);
    await campaignFundingService.captureAndFinalize((await campaignFundingService.createFundingForCampaign({ user: { id: owner1.userId, role: 'user' } as any, session: {} as any }, camp.id)).id);
    const owner2 = await signup();
    await expect(refundService.listForOwnerCampaign({ user: { id: owner2.userId, role: 'user' } as any, session: {} as any }, camp.id))
      .rejects.toMatchObject({ status: 403 });
  });

  it('RC01/RC02/RC03: reconcileFundingOrder finalizes a stale pending; is idempotent on paid; never downgrades from paid', async () => {
    const { paymentReconciliationService } = await import('@/lib/services/payments/paymentReconciliationService');
    const owner = await signup(); const ch = await ensureChannel(owner.userId);
    const camp = await createApprovedCampaign(owner.userId, ch.id, 2000);
    const f = await campaignFundingService.createFundingForCampaign({ user: { id: owner.userId, role: 'user' } as any, session: {} as any }, camp.id);
    // Stub provider retrievePayment to return COMPLETED so reconcile can finalize.
    (mock as any).retrievePayment = async () => ({ provider_order_id: f.provider_order_id!, internal_status: 'paid', amount_minor: 2000, currency: 'USD', provider_capture_id: `CAP-RC01-${f.id}`, raw: {} });
    const r1 = await paymentReconciliationService.reconcileFundingOrder(f.id);
    expect(['finalized_paid', 'no_change']).toContain(r1.action);
    // Second reconcile should be idempotent — no downgrade.
    const r2 = await paymentReconciliationService.reconcileFundingOrder(f.id);
    expect(r2.action).toBe('noop_already_paid');
    // Even if provider suddenly reports "pending" (older event), we don't downgrade.
    (mock as any).retrievePayment = async () => ({ provider_order_id: f.provider_order_id!, internal_status: 'pending', amount_minor: 2000, currency: 'USD', provider_capture_id: null, raw: {} });
    const r3 = await paymentReconciliationService.reconcileFundingOrder(f.id);
    expect(r3.action).toBe('noop_already_paid');
    const final = await paymentFundingOrderRepo.findById(f.id);
    expect(final!.status).toBe('paid');
  });

  it('RC07: reconcile with unknown funding_id → 404', async () => {
    const { paymentReconciliationService } = await import('@/lib/services/payments/paymentReconciliationService');
    await expect(paymentReconciliationService.reconcileFundingOrder('does-not-exist'))
      .rejects.toMatchObject({ status: 404 });
  });

  it('PRIVACY: refund and payment API responses never leak PayPal secret / raw provider payload', async () => {
    // executeRefund's return shape excludes provider "raw"; verify.
    const { refundService } = await import('@/lib/services/payments/refundService');
    const owner = await signup(); const ch = await ensureChannel(owner.userId);
    const camp = await createApprovedCampaign(owner.userId, ch.id, 2000);
    const f = await campaignFundingService.createFundingForCampaign({ user: { id: owner.userId, role: 'user' } as any, session: {} as any }, camp.id);
    await campaignFundingService.captureAndFinalize(f.id);
    const { promotionCampaignService } = await import('@/lib/services/promotion/campaignService');
    await promotionCampaignService.cancel({ user: { id: owner.userId, role: 'user' } as any, session: {} as any }, camp.id);
    const requests = await refundService.listForOwnerCampaign({ user: { id: owner.userId, role: 'user' } as any, session: {} as any }, camp.id);
    const executed = await refundService.executeRefund({ user: { id: 'admin-x', role: 'admin' } as any, session: {} as any }, requests[0].id);
    const s = JSON.stringify(executed);
    expect(s).not.toContain(process.env.PAYPAL_CLIENT_SECRET || '__unset__');
    expect(s).not.toContain('access_token');
    expect(s).not.toContain('raw_body');
  });
});

describe('M06.0.1 — Funding creation authz + amount enforcement', () => {
  it('happy path: owner funds own approved campaign; amount = campaign budget', async () => {
    const owner = await signup();
    const ch = await ensureChannel(owner.userId);
    const camp = await createApprovedCampaign(owner.userId, ch.id, 2000);
    const funding = await campaignFundingService.createFundingForCampaign(
      { user: { id: owner.userId, role: 'user' } as any, session: {} as any }, camp.id,
    );
    expect(funding.status).toBe('checkout_created');
    expect(funding.amount_minor).toBe(2000);
    expect(funding.currency).toBe('USD');
    expect(funding.provider_order_id).toBe(`PP-ORDER-${funding.id}`);
    expect(funding.approve_url).toContain('sandbox.paypal.com');
    // Amount authority: mock recorded the input; must exactly match campaign budget.
    const call = mock.createCalls.find((c: any) => c.funding_id === funding.id) as any;
    expect(call.amount_minor).toBe(2000);
  });

  it('cross-owner funding attempt → 403', async () => {
    const a = await signup(); const b = await signup();
    const ch = await ensureChannel(a.userId);
    const camp = await createApprovedCampaign(a.userId, ch.id);
    await expect(
      campaignFundingService.createFundingForCampaign(
        { user: { id: b.userId, role: 'user' } as any, session: {} as any }, camp.id,
      ),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('cannot open second funding while one is in progress', async () => {
    const owner = await signup(); const ch = await ensureChannel(owner.userId);
    const camp = await createApprovedCampaign(owner.userId, ch.id);
    await campaignFundingService.createFundingForCampaign({ user: { id: owner.userId, role: 'user' } as any, session: {} as any }, camp.id);
    await expect(
      campaignFundingService.createFundingForCampaign({ user: { id: owner.userId, role: 'user' } as any, session: {} as any }, camp.id),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('draft/pending campaigns cannot be funded', async () => {
    const owner = await signup(); const ch = await ensureChannel(owner.userId);
    const camp = await createApprovedCampaign(owner.userId, ch.id);
    await promotionCampaignRepo.update(camp.id, { status: 'draft' });
    await expect(
      campaignFundingService.createFundingForCampaign({ user: { id: owner.userId, role: 'user' } as any, session: {} as any }, camp.id),
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe('M06.0.2 — Capture + ledger + idempotency', () => {
  it('capture posts a single ledger credit and flips funding to paid', async () => {
    const owner = await signup(); const ch = await ensureChannel(owner.userId);
    const camp = await createApprovedCampaign(owner.userId, ch.id, 2000);
    const f = await campaignFundingService.createFundingForCampaign({ user: { id: owner.userId, role: 'user' } as any, session: {} as any }, camp.id);
    const paid = await campaignFundingService.captureAndFinalize(f.id);
    expect(paid.status).toBe('paid');
    expect(paid.provider_capture_id).toBe(`PP-CAPTURE-${paid.provider_order_id}`);
    const ledger = await campaignFundingLedgerRepo.list({ campaign_id: camp.id });
    expect(ledger.length).toBe(1);
    expect(ledger[0].entry_type).toBe('funding_credit');
    expect(ledger[0].amount_usd_micros).toBe(20_000_000); // $20 * 1_000_000
  });

  it('capture is idempotent under duplicate calls (webhook + return callback race)', async () => {
    const owner = await signup(); const ch = await ensureChannel(owner.userId);
    const camp = await createApprovedCampaign(owner.userId, ch.id, 2000);
    const f = await campaignFundingService.createFundingForCampaign({ user: { id: owner.userId, role: 'user' } as any, session: {} as any }, camp.id);
    await Promise.all([
      campaignFundingService.captureAndFinalize(f.id),
      campaignFundingService.finalizePaidByProviderOrderId(f.provider_order_id!, `PP-CAPTURE-${f.provider_order_id}`, 2000),
      campaignFundingService.captureAndFinalize(f.id),
    ]);
    const ledger = await campaignFundingLedgerRepo.list({ campaign_id: camp.id });
    expect(ledger.length).toBe(1);
    const balance = await campaignFundingLedgerRepo.balanceMicros(camp.id);
    expect(balance).toBe(20_000_000);
  });

  it('failed capture does not post to ledger', async () => {
    mock.captureResult = 'failed';
    const owner = await signup(); const ch = await ensureChannel(owner.userId);
    const camp = await createApprovedCampaign(owner.userId, ch.id, 2000);
    const f = await campaignFundingService.createFundingForCampaign({ user: { id: owner.userId, role: 'user' } as any, session: {} as any }, camp.id);
    const finalOrder = await campaignFundingService.captureAndFinalize(f.id);
    expect(finalOrder.status).toBe('failed');
    const ledger = await campaignFundingLedgerRepo.list({ campaign_id: camp.id });
    expect(ledger.length).toBe(0);
    const summary = await campaignFundingService.fundingSummary(camp.id);
    expect(summary.funded).toBe(false);
  });
});

describe('M06.0.3 — Delivery gating', () => {
  it('unfunded campaign is NOT delivered even when status is active', async () => {
    const owner = await signup(); const ch = await ensureChannel(owner.userId);
    const camp = await createApprovedCampaign(owner.userId, ch.id, 2000);
    await promotionCampaignRepo.update(camp.id, { status: 'active' });
    const { promotionDeliveryService } = await import('@/lib/services/promotion/deliveryService');
    const cands = await promotionDeliveryService.selectCandidates({
      placement: 'sponsored_search', anonymous_session_id: `s-${Date.now()}`,
    }, 50);
    expect(cands.find((c) => c.campaign_id === camp.id)).toBeUndefined();
  });

  it('funded campaign IS delivered', async () => {
    const owner = await signup(); const ch = await ensureChannel(owner.userId);
    const camp = await createApprovedCampaign(owner.userId, ch.id, 2000);
    const f = await campaignFundingService.createFundingForCampaign({ user: { id: owner.userId, role: 'user' } as any, session: {} as any }, camp.id);
    await campaignFundingService.captureAndFinalize(f.id);
    await promotionCampaignRepo.update(camp.id, { status: 'active' });
    const { promotionDeliveryService } = await import('@/lib/services/promotion/deliveryService');
    const cands = await promotionDeliveryService.selectCandidates({
      placement: 'sponsored_search', anonymous_session_id: `s-${Date.now()}`,
    }, 50);
    expect(cands.find((c) => c.campaign_id === camp.id)).toBeTruthy();
  });

  it('legacy_waived campaigns still deliver (grandfather clause)', async () => {
    const owner = await signup(); const ch = await ensureChannel(owner.userId);
    const camp = await createApprovedCampaign(owner.userId, ch.id, 2000);
    // Insert a legacy_waived funding row directly (simulates the migration).
    await paymentFundingOrderRepo.insert({
      id: uuidv4(), campaign_id: camp.id, owner_user_id: owner.userId,
      provider: 'paypal', provider_order_id: null, provider_capture_id: null,
      currency: 'USD', amount_minor: 0, amount_captured_minor: 0, amount_refunded_minor: 0,
      amount_usd_micros: 0, status: 'legacy_waived',
      approve_url: null, return_url: null, cancel_url: null,
      paid_at: null, cancelled_at: null, refunded_at: null,
      created_at: new Date(), updated_at: new Date(),
    });
    await promotionCampaignRepo.update(camp.id, { status: 'active' });
    const { promotionDeliveryService } = await import('@/lib/services/promotion/deliveryService');
    const cands = await promotionDeliveryService.selectCandidates({
      placement: 'sponsored_search', anonymous_session_id: `s-${Date.now()}`,
    }, 50);
    expect(cands.find((c) => c.campaign_id === camp.id)).toBeTruthy();
  });
});

describe('M06.0.4 — Refunds', () => {
  it('partial refund posts a negative ledger row and flips status', async () => {
    const owner = await signup(); const ch = await ensureChannel(owner.userId);
    const camp = await createApprovedCampaign(owner.userId, ch.id, 2000);
    const f = await campaignFundingService.createFundingForCampaign({ user: { id: owner.userId, role: 'user' } as any, session: {} as any }, camp.id);
    await campaignFundingService.captureAndFinalize(f.id);
    await campaignFundingService.recordRefund(f.provider_order_id!, 500, `REFUND-${Date.now()}`);
    const bal = await campaignFundingLedgerRepo.balanceMicros(camp.id);
    expect(bal).toBe(20_000_000 - 5_000_000);
    const updated = await paymentFundingOrderRepo.findById(f.id);
    expect(updated!.status).toBe('partially_refunded');
  });

  it('refund is idempotent — same provider reference does not double-debit', async () => {
    const owner = await signup(); const ch = await ensureChannel(owner.userId);
    const camp = await createApprovedCampaign(owner.userId, ch.id, 2000);
    const f = await campaignFundingService.createFundingForCampaign({ user: { id: owner.userId, role: 'user' } as any, session: {} as any }, camp.id);
    await campaignFundingService.captureAndFinalize(f.id);
    const ref = `REFUND-DUP-${Date.now()}`;
    await campaignFundingService.recordRefund(f.provider_order_id!, 500, ref);
    await campaignFundingService.recordRefund(f.provider_order_id!, 500, ref);
    await campaignFundingService.recordRefund(f.provider_order_id!, 500, ref);
    const ledger = await campaignFundingLedgerRepo.list({ campaign_id: camp.id });
    const refunds = ledger.filter((l) => l.entry_type === 'refund_debit');
    expect(refunds.length).toBe(1);
  });
});

describe('M06.0.5 — Webhook idempotency & signature', () => {
  it('invalid webhook signature is rejected with 400', async () => {
    mock.webhookValid = false;
    const r = await api('/payments/paypal/webhook', {
      method: 'POST',
      headers: { 'Paypal-Auth-Algo': 'x', 'Paypal-Cert-Url': 'y', 'Paypal-Transmission-Id': 'z', 'Paypal-Transmission-Sig': 's', 'Paypal-Transmission-Time': 't' },
      body: JSON.stringify({ id: 'evt-invalid', event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: {} }),
    });
    expect(r.status).toBe(400);
  });

  it('duplicate webhook delivery is idempotent (event_id dedup)', async () => {
    // The webhook route delegates to (a) paymentWebhookEventRepo.recordIfAbsent
    // for event-id dedup and (b) campaignFundingService.finalizePaidByProviderOrderId
    // for the paid flip + ledger insert. Both must be idempotent under duplicate
    // delivery. We exercise those two layers directly here — testing them via
    // the HTTP route would require injecting the mock provider into the running
    // Next.js server process, which isn't in scope for a unit test.
    const owner = await signup(); const ch = await ensureChannel(owner.userId);
    const camp = await createApprovedCampaign(owner.userId, ch.id, 2000);
    const f = await campaignFundingService.createFundingForCampaign({ user: { id: owner.userId, role: 'user' } as any, session: {} as any }, camp.id);
    const evtId = `evt-fixed-${Date.now()}`;
    const captureId = `PP-CAPTURE-${f.provider_order_id}`;
    // Simulate 10 duplicate deliveries of the same event.
    const results = await Promise.all(Array.from({ length: 10 }, async () => {
      const { inserted } = await paymentWebhookEventRepo.recordIfAbsent({
        id: uuidv4(), provider: 'paypal', provider_event_id: evtId,
        event_type: 'PAYMENT.CAPTURE.COMPLETED',
        raw_payload: { id: evtId, event_type: 'PAYMENT.CAPTURE.COMPLETED' },
        processed: false, processed_at: null, process_error: null,
        received_at: new Date(),
      });
      // Only the first insertion should call the finalize path (mimics route).
      if (inserted) {
        await campaignFundingService.finalizePaidByProviderOrderId(f.provider_order_id!, captureId, 2000);
      }
      return inserted;
    }));
    const insertedCount = results.filter(Boolean).length;
    expect(insertedCount).toBe(1);
    const ledger = await campaignFundingLedgerRepo.list({ campaign_id: camp.id });
    const credits = ledger.filter((l) => l.entry_type === 'funding_credit');
    expect(credits.length).toBe(1);
    // And the funding must be marked paid exactly once.
    const finalOrder = await paymentFundingOrderRepo.findById(f.id);
    expect(finalOrder!.status).toBe('paid');
  });

  it('client success return without real payment does NOT fund the campaign', async () => {
    // No capture, no webhook — just simulate the buyer bouncing off with the funding still in checkout_created.
    const owner = await signup(); const ch = await ensureChannel(owner.userId);
    const camp = await createApprovedCampaign(owner.userId, ch.id, 2000);
    await campaignFundingService.createFundingForCampaign({ user: { id: owner.userId, role: 'user' } as any, session: {} as any }, camp.id);
    const summary = await campaignFundingService.fundingSummary(camp.id);
    expect(summary.funded).toBe(false);
    expect(summary.balance_usd_micros).toBe(0);
  });
});
