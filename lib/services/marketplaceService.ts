// Phase B1 — Sponsorship Marketplace Service.
//
// PURITY OF THIS MILESTONE:
//   * NO PayPal integration for marketplace orders. Payment is manual/off-platform.
//   * NO automated payout. Owner Payable stays at `payable_pending_delivery`.
//   * NO reuse of Promote funding orders, PayPal funding order records, or
//     sponsorship_leads for order tracking.
//   * Server-authoritative: never trust owner_id / price / status / commission
//     from any browser payload.
//   * Integer money. `owner_share_bps = 9000`, `platform_share_bps = 1000`.
//   * UNKNOWN gateway fee ≠ ZERO gateway fee — see gateway-fee safety block.
//
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { HttpError, hasAtLeastRole, ROLES } from '../auth/rbac';
import { channelRepo } from '../repositories/channelRepo';
import {
  channelRateCardRepo,
  marketplaceFinancialEventRepo,
  marketplaceOrderRepo,
  marketplaceOwnerPayoutRepo,
  marketplacePaymentAttemptRepo,
} from '../repositories/marketplaceRepo';
import { computeSplit, OWNER_SHARE_BPS, PLATFORM_SHARE_BPS, assertSafeMoney } from '../utils/marketplaceMoney';
import { getConfiguredOrigin } from '../utils/canonicalOrigin';
import type {
  Actor,
  Channel,
  ChannelRateCard,
  IntegrationEnvironment,
  MarketplaceOrder,
  MarketplaceOrderStatus,
  MarketplaceOwnerPayout,
  MarketplacePackageType,
  MarketplacePaymentAttempt,
  MarketplacePaymentAttemptStatus,
  MarketplacePaymentMethod,
  OwnerPayableStatus,
  RateCardPackage,
} from '@/lib/types';
import { MARKETPLACE_PACKAGE_TYPES, MARKETPLACE_PAYMENT_METHODS } from '@/lib/types';

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const packageSchema = z.object({
  type: z.enum(MARKETPLACE_PACKAGE_TYPES as readonly [string, ...string[]]),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().min(1).max(4_000),
  price_minor: z.number().int().min(0).max(1_000_000_00).nullable(),
  currency: z.literal('USD').default('USD'),
  deliverables: z.array(z.string().trim().min(1).max(200)).min(0).max(20).default([]),
  estimated_delivery_days: z.number().int().min(1).max(365).nullable().optional(),
  is_active: z.boolean().default(true),
});

export const packageUpsertSchema = packageSchema.superRefine((v, ctx) => {
  if (v.type === 'custom_quote') {
    if (v.price_minor !== null) ctx.addIssue({ code: 'custom', path: ['price_minor'], message: 'custom_quote must have price_minor=null' });
  } else {
    if (v.price_minor === null || v.price_minor <= 0) ctx.addIssue({ code: 'custom', path: ['price_minor'], message: 'price_minor must be a positive integer for fixed-price packages' });
  }
});

export const rateCardReplaceSchema = z.object({
  packages: z.array(packageUpsertSchema).max(20),
});

export const brandBookingSchema = z.object({
  channel_id: z.string().min(1),
  package_id: z.string().min(1),
  company_name: z.string().trim().min(1).max(200),
  contact_name: z.string().trim().min(1).max(120),
  contact_email: z.string().trim().toLowerCase().email().max(200),
  campaign_objective: z.string().trim().min(1).max(500),
  brief: z.string().trim().min(1).max(4_000),
  target_start_date: z.string().datetime().optional().nullable(),
  target_end_date: z.string().datetime().optional().nullable(),
  product_url: z.string().trim().url().max(500).optional().nullable(),
  notes: z.string().trim().max(2_000).optional().nullable(),
});

export const ownerRejectSchema = z.object({
  reason: z.string().trim().min(1).max(500).optional(),
});

export const adminConfirmPaymentSchema = z.object({
  payment_method: z.enum(MARKETPLACE_PAYMENT_METHODS as readonly [string, ...string[]]),
  payment_reference: z.string().trim().min(3).max(200),
  amount_received_minor: z.number().int().min(1).max(1_000_000_00),
  currency: z.literal('USD'),
  payment_received_at: z.string().datetime(),
  // gateway_fee_minor: null = UNKNOWN, 0 = KNOWN-ZERO, >0 = KNOWN-POSITIVE.
  gateway_fee_minor: z.number().int().min(0).max(1_000_000_00).nullable(),
  notes: z.string().trim().max(2_000).optional().nullable(),
});

export const adminReconcileFeeSchema = z.object({
  gateway_fee_minor: z.number().int().min(0).max(1_000_000_00),
  notes: z.string().trim().max(2_000).optional().nullable(),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function requireVerifiedOwnerOfChannel(actor: Actor | null, channelId: string): Promise<Channel> {
  if (!actor) throw new HttpError(401, 'You must be signed in');
  const channel = await channelRepo.findById(channelId);
  if (!channel) throw new HttpError(404, 'Channel not found');
  if (channel.owner_id !== actor.user.id) throw new HttpError(403, 'You are not the owner of this channel');
  const vs = (channel as unknown as { verification_status?: string }).verification_status;
  if (vs !== 'verified' && vs !== 'official') {
    throw new HttpError(403, 'Only verified channels may publish a sellable rate card');
  }
  return channel;
}

function requireAdmin(actor: Actor | null) {
  if (!actor) throw new HttpError(401, 'Unauthorized');
  if (!hasAtLeastRole(actor.user, ROLES.ADMIN)) throw new HttpError(403, 'Admin privileges required');
}

function normalizePaymentReference(ref: string): string {
  return ref.trim().toLowerCase().replace(/\s+/g, '');
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export const marketplaceService = {
  // -------- Rate Card (owner) --------
  async getMyRateCard(actor: Actor | null, channelId: string): Promise<ChannelRateCard | null> {
    await requireVerifiedOwnerOfChannel(actor, channelId);
    return channelRateCardRepo.findByChannel(channelId);
  },

  async replaceRateCard(actor: Actor | null, channelId: string, input: unknown): Promise<ChannelRateCard> {
    const channel = await requireVerifiedOwnerOfChannel(actor, channelId);
    const parsed = rateCardReplaceSchema.safeParse(input);
    if (!parsed.success) throw new HttpError(400, `Invalid input: ${parsed.error.issues[0]?.message}`);
    const now = new Date();
    const existing = await channelRateCardRepo.findByChannel(channelId);
    // Preserve package IDs across edits where the same-typed same-name package
    // is retained; assign new IDs otherwise.
    const oldById = new Map((existing?.packages || []).map((p) => [p.id, p]));
    const packages: RateCardPackage[] = parsed.data.packages.map((p) => {
      const same = existing?.packages.find((op) => op.type === p.type && op.name === p.name);
      const id = same?.id || uuidv4();
      const prior = same ? oldById.get(same.id) : undefined;
      return {
        id,
        type: p.type as MarketplacePackageType,
        name: p.name,
        description: p.description,
        price_minor: p.price_minor,
        currency: 'USD',
        deliverables: p.deliverables,
        estimated_delivery_days: p.estimated_delivery_days ?? null,
        is_active: p.is_active,
        created_at: prior?.created_at || now,
        updated_at: now,
      };
    });
    const card: ChannelRateCard = {
      id: existing?.id || uuidv4(),
      channel_id: channel.id,
      owner_user_id: actor!.user.id,
      packages,
      created_at: existing?.created_at || now,
      updated_at: now,
    };
    return channelRateCardRepo.upsert(card);
  },

  // -------- Public rate card --------
  /** Publicly-visible rate card slice: only ACTIVE fixed-price packages. */
  async getPublicRateCard(channelId: string): Promise<{ packages: Array<Pick<RateCardPackage, 'id' | 'type' | 'name' | 'description' | 'price_minor' | 'currency' | 'deliverables' | 'estimated_delivery_days'>>; has_custom_quote: boolean } | null> {
    const ch = await channelRepo.findById(channelId);
    if (!ch) return null;
    const vs = (ch as unknown as { verification_status?: string }).verification_status;
    if (vs !== 'verified' && vs !== 'official') return null;
    const card = await channelRateCardRepo.findByChannel(channelId);
    if (!card) return null;
    const active = card.packages.filter((p) => p.is_active);
    const fixed = active.filter((p) => p.type !== 'custom_quote' && p.price_minor !== null);
    const has_custom_quote = active.some((p) => p.type === 'custom_quote');
    if (fixed.length === 0 && !has_custom_quote) return null;
    return {
      packages: fixed.map((p) => ({
        id: p.id, type: p.type, name: p.name, description: p.description,
        price_minor: p.price_minor, currency: p.currency, deliverables: p.deliverables,
        estimated_delivery_days: p.estimated_delivery_days,
      })),
      has_custom_quote,
    };
  },

  // -------- Brand booking --------
  // Fixed-price marketplace bookings REQUIRE an authenticated buyer.
  // buyer_user_id is derived exclusively from the authenticated session;
  // any client-supplied buyer_user_id in the payload is ignored (Zod schema
  // does not include it, so it never reaches this method).
  async submitBooking(actor: Actor | null, input: unknown): Promise<MarketplaceOrder> {
    if (!actor) throw new HttpError(401, 'You must be signed in to book a sponsorship');
    const parsed = brandBookingSchema.safeParse(input);
    if (!parsed.success) throw new HttpError(400, `Invalid input: ${parsed.error.issues[0]?.message}`);
    const d = parsed.data;

    // ── Server-side price + ownership authority (client-supplied price is ignored) ──
    const channel = await channelRepo.findById(d.channel_id);
    if (!channel) throw new HttpError(404, 'Channel not found');
    const vs = (channel as unknown as { verification_status?: string }).verification_status;
    if (vs !== 'verified' && vs !== 'official') throw new HttpError(400, 'This channel is not verified for sponsorship marketplace');
    if (!channel.owner_id) throw new HttpError(400, 'This channel is not owned by a verified user');

    const card = await channelRateCardRepo.findByChannel(d.channel_id);
    if (!card) throw new HttpError(404, 'This channel has no active rate card');
    const pkg = card.packages.find((p) => p.id === d.package_id);
    if (!pkg) throw new HttpError(404, 'Package not found on this channel rate card');
    if (!pkg.is_active) throw new HttpError(400, 'This package is not currently active');
    if (pkg.type === 'custom_quote') {
      throw new HttpError(400, 'custom_quote packages must use the sales-assisted sponsorship-lead flow, not marketplace booking');
    }

    const now = new Date();
    const order: MarketplaceOrder = {
      id: uuidv4(),
      status: 'requested',
      economics_status: 'pre_acceptance',
      buyer_user_id: actor.user.id,   // server-derived; never trusted from payload
      brief: {
        company_name: d.company_name,
        contact_name: d.contact_name,
        contact_email: d.contact_email,
        campaign_objective: d.campaign_objective,
        brief: d.brief,
        target_start_date: d.target_start_date ? new Date(d.target_start_date) : null,
        target_end_date: d.target_end_date ? new Date(d.target_end_date) : null,
        product_url: d.product_url ?? null,
        notes: d.notes ?? null,
      },
      channel_id: channel.id,
      channel_slug: channel.slug,
      owner_user_id: channel.owner_id,
      package_id: pkg.id,
      package_type: pkg.type,
      quoted_price_minor: pkg.price_minor,          // authoritative server-derived value
      currency: 'USD',
      snapshot: null,
      payment_method: null,
      payment_reference_normalized: null,
      payment_reference_display: null,
      payment_received_at: null,
      amount_received_minor: null,
      gateway_fee_minor: null,
      net_transaction_value_minor: null,
      owner_earnings_minor: null,
      wavelead_commission_minor: null,
      owner_payable_status: 'not_applicable',
      rejection_reason: null,
      cancelled_reason: null,
      created_at: now, updated_at: now,
      accepted_at: null, rejected_at: null, paid_at: null, cancelled_at: null,
      // B2 delivery lifecycle fields — null until the order transitions past `paid`.
      started_at: null, started_by: null,
      delivery_notes: null, delivery_urls: [],
      submitted_at: null, submitted_by: null, proof_description: null,
      completed_at: null, completed_by: null, completion_source: null, completion_note: null,
      paid_out_at: null, payout_id: null,
    };
    return marketplaceOrderRepo.insert(order);
  },

  // -------- Owner list / accept / reject --------
  async listMyOwnerOrders(actor: Actor | null, status?: MarketplaceOrderStatus): Promise<MarketplaceOrder[]> {
    if (!actor) throw new HttpError(401, 'You must be signed in');
    return marketplaceOrderRepo.listByOwner(actor.user.id, status);
  },

  async listMyBuyerOrders(actor: Actor | null): Promise<MarketplaceOrder[]> {
    if (!actor) throw new HttpError(401, 'You must be signed in');
    return marketplaceOrderRepo.listByBuyer(actor.user.id);
  },

  async ownerAcceptOrder(actor: Actor | null, orderId: string): Promise<MarketplaceOrder> {
    if (!actor) throw new HttpError(401, 'You must be signed in');
    const order = await marketplaceOrderRepo.findById(orderId);
    if (!order) throw new HttpError(404, 'Order not found');
    if (order.owner_user_id !== actor.user.id) throw new HttpError(403, 'Only the selling channel owner can accept this order');
    if (order.status !== 'requested') throw new HttpError(400, `Order is in status "${order.status}" — cannot accept`);

    // Re-verify current channel + rate-card + package (owner may have removed the channel or the package).
    const channel = await channelRepo.findById(order.channel_id);
    if (!channel || channel.owner_id !== actor.user.id) throw new HttpError(403, 'You no longer own this channel');
    const card = await channelRateCardRepo.findByChannel(order.channel_id);
    if (!card) throw new HttpError(400, 'Rate card no longer exists');
    const pkg = card.packages.find((p) => p.id === order.package_id);
    if (!pkg) throw new HttpError(400, 'Package no longer exists on the rate card');
    if (!pkg.is_active || pkg.type === 'custom_quote' || pkg.price_minor === null) {
      throw new HttpError(400, 'Package is no longer sellable at a fixed price');
    }
    if (pkg.price_minor <= 0) throw new HttpError(400, 'Invalid package price');

    const now = new Date();
    const patch: Partial<MarketplaceOrder> = {
      status: 'awaiting_payment',
      economics_status: 'accepted_awaiting_payment',
      snapshot: {
        channel_id: channel.id,
        channel_name: channel.name,
        channel_slug: channel.slug,
        owner_user_id: actor.user.id,
        package_id: pkg.id,
        package_type: pkg.type,
        package_name: pkg.name,
        package_description: pkg.description,
        deliverables: pkg.deliverables,
        estimated_delivery_days: pkg.estimated_delivery_days,
        gross_price_minor: pkg.price_minor,       // snapshot the price NOW
        currency: 'USD',
        owner_share_bps: OWNER_SHARE_BPS,
        platform_share_bps: PLATFORM_SHARE_BPS,
        accepted_at: now,
        accepted_by: actor.user.id,
      },
      accepted_at: now,
    };
    const updated = await marketplaceOrderRepo.update(orderId, patch);
    await marketplaceFinancialEventRepo.append({
      order_id: orderId,
      event_type: 'ORDER_ACCEPTED',
      currency: 'USD',
      gross_amount_minor: pkg.price_minor,
      gateway_fee_minor: null,
      net_amount_minor: null,
      owner_earnings_minor: null,
      wavelead_commission_minor: null,
      payment_reference_normalized: null,
      actor_user_id: actor.user.id,
      metadata: { package_id: pkg.id, package_type: pkg.type },
    });
    return updated;
  },

  async ownerRejectOrder(actor: Actor | null, orderId: string, input: unknown): Promise<MarketplaceOrder> {
    if (!actor) throw new HttpError(401, 'You must be signed in');
    const parsed = ownerRejectSchema.safeParse(input);
    if (!parsed.success) throw new HttpError(400, `Invalid input: ${parsed.error.issues[0]?.message}`);
    const order = await marketplaceOrderRepo.findById(orderId);
    if (!order) throw new HttpError(404, 'Order not found');
    if (order.owner_user_id !== actor.user.id) throw new HttpError(403, 'Only the selling channel owner can reject this order');
    if (order.status !== 'requested') throw new HttpError(400, `Order is in status "${order.status}" — cannot reject`);
    const now = new Date();
    return marketplaceOrderRepo.update(orderId, {
      status: 'owner_rejected',
      rejected_at: now,
      rejection_reason: parsed.data.reason ?? null,
    });
  },

  // -------- Admin: manual payment confirmation --------
  async adminConfirmPayment(actor: Actor | null, orderId: string, input: unknown): Promise<MarketplaceOrder> {
    requireAdmin(actor);
    const parsed = adminConfirmPaymentSchema.safeParse(input);
    if (!parsed.success) throw new HttpError(400, `Invalid input: ${parsed.error.issues[0]?.message}`);
    const d = parsed.data;

    const order = await marketplaceOrderRepo.findById(orderId);
    if (!order) throw new HttpError(404, 'Order not found');
    if (!order.snapshot) throw new HttpError(400, 'Order economics snapshot missing (not accepted?)');
    if (order.status !== 'awaiting_payment' && order.status !== 'paid') {
      throw new HttpError(400, `Order is in status "${order.status}" — cannot confirm payment`);
    }
    if (d.amount_received_minor !== order.snapshot.gross_price_minor) {
      throw new HttpError(400, `amount_received_minor (${d.amount_received_minor}) must equal snapshot gross_price_minor (${order.snapshot.gross_price_minor})`);
    }

    // B3 — a verified PayPal capture already exists on this order → block
    // manual double-accounting. Admin must reconcile out-of-band (never
    // silently apply a second economic confirmation).
    const paypalCaptured = (await marketplacePaymentAttemptRepo.listByOrder(orderId)).some((a) => a.status === 'captured');
    if (paypalCaptured && order.payment_source === 'paypal') {
      throw new HttpError(409, 'This order has already been paid via PayPal — cannot record a second manual payment');
    }

    const normalized = normalizePaymentReference(d.payment_reference);

    // (a) Same-order idempotency: if this exact (order, payment_reference) already has a
    // PAYMENT_CONFIRMED event, return the current order unchanged. The unique
    // partial index on the events collection also guards against races.
    const priorEvents = await marketplaceFinancialEventRepo.listByOrder(orderId);
    const prior = priorEvents.find((e) => e.event_type === 'PAYMENT_CONFIRMED' && e.payment_reference_normalized === normalized);
    if (prior) {
      return order; // idempotent no-op
    }
    if (order.payment_reference_normalized && order.payment_reference_normalized !== normalized) {
      throw new HttpError(409, 'This order already has a different payment reference recorded');
    }

    // (b) B1.1.2 — cross-order payment-reference reuse block. A single real-world
    // payment identifier (method + normalized ref) must never be applied to two
    // different marketplace orders. Return 409 without leaking any details
    // beyond the fact that this identifier is already allocated.
    const existingElsewhere = await marketplaceOrderRepo.findByPaymentIdentity(d.payment_method, normalized);
    if (existingElsewhere && existingElsewhere.id !== orderId) {
      throw new HttpError(409, 'This payment reference is already allocated to another order');
    }

    const gross = order.snapshot.gross_price_minor;
    const fee = d.gateway_fee_minor;

    let patch: Partial<MarketplaceOrder>;
    if (fee === null) {
      // UNKNOWN fee → provisional economics; owner payable BLOCKED.
      patch = {
        status: 'paid',
        economics_status: 'pending_fee_reconciliation',
        payment_method: d.payment_method as MarketplacePaymentMethod,
        payment_source: 'manual',
        payment_reference_normalized: normalized,
        payment_reference_display: d.payment_reference,
        payment_received_at: new Date(d.payment_received_at),
        amount_received_minor: d.amount_received_minor,
        gateway_fee_minor: null,
        net_transaction_value_minor: null,
        owner_earnings_minor: null,
        wavelead_commission_minor: null,
        owner_payable_status: 'blocked_fee_reconciliation',
        paid_at: new Date(),
      };
    } else {
      const split = computeSplit(gross, fee);
      patch = {
        status: 'paid',
        economics_status: 'finalized',
        payment_method: d.payment_method as MarketplacePaymentMethod,
        payment_source: 'manual',
        payment_reference_normalized: normalized,
        payment_reference_display: d.payment_reference,
        payment_received_at: new Date(d.payment_received_at),
        amount_received_minor: d.amount_received_minor,
        gateway_fee_minor: fee,
        net_transaction_value_minor: split.net_minor,
        owner_earnings_minor: split.owner_earnings_minor,
        wavelead_commission_minor: split.wavelead_commission_minor,
        owner_payable_status: 'payable_pending_delivery',
        paid_at: new Date(),
      };
    }
    let updated: MarketplaceOrder;
    try {
      updated = await marketplaceOrderRepo.update(orderId, patch);
    } catch (e) {
      // Defense-in-depth: partial unique index on
      // (payment_method, payment_reference_normalized) catches a race with a
      // concurrent confirmation on a different order.
      if (/E11000|duplicate key/i.test((e as Error).message)) {
        throw new HttpError(409, 'This payment reference is already allocated to another order');
      }
      throw e;
    }

    try {
      await marketplaceFinancialEventRepo.append({
        order_id: orderId,
        event_type: 'PAYMENT_CONFIRMED',
        currency: 'USD',
        gross_amount_minor: gross,
        gateway_fee_minor: fee,
        net_amount_minor: patch.net_transaction_value_minor ?? null,
        owner_earnings_minor: patch.owner_earnings_minor ?? null,
        wavelead_commission_minor: patch.wavelead_commission_minor ?? null,
        payment_reference_normalized: normalized,
        actor_user_id: actor!.user.id,
        metadata: { payment_method: d.payment_method, notes_present: !!d.notes },
      });
    } catch (e) {
      // Race with the partial unique index — safe to treat as idempotent success.
      if (!/E11000|duplicate key/i.test((e as Error).message)) throw e;
    }
    return updated;
  },

  async adminReconcileFee(actor: Actor | null, orderId: string, input: unknown): Promise<MarketplaceOrder> {
    requireAdmin(actor);
    const parsed = adminReconcileFeeSchema.safeParse(input);
    if (!parsed.success) throw new HttpError(400, `Invalid input: ${parsed.error.issues[0]?.message}`);
    const order = await marketplaceOrderRepo.findById(orderId);
    if (!order) throw new HttpError(404, 'Order not found');
    if (order.status !== 'paid') throw new HttpError(400, 'Order is not paid yet');
    if (order.economics_status === 'finalized') throw new HttpError(400, 'Order economics are already finalized');
    if (!order.snapshot) throw new HttpError(400, 'Order snapshot missing');

    const fee = parsed.data.gateway_fee_minor;
    const split = computeSplit(order.snapshot.gross_price_minor, fee);

    const updated = await marketplaceOrderRepo.update(orderId, {
      economics_status: 'finalized',
      gateway_fee_minor: fee,
      net_transaction_value_minor: split.net_minor,
      owner_earnings_minor: split.owner_earnings_minor,
      wavelead_commission_minor: split.wavelead_commission_minor,
      owner_payable_status: 'payable_pending_delivery',
    });

    await marketplaceFinancialEventRepo.append({
      order_id: orderId,
      event_type: 'GATEWAY_FEE_RECONCILED',
      currency: 'USD',
      gross_amount_minor: order.snapshot.gross_price_minor,
      gateway_fee_minor: fee,
      net_amount_minor: split.net_minor,
      owner_earnings_minor: split.owner_earnings_minor,
      wavelead_commission_minor: split.wavelead_commission_minor,
      payment_reference_normalized: order.payment_reference_normalized,
      actor_user_id: actor!.user.id,
      metadata: { notes_present: !!parsed.data.notes },
    });
    return updated;
  },

  // -------- Admin --------
  async listOrdersAdmin(actor: Actor | null, filter: { status?: MarketplaceOrderStatus } = {}): Promise<MarketplaceOrder[]> {
    requireAdmin(actor);
    return marketplaceOrderRepo.listAdmin(filter);
  },

  async adminKpis(actor: Actor | null): Promise<{
    orders_total: number;
    awaiting_payment: number;
    paid: number;
    gross_gmv_minor: number;
    finalized_net_minor: number;
    finalized_owner_earnings_minor: number;
    finalized_commission_minor: number;
    pending_fee_reconciliation: number;
  }> {
    requireAdmin(actor);
    const all = await marketplaceOrderRepo.listAdmin({});
    let gross = 0, finalized_net = 0, finalized_owner = 0, finalized_com = 0;
    let awaiting = 0, paid = 0, pending_fee = 0;
    for (const o of all) {
      if (o.status === 'awaiting_payment') awaiting++;
      if (o.status === 'paid') paid++;
      if (o.snapshot) gross += o.snapshot.gross_price_minor;
      if (o.economics_status === 'finalized') {
        finalized_net += o.net_transaction_value_minor || 0;
        finalized_owner += o.owner_earnings_minor || 0;
        finalized_com += o.wavelead_commission_minor || 0;
      }
      if (o.economics_status === 'pending_fee_reconciliation') pending_fee++;
    }
    return {
      orders_total: all.length,
      awaiting_payment: awaiting,
      paid,
      gross_gmv_minor: gross,
      finalized_net_minor: finalized_net,
      finalized_owner_earnings_minor: finalized_owner,
      finalized_commission_minor: finalized_com,
      pending_fee_reconciliation: pending_fee,
    };
  },

  // ============================================================================
  // Phase B2 — Delivery lifecycle + owner payout
  // ============================================================================

  /**
   * B2 — owner starts fulfillment. paid → in_progress.
   * Requires order.status==='paid', economics_status==='finalized',
   * owner_payable_status==='payable_pending_delivery'.
   */
  async startWork(actor: Actor | null, orderId: string): Promise<MarketplaceOrder> {
    if (!actor) throw new HttpError(401, 'You must be signed in');
    const order = await marketplaceOrderRepo.findById(orderId);
    if (!order) throw new HttpError(404, 'Order not found');
    if (order.owner_user_id !== actor.user.id) throw new HttpError(403, 'Only the channel owner may start work');
    // B3.1 — a refund/reversal or double-payment must block normal fulfillment.
    if (order.payment_reconciliation_required) {
      throw new HttpError(409, 'Cannot start work: payment reconciliation required for this order');
    }
    if (order.status !== 'paid') throw new HttpError(400, `Cannot start work: order status is '${order.status}', not 'paid'`);
    if (order.economics_status !== 'finalized') throw new HttpError(400, 'Cannot start work: order economics are not finalized (gateway fee may be unknown)');
    if (order.owner_payable_status !== 'payable_pending_delivery') throw new HttpError(400, `Cannot start work: owner payable status is '${order.owner_payable_status}'`);
    return marketplaceOrderRepo.update(orderId, {
      status: 'in_progress',
      started_at: new Date(),
      started_by: actor.user.id,
    });
  },

  /**
   * B2 — owner submits fulfillment. in_progress → submitted_for_review.
   * URL safety: only http:// and https:// are accepted. javascript:/data:/file:
   * and any other schemes are rejected. Server DOES NOT fetch these URLs.
   */
  async submitDelivery(actor: Actor | null, orderId: string, input: unknown): Promise<MarketplaceOrder> {
    if (!actor) throw new HttpError(401, 'You must be signed in');
    const schema = z.object({
      delivery_notes: z.string().trim().min(1).max(4000),
      delivery_urls: z.array(z.string().trim().min(1).max(2048)).min(0).max(10).default([]),
      proof_description: z.string().trim().max(2000).optional().nullable(),
    });
    const parsed = schema.safeParse(input);
    if (!parsed.success) throw new HttpError(400, `Invalid input: ${parsed.error.issues[0]?.message}`);
    const d = parsed.data;

    // Validate URLs — http/https only, well-formed.
    const cleanUrls: string[] = [];
    for (const u of d.delivery_urls) {
      let parsedUrl: URL;
      try { parsedUrl = new URL(u); }
      catch { throw new HttpError(400, `Delivery URL is not a valid URL: ${u.slice(0, 80)}`); }
      const proto = parsedUrl.protocol.toLowerCase();
      if (proto !== 'http:' && proto !== 'https:') {
        throw new HttpError(400, `Delivery URL protocol is not allowed: ${proto} (only http/https)`);
      }
      cleanUrls.push(parsedUrl.toString());
    }

    const order = await marketplaceOrderRepo.findById(orderId);
    if (!order) throw new HttpError(404, 'Order not found');
    if (order.owner_user_id !== actor.user.id) throw new HttpError(403, 'Only the channel owner may submit delivery');
    // B3.1 — refund/reversal/double-payment must block delivery progression.
    if (order.payment_reconciliation_required) {
      throw new HttpError(409, 'Cannot submit delivery: payment reconciliation required for this order');
    }
    if (order.status !== 'in_progress') throw new HttpError(400, `Cannot submit delivery: order status is '${order.status}', not 'in_progress'`);

    return marketplaceOrderRepo.update(orderId, {
      status: 'submitted_for_review',
      owner_payable_status: 'submitted_for_review',
      delivery_notes: d.delivery_notes,
      delivery_urls: cleanUrls,
      proof_description: d.proof_description || null,
      submitted_at: new Date(),
      submitted_by: actor.user.id,
    });
  },

  /**
   * B2 — buyer accepts delivery. submitted_for_review → completed.
   * Only order.buyer_user_id may accept.
   */
  async buyerAcceptDelivery(actor: Actor | null, orderId: string): Promise<MarketplaceOrder> {
    if (!actor) throw new HttpError(401, 'You must be signed in');
    const order = await marketplaceOrderRepo.findById(orderId);
    if (!order) throw new HttpError(404, 'Order not found');
    if (!order.buyer_user_id || order.buyer_user_id !== actor.user.id) {
      throw new HttpError(403, 'Only the buyer of this sponsorship may accept delivery');
    }
    if (order.status !== 'submitted_for_review') throw new HttpError(400, `Cannot accept: order status is '${order.status}', not 'submitted_for_review'`);
    return this._finalizeCompletion(order, {
      completed_by: actor.user.id,
      completion_source: 'buyer',
      completion_note: null,
    });
  },

  /**
   * B2 — admin/super_admin completion override. Requires a note.
   * Records completion_source='admin' explicitly — never masquerades as buyer.
   */
  async adminCompleteOrder(actor: Actor | null, orderId: string, input: unknown): Promise<MarketplaceOrder> {
    requireAdmin(actor);
    const schema = z.object({ completion_note: z.string().trim().min(3).max(1000) });
    const parsed = schema.safeParse(input);
    if (!parsed.success) throw new HttpError(400, 'completion_note is required (3–1000 chars)');
    const order = await marketplaceOrderRepo.findById(orderId);
    if (!order) throw new HttpError(404, 'Order not found');
    if (order.status !== 'submitted_for_review' && order.status !== 'in_progress') {
      throw new HttpError(400, `Cannot admin-complete: order status is '${order.status}'`);
    }
    return this._finalizeCompletion(order, {
      completed_by: actor!.user.id,
      completion_source: 'admin',
      completion_note: parsed.data.completion_note,
    });
  },

  /**
   * Internal — shared completion path: writes completed_* fields, computes
   * payout eligibility, appends DELIVERY_COMPLETED + OWNER_PAYABLE_ELIGIBLE
   * financial events. Called by buyer accept and admin override.
   */
  async _finalizeCompletion(
    order: MarketplaceOrder,
    who: { completed_by: string; completion_source: 'buyer' | 'admin'; completion_note: string | null },
  ): Promise<MarketplaceOrder> {
    const now = new Date();
    const nextPayable = deriveOwnerPayableAfterCompletion(order);
    const updated = await marketplaceOrderRepo.update(order.id, {
      status: 'completed',
      completed_at: now,
      completed_by: who.completed_by,
      completion_source: who.completion_source,
      completion_note: who.completion_note,
      owner_payable_status: nextPayable,
    });
    // Append financial events (append-only). Do not mutate.
    await marketplaceFinancialEventRepo.append({
      order_id: order.id,
      event_type: 'DELIVERY_COMPLETED',
      currency: 'USD',
      gross_amount_minor: order.snapshot?.gross_price_minor ?? null,
      gateway_fee_minor: order.gateway_fee_minor,
      net_amount_minor: order.net_transaction_value_minor,
      owner_earnings_minor: order.owner_earnings_minor,
      wavelead_commission_minor: order.wavelead_commission_minor,
      payment_reference_normalized: order.payment_reference_normalized,
      actor_user_id: who.completed_by,
      metadata: { completion_source: who.completion_source },
    });
    if (nextPayable === 'eligible_for_payout') {
      await marketplaceFinancialEventRepo.append({
        order_id: order.id,
        event_type: 'OWNER_PAYABLE_ELIGIBLE',
        currency: 'USD',
        gross_amount_minor: order.snapshot?.gross_price_minor ?? null,
        gateway_fee_minor: order.gateway_fee_minor,
        net_amount_minor: order.net_transaction_value_minor,
        owner_earnings_minor: order.owner_earnings_minor,
        wavelead_commission_minor: order.wavelead_commission_minor,
        payment_reference_normalized: order.payment_reference_normalized,
        actor_user_id: who.completed_by,
        metadata: {},
      });
    }
    return updated;
  },

  /**
   * B2 — admin records a manual owner payout. V1 full payout only.
   * Amount is server-derived from order.owner_earnings_minor.
   * Only admin/super_admin may call. Requires owner_payable_status==='eligible_for_payout'.
   */
  async adminRecordPayout(actor: Actor | null, orderId: string, input: unknown): Promise<{ order: MarketplaceOrder; payout: MarketplaceOwnerPayout }> {
    requireAdmin(actor);
    const schema = z.object({
      payout_method: z.enum(MARKETPLACE_PAYMENT_METHODS as readonly [string, ...string[]]),
      payout_reference: z.string().trim().min(1).max(200),
      paid_at: z.string().datetime(),
      notes: z.string().trim().max(2000).optional().nullable(),
      // B2.1 — explicit confirmation phrase. Enforced server-side; frontend must
      // require the admin to type this exact phrase before submitting.
      confirm: z.literal('PAYOUT COMPLETED EXTERNALLY'),
    });
    const parsed = schema.safeParse(input);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      // If the failing field is `confirm`, surface the exact phrase requirement.
      if (issue?.path[0] === 'confirm') {
        throw new HttpError(400, 'You must confirm by sending confirm="PAYOUT COMPLETED EXTERNALLY" — this action does not send money and only records a payout completed externally');
      }
      throw new HttpError(400, `Invalid input: ${issue?.message}`);
    }
    const d = parsed.data;

    const order = await marketplaceOrderRepo.findById(orderId);
    if (!order) throw new HttpError(404, 'Order not found');
    // B3.1 — refund/reversal/double-payment must block payout recording (even
    // when the order was already at eligible_for_payout when the event landed).
    if (order.payment_reconciliation_required && order.owner_payable_status !== 'paid_out') {
      throw new HttpError(409, 'Cannot record payout: payment reconciliation required for this order');
    }
    if (order.status !== 'completed') throw new HttpError(400, `Cannot record payout: order status is '${order.status}', not 'completed'`);
    if (order.economics_status !== 'finalized') throw new HttpError(400, 'Cannot record payout: order economics are not finalized');
    if (order.owner_payable_status !== 'eligible_for_payout' && order.owner_payable_status !== 'paid_out') {
      throw new HttpError(400, `Cannot record payout: owner payable status is '${order.owner_payable_status}'`);
    }
    if (order.owner_earnings_minor === null || order.owner_earnings_minor === undefined) {
      throw new HttpError(400, 'Cannot record payout: owner earnings not finalized');
    }
    assertSafeMoney(order.owner_earnings_minor, 'owner_earnings_minor');

    const normalizedRef = normalizePaymentReference(d.payout_reference);

    // Idempotency (same order): if a payout already exists on this order and
    // uses the SAME (method, ref), return it as a safe no-op.
    const existing = await marketplaceOwnerPayoutRepo.findByOrder(orderId);
    if (existing) {
      if (
        existing.payout_method === (d.payout_method as MarketplacePaymentMethod) &&
        existing.payout_reference_normalized === normalizedRef
      ) {
        return { order, payout: existing };
      }
      throw new HttpError(409, 'This order already has a payout recorded with a different reference');
    }

    // Cross-payout identity: (method, normalized) must be unique across payouts.
    const otherWithSameIdentity = await marketplaceOwnerPayoutRepo.findByPayoutIdentity(d.payout_method, normalizedRef);
    if (otherWithSameIdentity) {
      throw new HttpError(409, 'This payout reference is already allocated to another payout');
    }

    // Amount is server-authoritative. Client-supplied amount is ignored (Zod does
    // not include it in the schema, so it never reaches this scope).
    const payout: MarketplaceOwnerPayout = {
      id: uuidv4(),
      order_id: order.id,
      owner_user_id: order.owner_user_id,
      channel_id: order.channel_id,
      currency: 'USD',
      amount_minor: order.owner_earnings_minor,
      payout_method: d.payout_method as MarketplacePaymentMethod,
      payout_reference_normalized: normalizedRef,
      payout_reference_display: d.payout_reference,
      paid_at: new Date(d.paid_at),
      notes: d.notes || null,
      created_by: actor!.user.id,
      created_at: new Date(),
    };

    try {
      await marketplaceOwnerPayoutRepo.insert(payout);
    } catch (e) {
      if (/E11000|duplicate key/i.test((e as Error).message)) {
        throw new HttpError(409, 'This payout reference is already allocated to another payout');
      }
      throw e;
    }

    const updatedOrder = await marketplaceOrderRepo.update(order.id, {
      owner_payable_status: 'paid_out',
      paid_out_at: payout.paid_at,
      payout_id: payout.id,
    });

    await marketplaceFinancialEventRepo.append({
      order_id: order.id,
      event_type: 'OWNER_PAYOUT_RECORDED',
      currency: 'USD',
      gross_amount_minor: order.snapshot?.gross_price_minor ?? null,
      gateway_fee_minor: order.gateway_fee_minor,
      net_amount_minor: order.net_transaction_value_minor,
      owner_earnings_minor: order.owner_earnings_minor,
      wavelead_commission_minor: order.wavelead_commission_minor,
      payment_reference_normalized: order.payment_reference_normalized,
      actor_user_id: actor!.user.id,
      metadata: {
        payout_id: payout.id,
        payout_method: payout.payout_method,
        payout_reference_normalized: payout.payout_reference_normalized,
      },
    });

    return { order: updatedOrder, payout };
  },

  /**
   * B2 — refund guard. Refund execution is admin-only and remains manual.
   * If owner has already been paid, the system MUST NOT reverse economics
   * silently. Marks the order manual_reconciliation_required and returns
   * the guard state. Actual refund provider execution is out of scope for B2.
   */
  async adminInitiateRefund(actor: Actor | null, orderId: string, input: unknown): Promise<{ order: MarketplaceOrder; requires_manual: boolean; reason: string }> {
    requireAdmin(actor);
    const schema = z.object({ reason: z.string().trim().min(3).max(1000) });
    const parsed = schema.safeParse(input);
    if (!parsed.success) throw new HttpError(400, 'refund reason is required (3-1000 chars)');
    const order = await marketplaceOrderRepo.findById(orderId);
    if (!order) throw new HttpError(404, 'Order not found');

    if (order.owner_payable_status === 'paid_out') {
      // Owner already paid. Refund must NOT auto-reverse economics.
      const updated = await marketplaceOrderRepo.update(orderId, {
        owner_payable_status: 'manual_reconciliation_required',
      });
      return { order: updated, requires_manual: true, reason: parsed.data.reason };
    }
    // Not paid-out — economics could still be reversed by a future admin flow,
    // but B2 does not implement provider-side refund execution.
    return { order, requires_manual: true, reason: parsed.data.reason };
  },

  // -------- Buyer / owner list helpers for UI --------
  async listByOwner(actor: Actor | null): Promise<MarketplaceOrder[]> {
    if (!actor) throw new HttpError(401, 'You must be signed in');
    return marketplaceOrderRepo.listByOwner(actor.user.id);
  },
  async findOrderForOwner(actor: Actor | null, orderId: string): Promise<MarketplaceOrder | null> {
    if (!actor) throw new HttpError(401, 'You must be signed in');
    const o = await marketplaceOrderRepo.findById(orderId);
    if (!o) return null;
    if (o.owner_user_id !== actor.user.id) throw new HttpError(403, 'Not your order');
    return o;
  },
  async findOrderForBuyer(actor: Actor | null, orderId: string): Promise<MarketplaceOrder | null> {
    if (!actor) throw new HttpError(401, 'You must be signed in');
    const o = await marketplaceOrderRepo.findById(orderId);
    if (!o) return null;
    if (!o.buyer_user_id || o.buyer_user_id !== actor.user.id) throw new HttpError(403, 'Not your order');
    return o;
  },
  async listPayoutsAdmin(actor: Actor | null): Promise<MarketplaceOwnerPayout[]> {
    requireAdmin(actor);
    return marketplaceOwnerPayoutRepo.listAdmin();
  },
  async listPayablesAdmin(actor: Actor | null, filter: { status?: OwnerPayableStatus } = {}): Promise<MarketplaceOrder[]> {
    requireAdmin(actor);
    const all = await marketplaceOrderRepo.listAdmin({});
    return all.filter((o) => (filter.status ? o.owner_payable_status === filter.status : ['eligible_for_payout', 'paid_out', 'blocked_fee_reconciliation', 'submitted_for_review', 'manual_reconciliation_required'].includes(o.owner_payable_status)));
  },

  // ============================================================================
  // Phase B3 — Marketplace PayPal Checkout
  // ----------------------------------------------------------------------------
  // Payment DOMAIN separation. PROMOTE campaign funding (paymentFundingOrder /
  // paypal_orders) is a totally separate money flow with a separate ledger; this
  // block owns MARKETPLACE_SPONSORSHIP_PAYMENT only. Reuses the same PayPal
  // PaymentProvider abstraction, webhook signature verification, and canonical-
  // origin resolver — never mutates promote records.
  //
  // Amount authority: server derives amount from the immutable order snapshot;
  // client input is IGNORED.
  //
  // Race safety: manual admin confirm-payment and buyer PayPal checkout are
  // interlocked so that at most ONE allocated payment applies economics; a
  // second real payment is FLAGGED for manual reconciliation, never silently
  // absorbed.
  // ============================================================================

  async buyerStartPaypalCheckout(actor: Actor | null, orderId: string, requestOrigin?: string): Promise<{ attempt: MarketplacePaymentAttempt; approve_url: string }> {
    if (!actor) throw new HttpError(401, 'You must be signed in');
    const order = await marketplaceOrderRepo.findById(orderId);
    if (!order) throw new HttpError(404, 'Order not found');
    // Only the authenticated buyer may start checkout.
    if (!order.buyer_user_id || order.buyer_user_id !== actor.user.id) {
      throw new HttpError(403, 'Only the buyer of this sponsorship may start PayPal checkout');
    }
    if (order.status !== 'awaiting_payment') {
      throw new HttpError(400, `Order is in status "${order.status}" — payment can only start in "awaiting_payment"`);
    }
    if (!order.snapshot) throw new HttpError(400, 'Order economics snapshot missing');
    assertSafeMoney(order.snapshot.gross_price_minor, 'gross_price_minor');

    // If a manual/PayPal payment has already been fully confirmed against this
    // order, reject. `order.status !== 'awaiting_payment'` already handles paid
    // orders; belt-and-braces here for defense in depth.
    if (order.payment_source) {
      throw new HttpError(409, 'This order already has an allocated payment');
    }

    // Idempotency: if there's an existing still-usable attempt, reuse it.
    const priors = await marketplacePaymentAttemptRepo.listByOrder(orderId);
    const reusable = priors.find((a) => (a.status === 'created' || a.status === 'checkout_created' || a.status === 'approved') && a.approve_url);
    if (reusable && reusable.approve_url) {
      return { attempt: reusable, approve_url: reusable.approve_url };
    }
    // A previously captured attempt means we're already paid — reject.
    if (priors.some((a) => a.status === 'captured')) {
      throw new HttpError(409, 'This order has already been paid via PayPal');
    }

    const now = new Date();
    const { paypalConfigService } = await import('./payments/paypalConfigService');
    const activeCfg = await paypalConfigService.resolveActive();
    if (!activeCfg) throw new HttpError(503, 'Payment provider is not configured');
    const environment: IntegrationEnvironment = activeCfg.environment;

    // Canonical-origin allowlist: only trust request origin if allowlisted.
    const origin = (requestOrigin || getConfiguredOrigin()).replace(/\/+$/, '');
    const attemptId = uuidv4();
    const return_url = `${origin}/dashboard/sponsorships?order=${encodeURIComponent(orderId)}&payment=paypal&attempt=${encodeURIComponent(attemptId)}&status=return`;
    const cancel_url = `${origin}/dashboard/sponsorships?order=${encodeURIComponent(orderId)}&payment=paypal&attempt=${encodeURIComponent(attemptId)}&status=cancelled`;

    const doc: MarketplacePaymentAttempt = {
      id: attemptId,
      marketplace_order_id: orderId,
      purpose: 'MARKETPLACE_SPONSORSHIP_PAYMENT',
      provider: 'paypal',
      provider_environment: environment,
      provider_order_id: null,
      provider_capture_id: null,
      currency: 'USD',
      amount_minor: order.snapshot.gross_price_minor,     // authoritative
      status: 'created',
      approve_url: null,
      return_url,
      cancel_url,
      created_by: actor.user.id,
      created_at: now,
      updated_at: now,
      approved_at: null,
      captured_at: null,
      provider_fee_minor: null,
      provider_net_minor: null,
      failure_code: null,
      failure_message_safe: null,
    };
    await marketplacePaymentAttemptRepo.insert(doc);

    try {
      const { getPaymentProvider } = await import('./payments/providerFactory');
      const provider = getPaymentProvider();
      const created = await provider.createPayment({
        funding_id: attemptId,                              // used as PayPal-Request-Id — unique
        amount_minor: doc.amount_minor,
        currency: doc.currency,
        description: `WaveLead sponsorship "${(order.snapshot.package_name || order.package_type).slice(0, 80)}"`,
        return_url,
        cancel_url,
        // NOTE: metadata keys are provider-abstraction generic. The marketplace
        // canonical mapping never relies on custom_id — we look up by provider_order_id.
        metadata: { campaign_id: orderId, owner_user_id: order.owner_user_id },
      });
      const updated = await marketplacePaymentAttemptRepo.update(attemptId, {
        provider_order_id: created.provider_order_id,
        approve_url: created.approve_url,
        status: 'checkout_created',
      });
      return { attempt: updated, approve_url: created.approve_url };
    } catch (err) {
      await marketplacePaymentAttemptRepo.update(attemptId, {
        status: 'failed',
        failure_code: 'provider_create_failed',
        failure_message_safe: 'Payment provider could not create the order',
      });
      throw new HttpError(502, `Payment provider error: ${(err as Error).message.slice(0, 200)}`);
    }
  },

  async getPaymentAttemptForBuyer(actor: Actor | null, attempt_id: string): Promise<MarketplacePaymentAttempt> {
    if (!actor) throw new HttpError(401, 'You must be signed in');
    const a = await marketplacePaymentAttemptRepo.findById(attempt_id);
    if (!a) throw new HttpError(404, 'Payment attempt not found');
    const isCreator = a.created_by === actor.user.id;
    const isAdmin = hasAtLeastRole(actor.user, ROLES.ADMIN);
    if (!isCreator && !isAdmin) throw new HttpError(403, 'Not your payment attempt');
    return a;
  },

  /**
   * B3 — buyer-return capture. Idempotent single source of truth for turning
   * a checkout into a captured marketplace payment.
   * Buyer authority: only the attempt creator (or admin) may trigger.
   */
  async captureMarketplacePaypalOrder(actor: Actor | null, attempt_id: string): Promise<MarketplacePaymentAttempt> {
    if (!actor) throw new HttpError(401, 'You must be signed in');
    const a = await marketplacePaymentAttemptRepo.findById(attempt_id);
    if (!a) throw new HttpError(404, 'Payment attempt not found');
    // B3.1 — buyer-triggered capture authority.
    // Browser-return capture requires the AUTHENTICATED marketplace buyer of the
    // order this attempt belongs to (or admin). Knowing the attempt id alone
    // must not be sufficient. Server/provider remain authoritative for amount,
    // currency, capture id and payment status — those never come from browser.
    const order = await marketplaceOrderRepo.findById(a.marketplace_order_id);
    if (!order) throw new HttpError(404, 'Marketplace order not found');
    const isAdmin = hasAtLeastRole(actor.user, ROLES.ADMIN);
    const isBuyer = !!order.buyer_user_id && order.buyer_user_id === actor.user.id;
    if (!isAdmin && !isBuyer) throw new HttpError(403, 'Not your marketplace order');
    return this._captureAttempt(a);
  },

  /**
   * B3 — webhook-driven capture (CHECKOUT.ORDER.APPROVED). Same idempotent path.
   * Returns null if the provider_order_id does not belong to a marketplace attempt,
   * so the webhook can safely fall through to the promote handler.
   */
  async captureMarketplacePaypalOrderByProviderOrderId(provider_order_id: string): Promise<MarketplacePaymentAttempt | null> {
    const a = await marketplacePaymentAttemptRepo.findByProviderOrderId('paypal', provider_order_id);
    if (!a) return null;
    return this._captureAttempt(a);
  },

  async _captureAttempt(a: MarketplacePaymentAttempt): Promise<MarketplacePaymentAttempt> {
    if (a.status === 'captured') return a;
    if (!a.provider_order_id) throw new HttpError(400, 'No provider order to capture');
    if (a.status === 'cancelled' || a.status === 'failed' || a.status === 'reversed') {
      throw new HttpError(400, `Cannot capture attempt in status "${a.status}"`);
    }
    const { getPaymentProvider } = await import('./payments/providerFactory');
    const provider = getPaymentProvider();
    const cap = await provider.capturePayment({ provider_order_id: a.provider_order_id });
    if (cap.internal_status !== 'paid') {
      const next: MarketplacePaymentAttemptStatus =
        cap.internal_status === 'failed' ? 'failed' :
        cap.internal_status === 'cancelled' ? 'cancelled' :
        'approved';
      const updated = await marketplacePaymentAttemptRepo.update(a.id, {
        status: next,
        provider_capture_id: cap.provider_capture_id,
        failure_code: next === 'failed' ? 'capture_failed' : null,
        failure_message_safe: next === 'failed' ? 'Payment could not be captured' : null,
      });
      return updated;
    }
    if (cap.currency && cap.currency.toUpperCase() !== a.currency) {
      // Currency mismatch — never finalize.
      const updated = await marketplacePaymentAttemptRepo.update(a.id, {
        status: 'failed',
        failure_code: 'currency_mismatch',
        failure_message_safe: 'Captured currency does not match order currency',
      });
      return updated;
    }
    if (cap.amount_captured_minor !== a.amount_minor) {
      const updated = await marketplacePaymentAttemptRepo.update(a.id, {
        status: 'failed',
        failure_code: 'amount_mismatch',
        failure_message_safe: 'Captured amount does not match order amount',
      });
      return updated;
    }
    return this._finalizeCapturedAttempt(a, cap.provider_capture_id!, cap.amount_captured_minor, null, null);
  },

  /**
   * B3 — PAYMENT.CAPTURE.COMPLETED webhook path. Authoritative for successful
   * marketplace payment. Provider fee comes from PayPal's
   * `seller_receivable_breakdown.paypal_fee` when present; otherwise finalized
   * economics wait for manual admin reconcile (`pending_fee_reconciliation`).
   */
  async finalizeMarketplaceCaptureFromWebhook(
    provider_order_id: string,
    provider_capture_id: string,
    amount_captured_minor: number,
    currency: string,
    provider_fee_minor: number | null,
    provider_net_minor: number | null,
  ): Promise<MarketplacePaymentAttempt | null> {
    const a = await marketplacePaymentAttemptRepo.findByProviderOrderId('paypal', provider_order_id);
    if (!a) return null;
    if (a.status === 'captured') return a;
    if (currency && currency.toUpperCase() !== a.currency) {
      await marketplacePaymentAttemptRepo.update(a.id, {
        status: 'failed',
        failure_code: 'currency_mismatch',
        failure_message_safe: 'Captured currency does not match order currency',
      });
      return null;
    }
    if (amount_captured_minor !== a.amount_minor) {
      await marketplacePaymentAttemptRepo.update(a.id, {
        status: 'failed',
        failure_code: 'amount_mismatch',
        failure_message_safe: 'Captured amount does not match order amount',
      });
      return null;
    }
    return this._finalizeCapturedAttempt(a, provider_capture_id, amount_captured_minor, provider_fee_minor, provider_net_minor);
  },

  /**
   * Internal — atomic finalization of a captured attempt. Guarded by the
   * unique `provider_capture_id` index + a status transition guard so that
   * concurrent capture+webhook only produce ONE economic confirmation.
   */
  async _finalizeCapturedAttempt(
    a: MarketplacePaymentAttempt,
    provider_capture_id: string,
    amount_captured_minor: number,
    provider_fee_minor: number | null,
    provider_net_minor: number | null,
  ): Promise<MarketplacePaymentAttempt> {
    const now = new Date();
    // Idempotency: another worker may have already flipped to captured.
    const transitioned = await marketplacePaymentAttemptRepo.transitionIfIn(
      a.id,
      ['created', 'checkout_created', 'approved'],
      'captured',
      {
        provider_capture_id,
        captured_at: now,
        approved_at: a.approved_at || now,
        provider_fee_minor: provider_fee_minor,
        provider_net_minor: provider_net_minor,
      },
    );
    if (!transitioned) {
      // Another worker won the race — return the current row.
      const cur = await marketplacePaymentAttemptRepo.findById(a.id);
      if (cur && cur.status === 'captured') return cur;
      // Row moved to a terminal non-captured state under us; return that.
      return (cur || a);
    }

    // Now finalize the marketplace order — idempotent by design.
    const order = await marketplaceOrderRepo.findById(a.marketplace_order_id);
    if (!order || !order.snapshot) return transitioned;

    // Race protection: if this order already has a DIFFERENT allocated payment
    // (manual or PayPal via another attempt), do NOT reapply economics. Flag
    // for manual reconciliation and append an audit event.
    if (order.payment_source && order.payment_reference_normalized && order.payment_reference_normalized !== provider_capture_id.toLowerCase()) {
      await marketplaceOrderRepo.update(order.id, {
        payment_reconciliation_required: true,
        owner_payable_status: order.owner_payable_status === 'paid_out' ? 'paid_out' : 'manual_reconciliation_required',
      });
      try {
        await marketplaceFinancialEventRepo.append({
          order_id: order.id,
          event_type: 'MARKETPLACE_DOUBLE_PAYMENT_FLAGGED',
          currency: 'USD',
          gross_amount_minor: order.snapshot.gross_price_minor,
          gateway_fee_minor: null,
          net_amount_minor: null,
          owner_earnings_minor: null,
          wavelead_commission_minor: null,
          payment_reference_normalized: provider_capture_id.toLowerCase(),
          actor_user_id: 'system',
          metadata: { provider: 'paypal', provider_capture_id, second_source: 'paypal' },
        });
      } catch { /* audit best-effort */ }
      return transitioned;
    }

    const gross = order.snapshot.gross_price_minor;
    const fee = provider_fee_minor;
    const normalizedRef = provider_capture_id.toLowerCase();

    let patch: Partial<MarketplaceOrder>;
    if (fee === null || fee === undefined) {
      patch = {
        status: 'paid',
        economics_status: 'pending_fee_reconciliation',
        payment_method: 'paypal',
        payment_source: 'paypal',
        payment_reference_normalized: normalizedRef,
        payment_reference_display: provider_capture_id,
        payment_received_at: now,
        amount_received_minor: amount_captured_minor,
        gateway_fee_minor: null,
        net_transaction_value_minor: null,
        owner_earnings_minor: null,
        wavelead_commission_minor: null,
        owner_payable_status: 'blocked_fee_reconciliation',
        paid_at: order.paid_at || now,
      };
    } else {
      const split = computeSplit(gross, fee);
      patch = {
        status: 'paid',
        economics_status: 'finalized',
        payment_method: 'paypal',
        payment_source: 'paypal',
        payment_reference_normalized: normalizedRef,
        payment_reference_display: provider_capture_id,
        payment_received_at: now,
        amount_received_minor: amount_captured_minor,
        gateway_fee_minor: fee,
        net_transaction_value_minor: split.net_minor,
        owner_earnings_minor: split.owner_earnings_minor,
        wavelead_commission_minor: split.wavelead_commission_minor,
        owner_payable_status: 'payable_pending_delivery',
        paid_at: order.paid_at || now,
      };
    }
    await marketplaceOrderRepo.update(order.id, patch);

    try {
      await marketplaceFinancialEventRepo.append({
        order_id: order.id,
        event_type: 'PAYMENT_CONFIRMED',
        currency: 'USD',
        gross_amount_minor: gross,
        gateway_fee_minor: fee ?? null,
        net_amount_minor: patch.net_transaction_value_minor ?? null,
        owner_earnings_minor: patch.owner_earnings_minor ?? null,
        wavelead_commission_minor: patch.wavelead_commission_minor ?? null,
        payment_reference_normalized: normalizedRef,
        actor_user_id: 'system',
        metadata: {
          payment_source: 'paypal',
          provider: 'paypal',
          provider_environment: a.provider_environment,
          provider_order_id: a.provider_order_id,
          provider_capture_id,
          attempt_id: a.id,
          fee_known: fee !== null && fee !== undefined,
        },
      });
    } catch (e) {
      // Race with an already-appended event — safe to treat as idempotent success.
      if (!/E11000|duplicate key/i.test((e as Error).message)) throw e;
    }
    return transitioned;
  },

  /**
   * B3 — refund/reversal webhook handling for marketplace captures. Does NOT
   * auto-clawback owner money. Blocks future payout by moving owner_payable
   * to `manual_reconciliation_required` and appends an audit event. If the
   * owner has already been paid out, keeps `paid_out` but sets
   * payment_reconciliation_required so admin explicitly resolves.
   */
  async recordMarketplaceRefundOrReversal(
    provider_order_id: string,
    event_type: 'MARKETPLACE_PAYMENT_REFUNDED' | 'MARKETPLACE_PAYMENT_REVERSED',
    amount_minor: number,
    provider_refund_reference: string,
  ): Promise<{ attempt: MarketplacePaymentAttempt; order: MarketplaceOrder } | null> {
    const a = await marketplacePaymentAttemptRepo.findByProviderOrderId('paypal', provider_order_id);
    if (!a) return null;
    // B3.1 — service-layer idempotency guard: if this exact refund_reference
    // was already recorded on this order (as the same event_type), treat as
    // a no-op. The global PayPal event dedup already prevents webhook replay
    // from re-invoking this function; this belt-and-braces guard covers any
    // direct or duplicated call path (tests, manual admin retry).
    const refNormalized = provider_refund_reference.toLowerCase();
    const priorEvents = await marketplaceFinancialEventRepo.listByOrder(a.marketplace_order_id);
    const alreadyRecorded = priorEvents.some((e) => e.event_type === event_type && e.payment_reference_normalized === refNormalized);
    if (alreadyRecorded) {
      const orderNow = await marketplaceOrderRepo.findById(a.marketplace_order_id);
      const attemptNow = await marketplacePaymentAttemptRepo.findById(a.id);
      if (orderNow && attemptNow) return { attempt: attemptNow, order: orderNow };
    }
    // Mark the attempt reversed. Idempotent — repeated calls flip only once.
    if (a.status !== 'reversed') {
      await marketplacePaymentAttemptRepo.update(a.id, {
        status: 'reversed',
        failure_code: event_type === 'MARKETPLACE_PAYMENT_REFUNDED' ? 'refunded' : 'reversed',
        failure_message_safe: 'Capture refunded/reversed after success',
      });
    }
    const order = await marketplaceOrderRepo.findById(a.marketplace_order_id);
    if (!order) return null;
    const patch: Partial<MarketplaceOrder> = {
      payment_reconciliation_required: true,
    };
    if (order.owner_payable_status !== 'paid_out') {
      patch.owner_payable_status = 'manual_reconciliation_required';
    }
    const updated = await marketplaceOrderRepo.update(order.id, patch);
    if (!alreadyRecorded) {
      try {
        await marketplaceFinancialEventRepo.append({
          order_id: order.id,
          event_type,
          currency: 'USD',
          gross_amount_minor: order.snapshot?.gross_price_minor ?? null,
          gateway_fee_minor: null,
          net_amount_minor: null,
          owner_earnings_minor: null,
          wavelead_commission_minor: null,
          payment_reference_normalized: refNormalized,
          actor_user_id: 'system',
          metadata: {
            provider: 'paypal',
            provider_order_id,
            provider_refund_reference,
            amount_minor,
            owner_was_paid_out: order.owner_payable_status === 'paid_out',
          },
        });
      } catch { /* audit best-effort */ }
    }
    return { attempt: (await marketplacePaymentAttemptRepo.findById(a.id))!, order: updated };
  },

  async listPaymentAttemptsAdmin(actor: Actor | null): Promise<MarketplacePaymentAttempt[]> {
    requireAdmin(actor);
    return marketplacePaymentAttemptRepo.listAdmin();
  },

  async listPaymentAttemptsForOrder(actor: Actor | null, orderId: string): Promise<MarketplacePaymentAttempt[]> {
    if (!actor) throw new HttpError(401, 'You must be signed in');
    const o = await marketplaceOrderRepo.findById(orderId);
    if (!o) throw new HttpError(404, 'Order not found');
    const isBuyer = o.buyer_user_id && o.buyer_user_id === actor.user.id;
    const isOwner = o.owner_user_id === actor.user.id;
    const isAdmin = hasAtLeastRole(actor.user, ROLES.ADMIN);
    if (!isBuyer && !isOwner && !isAdmin) throw new HttpError(403, 'Not your order');
    return marketplacePaymentAttemptRepo.listByOrder(orderId);
  },
};

/**
 * B2 — pure function that derives owner_payable_status upon completion.
 * The rules are strict: ANY missing invariant blocks payout eligibility.
 */
export function deriveOwnerPayableAfterCompletion(order: MarketplaceOrder): OwnerPayableStatus {
  // If we're already paid_out, don't downgrade.
  if (order.owner_payable_status === 'paid_out') return 'paid_out';
  // B3.1 — a refund/reversal or double-payment must NEVER produce eligibility.
  // Historical delivery data is preserved, but payout stays blocked pending
  // admin reconciliation.
  if (order.payment_reconciliation_required) return 'manual_reconciliation_required';
  if (order.owner_payable_status === 'manual_reconciliation_required') return 'manual_reconciliation_required';
  // Must be paid + finalized.
  if (order.status !== 'paid' && order.status !== 'in_progress' && order.status !== 'submitted_for_review' && order.status !== 'completed') return 'not_applicable';
  if (order.economics_status !== 'finalized') return 'blocked_fee_reconciliation';
  if (order.gateway_fee_minor === null || order.gateway_fee_minor === undefined) return 'blocked_fee_reconciliation';
  if (order.owner_earnings_minor === null || order.owner_earnings_minor === undefined) return 'blocked_fee_reconciliation';
  return 'eligible_for_payout';
}
