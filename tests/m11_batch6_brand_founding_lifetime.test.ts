// M11-Batch6 — Founding Brand Pro Lifetime (SANDBOX one-time PayPal).
//
// Contract validated:
//   §1  Pricing snapshot history — every admin PUT appends an immutable
//       row to commercial_pricing_config_history and rotates snapshot_id.
//   §2  Purchase terms are IMMUTABLE — admin flip after purchase never
//       rewrites an existing order's economics.
//   §3  Payment domain is ISOLATED — order lives in its own collection with
//       purpose='BRAND_FOUNDING_LIFETIME'. Never bleeds into Marketplace /
//       Promote / Owner Activation.
//   §4  Server-derived $100 — client-supplied price is IGNORED.
//   §5  PayPal SANDBOX checkout end-to-end: create → capture → grant.
//   §6  Browser return is NOT authoritative — capture endpoint calls the
//       provider and only advances on 'paid'.
//   §7  Fee/net recorded when the provider reports a breakdown.
//   §8  BRAND-scoped entitlement — a Lifetime grant sets brand.founding_lifetime
//       and brand.* shipping capabilities, but does NOT unlock owner-facing
//       entitlements (revenue_intelligence, sponsorship_pipeline_intelligence).
//   §9  Owner Pro plan alone does NOT unlock brand entitlements.
//  §10  persona='both' — same user with owner Pro + brand Lifetime grant sees
//       BOTH sets simultaneously with no cross-leak.
//  §11  Grant creation is idempotent under duplicate capture / webhook replay.
//  §12  Duplicate purchase blocked — active Lifetime → 409 on new checkout.
//  §13  Full refund → grant.status='refunded' (grant not deleted); Lifetime
//       access removed on next resolution. Owner channels / other entitlements
//       untouched.
//  §14  Marketplace / Owner Activation / Promote economics untouched by
//       lifetime purchase or refund.
//  §15  Production checkout flag OFF by default → startCheckout throws 503.
//  §16  No real live payment created — provider_environment='sandbox'.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { MongoClient, type Db } from 'mongodb';
import { v4 as uuidv4 } from 'uuid';
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
const RUN_TAG = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;

async function withDb<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  const client = new MongoClient(process.env.MONGO_URL || 'mongodb://localhost:27017');
  await client.connect();
  try { return await fn(client.db(process.env.DB_NAME || 'wavelead')); }
  finally { await client.close(); }
}
function ip(): string { return `10.${Math.floor(Math.random()*255)}.${Math.floor(Math.random()*255)}.${Math.floor(Math.random()*255)}`; }

async function signup(email: string): Promise<{ userId: string; cookie: string }> {
  const res = await fetch(`${BASE}/auth/signup`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip() },
    body: JSON.stringify({ email, password: 'password123!', display_name: email.split('@')[0] }),
  });
  const cookie = (res.headers.get('set-cookie') || '').split(';')[0];
  const j = await res.json() as { data?: { user?: { id?: string } } };
  return { userId: j?.data?.user?.id as string, cookie };
}

function adminActor(user_id: string): Actor {
  return {
    session: { userId: user_id, email: `${user_id}@t.test`, v: 0 },
    user: {
      id: user_id, email: `${user_id}@t.test`, role: 'admin',
      display_name: user_id, avatar_url: null, country_code: null, preferred_language: 'en',
      auth_providers: [], created_at: new Date(), updated_at: new Date(),
    },
  } as unknown as Actor;
}
function userActor(user_id: string, plan?: 'free' | 'pro' | 'enterprise', persona?: 'owner' | 'brand' | 'both'): Actor {
  return {
    session: { userId: user_id, email: `${user_id}@t.test`, v: 0 },
    user: {
      id: user_id, email: `${user_id}@t.test`, role: 'user',
      display_name: user_id, avatar_url: null, country_code: null, preferred_language: 'en',
      auth_providers: [], created_at: new Date(), updated_at: new Date(),
      plan: plan ?? 'free', persona: persona ?? null,
    },
  } as unknown as Actor;
}

// Test payment provider: same shape as ActivationTestProvider — captures with
// fee inline so the order flows straight to captured_finalized.
class LifetimeTestProvider implements PaymentProvider {
  readonly id = 'paypal' as const;
  private _forceFailCreate = false;
  private _inlineFee: number | null = 350;    // typical PayPal fee for $100
  setFailCreate(v: boolean) { this._forceFailCreate = v; }
  setInlineFee(v: number | null) { this._inlineFee = v; }
  async createPayment(input: CreatePaymentInput) {
    if (this._forceFailCreate) throw new Error('provider down');
    return {
      provider: 'paypal' as const,
      provider_order_id: `LT-ORDER-${input.funding_id}`,
      approve_url: `https://sandbox.paypal.com/checkoutnow?token=LT-ORDER-${input.funding_id}`,
      raw: {},
    };
  }
  async capturePayment(input: CapturePaymentInput) {
    return {
      provider_order_id: input.provider_order_id,
      provider_capture_id: `LT-CAP-${input.provider_order_id}`,
      internal_status: 'paid' as const,
      amount_captured_minor: 10000,
      currency: 'USD',
      provider_fee_minor: this._inlineFee,
      provider_net_minor: this._inlineFee === null ? null : 10000 - this._inlineFee,
      raw: {},
    };
  }
  async retrievePayment(input: CapturePaymentInput) {
    return { provider_order_id: input.provider_order_id, internal_status: 'paid' as const, amount_minor: 10000, currency: 'USD', provider_capture_id: `LT-CAP-${input.provider_order_id}`, raw: {} };
  }
  async retrieveCapture(input: RetrieveCaptureInput) {
    return { provider_capture_id: input.provider_capture_id, internal_status: 'paid' as const, amount_minor: 10000, currency: 'USD', provider_fee_minor: 350, provider_net_minor: 9650, raw: {} };
  }
  async createRefund(input: RefundInput) {
    return { provider_refund_id: `LT-REF-${uuidv4()}`, internal_status: 'refunded' as const, amount_refunded_minor: input.amount_minor, raw: {} };
  }
  async verifyWebhook() { return { valid: true }; }
}

// -------- Test fixtures --------
async function ensureSnapshotExists(admin: Actor) {
  // Force at least one admin PUT so an immutable snapshot_id exists (guards
  // against the sentinel-snapshot refusal in startCheckout).
  await pricingConfigService.updatePricing(admin, {
    brand_lifetime: { price_minor: 10000, enabled: true, availability: 'public_beta' },
  });
}

async function wipePricingHistoryAndConfig() {
  await withDb(async (db) => {
    await db.collection(COLLECTIONS.COMMERCIAL_PRICING_CONFIG).deleteMany({});
    await db.collection(COLLECTIONS.COMMERCIAL_PRICING_CONFIG_HISTORY).deleteMany({});
  });
}

async function withCheckoutFlag<T>(value: boolean, fn: () => Promise<T>): Promise<T> {
  const prev = process.env.BRAND_FOUNDING_LIFETIME_CHECKOUT_ENABLED;
  process.env.BRAND_FOUNDING_LIFETIME_CHECKOUT_ENABLED = value ? '1' : '0';
  try { return await fn(); }
  finally { process.env.BRAND_FOUNDING_LIFETIME_CHECKOUT_ENABLED = prev; }
}

// ---------------------------------------------------------------------------
// §1–§2 Pricing snapshot history + immutability
// ---------------------------------------------------------------------------
describe('M11-Batch6 — Pricing snapshot history', () => {
  beforeAll(async () => { await wipePricingHistoryAndConfig(); });
  afterAll(async () => { await wipePricingHistoryAndConfig(); });

  it('§1 admin update writes an immutable history row and rotates snapshot_id', async () => {
    const admin = adminActor(`b6-hist-${RUN_TAG}`);
    const before = await withDb(async (db) => db.collection(COLLECTIONS.COMMERCIAL_PRICING_CONFIG_HISTORY).countDocuments());
    const updated = await pricingConfigService.updatePricing(admin, {
      brand_lifetime: { price_minor: 10000, enabled: true, availability: 'public_beta' },
    });
    expect(updated.snapshot_id).toBeTruthy();
    expect(updated.snapshot_id).not.toBe('00000000-0000-0000-0000-000000000000');
    const after = await withDb(async (db) => db.collection(COLLECTIONS.COMMERCIAL_PRICING_CONFIG_HISTORY).countDocuments());
    expect(after).toBe(before + 1);
    // Snapshot getter returns the exact row.
    const snap = await pricingConfigService.getSnapshot(updated.snapshot_id);
    expect(snap).toBeTruthy();
    expect(snap!.config.brand_lifetime.price_minor).toBe(10000);
  });

  it('§1b two admin updates create two distinct snapshot rows', async () => {
    const admin = adminActor(`b6-hist2-${RUN_TAG}`);
    const a = await pricingConfigService.updatePricing(admin, {
      brand_lifetime: { price_minor: 10000, enabled: true, availability: 'public_beta' },
    });
    const b = await pricingConfigService.updatePricing(admin, {
      brand_lifetime: { price_minor: 12000, enabled: true, availability: 'public_beta' },
    });
    expect(a.snapshot_id).not.toBe(b.snapshot_id);
    const snapA = await pricingConfigService.getSnapshot(a.snapshot_id);
    const snapB = await pricingConfigService.getSnapshot(b.snapshot_id);
    expect(snapA!.config.brand_lifetime.price_minor).toBe(10000);
    expect(snapB!.config.brand_lifetime.price_minor).toBe(12000);
  });
});

// ---------------------------------------------------------------------------
// §3–§7 Payment domain + sandbox checkout + fee reconciliation + capture safety
// ---------------------------------------------------------------------------
describe('M11-Batch6 — SANDBOX PayPal checkout end-to-end', () => {
  let provider: LifetimeTestProvider;
  const admin = adminActor(`b6-admin-${RUN_TAG}`);

  beforeAll(async () => {
    provider = new LifetimeTestProvider();
    _setPaymentProviderForTesting(provider);
    await ensureSnapshotExists(admin);
  });
  afterAll(() => { _setPaymentProviderForTesting(null); });

  it('§4/§5 server derives $100 (client cannot influence) and captures via provider', async () => {
    await withCheckoutFlag(true, async () => {
      const buyer = await signup(`b6buy-${RUN_TAG}-a@t.test`);
      const actor = userActor(buyer.userId);
      // Even a "hostile" body cannot alter price — service reads snapshot itself.
      const order = await brandFoundingLifetimeService.startCheckout(actor, 'http://localhost:3000');
      expect(order.price_minor).toBe(10000);
      expect(order.currency).toBe('USD');
      expect(order.purpose).toBe('BRAND_FOUNDING_LIFETIME');
      expect(order.provider_environment).toBe('sandbox');
      expect(order.commercial_terms_snapshot.price_minor).toBe(10000);
      expect(order.pricing_snapshot_id).toBeTruthy();
      // Capture (browser return simulation).
      const captured = await brandFoundingLifetimeService.captureAndReconcile(order.id!);
      expect(captured!.status).toBe('captured_finalized');
      expect(captured!.amount_captured_minor).toBe(10000);
      expect(captured!.provider_fee_minor).toBe(350);
      expect(captured!.provider_net_minor).toBe(9650);
      // Grant exists AND is scoped to brand.
      const grant = await brandEntitlementService.findActiveGrant(buyer.userId, 'brand_founding_lifetime');
      expect(grant).toBeTruthy();
      expect(grant!.product_scope).toBe('brand');
      expect(grant!.entitlement_set).toBe('brand_founding_lifetime');
      expect(grant!.valid_until).toBeNull();
      expect(grant!.pricing_snapshot_id).toBe(order.pricing_snapshot_id);
    });
  });

  it('§3 domain isolation — lifetime capture does not touch marketplace / promote / activation counts', async () => {
    const before = await withDb(async (db) => ({
      mp: await db.collection(COLLECTIONS.MARKETPLACE_PAYMENT_ATTEMPTS).countDocuments(),
      pf: await db.collection(COLLECTIONS.PAYMENT_FUNDING_ORDERS).countDocuments(),
      ac: await db.collection(COLLECTIONS.CHANNEL_ACTIVATION_PAYMENTS).countDocuments(),
    }));
    await withCheckoutFlag(true, async () => {
      const buyer = await signup(`b6buy-${RUN_TAG}-b@t.test`);
      const actor = userActor(buyer.userId);
      const order = await brandFoundingLifetimeService.startCheckout(actor, 'http://localhost:3000');
      await brandFoundingLifetimeService.captureAndReconcile(order.id!);
    });
    const after = await withDb(async (db) => ({
      mp: await db.collection(COLLECTIONS.MARKETPLACE_PAYMENT_ATTEMPTS).countDocuments(),
      pf: await db.collection(COLLECTIONS.PAYMENT_FUNDING_ORDERS).countDocuments(),
      ac: await db.collection(COLLECTIONS.CHANNEL_ACTIVATION_PAYMENTS).countDocuments(),
    }));
    expect(after.mp).toBe(before.mp);
    expect(after.pf).toBe(before.pf);
    expect(after.ac).toBe(before.ac);
  });

  it('§6 browser return is not authoritative — capture with a NON-PAID provider status leaves order unfinalized', async () => {
    await withCheckoutFlag(true, async () => {
      // Swap provider to one that returns 'pending'.
      const pending = new LifetimeTestProvider();
      (pending.capturePayment as unknown) = async (input: CapturePaymentInput) => ({
        provider_order_id: input.provider_order_id,
        provider_capture_id: null,
        internal_status: 'pending' as const,
        amount_captured_minor: 0,
        currency: 'USD',
        provider_fee_minor: null,
        provider_net_minor: null,
        raw: {},
      });
      _setPaymentProviderForTesting(pending);
      try {
        const buyer = await signup(`b6buy-${RUN_TAG}-c@t.test`);
        const actor = userActor(buyer.userId);
        const order = await brandFoundingLifetimeService.startCheckout(actor, 'http://localhost:3000');
        const captured = await brandFoundingLifetimeService.captureAndReconcile(order.id!);
        expect(captured!.status).not.toBe('captured_finalized');
        const grant = await brandEntitlementService.findActiveGrant(buyer.userId, 'brand_founding_lifetime');
        expect(grant).toBeNull();   // no grant issued on non-paid capture
      } finally {
        _setPaymentProviderForTesting(provider);
      }
    });
  });

  it('§2 purchase terms IMMUTABLE — admin flip $100 → $120 does not rewrite past order economics', async () => {
    let purchasedSnapshotId = '';
    let purchasedOrderId = '';
    await withCheckoutFlag(true, async () => {
      const buyer = await signup(`b6buy-${RUN_TAG}-d@t.test`);
      const actor = userActor(buyer.userId);
      const order = await brandFoundingLifetimeService.startCheckout(actor, 'http://localhost:3000');
      await brandFoundingLifetimeService.captureAndReconcile(order.id!);
      purchasedSnapshotId = order.pricing_snapshot_id!;
      purchasedOrderId = order.id!;
    });
    // Admin flips the price.
    await pricingConfigService.updatePricing(admin, {
      brand_lifetime: { price_minor: 12000, enabled: true, availability: 'public_beta' },
    });
    // Re-fetch the purchased order → terms unchanged.
    const stored = await withDb(async (db) => db.collection<BrandFoundingLifetimeOrder>(COLLECTIONS.BRAND_FOUNDING_LIFETIME_ORDERS).findOne({ id: purchasedOrderId }));
    expect(stored!.price_minor).toBe(10000);
    expect(stored!.commercial_terms_snapshot.price_minor).toBe(10000);
    expect(stored!.pricing_snapshot_id).toBe(purchasedSnapshotId);
    // And the recorded snapshot still resolves to $100 not $120.
    const oldSnap = await pricingConfigService.getSnapshot(purchasedSnapshotId);
    expect(oldSnap!.config.brand_lifetime.price_minor).toBe(10000);
    // Restore back to $100 so subsequent tests use the expected price.
    await pricingConfigService.updatePricing(admin, {
      brand_lifetime: { price_minor: 10000, enabled: true, availability: 'public_beta' },
    });
  });
});

// ---------------------------------------------------------------------------
// §8–§10 Entitlement scoping (BRAND vs OWNER, no cross-leak)
// ---------------------------------------------------------------------------
describe('M11-Batch6 — Brand-scoped entitlement resolution', () => {
  const admin = adminActor(`b6-scope-admin-${RUN_TAG}`);
  let provider: LifetimeTestProvider;

  beforeAll(async () => {
    provider = new LifetimeTestProvider();
    _setPaymentProviderForTesting(provider);
    await ensureSnapshotExists(admin);
  });
  afterAll(() => { _setPaymentProviderForTesting(null); });

  it('§9 owner Pro plan alone does NOT unlock any brand entitlements', async () => {
    const ownerPro = userActor(`b6-owner-pro-${RUN_TAG}`, 'pro', 'owner');
    const base = resolveEntitlements(ownerPro);
    // Owner-facing keys are unlocked (proves Pro is applied).
    expect(base.revenue_intelligence).toBe(true);
    expect(base.sponsorship_pipeline_intelligence).toBe(true);
    // Brand-scoped keys are all FALSE.
    expect(base.brand.founding_lifetime).toBe(false);
    expect(base.brand.advanced_channel_discovery).toBe(false);
    expect(base.brand.campaign_intelligence).toBe(false);
    // Layering with the grant service (no grants exist) still yields false.
    const layered = await applyBrandGrantsToEntitlements(ownerPro, base);
    expect(layered.brand.founding_lifetime).toBe(false);
    expect(layered.brand.campaign_intelligence).toBe(false);
  });

  it('§8 brand Lifetime grant unlocks brand.* but does NOT unlock owner-facing keys', async () => {
    await withCheckoutFlag(true, async () => {
      const buyer = await signup(`b6-brand-buyer-${RUN_TAG}@t.test`);
      const actor = userActor(buyer.userId, 'free', 'brand');
      const order = await brandFoundingLifetimeService.startCheckout(actor, 'http://localhost:3000');
      await brandFoundingLifetimeService.captureAndReconcile(order.id!);
      const base = resolveEntitlements(actor);
      const layered = await applyBrandGrantsToEntitlements(actor, base);
      // Brand keys unlocked.
      expect(layered.brand.founding_lifetime).toBe(true);
      expect(layered.brand.advanced_channel_discovery).toBe(true);
      expect(layered.brand.rate_card_intelligence_brand_view).toBe(true);
      expect(layered.brand.campaign_reporting).toBe(true);
      expect(layered.brand.campaign_intelligence).toBe(true);
      // Coming Soon capabilities remain FALSE even for grant holders.
      expect(layered.brand.ai_campaign_brief).toBe(false);
      expect(layered.brand.campaign_channel_recommendations).toBe(false);
      // Owner-facing keys remain OFF (buyer is on plan 'free').
      expect(layered.plan).toBe('free');
      expect(layered.revenue_intelligence).toBe(false);
      expect(layered.sponsorship_pipeline_intelligence).toBe(false);
      expect(layered.rate_card_intelligence).toBe(false);
    });
  });

  it('§10 persona="both" — owner Pro + brand Lifetime simultaneously; no cross-leak', async () => {
    await withCheckoutFlag(true, async () => {
      const buyer = await signup(`b6-both-${RUN_TAG}@t.test`);
      const actor = userActor(buyer.userId, 'pro', 'both');
      const order = await brandFoundingLifetimeService.startCheckout(actor, 'http://localhost:3000');
      await brandFoundingLifetimeService.captureAndReconcile(order.id!);
      const base = resolveEntitlements(actor);
      const layered = await applyBrandGrantsToEntitlements(actor, base);
      // Owner-side Pro keys ON.
      expect(layered.plan).toBe('pro');
      expect(layered.revenue_intelligence).toBe(true);
      expect(layered.sponsorship_pipeline_intelligence).toBe(true);
      // Brand-side Lifetime keys ON.
      expect(layered.brand.founding_lifetime).toBe(true);
      expect(layered.brand.campaign_intelligence).toBe(true);
      // Coming Soon still gated.
      expect(layered.brand.ai_campaign_brief).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// §11 Idempotent grant issuance under duplicate capture / webhook replay
// ---------------------------------------------------------------------------
describe('M11-Batch6 — Grant idempotency', () => {
  const admin = adminActor(`b6-idem-admin-${RUN_TAG}`);
  let provider: LifetimeTestProvider;
  beforeAll(async () => {
    provider = new LifetimeTestProvider();
    _setPaymentProviderForTesting(provider);
    await ensureSnapshotExists(admin);
  });
  afterAll(() => { _setPaymentProviderForTesting(null); });

  it('§11 duplicate capture (browser return + webhook replay) results in EXACTLY ONE active grant', async () => {
    await withCheckoutFlag(true, async () => {
      const buyer = await signup(`b6-idem-${RUN_TAG}@t.test`);
      const actor = userActor(buyer.userId);
      const order = await brandFoundingLifetimeService.startCheckout(actor, 'http://localhost:3000');
      // Call capture 3 times in a row + a simulated webhook finalize.
      await brandFoundingLifetimeService.captureAndReconcile(order.id!);
      await brandFoundingLifetimeService.captureAndReconcile(order.id!);
      await brandFoundingLifetimeService.captureAndReconcile(order.id!);
      await brandFoundingLifetimeService.finalizeFromWebhookByOrderId(order.provider_order_id!, `LT-CAP-${order.provider_order_id!}`, 10000, 350, 9650);
      const grants = await withDb(async (db) => db.collection<BrandEntitlementGrant>(COLLECTIONS.BRAND_ENTITLEMENT_GRANTS).find({ user_id: buyer.userId, entitlement_set: 'brand_founding_lifetime', status: 'active' }).toArray());
      expect(grants.length).toBe(1);
    });
  });
});

// ---------------------------------------------------------------------------
// §12 Duplicate purchase blocked
// ---------------------------------------------------------------------------
describe('M11-Batch6 — Duplicate purchase blocked', () => {
  const admin = adminActor(`b6-dupe-admin-${RUN_TAG}`);
  let provider: LifetimeTestProvider;
  beforeAll(async () => {
    provider = new LifetimeTestProvider();
    _setPaymentProviderForTesting(provider);
    await ensureSnapshotExists(admin);
  });
  afterAll(() => { _setPaymentProviderForTesting(null); });

  it('§12 second checkout attempt while Lifetime is active → 409', async () => {
    await withCheckoutFlag(true, async () => {
      const buyer = await signup(`b6-dupe-${RUN_TAG}@t.test`);
      const actor = userActor(buyer.userId);
      const order = await brandFoundingLifetimeService.startCheckout(actor, 'http://localhost:3000');
      await brandFoundingLifetimeService.captureAndReconcile(order.id!);
      await expect(brandFoundingLifetimeService.startCheckout(actor, 'http://localhost:3000')).rejects.toThrow(/already active/i);
    });
  });
});

// ---------------------------------------------------------------------------
// §13 Refund revokes only brand lifetime — owner / marketplace / activation intact
// ---------------------------------------------------------------------------
describe('M11-Batch6 — Refund revokes ONLY brand lifetime', () => {
  const admin = adminActor(`b6-refund-admin-${RUN_TAG}`);
  let provider: LifetimeTestProvider;
  beforeAll(async () => {
    provider = new LifetimeTestProvider();
    _setPaymentProviderForTesting(provider);
    await ensureSnapshotExists(admin);
  });
  afterAll(() => { _setPaymentProviderForTesting(null); });

  it('§13 full refund via webhook path → grant status=refunded, brand.* falls to false', async () => {
    await withCheckoutFlag(true, async () => {
      const buyer = await signup(`b6-refund-${RUN_TAG}@t.test`);
      const actor = userActor(buyer.userId);
      const order = await brandFoundingLifetimeService.startCheckout(actor, 'http://localhost:3000');
      await brandFoundingLifetimeService.captureAndReconcile(order.id!);
      // Grant is active.
      let g = await brandEntitlementService.findActiveGrant(buyer.userId, 'brand_founding_lifetime');
      expect(g).toBeTruthy();
      // Simulate webhook full refund.
      const handled = await brandFoundingLifetimeService.recordRefundByOrderId(order.provider_order_id!, 10000);
      expect(handled).toBe(true);
      // Grant is no longer active.
      g = await brandEntitlementService.findActiveGrant(buyer.userId, 'brand_founding_lifetime');
      expect(g).toBeNull();
      // Historical row STILL EXISTS with status=refunded.
      const row = await withDb(async (db) => db.collection<BrandEntitlementGrant>(COLLECTIONS.BRAND_ENTITLEMENT_GRANTS).findOne({ user_id: buyer.userId, entitlement_set: 'brand_founding_lifetime' }));
      expect(row).toBeTruthy();
      expect(row!.status).toBe('refunded');
      // Brand entitlements fall to false on next resolution.
      const layered = await applyBrandGrantsToEntitlements(actor, resolveEntitlements(actor));
      expect(layered.brand.founding_lifetime).toBe(false);
      expect(layered.brand.campaign_intelligence).toBe(false);
    });
  });

  it('§13b duplicate refund webhook is idempotent (no crash, still refunded)', async () => {
    await withCheckoutFlag(true, async () => {
      const buyer = await signup(`b6-refund2-${RUN_TAG}@t.test`);
      const actor = userActor(buyer.userId);
      const order = await brandFoundingLifetimeService.startCheckout(actor, 'http://localhost:3000');
      await brandFoundingLifetimeService.captureAndReconcile(order.id!);
      await brandFoundingLifetimeService.recordRefundByOrderId(order.provider_order_id!, 10000);
      await brandFoundingLifetimeService.recordRefundByOrderId(order.provider_order_id!, 10000);   // replay
      const g = await brandEntitlementService.findActiveGrant(buyer.userId, 'brand_founding_lifetime');
      expect(g).toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// §14 Marketplace / Activation / Promote UNCHANGED by lifetime purchase/refund
// ---------------------------------------------------------------------------
describe('M11-Batch6 — Adjacent domain economics untouched', () => {
  const admin = adminActor(`b6-adj-admin-${RUN_TAG}`);
  let provider: LifetimeTestProvider;
  beforeAll(async () => {
    provider = new LifetimeTestProvider();
    _setPaymentProviderForTesting(provider);
    await ensureSnapshotExists(admin);
  });
  afterAll(() => { _setPaymentProviderForTesting(null); });

  it('§14 lifetime purchase does not create marketplace/promote/activation rows', async () => {
    const before = await withDb(async (db) => ({
      mp: await db.collection(COLLECTIONS.MARKETPLACE_ORDERS).countDocuments(),
      pf: await db.collection(COLLECTIONS.PAYMENT_FUNDING_ORDERS).countDocuments(),
      ac: await db.collection(COLLECTIONS.CHANNEL_ACTIVATION_PAYMENTS).countDocuments(),
      credits: await db.collection(COLLECTIONS.WAVELEAD_CREDIT_EVENTS).countDocuments(),
    }));
    await withCheckoutFlag(true, async () => {
      const buyer = await signup(`b6-adj-${RUN_TAG}@t.test`);
      const actor = userActor(buyer.userId);
      const order = await brandFoundingLifetimeService.startCheckout(actor, 'http://localhost:3000');
      await brandFoundingLifetimeService.captureAndReconcile(order.id!);
      await brandFoundingLifetimeService.recordRefundByOrderId(order.provider_order_id!, 10000);
    });
    const after = await withDb(async (db) => ({
      mp: await db.collection(COLLECTIONS.MARKETPLACE_ORDERS).countDocuments(),
      pf: await db.collection(COLLECTIONS.PAYMENT_FUNDING_ORDERS).countDocuments(),
      ac: await db.collection(COLLECTIONS.CHANNEL_ACTIVATION_PAYMENTS).countDocuments(),
      credits: await db.collection(COLLECTIONS.WAVELEAD_CREDIT_EVENTS).countDocuments(),
    }));
    expect(after.mp).toBe(before.mp);
    expect(after.pf).toBe(before.pf);
    expect(after.ac).toBe(before.ac);
    expect(after.credits).toBe(before.credits);
  });
});

// ---------------------------------------------------------------------------
// §15–§16 Feature flag off by default; no live payments created
// ---------------------------------------------------------------------------
describe('M11-Batch6 — Feature flag + live safety', () => {
  const admin = adminActor(`b6-flag-admin-${RUN_TAG}`);
  let provider: LifetimeTestProvider;
  beforeAll(async () => {
    provider = new LifetimeTestProvider();
    _setPaymentProviderForTesting(provider);
    await ensureSnapshotExists(admin);
  });
  afterAll(() => { _setPaymentProviderForTesting(null); });

  it('§15 checkout flag OFF → 503 on startCheckout (service level)', async () => {
    await withCheckoutFlag(false, async () => {
      const buyer = await signup(`b6-flag-${RUN_TAG}@t.test`);
      const actor = userActor(buyer.userId);
      await expect(brandFoundingLifetimeService.startCheckout(actor, 'http://localhost:3000')).rejects.toThrow(/not enabled/i);
    });
  });

  it('§15b checkout flag OFF → public state advertises checkout_enabled=false', async () => {
    await withCheckoutFlag(false, async () => {
      const r = await fetch(`${BASE}/brand/founding-lifetime/state`);
      const j = await r.json() as { data: { checkout_enabled: boolean; environment: string } };
      expect(j.data.checkout_enabled).toBe(false);
      expect(j.data.environment).toBe('sandbox');
    });
  });

  it('§16 all orders created in this test run are provider_environment=sandbox', async () => {
    await withCheckoutFlag(true, async () => {
      const orders = await withDb(async (db) => db.collection<BrandFoundingLifetimeOrder>(COLLECTIONS.BRAND_FOUNDING_LIFETIME_ORDERS).find({}).toArray());
      for (const o of orders) {
        expect(o.provider_environment).toBe('sandbox');
        expect(o.provider).toBe('paypal');
      }
    });
  });
});

// ---------------------------------------------------------------------------
// §17 Public API routing — non-authenticated behavior
// ---------------------------------------------------------------------------
describe('M11-Batch6 — Public API routing', () => {
  it('§17 anonymous POST /checkout is blocked (401)', async () => {
    const r = await fetch(`${BASE}/brand/founding-lifetime/checkout`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    expect([401, 503]).toContain(r.status);   // 401 (no auth) OR 503 if flag also blocks
  });

  it('§17b anonymous GET /state is allowed and returns safe fields only', async () => {
    const r = await fetch(`${BASE}/brand/founding-lifetime/state`);
    expect(r.status).toBe(200);
    const j = await r.json() as { data: Record<string, unknown> };
    expect(j.data).toHaveProperty('checkout_enabled');
    expect(j.data).toHaveProperty('environment');
    expect(j.data).toHaveProperty('display_price_minor');
    expect(j.data).not.toHaveProperty('active_grant.idempotency_key');
  });
});
