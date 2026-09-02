// Phase B3.2 Gate A — Automatic PayPal Fee Reconciliation targeted tests.
// Scope:
//   §1 Capture-response fee: when PayPal capture returns seller_receivable_
//      breakdown, economics finalize immediately (no reconciliation needed).
//   §2 Webhook backfill: attempt already captured with fee=null and a later
//      verified CAPTURE.COMPLETED webhook carrying the fee finalizes economics.
//   §3 Webhook backfill idempotency: repeated CAPTURE.COMPLETED with the same
//      fee produces no duplicate PAYMENT_CONFIRMED and exactly one
//      GATEWAY_FEE_RECONCILED.
//   §4 Admin retrieveCapture + reconcile flow: fills fee when webhook was
//      absent or breakdown-less.
//   §5 Guardrails: no recapture, no additional buyer charge; refund/
//      reversal state blocks backfill.
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { MongoClient, type Db } from 'mongodb';
import { v4 as uuidv4 } from 'uuid';
import { COLLECTIONS } from '@/lib/db/collections';
import { marketplaceService } from '@/lib/services/marketplaceService';
import { marketplaceOrderRepo, marketplaceFinancialEventRepo, marketplacePaymentAttemptRepo } from '@/lib/repositories/marketplaceRepo';
import { _setPaymentProviderForTesting } from '@/lib/services/payments/providerFactory';
import type { Actor, Channel } from '@/lib/types';
import type {
  CreatePaymentInput, CreatePaymentResult, CapturePaymentInput, CapturePaymentResult,
  RetrievePaymentResult, RefundInput, RefundResult, PaymentInternalStatus,
} from '@/lib/services/payments/paymentProvider';

const BASE = 'http://localhost:3000/api';
const RUN_TAG = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
const IP = () => `10.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;

async function withDb<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  const client = new MongoClient(process.env.MONGO_URL || 'mongodb://localhost:27017');
  await client.connect();
  try { return await fn(client.db(process.env.DB_NAME || 'wavelead')); } finally { await client.close(); }
}
async function signup(tag: string, role?: string): Promise<{ userId: string; email: string }> {
  const email = `b32-${RUN_TAG}-${tag}@t.test`;
  const s = await fetch(`${BASE}/auth/signup`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': IP() },
    body: JSON.stringify({ email, password: 'password123!', display_name: `T-${tag}` }),
  });
  const j = await s.json() as { data?: { user?: { id?: string } } };
  const userId = j?.data?.user?.id as string;
  if (role) await withDb(async (db) => { await db.collection('users').updateOne({ id: userId }, { $set: { role } }); });
  return { userId, email };
}
function actorFor(user_id: string, role = 'user'): Actor {
  return { session: { userId: user_id, email: `${user_id}@t.test`, v: 0 }, user: { id: user_id, email: `${user_id}@t.test`, role, display_name: user_id, avatar_url: null, country_code: null, preferred_language: 'en', auth_providers: [], created_at: new Date(), updated_at: new Date() } } as unknown as Actor;
}
async function seedChannel(ownerId: string, tag: string): Promise<Channel> {
  const id = uuidv4();
  const slug = `b32-ch-${id.slice(0, 8)}`;
  const now = new Date();
  const doc = {
    id, slug, name: `${tag} ${id.slice(0, 6)}`,
    whatsapp_url: `https://whatsapp.com/channel/0029Va${id.slice(0, 20).replace(/-/g, '')}`,
    whatsapp_channel_id: `0029Va${id.slice(0, 20).replace(/-/g, '')}`,
    description: 'a completely-populated test channel description',
    short_description: 'a completely-populated test channel description',
    logo_url: 'https://example.com/logo.png', cover_url: null, website_url: null,
    country_code: 'US', follower_count: 5000, is_official: false, is_verified: true,
    verification_status: 'verified', owner_id: ownerId, category_id: null,
    tags: [], status: 'approved', view_count: 0, click_count: 0, follow_intent_count: 0,
    created_at: now, updated_at: now, submitted_by: null, published_at: now, moderated_by: null, moderated_at: now,
  };
  await withDb(async (db) => { await db.collection('channels').insertOne(doc as unknown as Record<string, unknown>); });
  return doc as unknown as Channel;
}

/** Mock provider supporting per-call fee/net + retrieveCapture. */
class MockPayPalFees {
  readonly id = 'paypal' as const;
  captureFee: number | null = 300;         // configurable per test
  captureNet: number | null = null;         // if null and captureFee set, auto = amount - fee
  captureResult: PaymentInternalStatus = 'paid';
  retrieveFee: number | null = null;
  retrieveNet: number | null = null;
  retrieveThrows: boolean = false;
  lastCaptureId: string | null = null;

  async createPayment(_input: CreatePaymentInput): Promise<CreatePaymentResult> {
    return { provider: 'paypal', provider_order_id: `PP-ORD-${uuidv4().slice(0, 12)}`, approve_url: `https://sandbox.paypal.com/checkoutnow?token=x`, raw: {} };
  }
  async capturePayment(input: CapturePaymentInput): Promise<CapturePaymentResult> {
    const amt = this.overrideAmount ?? 10000;
    const cid = `PP-CAP-${uuidv4().slice(0, 12)}`;
    this.lastCaptureId = cid;
    return {
      provider_order_id: input.provider_order_id,
      provider_capture_id: cid,
      internal_status: this.captureResult,
      amount_captured_minor: amt,
      currency: 'USD',
      provider_fee_minor: this.captureFee,
      provider_net_minor: this.captureFee !== null ? (this.captureNet ?? amt - this.captureFee) : null,
      raw: {},
    };
  }
  overrideAmount: number | null = null;
  async retrievePayment(input: CapturePaymentInput): Promise<RetrievePaymentResult> {
    return { provider_order_id: input.provider_order_id, internal_status: 'paid', amount_minor: this.overrideAmount ?? 10000, currency: 'USD', provider_capture_id: null, raw: {} };
  }
  async retrieveCapture(input: { provider_capture_id: string }) {
    if (this.retrieveThrows) throw new Error('provider error');
    const amt = this.overrideAmount ?? 10000;
    return {
      provider_capture_id: input.provider_capture_id,
      internal_status: 'paid' as PaymentInternalStatus,
      amount_minor: amt,
      currency: 'USD',
      provider_fee_minor: this.retrieveFee,
      provider_net_minor: this.retrieveFee !== null ? (this.retrieveNet ?? amt - this.retrieveFee) : null,
      raw: {},
    };
  }
  async createRefund(_input: RefundInput): Promise<RefundResult> { throw new Error('not used'); }
  async verifyWebhook() { return { valid: true, event_id: `evt-${Date.now()}`, event_type: 'X', resource: {} }; }
}

let mock: MockPayPalFees;

async function purge() {
  await withDb(async (db) => {
    await db.collection('channels').deleteMany({ slug: /^b32-/ });
    await db.collection(COLLECTIONS.CHANNEL_RATE_CARDS).deleteMany({});
    await db.collection(COLLECTIONS.MARKETPLACE_ORDERS).deleteMany({});
    await db.collection(COLLECTIONS.MARKETPLACE_FINANCIAL_EVENTS).deleteMany({});
    await db.collection(COLLECTIONS.MARKETPLACE_PAYMENT_ATTEMPTS).deleteMany({});
    await db.collection('users').deleteMany({ email: new RegExp(`b32-${RUN_TAG}`) });
  });
}
beforeAll(async () => { await purge(); mock = new MockPayPalFees(); _setPaymentProviderForTesting(mock); });
afterEach(() => {
  mock.captureFee = 300; mock.captureNet = null;
  mock.captureResult = 'paid';
  mock.retrieveFee = null; mock.retrieveNet = null; mock.retrieveThrows = false;
  mock.overrideAmount = null;
});
afterAll(async () => { _setPaymentProviderForTesting(null); await purge(); });

async function bookAndAccept(tag: string, priceMinor = 10000) {
  const owner = await signup(`${tag}-o`);
  const buyer = await signup(`${tag}-b`);
  const ch = await seedChannel(owner.userId, tag);
  const card = await marketplaceService.replaceRateCard(actorFor(owner.userId), ch.id, {
    packages: [{ type: 'sponsored_post', name: 'P', description: 'x', price_minor: priceMinor, deliverables: ['1 post'], currency: 'USD', is_active: true }],
  });
  const order = await marketplaceService.submitBooking(actorFor(buyer.userId), {
    channel_id: ch.id, package_id: card.packages[0].id,
    company_name: 'Acme', contact_name: 'CN', contact_email: `acme-${tag}@t.test`,
    campaign_objective: 'X', brief: 'Y',
  });
  const accepted = await marketplaceService.ownerAcceptOrder(actorFor(owner.userId), order.id);
  return { owner, buyer, order: accepted };
}

// ============================================================================
// §1 Capture-response fee → immediate finalization
// ============================================================================
describe('B3.2 §1 — capture response carries fee', () => {
  it('#1 browser-return capture with fee in seller_receivable_breakdown finalizes economics', async () => {
    const { buyer, order } = await bookAndAccept('c1', 10000);
    mock.overrideAmount = 10000; mock.captureFee = 350; mock.captureNet = 9650;
    const { attempt } = await marketplaceService.buyerStartPaypalCheckout(actorFor(buyer.userId), order.id);
    const captured = await marketplaceService.captureMarketplacePaypalOrder(actorFor(buyer.userId), attempt.id);
    expect(captured.status).toBe('captured');
    expect(captured.provider_fee_minor).toBe(350);
    expect(captured.provider_net_minor).toBe(9650);
    const o = (await marketplaceOrderRepo.findById(order.id))!;
    expect(o.status).toBe('paid');
    expect(o.economics_status).toBe('finalized');
    expect(o.gateway_fee_minor).toBe(350);
    expect(o.owner_payable_status).toBe('payable_pending_delivery');
    // Exactly one PAYMENT_CONFIRMED — no fee-reconcile event needed.
    const evts = await marketplaceFinancialEventRepo.listByOrder(order.id);
    expect(evts.filter((e) => e.event_type === 'PAYMENT_CONFIRMED').length).toBe(1);
    expect(evts.filter((e) => e.event_type === 'GATEWAY_FEE_RECONCILED').length).toBe(0);
  });
});

// ============================================================================
// §2 Webhook backfill when fee unknown at capture
// ============================================================================
describe('B3.2 §2 — webhook backfill', () => {
  it('#2 fee=null at capture → later CAPTURE.COMPLETED backfills fee + finalizes economics', async () => {
    const { buyer, order } = await bookAndAccept('c2', 10000);
    mock.overrideAmount = 10000; mock.captureFee = null; mock.captureNet = null;
    const { attempt } = await marketplaceService.buyerStartPaypalCheckout(actorFor(buyer.userId), order.id);
    const captured = await marketplaceService.captureMarketplacePaypalOrder(actorFor(buyer.userId), attempt.id);
    expect(captured.status).toBe('captured');
    expect(captured.provider_fee_minor).toBeNull();
    const preOrder = (await marketplaceOrderRepo.findById(order.id))!;
    expect(preOrder.economics_status).toBe('pending_fee_reconciliation');
    expect(preOrder.owner_payable_status).toBe('blocked_fee_reconciliation');
    // Now webhook arrives with exact fee.
    await marketplaceService.finalizeMarketplaceCaptureFromWebhook(
      attempt.provider_order_id!, captured.provider_capture_id!, 10000, 'USD', 350, 9650,
    );
    const postAttempt = (await marketplacePaymentAttemptRepo.findById(attempt.id))!;
    const postOrder = (await marketplaceOrderRepo.findById(order.id))!;
    expect(postAttempt.provider_fee_minor).toBe(350);
    expect(postAttempt.provider_net_minor).toBe(9650);
    expect(postOrder.economics_status).toBe('finalized');
    expect(postOrder.gateway_fee_minor).toBe(350);
    expect(postOrder.owner_payable_status).toBe('payable_pending_delivery');
    // 90/10 preserved.
    expect(postOrder.owner_earnings_minor! + postOrder.wavelead_commission_minor!).toBe(9650);
  });
  it('#3 webhook without fee AFTER captured-with-null → no-op (never estimates zero)', async () => {
    const { buyer, order } = await bookAndAccept('c3', 10000);
    mock.overrideAmount = 10000; mock.captureFee = null;
    const { attempt } = await marketplaceService.buyerStartPaypalCheckout(actorFor(buyer.userId), order.id);
    const captured = await marketplaceService.captureMarketplacePaypalOrder(actorFor(buyer.userId), attempt.id);
    await marketplaceService.finalizeMarketplaceCaptureFromWebhook(
      attempt.provider_order_id!, captured.provider_capture_id!, 10000, 'USD', null, null,
    );
    const postOrder = (await marketplaceOrderRepo.findById(order.id))!;
    expect(postOrder.gateway_fee_minor).toBeNull();
    expect(postOrder.economics_status).toBe('pending_fee_reconciliation');
  });
  it('#4 webhook idempotency: repeated CAPTURE.COMPLETED with same fee → exactly one GATEWAY_FEE_RECONCILED, exactly one PAYMENT_CONFIRMED', async () => {
    const { buyer, order } = await bookAndAccept('c4', 10000);
    mock.overrideAmount = 10000; mock.captureFee = null;
    const { attempt } = await marketplaceService.buyerStartPaypalCheckout(actorFor(buyer.userId), order.id);
    const captured = await marketplaceService.captureMarketplacePaypalOrder(actorFor(buyer.userId), attempt.id);
    // Fire webhook thrice with same fee.
    await marketplaceService.finalizeMarketplaceCaptureFromWebhook(attempt.provider_order_id!, captured.provider_capture_id!, 10000, 'USD', 350, 9650);
    await marketplaceService.finalizeMarketplaceCaptureFromWebhook(attempt.provider_order_id!, captured.provider_capture_id!, 10000, 'USD', 350, 9650);
    await marketplaceService.finalizeMarketplaceCaptureFromWebhook(attempt.provider_order_id!, captured.provider_capture_id!, 10000, 'USD', 350, 9650);
    const evts = await marketplaceFinancialEventRepo.listByOrder(order.id);
    expect(evts.filter((e) => e.event_type === 'PAYMENT_CONFIRMED').length).toBe(1);
    expect(evts.filter((e) => e.event_type === 'GATEWAY_FEE_RECONCILED').length).toBe(1);
  });
});

// ============================================================================
// §3 Admin retrieveCapture + backfill flow
// ============================================================================
describe('B3.2 §3 — admin retrieveCapture reconciliation', () => {
  it('#5 admin action fills fee from provider when webhook is absent', async () => {
    const { buyer, order } = await bookAndAccept('a5', 10000);
    mock.overrideAmount = 10000; mock.captureFee = null;
    const { attempt } = await marketplaceService.buyerStartPaypalCheckout(actorFor(buyer.userId), order.id);
    await marketplaceService.captureMarketplacePaypalOrder(actorFor(buyer.userId), attempt.id);
    // Configure retrieve to return exact fee.
    mock.retrieveFee = 350; mock.retrieveNet = 9650;
    const admin = await signup('a5-a', 'super_admin');
    const res = await marketplaceService.adminReconcileFeeFromProvider(actorFor(admin.userId, 'super_admin'), attempt.id);
    expect(res.ok).toBe(true);
    expect(res.fee_before).toBeNull();
    expect(res.fee_after).toBe(350);
    const o = (await marketplaceOrderRepo.findById(order.id))!;
    expect(o.economics_status).toBe('finalized');
    expect(o.gateway_fee_minor).toBe(350);
    const evts = await marketplaceFinancialEventRepo.listByOrder(order.id);
    expect(evts.filter((e) => e.event_type === 'GATEWAY_FEE_RECONCILED').length).toBe(1);
  });
  it('#6 admin action idempotent when fee is already set (returns fee_before === fee_after; no duplicate events)', async () => {
    const { buyer, order } = await bookAndAccept('a6', 10000);
    mock.overrideAmount = 10000; mock.captureFee = 350; mock.captureNet = 9650;
    const { attempt } = await marketplaceService.buyerStartPaypalCheckout(actorFor(buyer.userId), order.id);
    await marketplaceService.captureMarketplacePaypalOrder(actorFor(buyer.userId), attempt.id);
    const admin = await signup('a6-a', 'super_admin');
    const res = await marketplaceService.adminReconcileFeeFromProvider(actorFor(admin.userId, 'super_admin'), attempt.id);
    expect(res.ok).toBe(true);
    expect(res.fee_before).toBe(350);
    expect(res.fee_after).toBe(350);
    const evts = await marketplaceFinancialEventRepo.listByOrder(order.id);
    // Since fee was set at capture time, we should have exactly one PAYMENT_CONFIRMED and NO GATEWAY_FEE_RECONCILED (backfill path never ran).
    expect(evts.filter((e) => e.event_type === 'PAYMENT_CONFIRMED').length).toBe(1);
    expect(evts.filter((e) => e.event_type === 'GATEWAY_FEE_RECONCILED').length).toBe(0);
  });
  it('#7 admin action reports ok=false when provider still returns null fee (never estimates)', async () => {
    const { buyer, order } = await bookAndAccept('a7', 10000);
    mock.overrideAmount = 10000; mock.captureFee = null;
    const { attempt } = await marketplaceService.buyerStartPaypalCheckout(actorFor(buyer.userId), order.id);
    await marketplaceService.captureMarketplacePaypalOrder(actorFor(buyer.userId), attempt.id);
    mock.retrieveFee = null;
    const admin = await signup('a7-a', 'super_admin');
    const res = await marketplaceService.adminReconcileFeeFromProvider(actorFor(admin.userId, 'super_admin'), attempt.id);
    expect(res.ok).toBe(false);
    expect(res.fee_after).toBeNull();
    const o = (await marketplaceOrderRepo.findById(order.id))!;
    expect(o.economics_status).toBe('pending_fee_reconciliation');
    expect(o.gateway_fee_minor).toBeNull();
  });
  it('#8 admin action rejects non-captured attempts and non-admin actors', async () => {
    const { buyer, order } = await bookAndAccept('a8', 10000);
    const { attempt } = await marketplaceService.buyerStartPaypalCheckout(actorFor(buyer.userId), order.id);
    // Non-captured (still checkout_created).
    const admin = await signup('a8-a', 'super_admin');
    await expect(marketplaceService.adminReconcileFeeFromProvider(actorFor(admin.userId, 'super_admin'), attempt.id)).rejects.toMatchObject({ status: 409 });
    // Non-admin.
    const stranger = await signup('a8-x');
    await expect(marketplaceService.adminReconcileFeeFromProvider(actorFor(stranger.userId), attempt.id)).rejects.toMatchObject({ status: 403 });
    void order;
  });
});

// ============================================================================
// §4 Guardrails: no recapture, no additional buyer charge, refund blocks backfill
// ============================================================================
describe('B3.2 §4 — guardrails', () => {
  it('#9 refund/reversal blocks fee backfill (does not silently rewrite historical economics)', async () => {
    const { buyer, order } = await bookAndAccept('g9', 10000);
    mock.overrideAmount = 10000; mock.captureFee = null;
    const { attempt } = await marketplaceService.buyerStartPaypalCheckout(actorFor(buyer.userId), order.id);
    const captured = await marketplaceService.captureMarketplacePaypalOrder(actorFor(buyer.userId), attempt.id);
    // Refund arrives BEFORE fee reconciliation.
    await marketplaceService.recordMarketplaceRefundOrReversal(
      attempt.provider_order_id!, 'MARKETPLACE_PAYMENT_REFUNDED', 10000, `PP-REF-${uuidv4().slice(0, 8)}`,
    );
    // Now webhook comes with the fee.
    await marketplaceService.finalizeMarketplaceCaptureFromWebhook(
      attempt.provider_order_id!, captured.provider_capture_id!, 10000, 'USD', 350, 9650,
    );
    const o = (await marketplaceOrderRepo.findById(order.id))!;
    // Order MUST remain in reconciliation state — historical economics untouched.
    expect(o.payment_reconciliation_required).toBe(true);
    expect(o.owner_payable_status).toBe('manual_reconciliation_required');
    expect(o.gateway_fee_minor).toBeNull(); // NOT backfilled
    expect(o.economics_status).toBe('pending_fee_reconciliation');
  });
  it('#10 backfill NEVER recaptures — capturePayment is never called again after captured', async () => {
    const { buyer, order } = await bookAndAccept('g10', 10000);
    mock.overrideAmount = 10000; mock.captureFee = null;
    const { attempt } = await marketplaceService.buyerStartPaypalCheckout(actorFor(buyer.userId), order.id);
    const captured = await marketplaceService.captureMarketplacePaypalOrder(actorFor(buyer.userId), attempt.id);
    // Sanity — capture id is now set.
    expect(captured.provider_capture_id).toBeTruthy();
    // Spy on capturePayment.
    let captureCalls = 0;
    const origCap = mock.capturePayment.bind(mock);
    mock.capturePayment = async (i: CapturePaymentInput) => { captureCalls++; return origCap(i); };
    // Backfill via webhook and admin action.
    await marketplaceService.finalizeMarketplaceCaptureFromWebhook(
      attempt.provider_order_id!, captured.provider_capture_id!, 10000, 'USD', 350, 9650,
    );
    const admin = await signup('g10-a', 'super_admin');
    const rc = await marketplaceService.adminReconcileFeeFromProvider(actorFor(admin.userId, 'super_admin'), attempt.id);
    // Since webhook already backfilled, admin sees fee_before === fee_after.
    expect(rc.fee_after).toBe(350);
    expect(captureCalls).toBe(0);
    void order;
  });
  it('#11 mismatched capture id in webhook does NOT overwrite existing fee (safety)', async () => {
    const { buyer, order } = await bookAndAccept('g11', 10000);
    mock.overrideAmount = 10000; mock.captureFee = null;
    const { attempt } = await marketplaceService.buyerStartPaypalCheckout(actorFor(buyer.userId), order.id);
    const captured = await marketplaceService.captureMarketplacePaypalOrder(actorFor(buyer.userId), attempt.id);
    const bogusCaptureId = `PP-CAP-BOGUS-${uuidv4().slice(0, 8)}`;
    const r = await marketplaceService.finalizeMarketplaceCaptureFromWebhook(
      attempt.provider_order_id!, bogusCaptureId, 10000, 'USD', 999, 9001,
    );
    // Function returned safely without applying the different-capture fee.
    expect(r?.provider_fee_minor).toBeNull();
    const o = (await marketplaceOrderRepo.findById(order.id))!;
    expect(o.gateway_fee_minor).toBeNull();
    void captured; void order;
  });
});
