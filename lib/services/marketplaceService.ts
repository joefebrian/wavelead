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
import { createHmac, randomInt } from 'crypto';
import { z } from 'zod';
import { HttpError, hasAtLeastRole, ROLES } from '../auth/rbac';
import { channelRepo } from '../repositories/channelRepo';
import {
  channelRateCardRepo,
  marketplaceDeliveryEscalationRepo,
  marketplaceDeliverySubmissionRepo,
  marketplaceFinancialEventRepo,
  marketplaceOrderRepo,
  marketplaceOwnerPayoutRepo,
  marketplacePaymentAttemptRepo,
  ownerPayoutMethodRepo,
} from '../repositories/marketplaceRepo';
import { computeSplit, OWNER_SHARE_BPS, PLATFORM_SHARE_BPS, assertSafeMoney } from '../utils/marketplaceMoney';
import { getConfiguredOrigin } from '../utils/canonicalOrigin';
import type {
  Actor,
  Channel,
  ChannelRateCard,
  IntegrationEnvironment,
  MarketplaceDeliveryEscalation,
  MarketplaceDeliverySubmission,
  MarketplaceOrder,
  MarketplaceOrderStatus,
  MarketplaceOwnerPayout,
  MarketplacePackageType,
  MarketplacePaymentAttempt,
  MarketplacePaymentAttemptStatus,
  MarketplacePaymentMethod,
  OwnerPayableStatus,
  OwnerPayoutMethod,
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

/**
 * B3.2 Gate B — Payment Protection delivery review SLA (hours).
 * Configurable via env; falls back to 72h.
 */
export function getReviewSlaHours(): number {
  const raw = process.env.MARKETPLACE_DELIVERY_REVIEW_HOURS;
  const n = raw ? Number(raw) : NaN;
  if (!Number.isFinite(n) || n <= 0 || n > 24 * 30) return 72;
  return Math.floor(n);
}

/**
 * B3.2 Gate C — Settlement hold (hours) applied between order completion and
 * payout availability. Configurable via env; defaults to 72h.
 */
export function getSettlementHoldHours(): number {
  const raw = process.env.MARKETPLACE_SETTLEMENT_HOLD_HOURS;
  const n = raw ? Number(raw) : NaN;
  if (!Number.isFinite(n) || n < 0 || n > 24 * 30) return 72;
  return Math.floor(n);
}

/**
 * B3.2 Gate C — deterministically hash a verification code for storage.
 * Uses HMAC-SHA256 with a server-side secret; the raw code is never
 * persisted. In production, a real secret is REQUIRED — no fallback to
 * hardcoded defaults (fail-closed).
 */
function hashVerificationCode(code: string): string {
  const secret = process.env.PAYOUT_METHOD_VERIFY_SECRET || process.env.SESSION_SECRET;
  if (!secret) {
    // Fail-closed in production. In dev/test allow a stable fallback.
    if (process.env.NODE_ENV === 'production') {
      throw new HttpError(500, 'Payout verification is unavailable: server secret not configured');
    }
    return createHmac('sha256', 'wavelead-mvp-dev-secret').update(code.trim()).digest('hex');
  }
  return createHmac('sha256', secret).update(code.trim()).digest('hex');
}

/**
 * B3.2 Gate C — production-safety helper. Returns true iff WaveLead has
 * an active transactional email delivery primitive configured. We check
 * for env vars belonging to any well-known provider (SendGrid, Resend,
 * Postmark, Mailgun, AWS SES) or a raw SMTP configuration. Do NOT wire
 * up email inside this gate — this helper only lets the payout method
 * flow degrade safely when no delivery service exists.
 */
export function hasEmailDelivery(): boolean {
  return !!(
    process.env.SENDGRID_API_KEY ||
    process.env.RESEND_API_KEY ||
    process.env.POSTMARK_API_TOKEN ||
    process.env.MAILGUN_API_KEY ||
    process.env.AWS_SES_REGION ||
    process.env.SMTP_HOST
  );
}

function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

function generateVerificationCode(): string {
  // 6-digit numeric code; leading-zero-safe.
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

function normalizeEmail(e: string): string {
  return e.trim().toLowerCase();
}

function maskEmail(e: string): string {
  const [local, domain] = e.split('@');
  if (!local || !domain) return e;
  if (local.length <= 2) return `${local[0] || '*'}***@${domain}`;
  return `${local[0]}***${local[local.length - 1]}@${domain}`;
}

const EMAIL_RE = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

/**
 * Public projection of a payout method — never expose the full email or
 * verification hash beyond the method owner themselves.
 */
export interface OwnerPayoutMethodMasked {
  id: string;
  method: 'paypal';
  paypal_email_masked: string;
  is_active: boolean;
  is_verified: boolean;
  verified_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export function maskPayoutMethod(m: OwnerPayoutMethod): OwnerPayoutMethodMasked {
  return {
    id: m.id,
    method: m.method,
    paypal_email_masked: maskEmail(m.paypal_email_display),
    is_active: m.is_active,
    is_verified: !!m.verified_at,
    verified_at: m.verified_at,
    created_at: m.created_at,
    updated_at: m.updated_at,
  };
}

/**
 * Safe URL validator — http/https only. Reject javascript:, data:, file:,
 * ftp:, and malformed input. Returns the canonicalized URL string.
 */
export function assertSafeHttpUrl(u: string, label = 'URL'): string {
  let parsed: URL;
  try { parsed = new URL(u); }
  catch { throw new HttpError(400, `${label} is not a valid URL: ${u.slice(0, 80)}`); }
  const proto = parsed.protocol.toLowerCase();
  if (proto !== 'http:' && proto !== 'https:') {
    throw new HttpError(400, `${label} protocol is not allowed: ${proto} (only http/https)`);
  }
  return parsed.toString();
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
    const updated = await marketplaceOrderRepo.update(orderId, {
      status: 'in_progress',
      started_at: new Date(),
      started_by: actor.user.id,
    });
    // B3.2 Gate B — audit event (non-financial-mutating).
    try {
      await marketplaceFinancialEventRepo.append({
        order_id: order.id,
        event_type: 'WORK_STARTED',
        currency: 'USD',
        gross_amount_minor: order.snapshot?.gross_price_minor ?? null,
        gateway_fee_minor: order.gateway_fee_minor,
        net_amount_minor: order.net_transaction_value_minor,
        owner_earnings_minor: order.owner_earnings_minor,
        wavelead_commission_minor: order.wavelead_commission_minor,
        payment_reference_normalized: order.payment_reference_normalized,
        actor_user_id: actor.user.id,
        metadata: {},
      });
    } catch { /* audit failure must not block business logic */ }
    return updated;
  },

  /**
   * B2 + B3.2 Gate B — owner submits fulfillment.
   *   in_progress → submitted_for_review   (initial submission, revision_number=0)
   *   revision_requested → submitted_for_review   (resubmission after buyer revision, revision_number+1)
   *
   * URL safety: only http:// and https:// are accepted. javascript:/data:/file:
   * and any other schemes are rejected. Server DOES NOT fetch these URLs.
   *
   * Evidence requirement: at least one delivery URL OR proof URL must be
   * supplied. Every submission is persisted as an append-only versioned row
   * in `marketplace_delivery_submissions` — prior evidence is never lost.
   */
  async submitDelivery(actor: Actor | null, orderId: string, input: unknown): Promise<MarketplaceOrder> {
    if (!actor) throw new HttpError(401, 'You must be signed in');
    const schema = z.object({
      delivery_notes: z.string().trim().max(4000).optional().nullable(),
      notes_to_brand: z.string().trim().max(4000).optional().nullable(),
      delivery_urls: z.array(z.string().trim().min(1).max(2048)).min(0).max(10).default([]),
      proof_urls: z.array(z.string().trim().min(1).max(2048)).min(0).max(10).optional().default([]),
      proof_description: z.string().trim().max(2000).optional().nullable(),
    });
    const parsed = schema.safeParse(input);
    if (!parsed.success) throw new HttpError(400, `Invalid input: ${parsed.error.issues[0]?.message}`);
    const d = parsed.data;

    // Notes: accept either legacy `delivery_notes` OR the Gate B `notes_to_brand`.
    const notesToBrand = (d.notes_to_brand ?? d.delivery_notes ?? '').trim();

    // Validate URLs — http/https only, well-formed.
    const cleanDeliveryUrls: string[] = [];
    for (const u of d.delivery_urls) cleanDeliveryUrls.push(assertSafeHttpUrl(u, 'Delivery URL'));
    const cleanProofUrls: string[] = [];
    for (const u of (d.proof_urls || [])) cleanProofUrls.push(assertSafeHttpUrl(u, 'Proof URL'));

    // Evidence requirement — Gate B: at least one delivery URL, proof URL,
    // OR non-empty notes-to-brand must be supplied. A completely empty
    // submission is never accepted.
    if (cleanDeliveryUrls.length === 0 && cleanProofUrls.length === 0 && !notesToBrand) {
      throw new HttpError(400, 'At least one delivery URL, proof URL, or notes-to-brand is required');
    }

    const order = await marketplaceOrderRepo.findById(orderId);
    if (!order) throw new HttpError(404, 'Order not found');
    if (order.owner_user_id !== actor.user.id) throw new HttpError(403, 'Only the channel owner may submit delivery');
    // B3.1 — refund/reversal/double-payment must block delivery progression.
    if (order.payment_reconciliation_required) {
      throw new HttpError(409, 'Cannot submit delivery: payment reconciliation required for this order');
    }
    const validFrom: MarketplaceOrderStatus[] = ['in_progress', 'revision_requested'];
    if (!validFrom.includes(order.status)) {
      throw new HttpError(400, `Cannot submit delivery: order status is '${order.status}', not 'in_progress' or 'revision_requested'`);
    }

    // Compute revision_number by inspecting prior submissions (append-only).
    const priorCount = await marketplaceDeliverySubmissionRepo.countByOrder(order.id);
    const revisionNumber = priorCount;   // 0 for first, +1 per resubmit
    const isResubmit = order.status === 'revision_requested';
    const now = new Date();

    const submission: MarketplaceDeliverySubmission = {
      id: uuidv4(),
      marketplace_order_id: order.id,
      submitted_by: actor.user.id,
      submitted_at: now,
      delivery_urls: cleanDeliveryUrls,
      proof_urls: cleanProofUrls,
      proof_description: d.proof_description || null,
      notes_to_brand: notesToBrand,
      revision_number: revisionNumber,
      created_at: now,
    };
    await marketplaceDeliverySubmissionRepo.insert(submission);

    const updated = await marketplaceOrderRepo.update(orderId, {
      status: 'submitted_for_review',
      owner_payable_status: 'submitted_for_review',
      // Legacy denorm — keeps existing UI/tests reading the "latest" values.
      delivery_notes: notesToBrand,
      delivery_urls: cleanDeliveryUrls,
      proof_description: d.proof_description || null,
      submitted_at: now,
      submitted_by: actor.user.id,
      // B3.2 Gate B — provider-neutral denorm.
      proof_urls: cleanProofUrls,
      notes_to_brand: notesToBrand,
      submitted_for_review_at: now,
      revision_number: revisionNumber,
      latest_submission_id: submission.id,
      // Clear any prior revision request markers now that we've resubmitted.
      revision_notes_latest: null,
    });

    // Financial-events audit (non-financial-mutating for Gate B).
    try {
      await marketplaceFinancialEventRepo.append({
        order_id: order.id,
        event_type: isResubmit ? 'DELIVERY_RESUBMITTED' : 'DELIVERY_SUBMITTED',
        currency: 'USD',
        gross_amount_minor: order.snapshot?.gross_price_minor ?? null,
        gateway_fee_minor: order.gateway_fee_minor,
        net_amount_minor: order.net_transaction_value_minor,
        owner_earnings_minor: order.owner_earnings_minor,
        wavelead_commission_minor: order.wavelead_commission_minor,
        payment_reference_normalized: order.payment_reference_normalized,
        actor_user_id: actor.user.id,
        metadata: { submission_id: submission.id, revision_number: revisionNumber },
      });
    } catch { /* audit-only */ }

    return updated;
  },

  /**
   * B2 — buyer accepts delivery. submitted_for_review → completed.
   * Only order.buyer_user_id may accept.
   *
   * B3.2 Gate B — if an active delivery escalation exists, it is atomically
   * closed as `resolved_owner` with reason `buyer_accepted_during_review`.
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

  // ==========================================================================
  // B3.2 Gate B — Buyer revision, delivery escalation, admin resolution
  // ==========================================================================

  /**
   * Buyer requests a revision on the currently submitted delivery.
   * submitted_for_review → revision_requested.
   * Requires non-empty revision_notes. Only the buyer of the order may call.
   *
   * If an active escalation exists, it is atomically closed as
   * `resolved_buyer` with reason `buyer_revision_during_review`.
   */
  async buyerRequestRevision(actor: Actor | null, orderId: string, input: unknown): Promise<MarketplaceOrder> {
    if (!actor) throw new HttpError(401, 'You must be signed in');
    const schema = z.object({ revision_notes: z.string().trim().min(3).max(4000) });
    const parsed = schema.safeParse(input);
    if (!parsed.success) throw new HttpError(400, 'revision_notes is required (3–4000 chars)');
    const revisionNotes = parsed.data.revision_notes;

    const order = await marketplaceOrderRepo.findById(orderId);
    if (!order) throw new HttpError(404, 'Order not found');
    if (!order.buyer_user_id || order.buyer_user_id !== actor.user.id) {
      throw new HttpError(403, 'Only the buyer of this sponsorship may request a revision');
    }
    if (order.status !== 'submitted_for_review') {
      throw new HttpError(400, `Cannot request revision: order status is '${order.status}', not 'submitted_for_review'`);
    }
    // B3.1 — reconciliation block still applies.
    if (order.payment_reconciliation_required) {
      throw new HttpError(409, 'Cannot request revision: payment reconciliation required for this order');
    }

    const now = new Date();
    const updated = await marketplaceOrderRepo.update(order.id, {
      status: 'revision_requested',
      // Owner payable reverts — work is again pending delivery.
      owner_payable_status: 'payable_pending_delivery',
      revision_notes_latest: revisionNotes,
      revision_requested_at: now,
      revision_requested_by: actor.user.id,
      // Delivery is no longer under review; clear the SLA timer input.
      submitted_for_review_at: null,
    });

    // Close any active escalation atomically as resolved_buyer.
    if (order.active_escalation_id) {
      const closed = await marketplaceDeliveryEscalationRepo.closeActive(order.id, {
        status: 'resolved_buyer',
        resolved_at: now,
        resolved_by_user_id: actor.user.id,
        resolution_notes: 'Buyer requested revision during review — escalation closed automatically',
        reason: 'buyer_revision_during_review' as MarketplaceDeliveryEscalation['reason'],
      });
      if (closed) {
        await marketplaceOrderRepo.update(order.id, { active_escalation_id: null });
      }
    }

    // Audit event.
    try {
      await marketplaceFinancialEventRepo.append({
        order_id: order.id,
        event_type: 'DELIVERY_REVISION_REQUESTED',
        currency: 'USD',
        gross_amount_minor: order.snapshot?.gross_price_minor ?? null,
        gateway_fee_minor: order.gateway_fee_minor,
        net_amount_minor: order.net_transaction_value_minor,
        owner_earnings_minor: order.owner_earnings_minor,
        wavelead_commission_minor: order.wavelead_commission_minor,
        payment_reference_normalized: order.payment_reference_normalized,
        actor_user_id: actor.user.id,
        metadata: {
          submission_id: order.latest_submission_id || null,
          revision_notes: revisionNotes.slice(0, 1000),
        },
      });
    } catch { /* audit-only */ }

    return updated;
  },

  /**
   * Compute whether the delivery review SLA has elapsed since the most
   * recent submitted_for_review_at. Never returns true if the order isn't
   * in `submitted_for_review` status.
   */
  isReviewSlaElapsed(order: MarketplaceOrder, nowMs?: number): boolean {
    if (order.status !== 'submitted_for_review') return false;
    const ts = order.submitted_for_review_at || order.submitted_at;
    if (!ts) return false;
    const startedMs = ts instanceof Date ? ts.getTime() : new Date(ts as unknown as string).getTime();
    const now = nowMs ?? Date.now();
    const slaMs = getReviewSlaHours() * 3600 * 1000;
    return (now - startedMs) >= slaMs;
  },

  /**
   * Owner escalates a stalled review to WaveLead. Available only when:
   *   status = submitted_for_review AND SLA has elapsed AND buyer has NOT
   *   accepted or requested revision.
   * Idempotent: repeated calls return the existing active escalation.
   */
  async ownerReportNoResponse(actor: Actor | null, orderId: string, input: unknown): Promise<MarketplaceDeliveryEscalation> {
    if (!actor) throw new HttpError(401, 'You must be signed in');
    const schema = z.object({ owner_notes: z.string().trim().max(4000).optional().nullable() });
    const parsed = schema.safeParse(input || {});
    if (!parsed.success) throw new HttpError(400, `Invalid input: ${parsed.error.issues[0]?.message}`);
    const notes = parsed.data.owner_notes || null;

    const order = await marketplaceOrderRepo.findById(orderId);
    if (!order) throw new HttpError(404, 'Order not found');
    if (order.owner_user_id !== actor.user.id) {
      throw new HttpError(403, 'Only the channel owner may escalate this order');
    }
    if (order.status !== 'submitted_for_review') {
      throw new HttpError(400, `Cannot escalate: order status is '${order.status}', not 'submitted_for_review'`);
    }
    if (!this.isReviewSlaElapsed(order)) {
      throw new HttpError(400, `Cannot escalate yet: review SLA (${getReviewSlaHours()}h) has not elapsed`);
    }

    // Idempotency: if an active escalation exists, return it.
    const existing = await marketplaceDeliveryEscalationRepo.findActiveByOrder(order.id);
    if (existing) return existing;

    const submissionId = order.latest_submission_id;
    if (!submissionId) {
      throw new HttpError(500, 'No submission found to escalate — this is a data integrity issue');
    }

    const now = new Date();
    const escalation: MarketplaceDeliveryEscalation = {
      id: uuidv4(),
      marketplace_order_id: order.id,
      submission_id: submissionId,
      owner_user_id: order.owner_user_id,
      buyer_user_id: order.buyer_user_id,
      reason: 'buyer_no_response',
      owner_notes: notes,
      status: 'open',
      is_active: true,
      created_at: now,
      updated_at: now,
      resolved_at: null,
      resolved_by_user_id: null,
      resolution_notes: null,
    };
    try {
      await marketplaceDeliveryEscalationRepo.insert(escalation);
    } catch (e) {
      // Race with another insert — refetch and return the winning row.
      if (/E11000|duplicate key/i.test((e as Error).message)) {
        const cur = await marketplaceDeliveryEscalationRepo.findActiveByOrder(order.id);
        if (cur) return cur;
      }
      throw e;
    }
    await marketplaceOrderRepo.update(order.id, { active_escalation_id: escalation.id });

    // Audit event.
    try {
      await marketplaceFinancialEventRepo.append({
        order_id: order.id,
        event_type: 'DELIVERY_ESCALATED',
        currency: 'USD',
        gross_amount_minor: order.snapshot?.gross_price_minor ?? null,
        gateway_fee_minor: order.gateway_fee_minor,
        net_amount_minor: order.net_transaction_value_minor,
        owner_earnings_minor: order.owner_earnings_minor,
        wavelead_commission_minor: order.wavelead_commission_minor,
        payment_reference_normalized: order.payment_reference_normalized,
        actor_user_id: actor.user.id,
        metadata: {
          escalation_id: escalation.id,
          submission_id: submissionId,
          reason: 'buyer_no_response',
          sla_hours: getReviewSlaHours(),
        },
      });
    } catch { /* audit-only */ }

    return escalation;
  },

  /**
   * Admin approves the delivery via an escalation review — completes the
   * order and grants owner-payout eligibility. Does NOT send any money.
   *
   * Persist completion_source='admin_delivery_resolution' (never masquerade
   * as buyer_accepted).
   */
  async adminApproveDeliveryEscalation(actor: Actor | null, escalationId: string, input: unknown): Promise<{ order: MarketplaceOrder; escalation: MarketplaceDeliveryEscalation }> {
    requireAdmin(actor);
    const schema = z.object({ resolution_notes: z.string().trim().min(3).max(4000) });
    const parsed = schema.safeParse(input);
    if (!parsed.success) throw new HttpError(400, 'resolution_notes is required (3–4000 chars)');
    const resolutionNotes = parsed.data.resolution_notes;

    const esc = await marketplaceDeliveryEscalationRepo.findById(escalationId);
    if (!esc) throw new HttpError(404, 'Escalation not found');
    if (!esc.is_active) throw new HttpError(409, `Escalation is no longer active (status='${esc.status}')`);

    const order = await marketplaceOrderRepo.findById(esc.marketplace_order_id);
    if (!order) throw new HttpError(404, 'Order not found');
    if (order.status !== 'submitted_for_review') {
      throw new HttpError(409, `Cannot admin-approve: order status is '${order.status}', not 'submitted_for_review'`);
    }
    if (order.latest_submission_id !== esc.submission_id) {
      throw new HttpError(409, 'Escalation references an older submission — a newer delivery has been submitted since');
    }
    if (order.economics_status !== 'finalized') {
      throw new HttpError(409, 'Cannot admin-approve: order economics are not finalized');
    }
    if (order.payment_reconciliation_required) {
      throw new HttpError(409, 'Cannot admin-approve: payment reconciliation required for this order');
    }

    // Finalize via shared completion path — grants payout eligibility if all
    // invariants hold, appends DELIVERY_COMPLETED + DELIVERY_ADMIN_APPROVED +
    // OWNER_PAYABLE_ELIGIBLE. Also closes the active escalation.
    const updatedOrder = await this._finalizeCompletion(order, {
      completed_by: actor!.user.id,
      completion_source: 'admin_delivery_resolution',
      completion_note: resolutionNotes,
    });

    // Ensure escalation is closed as resolved_owner even if _finalizeCompletion
    // didn't (defense-in-depth).
    const escAfter = await marketplaceDeliveryEscalationRepo.findById(esc.id);
    let finalEsc = escAfter!;
    if (finalEsc.is_active) {
      finalEsc = await marketplaceDeliveryEscalationRepo.update(esc.id, {
        status: 'resolved_owner',
        is_active: false,
        resolved_at: new Date(),
        resolved_by_user_id: actor!.user.id,
        resolution_notes: resolutionNotes,
      });
      await marketplaceOrderRepo.update(order.id, { active_escalation_id: null });
    }

    return { order: updatedOrder, escalation: finalEsc };
  },

  /**
   * Admin requests more evidence — escalation stays active but shifts to
   * `more_evidence_required`. Owner can then add evidence and resubmit
   * (existing submissions preserved).
   */
  async adminRequestMoreEvidence(actor: Actor | null, escalationId: string, input: unknown): Promise<MarketplaceDeliveryEscalation> {
    requireAdmin(actor);
    const schema = z.object({ resolution_notes: z.string().trim().min(3).max(4000) });
    const parsed = schema.safeParse(input);
    if (!parsed.success) throw new HttpError(400, 'resolution_notes is required (3–4000 chars)');
    const resolutionNotes = parsed.data.resolution_notes;

    const esc = await marketplaceDeliveryEscalationRepo.findById(escalationId);
    if (!esc) throw new HttpError(404, 'Escalation not found');
    if (!esc.is_active) throw new HttpError(409, `Escalation is no longer active (status='${esc.status}')`);
    if (esc.status !== 'open' && esc.status !== 'under_review') {
      throw new HttpError(409, `Cannot request more evidence: escalation status is '${esc.status}'`);
    }
    const updated = await marketplaceDeliveryEscalationRepo.update(esc.id, {
      status: 'more_evidence_required',
      is_active: true,
      resolution_notes: resolutionNotes,
    });

    // Audit event.
    try {
      const order = await marketplaceOrderRepo.findById(esc.marketplace_order_id);
      if (order) {
        await marketplaceFinancialEventRepo.append({
          order_id: order.id,
          event_type: 'DELIVERY_MORE_EVIDENCE_REQUESTED',
          currency: 'USD',
          gross_amount_minor: order.snapshot?.gross_price_minor ?? null,
          gateway_fee_minor: order.gateway_fee_minor,
          net_amount_minor: order.net_transaction_value_minor,
          owner_earnings_minor: order.owner_earnings_minor,
          wavelead_commission_minor: order.wavelead_commission_minor,
          payment_reference_normalized: order.payment_reference_normalized,
          actor_user_id: actor!.user.id,
          metadata: { escalation_id: esc.id, resolution_notes: resolutionNotes.slice(0, 1000) },
        });
      }
    } catch { /* audit-only */ }

    return updated;
  },

  /**
   * Admin rejects the escalation — evidence insufficient. Escalation closes
   * as resolved_buyer; order stays in `submitted_for_review` so buyer may
   * still accept or request revision. Order does NOT become payout eligible.
   */
  async adminRejectEscalation(actor: Actor | null, escalationId: string, input: unknown): Promise<MarketplaceDeliveryEscalation> {
    requireAdmin(actor);
    const schema = z.object({ resolution_notes: z.string().trim().min(3).max(4000) });
    const parsed = schema.safeParse(input);
    if (!parsed.success) throw new HttpError(400, 'resolution_notes is required (3–4000 chars)');
    const resolutionNotes = parsed.data.resolution_notes;

    const esc = await marketplaceDeliveryEscalationRepo.findById(escalationId);
    if (!esc) throw new HttpError(404, 'Escalation not found');
    if (!esc.is_active) throw new HttpError(409, `Escalation is no longer active (status='${esc.status}')`);

    const now = new Date();
    const updated = await marketplaceDeliveryEscalationRepo.update(esc.id, {
      status: 'resolved_buyer',
      is_active: false,
      resolved_at: now,
      resolved_by_user_id: actor!.user.id,
      resolution_notes: resolutionNotes,
    });
    await marketplaceOrderRepo.update(esc.marketplace_order_id, { active_escalation_id: null });

    // Audit event.
    try {
      const order = await marketplaceOrderRepo.findById(esc.marketplace_order_id);
      if (order) {
        await marketplaceFinancialEventRepo.append({
          order_id: order.id,
          event_type: 'DELIVERY_ESCALATION_REJECTED',
          currency: 'USD',
          gross_amount_minor: order.snapshot?.gross_price_minor ?? null,
          gateway_fee_minor: order.gateway_fee_minor,
          net_amount_minor: order.net_transaction_value_minor,
          owner_earnings_minor: order.owner_earnings_minor,
          wavelead_commission_minor: order.wavelead_commission_minor,
          payment_reference_normalized: order.payment_reference_normalized,
          actor_user_id: actor!.user.id,
          metadata: { escalation_id: esc.id, resolution_notes: resolutionNotes.slice(0, 1000) },
        });
      }
    } catch { /* audit-only */ }

    return updated;
  },

  /**
   * Fetch the delivery history + current escalation state for the given
   * order. Authorized viewers: buyer, owner, or admin.
   */
  async getDeliveryHistory(actor: Actor | null, orderId: string): Promise<{
    order: MarketplaceOrder;
    submissions: MarketplaceDeliverySubmission[];
    escalation: MarketplaceDeliveryEscalation | null;
    review_sla_hours: number;
  }> {
    if (!actor) throw new HttpError(401, 'You must be signed in');
    const order = await marketplaceOrderRepo.findById(orderId);
    if (!order) throw new HttpError(404, 'Order not found');
    const isAdmin = hasAtLeastRole(actor.user, ROLES.ADMIN);
    if (!isAdmin && actor.user.id !== order.owner_user_id && actor.user.id !== order.buyer_user_id) {
      throw new HttpError(403, 'You do not have access to this order\'s delivery history');
    }
    const submissions = await marketplaceDeliverySubmissionRepo.listByOrder(order.id);
    const escalation = await marketplaceDeliveryEscalationRepo.findActiveByOrder(order.id);
    return { order, submissions, escalation, review_sla_hours: getReviewSlaHours() };
  },

  /**
   * Admin — list all active or recent escalations for the Delivery Reviews tab.
   */
  async adminListEscalations(actor: Actor | null, filter: { is_active?: boolean } = {}): Promise<MarketplaceDeliveryEscalation[]> {
    requireAdmin(actor);
    return marketplaceDeliveryEscalationRepo.listAdmin(filter);
  },

  // ==========================================================================
  // B3.2 Gate C — Owner earnings + payout account
  // ==========================================================================

  /**
   * Upsert (create-or-replace) an owner's PayPal payout email. The address
   * is stored unverified and a short-lived numeric verification code is
   * returned so the owner can prove control of the inbox. Repeating the
   * same address is idempotent: it does NOT invalidate an already-verified
   * method. Setting a DIFFERENT address atomically deactivates any
   * previously-active method and creates a new unverified row.
   *
   * NOTE: In production this endpoint MUST also trigger an actual email
   * delivery of the verification code. For the current MVP, the response
   * body includes the code so the owner can enter it back into the UI —
   * documented clearly to make the email-delivery TODO explicit.
   */
  async ownerUpsertPayoutMethod(actor: Actor | null, input: unknown): Promise<{
    method: OwnerPayoutMethodMasked;
    verification_required: boolean;
    verification_code_dev?: string;              // present ONLY in non-production
    email_delivery_pending?: true;               // set when no email primitive is wired
    verification_delivery: 'sent' | 'unavailable' | 'dev_only';
  }> {
    if (!actor) throw new HttpError(401, 'You must be signed in');
    const schema = z.object({ paypal_email: z.string().trim().min(3).max(320) });
    const parsed = schema.safeParse(input);
    if (!parsed.success) throw new HttpError(400, 'paypal_email is required');
    const raw = parsed.data.paypal_email;
    if (!EMAIL_RE.test(raw)) throw new HttpError(400, 'paypal_email is not a valid email address');
    const normalized = normalizeEmail(raw);

    const now = new Date();
    const existing = await ownerPayoutMethodRepo.findActiveByOwner(actor.user.id);

    // Idempotent same-email path.
    if (existing && existing.paypal_email_normalized === normalized) {
      if (existing.verified_at) {
        return { method: maskPayoutMethod(existing), verification_required: false, verification_delivery: 'sent' };
      }
      const code = await this._reissueVerificationCode(existing.id);
      return this._verificationResponse(existing, code);
    }

    // New/different email: deactivate old, insert new (unverified).
    if (existing) {
      await ownerPayoutMethodRepo.deactivateActive(actor.user.id);
    }
    const code = generateVerificationCode();
    const method: OwnerPayoutMethod = {
      id: uuidv4(),
      owner_user_id: actor.user.id,
      method: 'paypal',
      paypal_email_normalized: normalized,
      paypal_email_display: raw,
      is_active: true,
      verified_at: null,
      verification_code_hash: hashVerificationCode(code),
      verification_sent_at: now,
      verification_attempts: 0,
      created_at: now,
      updated_at: now,
    };
    await ownerPayoutMethodRepo.insert(method);
    return this._verificationResponse(method, code);
  },

  /**
   * Internal — shape the verification response with production-safe fields.
   *
   * Production rules:
   *   • NEVER return `verification_code_dev` (regardless of email delivery)
   *   • If NO email delivery primitive exists → `verification_delivery='unavailable'`,
   *     method stays pending forever, automated verify path is closed;
   *     manual admin external payout remains the launch fallback.
   *   • If email delivery exists → `verification_delivery='sent'` (the actual
   *     email hook lives elsewhere; this service layer only stores the hash
   *     and returns the delivery status).
   *
   * Non-production: `verification_code_dev` is returned so local dev/test
   * can exercise the full flow without wiring an email service.
   */
  _verificationResponse(method: OwnerPayoutMethod, code: string): {
    method: OwnerPayoutMethodMasked;
    verification_required: boolean;
    verification_code_dev?: string;
    email_delivery_pending?: true;
    verification_delivery: 'sent' | 'unavailable' | 'dev_only';
  } {
    if (isProduction()) {
      if (hasEmailDelivery()) {
        // Production email delivery is present — the email-hook layer is
        // responsible for actually sending the code. Do NOT return the code.
        return {
          method: maskPayoutMethod(method),
          verification_required: true,
          verification_delivery: 'sent',
        };
      }
      // Production without email delivery — verification cannot proceed.
      return {
        method: maskPayoutMethod(method),
        verification_required: true,
        email_delivery_pending: true,
        verification_delivery: 'unavailable',
      };
    }
    // Non-production — return the code so tests + local dev can verify.
    return {
      method: maskPayoutMethod(method),
      verification_required: true,
      verification_code_dev: code,
      email_delivery_pending: true,
      verification_delivery: 'dev_only',
    };
  },

  /**
   * Internal — regenerate a verification code for an existing unverified
   * method (returned only when the caller is the owner of that method).
   */
  async _reissueVerificationCode(methodId: string): Promise<string> {
    const code = generateVerificationCode();
    await ownerPayoutMethodRepo.update(methodId, {
      verification_code_hash: hashVerificationCode(code),
      verification_sent_at: new Date(),
    });
    return code;
  },

  /**
   * Owner verifies control of the declared PayPal email by supplying the
   * numeric code they received. Rejects wrong codes and rate-limits by
   * bumping `verification_attempts`.
   */
  async ownerVerifyPayoutMethod(actor: Actor | null, input: unknown): Promise<OwnerPayoutMethodMasked> {
    if (!actor) throw new HttpError(401, 'You must be signed in');
    const schema = z.object({ verification_code: z.string().trim().min(4).max(12) });
    const parsed = schema.safeParse(input);
    if (!parsed.success) throw new HttpError(400, 'verification_code is required');
    const code = parsed.data.verification_code;

    const m = await ownerPayoutMethodRepo.findActiveByOwner(actor.user.id);
    if (!m) throw new HttpError(404, 'No active payout method to verify');
    if (m.verified_at) return maskPayoutMethod(m);
    if (m.verification_attempts >= 8) {
      throw new HttpError(429, 'Too many attempts — request a new verification code');
    }
    const provided = hashVerificationCode(code);
    if (provided !== m.verification_code_hash) {
      await ownerPayoutMethodRepo.update(m.id, { verification_attempts: m.verification_attempts + 1 });
      throw new HttpError(400, 'Verification code is incorrect');
    }
    const updated = await ownerPayoutMethodRepo.update(m.id, {
      verified_at: new Date(),
      verification_code_hash: null,
    });
    return maskPayoutMethod(updated);
  },

  /**
   * Owner reads their currently-active payout method (masked).
   */
  async ownerGetPayoutMethod(actor: Actor | null): Promise<OwnerPayoutMethodMasked | null> {
    if (!actor) throw new HttpError(401, 'You must be signed in');
    const m = await ownerPayoutMethodRepo.findActiveByOwner(actor.user.id);
    return m ? maskPayoutMethod(m) : null;
  },

  /**
   * Owner earnings rollup — buckets the owner's completed orders into
   * three settlement-aware groups and includes per-order history rows.
   *
   *   pending_earnings  = eligible_for_payout AND payout_available_at > now
   *   available_payout  = eligible_for_payout AND payout_available_at <= now
   *   paid_out          = owner_payable_status='paid_out'
   *
   * Blocked / manual_reconciliation_required orders are surfaced separately
   * so the owner sees WHY certain earnings are held.
   */
  async ownerListEarnings(actor: Actor | null): Promise<{
    settlement_hold_hours: number;
    payout_method: OwnerPayoutMethodMasked | null;
    totals: {
      pending_earnings_minor: number;
      available_payout_minor: number;
      paid_out_minor: number;
      blocked_minor: number;
      currency: 'USD';
    };
    orders: Array<{
      id: string;
      channel_slug: string;
      buyer_company: string;
      completed_at: Date | null;
      payout_available_at: Date | null;
      payout_requested_at: Date | null;
      owner_earnings_minor: number | null;
      owner_payable_status: OwnerPayableStatus;
      bucket: 'pending' | 'available' | 'paid_out' | 'blocked';
    }>;
  }> {
    if (!actor) throw new HttpError(401, 'You must be signed in');
    const orders = await marketplaceOrderRepo.listByOwner(actor.user.id);
    const nowMs = Date.now();
    let pending = 0, available = 0, paidOut = 0, blocked = 0;
    const rows = orders
      .filter((o) => ['completed', 'paid', 'in_progress', 'submitted_for_review', 'revision_requested'].includes(o.status))
      .map((o) => {
        const amt = o.owner_earnings_minor ?? 0;
        let bucket: 'pending' | 'available' | 'paid_out' | 'blocked';
        if (o.owner_payable_status === 'paid_out') { paidOut += amt; bucket = 'paid_out'; }
        else if (o.owner_payable_status === 'eligible_for_payout') {
          const availableAt = o.payout_available_at ? new Date(o.payout_available_at).getTime() : 0;
          if (availableAt && availableAt > nowMs) { pending += amt; bucket = 'pending'; }
          else { available += amt; bucket = 'available'; }
        }
        else if (o.owner_payable_status === 'manual_reconciliation_required' || o.owner_payable_status === 'blocked_fee_reconciliation') {
          blocked += amt; bucket = 'blocked';
        }
        else {
          pending += amt; bucket = 'pending';
        }
        return {
          id: o.id,
          channel_slug: o.snapshot?.channel_slug || o.channel_slug,
          buyer_company: o.brief.company_name,
          completed_at: o.completed_at,
          payout_available_at: o.payout_available_at || null,
          payout_requested_at: o.payout_requested_at || null,
          owner_earnings_minor: o.owner_earnings_minor,
          owner_payable_status: o.owner_payable_status,
          bucket,
        };
      });
    const method = await ownerPayoutMethodRepo.findActiveByOwner(actor.user.id);
    return {
      settlement_hold_hours: getSettlementHoldHours(),
      payout_method: method ? maskPayoutMethod(method) : null,
      totals: {
        pending_earnings_minor: pending,
        available_payout_minor: available,
        paid_out_minor: paidOut,
        blocked_minor: blocked,
        currency: 'USD',
      },
      orders: rows,
    };
  },

  /**
   * Owner requests an external payout for a specific completed order.
   * Sets a `payout_requested_at` marker and appends an
   * `OWNER_PAYOUT_REQUESTED` audit event. Does NOT send money. Manual
   * external payout via `adminRecordPayout` remains the fulfillment
   * pathway until Gate D lands automated PayPal Payouts.
   *
   * Preconditions:
   *   • owner_payable_status = 'eligible_for_payout'
   *   • payout_available_at ≤ now (settlement hold elapsed)
   *   • not already paid_out
   *   • not payment_reconciliation_required
   *   • owner has a verified active payout method
   */
  async ownerRequestPayout(actor: Actor | null, orderId: string): Promise<MarketplaceOrder> {
    if (!actor) throw new HttpError(401, 'You must be signed in');
    const order = await marketplaceOrderRepo.findById(orderId);
    if (!order) throw new HttpError(404, 'Order not found');
    if (order.owner_user_id !== actor.user.id) throw new HttpError(403, 'Only the channel owner may request a payout');
    if (order.payment_reconciliation_required) {
      throw new HttpError(409, 'Cannot request payout: payment reconciliation required for this order');
    }
    if (order.owner_payable_status === 'paid_out') {
      throw new HttpError(409, 'This order is already paid out');
    }
    if (order.owner_payable_status !== 'eligible_for_payout') {
      throw new HttpError(400, `Cannot request payout: owner payable status is '${order.owner_payable_status}'`);
    }
    const availableAtMs = order.payout_available_at ? new Date(order.payout_available_at).getTime() : Infinity;
    if (availableAtMs > Date.now()) {
      throw new HttpError(400, `Cannot request payout yet: settlement hold has not elapsed (${getSettlementHoldHours()}h)`);
    }
    const method = await ownerPayoutMethodRepo.findActiveByOwner(actor.user.id);
    if (!method || !method.verified_at) {
      throw new HttpError(400, 'Cannot request payout: a verified PayPal payout account is required');
    }

    // Idempotent: repeated calls just refresh the timestamp; audit event
    // is appended exactly once (guarded by a per-order lookup).
    const events = await marketplaceFinancialEventRepo.listByOrder(order.id);
    const alreadyRequested = events.some((e) => e.event_type === 'OWNER_PAYOUT_REQUESTED');
    const now = new Date();
    const updated = await marketplaceOrderRepo.update(order.id, {
      payout_requested_at: now,
      payout_method_id: method.id,
    });
    if (!alreadyRequested) {
      try {
        await marketplaceFinancialEventRepo.append({
          order_id: order.id,
          event_type: 'OWNER_PAYOUT_REQUESTED',
          currency: 'USD',
          gross_amount_minor: order.snapshot?.gross_price_minor ?? null,
          gateway_fee_minor: order.gateway_fee_minor,
          net_amount_minor: order.net_transaction_value_minor,
          owner_earnings_minor: order.owner_earnings_minor,
          wavelead_commission_minor: order.wavelead_commission_minor,
          payment_reference_normalized: order.payment_reference_normalized,
          actor_user_id: actor.user.id,
          metadata: { payout_method_id: method.id, method: 'paypal' },
        });
      } catch { /* audit-only */ }
    }
    return updated;
  },

  /**
   * Admin — list owner payout methods (masked). Never exposes verification
   * hashes or unmasked emails.
   */
  async adminListPayoutMethods(actor: Actor | null): Promise<OwnerPayoutMethodMasked[]> {
    requireAdmin(actor);
    const list = await ownerPayoutMethodRepo.listAdmin();
    return list.map(maskPayoutMethod);
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
   *
   * B3.2 Gate B — also appends the Gate B semantic audit events
   * (DELIVERY_ACCEPTED / DELIVERY_ADMIN_APPROVED) and closes any active
   * escalation.
   */
  async _finalizeCompletion(
    order: MarketplaceOrder,
    who: { completed_by: string; completion_source: 'buyer' | 'admin' | 'admin_delivery_resolution'; completion_note: string | null },
  ): Promise<MarketplaceOrder> {
    const now = new Date();
    const nextPayable = deriveOwnerPayableAfterCompletion(order);
    // B3.2 Gate C — capture the settlement hold at completion.
    const holdHours = getSettlementHoldHours();
    const payoutAvailableAt: Date | null = nextPayable === 'eligible_for_payout'
      ? new Date(now.getTime() + holdHours * 3600 * 1000)
      : null;
    const updated = await marketplaceOrderRepo.update(order.id, {
      status: 'completed',
      completed_at: now,
      completed_by: who.completed_by,
      completion_source: who.completion_source,
      completion_note: who.completion_note,
      owner_payable_status: nextPayable,
      settlement_hold_hours: holdHours,
      payout_available_at: payoutAvailableAt,
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
    // B3.2 Gate B — semantic audit events for buyer accept / admin resolution.
    if (who.completion_source === 'buyer') {
      try {
        await marketplaceFinancialEventRepo.append({
          order_id: order.id,
          event_type: 'DELIVERY_ACCEPTED',
          currency: 'USD',
          gross_amount_minor: order.snapshot?.gross_price_minor ?? null,
          gateway_fee_minor: order.gateway_fee_minor,
          net_amount_minor: order.net_transaction_value_minor,
          owner_earnings_minor: order.owner_earnings_minor,
          wavelead_commission_minor: order.wavelead_commission_minor,
          payment_reference_normalized: order.payment_reference_normalized,
          actor_user_id: who.completed_by,
          metadata: { submission_id: order.latest_submission_id || null },
        });
      } catch { /* audit-only */ }
    }
    if (who.completion_source === 'admin_delivery_resolution') {
      try {
        await marketplaceFinancialEventRepo.append({
          order_id: order.id,
          event_type: 'DELIVERY_ADMIN_APPROVED',
          currency: 'USD',
          gross_amount_minor: order.snapshot?.gross_price_minor ?? null,
          gateway_fee_minor: order.gateway_fee_minor,
          net_amount_minor: order.net_transaction_value_minor,
          owner_earnings_minor: order.owner_earnings_minor,
          wavelead_commission_minor: order.wavelead_commission_minor,
          payment_reference_normalized: order.payment_reference_normalized,
          actor_user_id: who.completed_by,
          metadata: { submission_id: order.latest_submission_id || null, completion_note: who.completion_note },
        });
      } catch { /* audit-only */ }
    }
    // Close any currently-active escalation atomically.
    if (order.active_escalation_id) {
      try {
        const reason: 'buyer_accepted_during_review' | 'buyer_no_response' =
          who.completion_source === 'buyer' ? 'buyer_accepted_during_review' : 'buyer_no_response';
        const closed = await marketplaceDeliveryEscalationRepo.closeActive(order.id, {
          status: 'resolved_owner',
          resolved_at: now,
          resolved_by_user_id: who.completed_by,
          resolution_notes: who.completion_source === 'buyer'
            ? 'Buyer accepted delivery — escalation closed automatically'
            : (who.completion_note || 'Admin approved delivery'),
          reason: reason as MarketplaceDeliveryEscalation['reason'],
        });
        if (closed) {
          await marketplaceOrderRepo.update(order.id, { active_escalation_id: null });
        }
      } catch { /* escalation close is best-effort — audit-only */ }
    }
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
    return this._finalizeCapturedAttempt(a, cap.provider_capture_id!, cap.amount_captured_minor, cap.provider_fee_minor ?? null, cap.provider_net_minor ?? null);
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
    // B3.2 — fee backfill path. If the attempt is already captured but the
    // fee was unknown at capture time (browser-return path had no seller_-
    // receivable_breakdown), a later CAPTURE.COMPLETED webhook carrying the
    // exact fee is our chance to finalize economics. This is separately
    // idempotent — subsequent replays with the same fee no-op.
    if (a.status === 'captured') {
      if (provider_fee_minor !== null && provider_fee_minor !== undefined && a.provider_fee_minor === null) {
        // Optional sanity: the webhook capture id must match the attempt's
        // capture id (both should be the SAME capture). If they diverge,
        // do NOT backfill — this is a different capture event and requires
        // manual review.
        if (a.provider_capture_id && provider_capture_id && a.provider_capture_id !== provider_capture_id) return a;
        await this._backfillCaptureFee(a.id, provider_fee_minor, provider_net_minor);
        return (await marketplacePaymentAttemptRepo.findById(a.id))!;
      }
      return a;
    }
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

  // ============================================================================
  // Phase B3.2 — Automatic PayPal Fee Reconciliation
  // ----------------------------------------------------------------------------
  // Centralized "we now know the exact fee — finalize economics" path. Used
  // by BOTH the webhook backfill (finalizeMarketplaceCaptureFromWebhook) AND
  // the admin-triggered PayPal capture-details lookup. Never estimates a fee.
  //
  // Idempotency guard: only runs when `attempt.provider_fee_minor === null`.
  // Post-condition: attempt.provider_fee_minor set, order.economics_status
  // = 'finalized', order.owner_payable_status advanced to
  // 'payable_pending_delivery' (unless overridden by refund/reversal safety
  // state), one GATEWAY_FEE_RECONCILED financial event appended, and NO
  // duplicate PAYMENT_CONFIRMED added.
  // ============================================================================
  async _backfillCaptureFee(
    attempt_id: string,
    provider_fee_minor: number,
    provider_net_minor: number | null,
  ): Promise<MarketplacePaymentAttempt> {
    // Atomic idempotency: only update when fee is currently null. Repeated
    // webhook / admin calls that would apply the same fee become no-ops.
    const patched = await marketplacePaymentAttemptRepo.transitionIfIn(attempt_id, ['captured'], 'captured', {
      provider_fee_minor,
      provider_net_minor: provider_net_minor ?? null,
    });
    if (!patched) {
      // Row moved terminal (reversed/failed). Nothing to backfill.
      const cur = await marketplacePaymentAttemptRepo.findById(attempt_id);
      return cur!;
    }
    // Second guard: another worker may have flipped the fee between our read
    // and this write. Detect and no-op.
    if (patched.provider_fee_minor !== provider_fee_minor && patched.provider_fee_minor !== null) {
      return patched;
    }

    const order = await marketplaceOrderRepo.findById(patched.marketplace_order_id);
    if (!order || !order.snapshot) return patched;

    // Defense-in-depth: never rewrite historical economics or bypass
    // reconciliation flags.
    if (order.payment_reconciliation_required) return patched;
    // If the order was already finalized somehow (e.g. an earlier webhook
    // ran through the initial-capture code path), do not double-append.
    if (order.economics_status === 'finalized' && order.gateway_fee_minor !== null && order.gateway_fee_minor !== undefined) return patched;

    const gross = order.snapshot.gross_price_minor;
    const split = computeSplit(gross, provider_fee_minor);
    const patch: Partial<MarketplaceOrder> = {
      economics_status: 'finalized',
      gateway_fee_minor: provider_fee_minor,
      net_transaction_value_minor: split.net_minor,
      owner_earnings_minor: split.owner_earnings_minor,
      wavelead_commission_minor: split.wavelead_commission_minor,
      owner_payable_status: order.owner_payable_status === 'paid_out' ? 'paid_out' : 'payable_pending_delivery',
    };
    await marketplaceOrderRepo.update(order.id, patch);

    try {
      await marketplaceFinancialEventRepo.append({
        order_id: order.id,
        event_type: 'GATEWAY_FEE_RECONCILED',
        currency: 'USD',
        gross_amount_minor: gross,
        gateway_fee_minor: provider_fee_minor,
        net_amount_minor: split.net_minor,
        owner_earnings_minor: split.owner_earnings_minor,
        wavelead_commission_minor: split.wavelead_commission_minor,
        payment_reference_normalized: (patched.provider_capture_id || '').toLowerCase(),
        actor_user_id: 'system',
        metadata: {
          source: 'automatic_backfill',
          provider: 'paypal',
          provider_capture_id: patched.provider_capture_id,
          attempt_id: patched.id,
          fee_source: 'provider',
        },
      });
    } catch (e) {
      // Duplicate append (rare race) is a safe no-op for idempotency.
      if (!/E11000|duplicate key/i.test((e as Error).message)) throw e;
    }
    return (await marketplacePaymentAttemptRepo.findById(patched.id))!;
  },

  /**
   * Admin-triggered "reconcile fee from PayPal" — read-only PayPal call to
   * `/v2/payments/captures/:id`, then apply the same idempotent backfill.
   * Used when the CAPTURE.COMPLETED webhook did not arrive or arrived
   * without the seller_receivable_breakdown.
   */
  async adminReconcileFeeFromProvider(actor: Actor | null, attempt_id: string): Promise<{
    ok: boolean;
    fee_before: number | null;
    fee_after: number | null;
    net_after: number | null;
    provider_fee_returned: number | null;
  }> {
    requireAdmin(actor);
    const a = await marketplacePaymentAttemptRepo.findById(attempt_id);
    if (!a) throw new HttpError(404, 'Payment attempt not found');
    if (a.provider !== 'paypal') throw new HttpError(400, 'This attempt is not a PayPal attempt');
    if (a.status !== 'captured') throw new HttpError(409, `Attempt is in status "${a.status}" — only captured attempts can be fee-reconciled`);
    if (!a.provider_capture_id) throw new HttpError(400, 'Attempt has no provider capture id yet');
    if (a.provider_fee_minor !== null && a.provider_fee_minor !== undefined) {
      return { ok: true, fee_before: a.provider_fee_minor, fee_after: a.provider_fee_minor, net_after: a.provider_net_minor ?? null, provider_fee_returned: a.provider_fee_minor };
    }

    const { getPaymentProvider } = await import('./payments/providerFactory');
    const provider = getPaymentProvider();
    if (typeof (provider as { retrieveCapture?: unknown }).retrieveCapture !== 'function') {
      throw new HttpError(501, 'Configured payment provider does not support capture-details lookup');
    }
    const cap = await (provider as { retrieveCapture: (i: { provider_capture_id: string }) => Promise<{
      provider_fee_minor: number | null; provider_net_minor: number | null;
    }> }).retrieveCapture({ provider_capture_id: a.provider_capture_id });
    if (cap.provider_fee_minor === null || cap.provider_fee_minor === undefined) {
      return { ok: false, fee_before: null, fee_after: null, net_after: null, provider_fee_returned: null };
    }
    await this._backfillCaptureFee(a.id, cap.provider_fee_minor, cap.provider_net_minor ?? null);
    const after = (await marketplacePaymentAttemptRepo.findById(a.id))!;
    return {
      ok: true,
      fee_before: null,
      fee_after: after.provider_fee_minor ?? null,
      net_after: after.provider_net_minor ?? null,
      provider_fee_returned: cap.provider_fee_minor,
    };
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
