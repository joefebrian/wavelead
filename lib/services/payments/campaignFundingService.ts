// M06.0 funding service. Owns:
//   • create funding order (server-controlled amount = approved campaign budget)
//   • finalize on capture (post immutable ledger credit + flip campaign to fundable)
//   • record refund (post immutable negative ledger entry)
//   • grandfather-waive pre-M06 campaigns (idempotent)
import { v4 as uuidv4 } from 'uuid';
import { promotionCampaignRepo } from '@/lib/repositories/promotionRepo';
import { paymentFundingOrderRepo, campaignFundingLedgerRepo } from '@/lib/repositories/paymentRepo';
import { getPaymentProvider } from './providerFactory';
import { HttpError, ROLES, rankOf } from '@/lib/auth/rbac';
import { reconcileCampaign } from '@/lib/services/promotion/campaignStateService';
import type { Actor, PaymentFundingOrder, PromotionCampaign } from '@/lib/types';

// $1.00 = 1,000,000 USD micros. Payment currency USD; conversion is exact until
// M06.1 adds FX. Amount(minor) × 10_000 = amount(micros).
function minorToMicros(minor: number): number { return minor * 10_000; }

function assertOwner(actor: Actor | null, camp: PromotionCampaign): void {
  if (!actor) throw new HttpError(401, 'Authentication required');
  const isOwner = camp.owner_user_id === actor.user.id;
  const isAdmin = rankOf(actor.user.role) >= rankOf(ROLES.ADMIN);
  if (!isOwner && !isAdmin) throw new HttpError(403, 'Not your campaign');
}

export const campaignFundingService = {
  /**
   * Create a PayPal order for the campaign’s approved budget. Server sets the
   * amount from the campaign record — client input is ignored.
   */
  async createFundingForCampaign(actor: Actor | null, campaign_id: string): Promise<PaymentFundingOrder> {
    if (!actor) throw new HttpError(401, 'Authentication required');
    const camp = await promotionCampaignRepo.findById(campaign_id);
    if (!camp) throw new HttpError(404, 'Campaign not found');
    assertOwner(actor, camp);
    // Only approved-and-not-yet-funded campaigns are fundable. Draft/pending
    // owners must submit + get admin approval first.
    if (!['approved', 'scheduled', 'paused'].includes(camp.status)) {
      throw new HttpError(400, `Cannot fund a campaign in status ${camp.status}`);
    }
    // Refuse to open a second checkout while one is still open.
    const existing = await paymentFundingOrderRepo.listForCampaign(campaign_id);
    const openOne = existing.find((f) => ['created', 'checkout_created', 'pending'].includes(f.status));
    if (openOne) throw new HttpError(409, 'A funding checkout is already in progress for this campaign');
    const alreadyPaid = existing.some((f) => f.status === 'paid' || f.status === 'legacy_waived');
    if (alreadyPaid) throw new HttpError(400, 'Campaign is already funded');

    const id = uuidv4();
    const now = new Date();
    const base = (process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
    const return_url = `${base}/dashboard/promotions/${campaign_id}?funding=${id}&status=paid`;
    const cancel_url = `${base}/dashboard/promotions/${campaign_id}?funding=${id}&status=cancelled`;
    const provider = getPaymentProvider();
    const doc: PaymentFundingOrder = {
      id, campaign_id, owner_user_id: camp.owner_user_id, provider: provider.id,
      provider_order_id: null, provider_capture_id: null,
      currency: 'USD', amount_minor: camp.budget_total_usd_minor,
      amount_captured_minor: 0, amount_refunded_minor: 0,
      amount_usd_micros: minorToMicros(camp.budget_total_usd_minor),
      status: 'created',
      approve_url: null, return_url, cancel_url,
      paid_at: null, cancelled_at: null, refunded_at: null,
      created_at: now, updated_at: now,
    };
    await paymentFundingOrderRepo.insert(doc);

    try {
      const created = await provider.createPayment({
        funding_id: id,
        amount_minor: doc.amount_minor,
        currency: doc.currency,
        description: `WaveLead campaign "${camp.name.slice(0, 80)}"`,
        return_url, cancel_url,
        metadata: { campaign_id, owner_user_id: camp.owner_user_id },
      });
      await paymentFundingOrderRepo.transition(id, ['created'], 'checkout_created', {
        provider_order_id: created.provider_order_id,
        approve_url: created.approve_url,
      });
      return (await paymentFundingOrderRepo.findById(id))!;
    } catch (err) {
      await paymentFundingOrderRepo.update(id, { status: 'failed' });
      throw new HttpError(502, `Payment provider error: ${(err as Error).message}`);
    }
  },

  async getFunding(actor: Actor | null, funding_id: string): Promise<PaymentFundingOrder> {
    if (!actor) throw new HttpError(401, 'Authentication required');
    const f = await paymentFundingOrderRepo.findById(funding_id);
    if (!f) throw new HttpError(404, 'Funding order not found');
    const isOwner = f.owner_user_id === actor.user.id;
    const isAdmin = rankOf(actor.user.role) >= rankOf(ROLES.ADMIN);
    if (!isOwner && !isAdmin) throw new HttpError(403, 'Not your funding order');
    return f;
  },

  /**
   * Server-side capture. Called either from the buyer-return callback OR from
   * webhook handling — both paths are idempotent because the ledger insert is
   * keyed by `funding:paid:{funding_id}` and the transition() guard rejects
   * duplicates. Returns the (possibly already-paid) funding order.
   */
  async captureAndFinalize(funding_id: string): Promise<PaymentFundingOrder> {
    const f = await paymentFundingOrderRepo.findById(funding_id);
    if (!f) throw new HttpError(404, 'Funding order not found');
    if (f.status === 'paid') return f;
    if (!f.provider_order_id) throw new HttpError(400, 'No provider order to capture');
    const provider = getPaymentProvider();
    const cap = await provider.capturePayment({ provider_order_id: f.provider_order_id });
    if (cap.internal_status !== 'paid') {
      // Failed / pending / cancelled — record but do NOT post to ledger.
      const next = cap.internal_status === 'failed' ? 'failed' : (cap.internal_status === 'cancelled' ? 'cancelled' : 'pending');
      await paymentFundingOrderRepo.transition(funding_id, ['created', 'checkout_created', 'pending'], next, {
        provider_capture_id: cap.provider_capture_id,
        amount_captured_minor: cap.amount_captured_minor,
      });
      return (await paymentFundingOrderRepo.findById(funding_id))!;
    }
    return finalizePaid(f, cap.provider_capture_id!, cap.amount_captured_minor);
  },

  /**
   * Public alias for use by both the browser-return route AND the
   * CHECKOUT.ORDER.APPROVED webhook branch. Same idempotent single source of
   * truth for turning a checkout into a paid funding order — never split this
   * business logic across call sites.
   */
  async captureFundingOrder(funding_id: string): Promise<PaymentFundingOrder> {
    return this.captureAndFinalize(funding_id);
  },

  /**
   * Look up funding by provider order id and drive the same capture pipeline.
   * Used by the CHECKOUT.ORDER.APPROVED webhook, which only knows the PayPal
   * order id. Safe to call concurrently with the browser-return capture; the
   * transition guard + ledger unique-index dedup the second caller.
   */
  async captureFundingOrderByProviderOrderId(provider_order_id: string): Promise<PaymentFundingOrder | null> {
    const f = await paymentFundingOrderRepo.findByProviderOrderId(provider_order_id);
    if (!f) return null;
    return this.captureAndFinalize(f.id);
  },

  /**
   * Webhook-driven finalize. Same code path as return-callback capture; the
   * ledger idempotency key ensures only one credit is ever posted per funding.
   */
  async finalizePaidByProviderOrderId(provider_order_id: string, provider_capture_id: string, amount_captured_minor: number): Promise<PaymentFundingOrder | null> {
    const f = await paymentFundingOrderRepo.findByProviderOrderId(provider_order_id);
    if (!f) return null;
    if (f.status === 'paid') return f;
    return finalizePaid(f, provider_capture_id, amount_captured_minor);
  },

  /**
   * Refund path (partial or full). Posts a negative ledger row.
   */
  async recordRefund(provider_order_id: string, refund_amount_minor: number, provider_reference: string): Promise<void> {
    const f = await paymentFundingOrderRepo.findByProviderOrderId(provider_order_id);
    if (!f) return;
    const totalRefundedAfter = f.amount_refunded_minor + refund_amount_minor;
    const nextStatus = totalRefundedAfter >= f.amount_captured_minor ? 'refunded' : 'partially_refunded';
    const now = new Date();
    const key = `funding:refund:${provider_reference}`;
    await campaignFundingLedgerRepo.insertIfAbsent({
      id: uuidv4(), campaign_id: f.campaign_id, funding_id: f.id,
      entry_type: 'refund_debit', direction: 'debit',
      amount_usd_micros: minorToMicros(refund_amount_minor),
      balance_after_usd_micros: null,
      provider_reference, idempotency_key: key,
      metadata: { refund_amount_minor }, created_at: now,
    });
    await paymentFundingOrderRepo.update(f.id, {
      amount_refunded_minor: totalRefundedAfter,
      status: nextStatus,
      refunded_at: nextStatus === 'refunded' ? now : f.refunded_at,
    });
  },

  /**
   * Look up a campaign's aggregated funding state. Callers that gate campaign
   * eligibility should use this instead of parsing individual rows.
   */
  async fundingSummary(campaign_id: string): Promise<{ funded: boolean; balance_usd_micros: number; total_paid_usd_minor: number; has_legacy_waiver: boolean; last_funding_status: string | null; }> {
    const rows = await paymentFundingOrderRepo.listForCampaign(campaign_id);
    const hasWaiver = rows.some((r) => r.status === 'legacy_waived');
    const paid = rows.filter((r) => r.status === 'paid' || r.status === 'partially_refunded');
    const total_paid_usd_minor = paid.reduce((s, r) => s + (r.amount_captured_minor - r.amount_refunded_minor), 0);
    const balance_usd_micros = await campaignFundingLedgerRepo.balanceMicros(campaign_id);
    return {
      funded: hasWaiver || total_paid_usd_minor > 0,
      balance_usd_micros,
      total_paid_usd_minor,
      has_legacy_waiver: hasWaiver,
      last_funding_status: rows[0]?.status ?? null,
    };
  },
};

async function finalizePaid(f: PaymentFundingOrder, provider_capture_id: string, amount_captured_minor: number): Promise<PaymentFundingOrder> {
  // Idempotent ledger credit — unique index on idempotency_key protects against
  // dual writes (webhook + return callback racing).
  const now = new Date();
  await campaignFundingLedgerRepo.insertIfAbsent({
    id: uuidv4(),
    campaign_id: f.campaign_id,
    funding_id: f.id,
    entry_type: 'funding_credit',
    direction: 'credit',
    amount_usd_micros: minorToMicros(amount_captured_minor),
    balance_after_usd_micros: null,
    provider_reference: provider_capture_id,
    idempotency_key: `funding:paid:${f.id}`,
    metadata: { amount_minor: amount_captured_minor, provider: f.provider },
    created_at: now,
  });
  // Only after ledger insert do we flip status — if the transition guard fails,
  // a duplicate delivery simply no-ops.
  await paymentFundingOrderRepo.transition(
    f.id, ['created', 'checkout_created', 'pending'], 'paid',
    { provider_capture_id, amount_captured_minor, paid_at: now },
  );
  // Campaign lifecycle reconciliation. approved+funded within schedule → active;
  // future start_at → scheduled; end_at passed → completed. Safe & idempotent.
  const camp = await promotionCampaignRepo.findById(f.campaign_id);
  if (camp) {
    try { await reconcileCampaign(camp, now); } catch { /* best-effort; delivery gate re-checks anyway */ }
  }
  return (await paymentFundingOrderRepo.findById(f.id))!;
}
