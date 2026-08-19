// M06.0 Phase 4 — Payment reconciliation service.
//
// Retrieves authoritative payment state from PayPal (or any provider) and
// synchronizes local funding + ledger without ever double-posting, never
// downgrading a terminal-successful state due to stale/out-of-order events.
import { HttpError } from '@/lib/auth/rbac';
import { paymentFundingOrderRepo } from '@/lib/repositories/paymentRepo';
import { getPaymentProvider } from './providerFactory';

export interface ReconciliationOutcome {
  funding_order_id: string;
  before_status: string;
  after_status: string;
  provider_status: string;
  amount_captured_minor: number;
  changed: boolean;
  action: 'no_change' | 'finalized_paid' | 'noop_already_paid' | 'noop_no_capture' | 'provider_error';
  note?: string;
}

export const paymentReconciliationService = {
  /**
   * Reconcile ONE funding order against the provider. Idempotent.
   * - If provider reports COMPLETED and we're still pending → finalize paid.
   * - If we're already paid, do nothing (never downgrade from paid).
   * - If provider reports nothing captured yet, do nothing (keep pending).
   */
  async reconcileFundingOrder(funding_id: string): Promise<ReconciliationOutcome> {
    const f = await paymentFundingOrderRepo.findById(funding_id);
    if (!f) throw new HttpError(404, 'Funding order not found');
    const beforeStatus = f.status;

    // Terminal-successful guard: never downgrade a paid/refunded row using an
    // older or missing provider event.
    if (f.status === 'paid' || f.status === 'partially_refunded' || f.status === 'refunded') {
      return {
        funding_order_id: f.id, before_status: beforeStatus, after_status: f.status,
        provider_status: f.status, amount_captured_minor: f.amount_captured_minor,
        changed: false, action: 'noop_already_paid',
        note: 'Terminal-successful — no downgrade from stale events',
      };
    }

    if (!f.provider_order_id) {
      return {
        funding_order_id: f.id, before_status: beforeStatus, after_status: f.status,
        provider_status: 'unknown', amount_captured_minor: 0, changed: false,
        action: 'noop_no_capture', note: 'No provider order id on funding row',
      };
    }

    const provider = getPaymentProvider();
    let retrieved;
    try {
      retrieved = await provider.retrievePayment({ provider_order_id: f.provider_order_id });
    } catch (e) {
      return {
        funding_order_id: f.id, before_status: beforeStatus, after_status: f.status,
        provider_status: 'error', amount_captured_minor: 0, changed: false,
        action: 'provider_error', note: (e as Error).message.slice(0, 300),
      };
    }

    if (retrieved.internal_status === 'paid' && retrieved.provider_capture_id) {
      // Finalize via the canonical single-source-of-truth path.
      const { campaignFundingService } = await import('./campaignFundingService');
      await campaignFundingService.finalizePaidByProviderOrderId(
        f.provider_order_id,
        retrieved.provider_capture_id,
        retrieved.amount_minor,
      );
      const after = await paymentFundingOrderRepo.findById(f.id);
      return {
        funding_order_id: f.id, before_status: beforeStatus,
        after_status: after?.status || 'unknown',
        provider_status: retrieved.internal_status,
        amount_captured_minor: retrieved.amount_minor,
        changed: after?.status !== beforeStatus,
        action: 'finalized_paid',
      };
    }

    return {
      funding_order_id: f.id, before_status: beforeStatus, after_status: f.status,
      provider_status: retrieved.internal_status,
      amount_captured_minor: retrieved.amount_minor,
      changed: false, action: 'no_change',
      note: `Provider status=${retrieved.internal_status}; no local change`,
    };
  },
};
