// M06.0 Phase 4 — Refund service.
//
// Owner cancels a campaign → we compute the unused refundable amount and open a
// `pending` refund row. An admin (or super_admin) then executes the actual
// provider refund via `executeRefund`. Owners CAN'T touch the provider directly.
//
// Money invariants:
//   refundable_micros = max(funded - spent - already_refunded, 0)
//   refund never exceeds refundable
//   micros → provider minor: floor (never round up)
import { v4 as uuidv4 } from 'uuid';
import { HttpError, rankOf, ROLES } from '@/lib/auth/rbac';
import { paymentFundingOrderRepo, campaignFundingLedgerRepo } from '@/lib/repositories/paymentRepo';
import { promotionCampaignRepo } from '@/lib/repositories/promotionRepo';
import { paymentRefundRepo } from '@/lib/repositories/paymentRefundRepo';
import { getPaymentProvider } from '@/lib/services/payments/providerFactory';
import { ledgerService } from '@/lib/services/ledger/ledgerService';
import { minorToMicros } from '@/lib/services/payments/campaignFundingService';
import type { Actor, PaymentRefund, PromotionCampaign } from '@/lib/types';

const MICROS_PER_MINOR = 10_000;

async function assertOwner(actor: Actor | null, campaign_id: string): Promise<PromotionCampaign> {
  if (!actor) throw new HttpError(401, 'Authentication required');
  const camp = await promotionCampaignRepo.findById(campaign_id);
  if (!camp) throw new HttpError(404, 'Campaign not found');
  const isOwner = camp.owner_user_id === actor.user.id;
  const isAdmin = rankOf(actor.user.role) >= rankOf(ROLES.ADMIN);
  if (!isOwner && !isAdmin) throw new HttpError(403, 'Not authorized');
  return camp;
}

function assertAdmin(actor: Actor | null): void {
  if (!actor) throw new HttpError(401, 'Authentication required');
  if (rankOf(actor.user.role) < rankOf(ROLES.ADMIN)) throw new HttpError(403, 'Admin privileges required');
}

export interface RefundabilityReport {
  funded_usd_micros: number;
  spent_usd_micros: number;
  already_refunded_usd_micros: number;
  refundable_usd_micros: number;
  refundable_amount_minor: number;   // floor micros→minor for the provider boundary
  rounding_adjustment_usd_micros: number; // residual micros not representable in minor
  has_open_request: boolean;
}

export const refundService = {
  /** Compute the exact unused/refundable amount for a campaign from the ledger. */
  async computeRefundability(campaign_id: string): Promise<RefundabilityReport> {
    const b = await ledgerService.campaignBalances(campaign_id);
    const refundable_usd_micros = Math.max(0, b.funded_usd_micros - b.spent_usd_micros - b.refunded_usd_micros);
    const refundable_amount_minor = Math.floor(refundable_usd_micros / MICROS_PER_MINOR); // never round up
    const rounding_adjustment_usd_micros = refundable_usd_micros - refundable_amount_minor * MICROS_PER_MINOR;
    const openReq = await paymentRefundRepo.findPendingForFunding((await paymentFundingOrderRepo.listForCampaign(campaign_id)).find((f) => f.status === 'paid' || f.status === 'partially_refunded')?.id || '');
    return {
      funded_usd_micros: b.funded_usd_micros,
      spent_usd_micros: b.spent_usd_micros,
      already_refunded_usd_micros: b.refunded_usd_micros,
      refundable_usd_micros,
      refundable_amount_minor,
      rounding_adjustment_usd_micros,
      has_open_request: !!openReq,
    };
  },

  /**
   * Owner-initiated. Called by campaignService.cancel(). Refund row is created
   * in `pending` status with the AUTHORITATIVE server-computed refundable
   * amount. Owner does NOT get to specify amount.
   */
  async requestRefundForCancelledCampaign(actor: Actor | null, campaign_id: string): Promise<PaymentRefund | null> {
    const camp = await assertOwner(actor, campaign_id);
    const paidFunding = (await paymentFundingOrderRepo.listForCampaign(camp.id))
      .find((f) => f.status === 'paid' || f.status === 'partially_refunded');
    if (!paidFunding) return null; // legacy_waived or unfunded — nothing to refund
    // Refuse if a request is already open.
    const existing = await paymentRefundRepo.findPendingForFunding(paidFunding.id);
    if (existing) return existing;
    const rep = await this.computeRefundability(campaign_id);
    if (rep.refundable_amount_minor <= 0) return null;
    const now = new Date();
    const refund: PaymentRefund = {
      id: uuidv4(),
      funding_order_id: paidFunding.id,
      campaign_id,
      owner_user_id: camp.owner_user_id,
      provider: paidFunding.provider,
      provider_refund_id: null,
      requested_amount_minor: rep.refundable_amount_minor,
      requested_amount_usd_micros: rep.refundable_amount_minor * MICROS_PER_MINOR,
      actual_refunded_amount_minor: 0,
      actual_refunded_usd_micros: 0,
      status: 'pending',
      requested_by_user_id: actor!.user.id,
      executed_by_user_id: null,
      reason: 'Campaign cancelled',
      requested_at: now,
      processed_at: null, failed_at: null, failure_reason: null,
      created_at: now, updated_at: now,
    };
    await paymentRefundRepo.insert(refund);
    return refund;
  },

  /**
   * Admin-initiated. Dispatches to the payment provider and, on success,
   * reconciles the ledger + funding order + campaign refunded_amount cache.
   * Idempotent: repeated calls with the same refund_id return the current
   * server state without double-charging the provider (provider retry is
   * guarded by `PayPal-Request-Id: refund:<refund_id>`).
   */
  async executeRefund(actor: Actor | null, refund_id: string): Promise<PaymentRefund> {
    assertAdmin(actor);
    const refund = await paymentRefundRepo.findById(refund_id);
    if (!refund) throw new HttpError(404, 'Refund request not found');
    if (refund.status === 'refunded' || refund.status === 'partially_refunded') return refund;
    if (refund.status === 'failed') throw new HttpError(409, 'Refund already failed — create a new request');
    if (refund.status !== 'pending' && refund.status !== 'processing') {
      throw new HttpError(409, `Refund not executable from status ${refund.status}`);
    }
    // Move to processing to prevent concurrent admin double-clicks.
    const moved = await paymentRefundRepo.transition(refund.id, ['pending'], 'processing', {
      executed_by_user_id: actor!.user.id,
    });
    if (!moved && refund.status === 'pending') {
      // Someone else grabbed it; return the current row.
      return (await paymentRefundRepo.findById(refund.id))!;
    }
    const funding = await paymentFundingOrderRepo.findById(refund.funding_order_id);
    if (!funding || !funding.provider_capture_id) {
      await paymentRefundRepo.transition(refund.id, ['processing'], 'failed', { failure_reason: 'No provider capture on funding order', failed_at: new Date() });
      throw new HttpError(400, 'No provider capture on funding order');
    }
    // Re-verify refundable amount at execution time. Refund cannot exceed
    // ledger-authoritative unused funds (protects against post-request spend).
    const rep = await this.computeRefundability(refund.campaign_id);
    const executeAmountMinor = Math.min(refund.requested_amount_minor, rep.refundable_amount_minor);
    if (executeAmountMinor <= 0) {
      await paymentRefundRepo.transition(refund.id, ['processing'], 'failed', { failure_reason: 'No unused funds remain', failed_at: new Date() });
      throw new HttpError(409, 'No unused funds remain');
    }
    const provider = getPaymentProvider();
    try {
      const providerResult = await provider.createRefund({
        provider_capture_id: funding.provider_capture_id,
        amount_minor: executeAmountMinor,
        currency: funding.currency,
        reason: refund.reason || 'Campaign refund',
        idempotency_key: `refund:${refund.id}`,
      });
      // Post ledger + update funding + cached campaign counters. Reuse the
      // proven `recordRefund` pathway — it dedups on the provider refund id.
      const { campaignFundingService } = await import('@/lib/services/payments/campaignFundingService');
      await campaignFundingService.recordRefund(funding.provider_order_id!, providerResult.amount_refunded_minor, providerResult.provider_refund_id);
      const finalStatus = providerResult.amount_refunded_minor >= funding.amount_captured_minor - funding.amount_refunded_minor ? 'refunded' : 'partially_refunded';
      // Match to actual behaviour of recordRefund (compares against captured − prior refunds).
      const nextStatus = finalStatus === 'refunded' ? 'refunded' : 'partially_refunded';
      await paymentRefundRepo.transition(refund.id, ['processing'], nextStatus, {
        provider_refund_id: providerResult.provider_refund_id,
        actual_refunded_amount_minor: providerResult.amount_refunded_minor,
        actual_refunded_usd_micros: providerResult.amount_refunded_minor * MICROS_PER_MINOR,
        processed_at: new Date(),
      });
      return (await paymentRefundRepo.findById(refund.id))!;
    } catch (e) {
      await paymentRefundRepo.transition(refund.id, ['processing'], 'failed', {
        failure_reason: (e as Error).message?.slice(0, 500) || 'provider_error',
        failed_at: new Date(),
      });
      throw e;
    }
  },

  /** Convenience for owner UI: get refund rows for their campaigns. */
  async listForOwnerCampaign(actor: Actor | null, campaign_id: string): Promise<PaymentRefund[]> {
    const camp = await assertOwner(actor, campaign_id);
    return await paymentRefundRepo.listForCampaign(camp.id);
  },
};

// Re-export minorToMicros for symmetry with fundingService in tests.
export { minorToMicros };
export const _internalsForTests = { MICROS_PER_MINOR };
