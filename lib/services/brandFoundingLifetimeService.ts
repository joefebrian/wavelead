// M11-Batch6 — Founding Brand Pro Lifetime purchase (SANDBOX one-time PayPal).
//
// Domain contract:
//   • Isolated collection `brand_founding_lifetime_orders`. Cannot bleed
//     into Marketplace / Promote / Owner Activation domains.
//   • Server-authoritative economics — price + snapshot are derived from
//     pricingConfigService at insert time and immutably persisted on the
//     order row. Client CANNOT influence price.
//   • LIVE checkout is gated by env flag BRAND_FOUNDING_LIFETIME_CHECKOUT_ENABLED.
//     Default OFF. When OFF, `startCheckout` returns HTTP 503.
//   • Sandbox environment required — refuses to run against a live-configured
//     PayPal integration until an explicit rollout patch enables it.
//   • Grant creation is idempotent (unique idempotency_key on
//     brand_entitlement_grants). Browser return + webhook + retries all
//     coalesce to exactly ONE active Lifetime grant per order.
//   • Duplicate-purchase protection: if the buyer already has an ACTIVE
//     brand_founding_lifetime grant, startCheckout returns HTTP 409.
//   • Refund → order status='refunded', grant status='refunded'. Idempotent
//     under webhook replay.
//   • No creator revenue split. WaveLead retains SaaS revenue.
import { v4 as uuidv4 } from 'uuid';
import { HttpError, requireAuth } from '@/lib/auth/rbac';
import { getCollection } from '@/lib/db/mongo';
import { COLLECTIONS } from '@/lib/db/collections';
import { getPaymentProvider } from '@/lib/services/payments/providerFactory';
import { readActiveEnvironment } from '@/lib/services/payments/paypalConfigService';
import { getConfiguredOrigin } from '@/lib/utils/canonicalOrigin';
import { pricingConfigService } from '@/lib/services/pricingConfigService';
import { brandEntitlementService } from '@/lib/services/brandEntitlementService';
import type {
  Actor,
  BrandFoundingLifetimeOrder,
  BrandFoundingLifetimeOrderStatus,
  BrandFoundingLifetimeCommercialTerms,
} from '@/lib/types';

export const LIFETIME_PURPOSE = 'BRAND_FOUNDING_LIFETIME' as const;
export const LIFETIME_CURRENCY = 'USD' as const;
export const LIFETIME_IDEMPOTENCY_KEY_PREFIX = 'brand_lifetime_grant:';

async function orderCol() {
  return getCollection<BrandFoundingLifetimeOrder>(COLLECTIONS.BRAND_FOUNDING_LIFETIME_ORDERS);
}

// Feature flag read at call time. Default OFF.
export function isLifetimeCheckoutEnabled(): boolean {
  const v = (process.env.BRAND_FOUNDING_LIFETIME_CHECKOUT_ENABLED || '').toLowerCase().trim();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

async function assertSandbox(): Promise<'sandbox' | 'live'> {
  const r = await readActiveEnvironment();
  if (r.environment === 'live') {
    // Guard against accidental LIVE traffic during SANDBOX rollout window.
    throw new HttpError(503, 'Brand Founding Lifetime is not yet enabled on the production PayPal environment.');
  }
  return r.environment;
}

async function transition(
  id: string,
  fromStatuses: BrandFoundingLifetimeOrderStatus[],
  toStatus: BrandFoundingLifetimeOrderStatus,
  patch: Partial<BrandFoundingLifetimeOrder> = {},
): Promise<BrandFoundingLifetimeOrder | null> {
  const c = await orderCol();
  const now = new Date();
  const res = await c.findOneAndUpdate(
    { id, status: { $in: fromStatuses } },
    { $set: { ...patch, status: toStatus, updated_at: now } },
    { returnDocument: 'after' } as { returnDocument: 'after' },
  );
  const doc = ((res as unknown as { value?: BrandFoundingLifetimeOrder }).value ?? (res as unknown as BrandFoundingLifetimeOrder | null));
  return doc || null;
}

// Public projection returned to the buyer. Never exposes internal audit trail.
function toBuyerView(o: BrandFoundingLifetimeOrder) {
  return {
    id: o.id,
    purpose: o.purpose,
    status: o.status,
    provider: o.provider,
    provider_environment: o.provider_environment,
    // provider_order_id is exposed — buyers see it in the PayPal approval URL
    // anyway and downstream services (webhook fan-out, tests) key on it.
    provider_order_id: o.provider_order_id,
    price_minor: o.price_minor,
    currency: o.currency,
    pricing_snapshot_id: o.pricing_snapshot_id,
    commercial_terms_snapshot: o.commercial_terms_snapshot,
    amount_captured_minor: o.amount_captured_minor,
    amount_refunded_minor: o.amount_refunded_minor,
    provider_fee_minor: o.provider_fee_minor,
    provider_net_minor: o.provider_net_minor,
    approve_url: o.approve_url,
    return_url: o.return_url,
    cancel_url: o.cancel_url,
    captured_at: o.captured_at,
    finalized_at: o.finalized_at,
    refunded_at: o.refunded_at,
    created_at: o.created_at,
  };
}

// Try to finalize a captured order — grant creation is idempotent by
// idempotency_key. Called from browser-return capture AND from webhook.
async function tryFinalize(orderId: string): Promise<BrandFoundingLifetimeOrder | null> {
  const c = await orderCol();
  const o = await c.findOne({ id: orderId });
  if (!o) return null;
  if (o.status === 'captured_finalized' || o.status === 'refunded' || o.status === 'partially_refunded') return o;
  if (o.status !== 'captured_pending_fee') return o;
  // For SaaS Lifetime we finalize as soon as the capture is confirmed —
  // fee/net can arrive later without blocking entitlement (no creator credit
  // computation depends on it). We still record fee/net when known.
  const grantKey = `${LIFETIME_IDEMPOTENCY_KEY_PREFIX}${o.id}`;
  await brandEntitlementService.createGrantIdempotent({
    user_id: o.buyer_user_id,
    entitlement_set: 'brand_founding_lifetime',
    source: 'brand_founding_lifetime',
    source_id: o.id,
    pricing_snapshot_id: o.pricing_snapshot_id,
    idempotency_key: grantKey,
    valid_until: null,   // Lifetime — never expires unless refunded/revoked
  });
  const finalized = await transition(orderId, ['captured_pending_fee'], 'captured_finalized', { finalized_at: new Date() });
  return finalized || c.findOne({ id: orderId });
}

export const brandFoundingLifetimeService = {
  isLifetimeCheckoutEnabled,
  LIFETIME_PURPOSE,
  LIFETIME_CURRENCY,

  /**
   * Read-only snapshot for the pricing page / buyer status widget.
   * Never mutates.
   */
  async getBuyerState(actor: Actor | null) {
    const publicPricing = await pricingConfigService.getPublicPricing();
    const lifetimeCfg = publicPricing.brand_lifetime;
    const enabled = isLifetimeCheckoutEnabled() && lifetimeCfg.enabled;
    const env = (await readActiveEnvironment()).environment;
    let activeGrant = null as null | Awaited<ReturnType<typeof brandEntitlementService.findActiveGrant>>;
    if (actor) {
      activeGrant = await brandEntitlementService.findActiveGrant(actor.user.id, 'brand_founding_lifetime');
    }
    return {
      checkout_enabled: enabled,
      lifetime_available: lifetimeCfg.enabled,
      environment: env,
      display_price_minor: lifetimeCfg.price_minor,
      currency: LIFETIME_CURRENCY,
      availability: lifetimeCfg.availability,
      already_active: !!activeGrant,
      active_grant: activeGrant ? brandEntitlementService.toPublicView(activeGrant) : null,
    };
  },

  /**
   * Start a checkout. Server-authoritative — price + snapshot come from
   * pricingConfigService, NEVER from the client.
   *
   * Throws:
   *   • 503 if the LIVE feature flag is off OR the PayPal integration
   *     is configured for live (SANDBOX-only in Batch6).
   *   • 400 if the current pricing config disables brand_lifetime.
   *   • 409 if the buyer already has an active brand_founding_lifetime grant.
   */
  async startCheckout(actor: Actor | null, requestOrigin?: string) {
    requireAuth(actor);
    if (!isLifetimeCheckoutEnabled()) {
      throw new HttpError(503, 'Brand Founding Lifetime checkout is not enabled yet. Reserve your spot with the WaveLead commercial team.');
    }
    const env = await assertSandbox();

    // Duplicate-purchase protection: block a second checkout while a Lifetime
    // grant is already active. Returns a friendly 409.
    const existingActive = await brandEntitlementService.findActiveGrant(actor!.user.id, 'brand_founding_lifetime');
    if (existingActive) {
      throw new HttpError(409, 'Founding Lifetime already active on this account.');
    }

    // Server-derived commercial state. Client cannot supply/override.
    const config = await pricingConfigService.getAdminPricing();
    const lifetimeCfg = config.brand_lifetime;
    if (!lifetimeCfg.enabled) throw new HttpError(400, 'Founding Lifetime is currently disabled.');
    if (lifetimeCfg.price_minor <= 0) throw new HttpError(400, 'Founding Lifetime price is not configured.');
    if (config.snapshot_id === '00000000-0000-0000-0000-000000000000') {
      // No admin has ever written the pricing config — refuse to create a
      // purchase against sentinel defaults. Admin must PUT the config first
      // so a real snapshot exists in history.
      throw new HttpError(409, 'Pricing config has never been finalized by an admin. Please finalize pricing before enabling checkout.');
    }

    // Refuse if the buyer already has a non-terminal open order — avoids
    // accidental double approval on PayPal side.
    const c = await orderCol();
    const openOne = await c.find({
      buyer_user_id: actor!.user.id,
      status: { $in: ['created', 'checkout_created', 'pending', 'captured_pending_fee'] },
    }).limit(1).next();
    if (openOne) return toBuyerView(openOne);

    const id = uuidv4();
    const now = new Date();
    const base = (requestOrigin || getConfiguredOrigin() || 'http://localhost:3000').replace(/\/$/, '');
    const return_url = `${base}/pricing?founding_lifetime=${id}&status=paid`;
    const cancel_url = `${base}/pricing?founding_lifetime=${id}&status=cancelled`;

    const terms: BrandFoundingLifetimeCommercialTerms = {
      price_minor: lifetimeCfg.price_minor,
      currency: LIFETIME_CURRENCY,
      product_name: 'Founding Brand Pro Lifetime',
      availability_at_purchase: lifetimeCfg.availability,
    };

    const doc: BrandFoundingLifetimeOrder = {
      id,
      buyer_user_id: actor!.user.id,
      purpose: LIFETIME_PURPOSE,
      status: 'created',
      price_minor: lifetimeCfg.price_minor,
      currency: LIFETIME_CURRENCY,
      pricing_snapshot_id: config.snapshot_id,
      commercial_terms_snapshot: terms,
      provider: 'paypal',
      provider_environment: env,
      provider_order_id: null,
      provider_capture_id: null,
      provider_fee_minor: null,
      provider_net_minor: null,
      amount_captured_minor: 0,
      amount_refunded_minor: 0,
      approve_url: null,
      return_url, cancel_url,
      captured_at: null, finalized_at: null, refunded_at: null,
      created_at: now, updated_at: now,
    };
    await c.insertOne(doc as unknown as import('mongodb').OptionalUnlessRequiredId<BrandFoundingLifetimeOrder>);

    const provider = getPaymentProvider();
    try {
      const created = await provider.createPayment({
        funding_id: id,
        amount_minor: lifetimeCfg.price_minor,
        currency: LIFETIME_CURRENCY,
        description: `WaveLead — Founding Brand Pro Lifetime (${(lifetimeCfg.price_minor / 100).toFixed(2)} ${LIFETIME_CURRENCY})`,
        return_url, cancel_url,
        metadata: { campaign_id: id, owner_user_id: actor!.user.id },
      });
      const updated = await transition(id, ['created'], 'checkout_created', {
        provider_order_id: created.provider_order_id,
        approve_url: created.approve_url,
      });
      return toBuyerView(updated || (await c.findOne({ id }))!);
    } catch (err) {
      await transition(id, ['created', 'checkout_created', 'pending'], 'failed');
      throw new HttpError(502, `Payment provider error: ${(err as Error).message}`);
    }
  },

  /**
   * Browser-return callback OR internal capture. Advances the order to
   * captured_pending_fee. Grant creation happens in tryFinalize().
   *
   * Browser return is NEVER authoritative — this method calls the provider
   * to actually capture the order, and only proceeds if the provider
   * confirms `paid`.
   *
   * §12C — ATOMIC SAFETY: if a previous run already captured the payment
   * (status='captured_pending_fee', provider_capture_id set) but the grant
   * persistence step failed, this method MUST NOT re-call the provider on
   * retry — that would either double-charge or hit ORDER_ALREADY_CAPTURED.
   * Instead, we advance straight to tryFinalize using the persisted capture
   * record. Grant creation itself is idempotent (unique idempotency_key).
   */
  async captureAndReconcile(orderId: string): Promise<BrandFoundingLifetimeOrder | null> {
    const c = await orderCol();
    const o = await c.findOne({ id: orderId });
    if (!o) throw new HttpError(404, 'Order not found');
    if (o.status === 'captured_finalized' || o.status === 'refunded' || o.status === 'partially_refunded') {
      // Already captured — ensure grant exists (idempotent) and return.
      await tryFinalize(orderId);
      return c.findOne({ id: orderId });
    }
    // §12C — Provider already confirmed capture on a previous attempt.
    // Recovery path: finalize from the persisted capture record without
    // touching the payment provider. Buyer NEVER pays twice.
    if (o.status === 'captured_pending_fee') {
      await tryFinalize(orderId);
      return c.findOne({ id: orderId });
    }
    if (!o.provider_order_id) throw new HttpError(400, 'No provider order id yet');
    const provider = getPaymentProvider();
    const cap = await provider.capturePayment({ provider_order_id: o.provider_order_id });
    if (cap.internal_status !== 'paid') {
      const next: BrandFoundingLifetimeOrderStatus = cap.internal_status === 'failed' ? 'failed'
        : cap.internal_status === 'cancelled' ? 'cancelled' : 'pending';
      await transition(orderId, ['created', 'checkout_created', 'pending'], next, {
        provider_capture_id: cap.provider_capture_id,
        amount_captured_minor: cap.amount_captured_minor,
      });
      return c.findOne({ id: orderId });
    }
    const fee = cap.provider_fee_minor ?? null;
    const net = cap.provider_net_minor ?? (fee === null ? null : Math.max(0, cap.amount_captured_minor - fee));
    await transition(orderId, ['created', 'checkout_created', 'pending'], 'captured_pending_fee', {
      provider_capture_id: cap.provider_capture_id,
      amount_captured_minor: cap.amount_captured_minor,
      provider_fee_minor: fee,
      provider_net_minor: net,
      captured_at: new Date(),
    });
    return tryFinalize(orderId);
  },

  /**
   * §12C — Recovery lookup by provider identifiers. Given a provider_order_id
   * (retrieved from PayPal / an inbound webhook / an admin recovery UI) this
   * returns the existing order — enabling reconciliation without a second
   * charge.
   */
  async recoverByProviderOrderId(providerOrderId: string): Promise<BrandFoundingLifetimeOrder | null> {
    const c = await orderCol();
    const o = await c.findOne({ provider: 'paypal', provider_order_id: providerOrderId });
    if (!o) return null;
    // If capture already succeeded on the provider but our finalize failed,
    // advance the order to captured_finalized idempotently.
    if (o.status === 'captured_pending_fee') {
      await tryFinalize(o.id);
      return c.findOne({ id: o.id });
    }
    return o;
  },

  /**
   * Webhook-driven finalize (called from /payments/paypal/webhook dispatch).
   * Idempotent — safe under duplicate deliveries.
   */
  async finalizeFromWebhookByOrderId(providerOrderId: string, providerCaptureId: string, amount_minor: number, fee_minor: number | null, net_minor: number | null): Promise<boolean> {
    const c = await orderCol();
    const o = await c.findOne({ provider_order_id: providerOrderId });
    if (!o) return false;   // not our order — let the caller fall through to other domains
    // Terminal? Just ensure the grant exists.
    if (o.status === 'captured_finalized' || o.status === 'refunded') {
      await tryFinalize(o.id);
      return true;
    }
    await c.updateOne(
      { id: o.id, status: { $in: ['created', 'checkout_created', 'pending', 'captured_pending_fee'] } },
      { $set: {
        status: 'captured_pending_fee',
        provider_capture_id: providerCaptureId,
        amount_captured_minor: amount_minor,
        provider_fee_minor: fee_minor ?? o.provider_fee_minor,
        provider_net_minor: net_minor ?? o.provider_net_minor,
        captured_at: o.captured_at || new Date(),
        updated_at: new Date(),
      } },
    );
    await tryFinalize(o.id);
    return true;
  },

  /**
   * Refund path. Full refund → order='refunded', grant='refunded'.
   * Partial refund of a $100 one-time still revokes the grant (SaaS
   * subscription semantics don't apply — buyer either has Lifetime or not).
   * Idempotent under duplicate webhooks.
   */
  async recordRefundByOrderId(providerOrderId: string, refund_amount_minor: number): Promise<boolean> {
    const c = await orderCol();
    const o = await c.findOne({ provider_order_id: providerOrderId });
    if (!o) return false;
    if (o.status === 'refunded') {
      // Still ensure grant is revoked in case of previous partial write.
      const g = await brandEntitlementService.findActiveGrant(o.buyer_user_id, 'brand_founding_lifetime');
      if (g) await brandEntitlementService.setStatus(g.id, 'refunded');
      return true;
    }
    const newRefunded = o.amount_refunded_minor + refund_amount_minor;
    const nextStatus: BrandFoundingLifetimeOrderStatus = newRefunded >= o.amount_captured_minor ? 'refunded' : 'partially_refunded';
    await c.updateOne({ id: o.id }, {
      $set: { amount_refunded_minor: newRefunded, status: nextStatus, refunded_at: new Date(), updated_at: new Date() },
    });
    // Revoke the Lifetime grant — buyer no longer has the entitlement.
    const grantKey = `${LIFETIME_IDEMPOTENCY_KEY_PREFIX}${o.id}`;
    const grantCol = await getCollection<import('@/lib/types').BrandEntitlementGrant>(COLLECTIONS.BRAND_ENTITLEMENT_GRANTS);
    const g = await grantCol.findOne({ idempotency_key: grantKey });
    if (g && g.status === 'active') {
      await brandEntitlementService.setStatus(g.id, 'refunded');
    }
    return true;
  },

  async findByProviderOrderId(providerOrderId: string): Promise<BrandFoundingLifetimeOrder | null> {
    const c = await orderCol();
    return c.findOne({ provider_order_id: providerOrderId });
  },

  async getForBuyer(actor: Actor | null, orderId: string) {
    requireAuth(actor);
    const c = await orderCol();
    const o = await c.findOne({ id: orderId });
    if (!o) throw new HttpError(404, 'Order not found');
    if (o.buyer_user_id !== actor!.user.id) throw new HttpError(403, 'Not your order');
    return toBuyerView(o);
  },

  toBuyerView,
};
