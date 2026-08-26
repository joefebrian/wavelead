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
import { channelRateCardRepo, marketplaceFinancialEventRepo, marketplaceOrderRepo } from '../repositories/marketplaceRepo';
import { computeSplit, OWNER_SHARE_BPS, PLATFORM_SHARE_BPS } from '../utils/marketplaceMoney';
import type {
  Actor,
  Channel,
  ChannelRateCard,
  MarketplaceOrder,
  MarketplaceOrderStatus,
  MarketplacePackageType,
  MarketplacePaymentMethod,
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
};
