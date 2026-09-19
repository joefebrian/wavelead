// M17 — Brand Pro Founding Beta: $15 / 30 days, MANUAL renewal.
//
// Domain contract (deliberately isolated):
//   • purpose = 'BRAND_PRO_FOUNDING_BETA_TERM'. NEVER reuses
//     the Owner Activation, Founding Lifetime or Marketplace domains.
//   • Server-authoritative: 1500 USD minor, 30-day term. The browser cannot
//     override price, currency, term or purpose.
//   • PayPal order creation grants NOTHING. Browser return grants NOTHING.
//     Only an authoritative finalized capture grants a 30-day term.
//   • This is NOT an auto-recurring subscription. One payment = 30 days;
//     the brand renews manually.
//   • Renewal of a still-active membership extends from period_end_at (no
//     paid days are discarded). Renewal after expiry starts at capture time.
//   • Expiry removes premium access ONLY. No account/campaign/analytics/
//     sponsorship/conversation/payment history is ever deleted.
import { v4 as uuidv4 } from 'uuid';
import { HttpError, requireAuth, ROLES, rankOf } from '@/lib/auth/rbac';
import { getCollection } from '@/lib/db/mongo';
import { COLLECTIONS } from '@/lib/db/collections';
import { getPaymentProvider } from '@/lib/services/payments/providerFactory';
import { readActiveEnvironment } from '@/lib/services/payments/paypalConfigService';
import { getConfiguredOrigin } from '@/lib/utils/canonicalOrigin';
import { brandEntitlementService } from './brandEntitlementService';
import { userRepo } from '@/lib/repositories/userRepo';
import { sendMailBestEffort, hasSmtpTransport, appOrigin } from './mailer';
import type { Actor } from '@/lib/types';

// ---------------------------------------------------------------------------
// Server-owned commercial constants. Client can NEVER influence these.
// ---------------------------------------------------------------------------
export const BRAND_PRO_PURPOSE = 'BRAND_PRO_FOUNDING_BETA_TERM' as const;
export const BRAND_PRO_AMOUNT_MINOR = 1500;          // $15.00 USD
export const BRAND_PRO_CURRENCY = 'USD' as const;
export const BRAND_PRO_TERM_DAYS = 30;
export const BRAND_PRO_REMINDER_DAYS_BEFORE = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

export type BrandProOrderStatus =
  | 'created' | 'checkout_created' | 'pending'
  | 'captured_finalized' | 'failed' | 'cancelled' | 'refunded';

export interface BrandProTermOrder {
  id: string;
  user_id: string;
  purpose: typeof BRAND_PRO_PURPOSE;
  provider: 'paypal';
  provider_environment: string;
  currency: 'USD';
  gross_amount_minor: number;
  term_days: number;
  status: BrandProOrderStatus;
  provider_order_id: string | null;
  provider_capture_id: string | null;
  approve_url: string | null;
  return_url: string;
  cancel_url: string;
  amount_captured_minor: number;
  membership_id: string | null;
  period_start_at: Date | null;
  period_end_at: Date | null;
  paid_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export type BrandProMembershipStatus = 'active' | 'expired' | 'refunded';

export interface BrandProMembership {
  id: string;
  user_id: string;
  status: BrandProMembershipStatus;
  period_start_at: Date;
  period_end_at: Date;
  terms_paid: number;
  gross_amount_minor: number;          // cumulative paid for this membership
  currency: 'USD';
  provider: 'paypal';
  provider_environment: string;
  last_provider_order_id: string | null;
  last_provider_capture_id: string | null;
  paid_at: Date | null;
  reminder_sent_for_period_end_at: Date | null;
  reminder_sent_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

async function orderCol() { return getCollection<BrandProTermOrder>(COLLECTIONS.BRAND_PRO_TERM_ORDERS); }
async function memberCol() { return getCollection<BrandProMembership>(COLLECTIONS.BRAND_PRO_MEMBERSHIPS); }

async function currentEnvironment(): Promise<string> {
  try { const r = await readActiveEnvironment(); return (r?.environment as string) || 'sandbox'; } catch { return 'sandbox'; }
}

/** Mask provider references for admin/report surfaces. */
export function maskRef(v: string | null | undefined): string | null {
  if (!v) return null;
  if (v.length <= 6) return `${v.slice(0, 2)}****`;
  return `${v.slice(0, 4)}****${v.slice(-2)}`;
}

function isActive(m: BrandProMembership | null, now = new Date()): boolean {
  return !!m && m.status === 'active' && new Date(m.period_end_at).getTime() > now.getTime();
}

export function publicMembershipView(m: BrandProMembership | null, now = new Date()) {
  if (!m) return { plan: 'brand_free', status: 'none' as const, period_end_at: null, days_remaining: 0, terms_paid: 0 };
  const end = new Date(m.period_end_at).getTime();
  const active = isActive(m, now);
  return {
    plan: active ? 'brand_pro' : 'brand_free',
    status: active ? ('active' as const) : (m.status === 'refunded' ? ('refunded' as const) : ('expired' as const)),
    period_start_at: m.period_start_at,
    period_end_at: m.period_end_at,
    days_remaining: active ? Math.max(0, Math.ceil((end - now.getTime()) / DAY_MS)) : 0,
    terms_paid: m.terms_paid,
  };
}

export const brandProService = {
  BRAND_PRO_PURPOSE,
  BRAND_PRO_AMOUNT_MINOR,
  BRAND_PRO_CURRENCY,
  BRAND_PRO_TERM_DAYS,

  /** Current membership row (may be expired). */
  async findMembership(userId: string): Promise<BrandProMembership | null> {
    const c = await memberCol();
    return c.find({ user_id: userId }).sort({ created_at: -1 }).limit(1).next();
  },

  /** Brand-facing state. Expired → Brand Free fallback, history preserved. */
  async getStateForActor(actor: Actor | null) {
    requireAuth(actor);
    const m = await this.findMembership(actor!.user.id);
    const c = await orderCol();
    const orders = await c.find({ user_id: actor!.user.id }).sort({ created_at: -1 }).limit(20).toArray();
    return {
      price_minor: BRAND_PRO_AMOUNT_MINOR,
      currency: BRAND_PRO_CURRENCY,
      term_days: BRAND_PRO_TERM_DAYS,
      auto_recurring: false,
      renewal: 'manual' as const,
      membership: publicMembershipView(m),
      payment_history: orders.map((o) => ({
        id: o.id,
        status: o.status,
        gross_amount_minor: o.gross_amount_minor,
        currency: o.currency,
        paid_at: o.paid_at,
        period_start_at: o.period_start_at,
        period_end_at: o.period_end_at,
        provider_order_id_masked: maskRef(o.provider_order_id),
      })),
    };
  },

  /**
   * Start a $15 / 30-day checkout. Reuses an existing open order (idempotent
   * against repeated clicks). Creating the order grants NOTHING.
   */
  async startCheckout(actor: Actor | null, requestOrigin?: string) {
    requireAuth(actor);
    const c = await orderCol();
    const open = await c.find({
      user_id: actor!.user.id,
      status: { $in: ['created', 'checkout_created', 'pending'] },
    }).sort({ created_at: -1 }).limit(1).next();
    if (open) return this.toCheckoutView(open);

    const id = uuidv4();
    const now = new Date();
    const base = (requestOrigin || getConfiguredOrigin() || 'http://localhost:3000').replace(/\/$/, '');
    const return_url = `${base}/dashboard/billing?brand_pro=${id}&status=paid`;
    const cancel_url = `${base}/dashboard/billing?brand_pro=${id}&status=cancelled`;
    const doc: BrandProTermOrder = {
      id, user_id: actor!.user.id,
      purpose: BRAND_PRO_PURPOSE,
      provider: 'paypal',
      provider_environment: await currentEnvironment(),
      currency: BRAND_PRO_CURRENCY,
      gross_amount_minor: BRAND_PRO_AMOUNT_MINOR,   // server-authoritative
      term_days: BRAND_PRO_TERM_DAYS,               // server-authoritative
      status: 'created',
      provider_order_id: null, provider_capture_id: null, approve_url: null,
      return_url, cancel_url,
      amount_captured_minor: 0,
      membership_id: null, period_start_at: null, period_end_at: null, paid_at: null,
      created_at: now, updated_at: now,
    };
    await c.insertOne(doc as never);
    try {
      const provider = getPaymentProvider();
      const created = await provider.createPayment({
        funding_id: id,
        amount_minor: BRAND_PRO_AMOUNT_MINOR,
        currency: BRAND_PRO_CURRENCY,
        description: 'WaveLead Brand Pro Founding Beta — 30 days',
        return_url, cancel_url,
        metadata: { campaign_id: id, owner_user_id: actor!.user.id },
      });
      await c.updateOne({ id, status: 'created' }, {
        $set: {
          status: 'checkout_created',
          provider_order_id: created.provider_order_id,
          approve_url: created.approve_url,
          updated_at: new Date(),
        },
      });
      return this.toCheckoutView((await c.findOne({ id }))!);
    } catch (err) {
      await c.updateOne({ id }, { $set: { status: 'failed', updated_at: new Date() } });
      throw new HttpError(502, `Payment provider error: ${(err as Error).message}`);
    }
  },

  toCheckoutView(o: BrandProTermOrder) {
    return {
      id: o.id,
      status: o.status,
      gross_amount_minor: o.gross_amount_minor,
      currency: o.currency,
      term_days: o.term_days,
      approve_url: o.approve_url,
      provider_environment: o.provider_environment,
      auto_recurring: false,
    };
  },

  async findByProviderOrderId(provider_order_id: string): Promise<BrandProTermOrder | null> {
    const c = await orderCol();
    return c.findOne({ provider_order_id });
  },

  /**
   * AUTHORITATIVE capture + term grant. Callable from browser-return AND
   * webhook — fully idempotent: a replayed capture never extends the term
   * twice (guarded by the status transition on the order row).
   */
  async captureAndGrant(orderId: string): Promise<BrandProTermOrder | null> {
    const c = await orderCol();
    const o = await c.findOne({ id: orderId });
    if (!o) throw new HttpError(404, 'Brand Pro order not found');
    if (o.status === 'captured_finalized' || o.status === 'refunded') return o;   // idempotent
    if (!o.provider_order_id) throw new HttpError(400, 'No provider order id on this Brand Pro order');

    const provider = getPaymentProvider();
    const cap = await provider.capturePayment({ provider_order_id: o.provider_order_id });
    if (cap.internal_status !== 'paid') {
      const next: BrandProOrderStatus = cap.internal_status === 'failed' ? 'failed'
        : cap.internal_status === 'cancelled' ? 'cancelled' : 'pending';
      await c.updateOne({ id: orderId, status: { $in: ['created', 'checkout_created', 'pending'] } }, {
        $set: { status: next, provider_capture_id: cap.provider_capture_id ?? null, updated_at: new Date() },
      });
      return c.findOne({ id: orderId });
    }

    // Claim the finalization exactly once.
    const claim = await c.updateOne(
      { id: orderId, status: { $in: ['created', 'checkout_created', 'pending'] } },
      { $set: { status: 'captured_finalized', provider_capture_id: cap.provider_capture_id ?? null, amount_captured_minor: cap.amount_captured_minor, paid_at: new Date(), updated_at: new Date() } },
    );
    if (claim.modifiedCount !== 1) return c.findOne({ id: orderId });   // someone else finalized

    const { membership } = await this.grantTerm(o.user_id, {
      order_id: o.id,
      provider_order_id: o.provider_order_id,
      provider_capture_id: cap.provider_capture_id ?? null,
      provider_environment: o.provider_environment,
      gross_amount_minor: o.gross_amount_minor,
    });
    await c.updateOne({ id: orderId }, {
      $set: {
        membership_id: membership.id,
        period_start_at: membership.period_start_at,
        period_end_at: membership.period_end_at,
        updated_at: new Date(),
      },
    });
    return c.findOne({ id: orderId });
  },

  /**
   * Term arithmetic: active membership → extend from period_end_at;
   * expired/none → start at now. Also refreshes the brand_pro entitlement
   * grant (existing brand entitlement architecture, scope='brand').
   */
  async grantTerm(userId: string, src: {
    order_id: string;
    provider_order_id: string | null;
    provider_capture_id: string | null;
    provider_environment: string;
    gross_amount_minor: number;
  }): Promise<{ membership: BrandProMembership; extended: boolean }> {
    const c = await memberCol();
    const now = new Date();
    const existing = await this.findMembership(userId);
    const active = isActive(existing, now);
    const start = active ? new Date(existing!.period_start_at) : now;
    const anchor = active ? new Date(existing!.period_end_at) : now;
    const end = new Date(anchor.getTime() + BRAND_PRO_TERM_DAYS * DAY_MS);

    let membership: BrandProMembership;
    if (existing) {
      await c.updateOne({ id: existing.id }, {
        $set: {
          status: 'active',
          period_start_at: start,
          period_end_at: end,
          terms_paid: (existing.terms_paid || 0) + 1,
          gross_amount_minor: (existing.gross_amount_minor || 0) + src.gross_amount_minor,
          provider_environment: src.provider_environment,
          last_provider_order_id: src.provider_order_id,
          last_provider_capture_id: src.provider_capture_id,
          paid_at: now,
          // New period → a new H-7 reminder becomes eligible.
          reminder_sent_for_period_end_at: null,
          reminder_sent_at: null,
          updated_at: now,
        },
      });
      membership = (await c.findOne({ id: existing.id }))!;
    } else {
      membership = {
        id: uuidv4(), user_id: userId, status: 'active',
        period_start_at: start, period_end_at: end,
        terms_paid: 1,
        gross_amount_minor: src.gross_amount_minor,
        currency: BRAND_PRO_CURRENCY,
        provider: 'paypal',
        provider_environment: src.provider_environment,
        last_provider_order_id: src.provider_order_id,
        last_provider_capture_id: src.provider_capture_id,
        paid_at: now,
        reminder_sent_for_period_end_at: null, reminder_sent_at: null,
        created_at: now, updated_at: now,
      };
      await c.insertOne(membership as never);
    }

    // Entitlement grant (idempotent per paid order) — premium access only.
    try {
      const existingGrant = await brandEntitlementService.findActiveGrant(userId, 'brand_pro');
      if (existingGrant) {
        const gc = await getCollection<{ id: string }>(COLLECTIONS.BRAND_ENTITLEMENT_GRANTS);
        await gc.updateOne({ id: existingGrant.id }, { $set: { valid_until: membership.period_end_at, status: 'active', updated_at: now } } as never);
      } else {
        await brandEntitlementService.createGrantIdempotent({
          user_id: userId,
          entitlement_set: 'brand_pro',
          source: 'brand_pro_subscription',
          source_id: src.order_id,
          pricing_snapshot_id: null,
          idempotency_key: `brand_pro_term_grant:${src.order_id}`,
          valid_until: membership.period_end_at,
        });
      }
    } catch { /* entitlement projection is best-effort; membership is authoritative */ }

    return { membership, extended: active };
  },

  /** Maintenance: flip overdue memberships to expired (premium access only). */
  async expireOverdue(now = new Date()): Promise<number> {
    const c = await memberCol();
    const r = await c.updateMany(
      { status: 'active', period_end_at: { $lt: now } },
      { $set: { status: 'expired', updated_at: new Date() } },
    );
    return r.modifiedCount || 0;
  },

  /**
   * H-7 expiry reminders. ONE per active membership period, idempotent via
   * reminder_sent_for_period_end_at. Never sends on page loads — only from
   * the guarded maintenance endpoint.
   */
  async sendExpiryReminders(now = new Date()): Promise<{ scanned: number; sent: number; skipped: number; smtp: boolean }> {
    const c = await memberCol();
    const windowEnd = new Date(now.getTime() + BRAND_PRO_REMINDER_DAYS_BEFORE * DAY_MS);
    const due = await c.find({
      status: 'active',
      period_end_at: { $gt: now, $lte: windowEnd },
    }).limit(500).toArray();
    let sent = 0, skipped = 0;
    const smtp = hasSmtpTransport();
    for (const m of due) {
      const already = m.reminder_sent_for_period_end_at
        && new Date(m.reminder_sent_for_period_end_at).getTime() === new Date(m.period_end_at).getTime();
      if (already) { skipped++; continue; }
      // Claim the reminder slot first → idempotent even under concurrency.
      const claim = await c.updateOne(
        { id: m.id, reminder_sent_for_period_end_at: m.reminder_sent_for_period_end_at ?? null },
        { $set: { reminder_sent_for_period_end_at: m.period_end_at, reminder_sent_at: new Date(), updated_at: new Date() } },
      );
      if (claim.modifiedCount !== 1) { skipped++; continue; }
      if (!smtp) { sent++; continue; }
      try {
        const u = await userRepo.findById(m.user_id);
        if (!u?.email) continue;
        const base = appOrigin();
        await sendMailBestEffort({
          to: u.email,
          subject: 'Your WaveLead Brand Pro access ends soon',
          text: [
            `Your Brand Pro Founding Beta access ends on ${new Date(m.period_end_at).toDateString()}.`,
            '',
            'During the Founding Beta, renewal is manual — there is no automatic recurring charge.',
            'Renew for another 30 days for $15.',
            '',
            `Renew Brand Pro — $15: ${base ? `${base}/pricing#brand-pro` : '/pricing#brand-pro'}`,
            '',
            '— WaveLead',
          ].join('\n'),
        });
        sent++;
      } catch { /* best-effort */ }
    }
    return { scanned: due.length, sent, skipped, smtp };
  },

  /** Read-only admin report. Brand Pro domain ONLY — never mixed with other revenue. */
  async adminReport(actor: Actor | null, now = new Date()) {
    requireAuth(actor);
    if (rankOf(actor!.user.role) < rankOf(ROLES.ADMIN)) throw new HttpError(403, 'Admin only');
    const mc = await memberCol();
    const oc = await orderCol();
    const memberships = await mc.find({}).sort({ period_end_at: -1 }).limit(500).toArray();
    const paidOrders = await oc.find({ status: 'captured_finalized' }).limit(1000).toArray();
    const rows = [] as Array<Record<string, unknown>>;
    let active = 0, expiringSoon = 0, expired = 0;
    for (const m of memberships) {
      const u = await userRepo.findById(m.user_id);
      const end = new Date(m.period_end_at).getTime();
      const isAct = m.status === 'active' && end > now.getTime();
      const daysRemaining = isAct ? Math.max(0, Math.ceil((end - now.getTime()) / DAY_MS)) : 0;
      if (isAct) { active++; if (daysRemaining <= 7) expiringSoon++; } else { expired++; }
      rows.push({
        membership_id: m.id,
        brand: u?.display_name || u?.email || m.user_id,
        period_start_at: m.period_start_at,
        period_end_at: m.period_end_at,
        days_remaining: daysRemaining,
        status: isAct ? 'active' : m.status,
        terms_paid: m.terms_paid,
        gross_amount_minor: m.gross_amount_minor,
        currency: m.currency,
        payment_status: m.paid_at ? 'paid' : 'unpaid',
        provider: m.provider,
        provider_environment: m.provider_environment,
        provider_order_id_masked: maskRef(m.last_provider_order_id),
        provider_capture_id_masked: maskRef(m.last_provider_capture_id),
        reminder_status: m.reminder_sent_at ? 'sent' : 'not_sent',
        last_payment_at: m.paid_at,
      });
    }
    return {
      domain: 'brand_pro_founding_beta',
      price_minor: BRAND_PRO_AMOUNT_MINOR,
      term_days: BRAND_PRO_TERM_DAYS,
      auto_recurring: false,
      summary: {
        active_brand_pro: active,
        expiring_within_7_days: expiringSoon,
        expired,
        gross_collected_minor: paidOrders.reduce((s, o) => s + (o.gross_amount_minor || 0), 0),
        currency: BRAND_PRO_CURRENCY,
        paid_terms: paidOrders.length,
      },
      rows,
    };
  },
};
