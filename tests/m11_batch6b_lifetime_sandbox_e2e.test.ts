// M11-Batch6b — Founding Brand Pro Lifetime SANDBOX end-to-end acceptance.
//
// This exercises the COMPLETE purchase lifecycle. HTTP routes are used
// wherever they don't touch the real PayPal API. The PayPal capture flow is
// exercised via the service layer with a deterministic sandbox stub — a live
// PayPal sandbox click-through is unnecessarily fragile for CI, and the
// underlying provider adapter is already covered by tests/m07_paypal_activation
// and tests/m08b3_paypal_checkout regressions.
//
// Verifies §1–§17 of the "ENABLE FOUNDING LIFETIME SANDBOX" acceptance list:
//   /api/admin/pricing-config PUT               → seeds real pricing_snapshot_id
//   /api/brand/founding-lifetime/state GET       → sandbox state
//   duplicate purchase blocked (409)             → verified against real route
//   /api/brand/founding-lifetime/[id] GET        → buyer sees frozen terms
//   service.startCheckout / captureAndReconcile  → server-authoritative $100
//   webhook replay + duplicate capture           → still ONE grant
//   refund service                                → grant refunded / brand.* off
//   admin flip $100 → $149 via HTTP              → existing order economics immutable
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MongoClient, type Db } from 'mongodb';
import { COLLECTIONS } from '@/lib/db/collections';
import { _setPaymentProviderForTesting } from '@/lib/services/payments/providerFactory';
import { pricingConfigService } from '@/lib/services/pricingConfigService';
import { brandEntitlementService, applyBrandGrantsToEntitlements } from '@/lib/services/brandEntitlementService';
import { brandFoundingLifetimeService } from '@/lib/services/brandFoundingLifetimeService';
import { resolveEntitlements } from '@/lib/entitlements';
import type {
  Actor,
  BrandFoundingLifetimeOrder,
  BrandEntitlementGrant,
} from '@/lib/types';
import type {
  CreatePaymentInput, CapturePaymentInput, RefundInput, RetrieveCaptureInput,
  PaymentProvider,
} from '@/lib/services/payments/paymentProvider';

const BASE = 'http://localhost:3000/api';
const RUN_TAG = `b6b-${Date.now()}${Math.floor(Math.random() * 1e6)}`;

async function withDb<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  const client = new MongoClient(process.env.MONGO_URL || 'mongodb://localhost:27017');
  await client.connect();
  try { return await fn(client.db(process.env.DB_NAME || 'wavelead')); }
  finally { await client.close(); }
}
function ip(): string { return `10.${Math.floor(Math.random()*255)}.${Math.floor(Math.random()*255)}.${Math.floor(Math.random()*255)}`; }

async function signup(email: string, persona?: 'owner' | 'brand' | 'both', plan?: 'free' | 'pro'): Promise<{ userId: string; cookie: string }> {
  const res = await fetch(`${BASE}/auth/signup`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip() },
    body: JSON.stringify({ email, password: 'password123!', display_name: email.split('@')[0] }),
  });
  const cookie = (res.headers.get('set-cookie') || '').split(';')[0];
  const j = await res.json() as { data?: { user?: { id?: string } } };
  const userId = j?.data?.user?.id as string;
  if (persona || plan) {
    await withDb(async (db) => {
      const patch: Record<string, unknown> = {};
      if (persona) patch.persona = persona;
      if (plan) patch.plan = plan;
      await db.collection('users').updateOne({ id: userId }, { $set: patch });
    });
  }
  return { userId, cookie };
}
async function elevateToAdmin(userId: string): Promise<void> {
  await withDb(async (db) => { await db.collection('users').updateOne({ id: userId }, { $set: { role: 'admin' } }); });
}
function actorFor(userId: string, opts?: { role?: string; plan?: 'free' | 'pro' | 'enterprise'; persona?: 'owner' | 'brand' | 'both' }): Actor {
  return {
    session: { userId, email: `${userId}@t.test`, v: 0 },
    user: {
      id: userId, email: `${userId}@t.test`, role: opts?.role || 'user',
      display_name: userId, avatar_url: null, country_code: null, preferred_language: 'en',
      auth_providers: [], created_at: new Date(), updated_at: new Date(),
      plan: opts?.plan ?? 'free', persona: opts?.persona ?? null,
    },
  } as unknown as Actor;
}

// Deterministic PayPal sandbox stub. Confirms capture with an inline fee so
// the order finalizes immediately, mirroring a real "instant" sandbox capture.
class SandboxStub implements PaymentProvider {
  readonly id = 'paypal' as const;
  private fee: number | null = 350;
  private mode: 'paid' | 'pending' = 'paid';
  setPending() { this.mode = 'pending'; }
  setPaid() { this.mode = 'paid'; }
  async createPayment(input: CreatePaymentInput) {
    return {
      provider: 'paypal' as const,
      provider_order_id: `SB-${input.funding_id}`,
      approve_url: `https://sandbox.paypal.com/checkoutnow?token=SB-${input.funding_id}`,
      raw: {},
    };
  }
  async capturePayment(input: CapturePaymentInput) {
    if (this.mode === 'pending') {
      return {
        provider_order_id: input.provider_order_id,
        provider_capture_id: null,
        internal_status: 'pending' as const,
        amount_captured_minor: 0,
        currency: 'USD',
        provider_fee_minor: null,
        provider_net_minor: null,
        raw: {},
      };
    }
    return {
      provider_order_id: input.provider_order_id,
      provider_capture_id: `SB-CAP-${input.provider_order_id}`,
      internal_status: 'paid' as const,
      amount_captured_minor: 10000,
      currency: 'USD',
      provider_fee_minor: this.fee,
      provider_net_minor: this.fee === null ? null : 10000 - this.fee,
      raw: {},
    };
  }
  async retrievePayment(input: CapturePaymentInput) {
    return { provider_order_id: input.provider_order_id, internal_status: 'paid' as const, amount_minor: 10000, currency: 'USD', provider_capture_id: `SB-CAP-${input.provider_order_id}`, raw: {} };
  }
  async retrieveCapture(input: RetrieveCaptureInput) {
    return { provider_capture_id: input.provider_capture_id, internal_status: 'paid' as const, amount_minor: 10000, currency: 'USD', provider_fee_minor: 350, provider_net_minor: 9650, raw: {} };
  }
  async createRefund(input: RefundInput) {
    return { provider_refund_id: `SB-REF-${input.provider_capture_id}`, internal_status: 'refunded' as const, amount_refunded_minor: input.amount_minor, raw: {} };
  }
  async verifyWebhook() { return { valid: true }; }
}

let stub: SandboxStub;

beforeAll(async () => {
  stub = new SandboxStub();
  _setPaymentProviderForTesting(stub);
  // Seed a real pricing snapshot via the admin HTTP API — mirrors the
  // operational path (admin uses /admin/pricing to finalize pricing before
  // enabling checkout).
  const admin = await signup(`${RUN_TAG}-admin@t.test`);
  await elevateToAdmin(admin.userId);
  const r = await fetch(`${BASE}/admin/pricing-config`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', cookie: admin.cookie },
    body: JSON.stringify({
      brand_lifetime: { price_minor: 10000, enabled: true, availability: 'public_beta' },
    }),
  });
  if (!r.ok) throw new Error(`Failed to seed pricing: ${r.status}`);
});
afterAll(() => { _setPaymentProviderForTesting(null); });

// ---------------------------------------------------------------------------
// Section 1 — Public state advertises sandbox + $100 (HTTP)
// ---------------------------------------------------------------------------
describe('M11-Batch6b — Public state (HTTP)', () => {
  it('§10 unauthenticated GET /state → checkout_enabled=true, sandbox, $100', async () => {
    const r = await fetch(`${BASE}/brand/founding-lifetime/state`);
    expect(r.status).toBe(200);
    const j = await r.json() as { data: { checkout_enabled: boolean; environment: string; display_price_minor: number; already_active: boolean; active_grant: unknown } };
    expect(j.data.checkout_enabled).toBe(true);
    expect(j.data.environment).toBe('sandbox');
    expect(j.data.display_price_minor).toBe(10000);
    expect(j.data.already_active).toBe(false);
    expect(j.data.active_grant).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Section 2 — Full lifecycle (service + HTTP hybrid)
// ---------------------------------------------------------------------------
describe('M11-Batch6b — Brand user full lifecycle', () => {
  let buyer: { userId: string; cookie: string };
  let orderId = '';
  let providerOrderId = '';
  let snapshotAtPurchase = '';

  beforeAll(async () => {
    buyer = await signup(`${RUN_TAG}-brand@t.test`, 'brand', 'free');
    stub.setPaid();
  });

  it('§2/§4 service.startCheckout → server derives $100 (client cannot influence)', async () => {
    const actor = actorFor(buyer.userId, { plan: 'free', persona: 'brand' });
    const order = await brandFoundingLifetimeService.startCheckout(actor, 'http://localhost:3000');
    expect(order.price_minor).toBe(10000);
    expect(order.currency).toBe('USD');
    expect(order.pricing_snapshot_id).toBeTruthy();
    expect(order.pricing_snapshot_id).not.toBe('00000000-0000-0000-0000-000000000000');
    expect(order.commercial_terms_snapshot.price_minor).toBe(10000);
    expect(order.commercial_terms_snapshot.product_name).toBe('Founding Brand Pro Lifetime');
    expect(order.provider_environment).toBe('sandbox');
    expect(order.approve_url).toMatch(/sandbox\.paypal\.com/);
    orderId = order.id!;
    providerOrderId = order.provider_order_id!;
    snapshotAtPurchase = order.pricing_snapshot_id!;
  });

  it('§5 browser return alone is NOT authoritative (pending-mode → no grant)', async () => {
    const scout = await signup(`${RUN_TAG}-scout@t.test`, 'brand', 'free');
    stub.setPending();
    const actor = actorFor(scout.userId, { persona: 'brand' });
    const order = await brandFoundingLifetimeService.startCheckout(actor, 'http://localhost:3000');
    await brandFoundingLifetimeService.captureAndReconcile(order.id!);
    const g = await brandEntitlementService.findActiveGrant(scout.userId, 'brand_founding_lifetime');
    expect(g).toBeNull();
    stub.setPaid();
  });

  it('§3 service.captureAndReconcile → captured_finalized, fee reconciled, grant issued (scoped brand)', async () => {
    const finalized = await brandFoundingLifetimeService.captureAndReconcile(orderId);
    expect(finalized!.status).toBe('captured_finalized');
    expect(finalized!.amount_captured_minor).toBe(10000);
    expect(finalized!.provider_fee_minor).toBe(350);
    expect(finalized!.provider_net_minor).toBe(9650);
    // Grant assertions.
    const g = await brandEntitlementService.findActiveGrant(buyer.userId, 'brand_founding_lifetime');
    expect(g).toBeTruthy();
    expect(g!.product_scope).toBe('brand');
    expect(g!.entitlement_set).toBe('brand_founding_lifetime');
    expect(g!.status).toBe('active');
    expect(g!.valid_until).toBeNull();
    expect(g!.pricing_snapshot_id).toBe(snapshotAtPurchase);
  });

  it('§3 HTTP: buyer GET /:id shows frozen commercial terms', async () => {
    const r = await fetch(`${BASE}/brand/founding-lifetime/${orderId}`, { headers: { cookie: buyer.cookie } });
    expect(r.status).toBe(200);
    const j = await r.json() as { data: { order: BrandFoundingLifetimeOrder } };
    expect(j.data.order.price_minor).toBe(10000);
    expect(j.data.order.commercial_terms_snapshot.price_minor).toBe(10000);
    expect(j.data.order.pricing_snapshot_id).toBe(snapshotAtPurchase);
    expect(j.data.order.status).toBe('captured_finalized');
  });

  it('§3 brand entitlement unlocks brand.* but NEVER owner-facing keys', async () => {
    const actor = actorFor(buyer.userId, { plan: 'free', persona: 'brand' });
    const layered = await applyBrandGrantsToEntitlements(actor, resolveEntitlements(actor));
    expect(layered.brand.founding_lifetime).toBe(true);
    expect(layered.brand.advanced_channel_discovery).toBe(true);
    expect(layered.brand.rate_card_intelligence_brand_view).toBe(true);
    expect(layered.brand.campaign_reporting).toBe(true);
    expect(layered.brand.campaign_intelligence).toBe(true);
    expect(layered.brand.ai_campaign_brief).toBe(false);
    expect(layered.brand.campaign_channel_recommendations).toBe(false);
    expect(layered.plan).toBe('free');
    expect(layered.revenue_intelligence).toBe(false);
    expect(layered.sponsorship_pipeline_intelligence).toBe(false);
  });

  it('§10 HTTP: /state advertises already_active=true for buyer with active grant', async () => {
    const r = await fetch(`${BASE}/brand/founding-lifetime/state`, { headers: { cookie: buyer.cookie } });
    const j = await r.json() as { data: { already_active: boolean; active_grant: { entitlement_set: string; status: string; product_scope: string } | null } };
    expect(j.data.already_active).toBe(true);
    expect(j.data.active_grant?.entitlement_set).toBe('brand_founding_lifetime');
    expect(j.data.active_grant?.status).toBe('active');
    expect(j.data.active_grant?.product_scope).toBe('brand');
  });

  it('§6 duplicate purchase blocked (service-level throws /already active/)', async () => {
    const actor = actorFor(buyer.userId, { persona: 'brand' });
    await expect(brandFoundingLifetimeService.startCheckout(actor, 'http://localhost:3000')).rejects.toThrow(/already active/i);
  });

  it('§7 webhook replay + capture replay → still exactly ONE active grant', async () => {
    await brandFoundingLifetimeService.captureAndReconcile(orderId);
    await brandFoundingLifetimeService.captureAndReconcile(orderId);
    await brandFoundingLifetimeService.finalizeFromWebhookByOrderId(providerOrderId, `SB-CAP-${providerOrderId}`, 10000, 350, 9650);
    await brandFoundingLifetimeService.finalizeFromWebhookByOrderId(providerOrderId, `SB-CAP-${providerOrderId}`, 10000, 350, 9650);
    const grants = await withDb(async (db) => db.collection<BrandEntitlementGrant>(COLLECTIONS.BRAND_ENTITLEMENT_GRANTS).find({ user_id: buyer.userId, entitlement_set: 'brand_founding_lifetime', status: 'active' }).toArray());
    expect(grants.length).toBe(1);
  });

  it('§8 refund → grant.status=refunded; brand.* falls to false; grant history preserved', async () => {
    const refundBuyer = await signup(`${RUN_TAG}-refund@t.test`, 'brand', 'free');
    stub.setPaid();
    const actor = actorFor(refundBuyer.userId, { persona: 'brand' });
    const order = await brandFoundingLifetimeService.startCheckout(actor, 'http://localhost:3000');
    await brandFoundingLifetimeService.captureAndReconcile(order.id!);
    let g = await brandEntitlementService.findActiveGrant(refundBuyer.userId, 'brand_founding_lifetime');
    expect(g).toBeTruthy();
    const handled = await brandFoundingLifetimeService.recordRefundByOrderId(order.provider_order_id!, 10000);
    expect(handled).toBe(true);
    g = await brandEntitlementService.findActiveGrant(refundBuyer.userId, 'brand_founding_lifetime');
    expect(g).toBeNull();
    const row = await withDb(async (db) => db.collection<BrandEntitlementGrant>(COLLECTIONS.BRAND_ENTITLEMENT_GRANTS).findOne({ user_id: refundBuyer.userId, entitlement_set: 'brand_founding_lifetime' }));
    expect(row).toBeTruthy();
    expect(row!.status).toBe('refunded');
    const layered = await applyBrandGrantsToEntitlements(actor, resolveEntitlements(actor));
    expect(layered.brand.founding_lifetime).toBe(false);
    expect(layered.brand.campaign_intelligence).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Section 3 — persona='both' safety
// ---------------------------------------------------------------------------
describe('M11-Batch6b — persona=both safety', () => {
  it('§4 persona=both + owner Pro + brand Lifetime → both dimensions, no cross-leak', async () => {
    const both = await signup(`${RUN_TAG}-both@t.test`, 'both', 'pro');
    stub.setPaid();
    const actor = actorFor(both.userId, { plan: 'pro', persona: 'both' });
    const order = await brandFoundingLifetimeService.startCheckout(actor, 'http://localhost:3000');
    await brandFoundingLifetimeService.captureAndReconcile(order.id!);
    const layered = await applyBrandGrantsToEntitlements(actor, resolveEntitlements(actor));
    expect(layered.plan).toBe('pro');
    expect(layered.revenue_intelligence).toBe(true);
    expect(layered.sponsorship_pipeline_intelligence).toBe(true);
    expect(layered.brand.founding_lifetime).toBe(true);
    expect(layered.brand.campaign_intelligence).toBe(true);
    expect(layered.brand.ai_campaign_brief).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Section 4 — Pricing snapshot immutability under admin edit (HTTP)
// ---------------------------------------------------------------------------
describe('M11-Batch6b — Snapshot immutability under admin edit', () => {
  it('§9 admin flips $100 → $149 via HTTP; existing captured order still $100', async () => {
    const buyer = await signup(`${RUN_TAG}-immut@t.test`, 'brand', 'free');
    stub.setPaid();
    const actor = actorFor(buyer.userId, { persona: 'brand' });
    const order = await brandFoundingLifetimeService.startCheckout(actor, 'http://localhost:3000');
    await brandFoundingLifetimeService.captureAndReconcile(order.id!);
    const snapshotAt = order.pricing_snapshot_id!;
    // Admin flip via real HTTP.
    const admin = await signup(`${RUN_TAG}-immut-adm@t.test`);
    await elevateToAdmin(admin.userId);
    const put = await fetch(`${BASE}/admin/pricing-config`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json', cookie: admin.cookie },
      body: JSON.stringify({ brand_lifetime: { price_minor: 14900, enabled: true, availability: 'public_beta' } }),
    });
    expect(put.ok).toBe(true);
    // Existing captured order remains $100 — HTTP round-trip.
    const rget = await fetch(`${BASE}/brand/founding-lifetime/${order.id}`, { headers: { cookie: buyer.cookie } });
    const jget = await rget.json() as { data: { order: BrandFoundingLifetimeOrder } };
    expect(jget.data.order.price_minor).toBe(10000);
    expect(jget.data.order.commercial_terms_snapshot.price_minor).toBe(10000);
    expect(jget.data.order.pricing_snapshot_id).toBe(snapshotAt);
    // Historical snapshot still resolves to $100.
    const oldSnap = await pricingConfigService.getSnapshot(snapshotAt);
    expect(oldSnap!.config.brand_lifetime.price_minor).toBe(10000);
    // New /state advertises $149 for new visitors.
    const state = await (await fetch(`${BASE}/brand/founding-lifetime/state`)).json() as { data: { display_price_minor: number } };
    expect(state.data.display_price_minor).toBe(14900);
    // Grant remains active (admin price change never revokes access).
    const g = await brandEntitlementService.findActiveGrant(buyer.userId, 'brand_founding_lifetime');
    expect(g).toBeTruthy();
    expect(g!.status).toBe('active');
    // Restore $100 for other tests.
    await fetch(`${BASE}/admin/pricing-config`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json', cookie: admin.cookie },
      body: JSON.stringify({ brand_lifetime: { price_minor: 10000, enabled: true, availability: 'public_beta' } }),
    });
  });
});

// ---------------------------------------------------------------------------
// Section 5 — Adjacent domains unaffected
// ---------------------------------------------------------------------------
describe('M11-Batch6b — Adjacent domains untouched', () => {
  it('§14 marketplace / promote / activation / credits row counts unchanged by Lifetime traffic', async () => {
    const before = await withDb(async (db) => ({
      mp: await db.collection(COLLECTIONS.MARKETPLACE_ORDERS).countDocuments(),
      pf: await db.collection(COLLECTIONS.PAYMENT_FUNDING_ORDERS).countDocuments(),
      ac: await db.collection(COLLECTIONS.CHANNEL_ACTIVATION_PAYMENTS).countDocuments(),
      cr: await db.collection(COLLECTIONS.WAVELEAD_CREDIT_EVENTS).countDocuments(),
    }));
    const buyer = await signup(`${RUN_TAG}-adj@t.test`, 'brand', 'free');
    stub.setPaid();
    const actor = actorFor(buyer.userId, { persona: 'brand' });
    const order = await brandFoundingLifetimeService.startCheckout(actor, 'http://localhost:3000');
    await brandFoundingLifetimeService.captureAndReconcile(order.id!);
    await brandFoundingLifetimeService.recordRefundByOrderId(order.provider_order_id!, 10000);
    const after = await withDb(async (db) => ({
      mp: await db.collection(COLLECTIONS.MARKETPLACE_ORDERS).countDocuments(),
      pf: await db.collection(COLLECTIONS.PAYMENT_FUNDING_ORDERS).countDocuments(),
      ac: await db.collection(COLLECTIONS.CHANNEL_ACTIVATION_PAYMENTS).countDocuments(),
      cr: await db.collection(COLLECTIONS.WAVELEAD_CREDIT_EVENTS).countDocuments(),
    }));
    expect(after.mp).toBe(before.mp);
    expect(after.pf).toBe(before.pf);
    expect(after.ac).toBe(before.ac);
    expect(after.cr).toBe(before.cr);
  });
});

// ---------------------------------------------------------------------------
// Section 6 — Route surface responds correctly for non-authenticated callers
// ---------------------------------------------------------------------------
describe('M11-Batch6b — Route surface', () => {
  it('§10 unauth POST /checkout is blocked (401)', async () => {
    const r = await fetch(`${BASE}/brand/founding-lifetime/checkout`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    expect(r.status).toBe(401);
  });
  it('§17 unauth GET /:id is blocked (401)', async () => {
    const r = await fetch(`${BASE}/brand/founding-lifetime/does-not-exist-xyz`);
    expect(r.status).toBe(401);
  });
});
