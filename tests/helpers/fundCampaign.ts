// Canonical funding fixture for tests that legitimately need an approved
// campaign to reach the `active` / `scheduled` state.
//
// This helper drives the REAL production funding path:
//   campaignFundingService.createFundingForCampaign(actor, campaign_id)
//   → provider.createPayment (mocked)
//   → campaignFundingService.captureAndFinalize(funding_id)
//   → provider.capturePayment (mocked, returns paid)
//   → ledger insert + campaign.funded_amount_usd_micros bump
//   → reconcileCampaign (in-window+funded → active, future-start → scheduled)
//
// It does NOT:
//   • use `legacy_waived` (that status is reserved for genuine pre-M06
//     grandfathered campaigns and MUST NOT be used as a generic new-campaign
//     funding fixture),
//   • mutate campaign.status directly,
//   • bypass the funding eligibility gate.
//
// Callers must install the test provider before use and restore afterwards:
//   beforeAll(() => installTestPaymentProvider());
//   afterAll(() => restoreDefaultPaymentProvider());
import { _setPaymentProviderForTesting } from '@/lib/services/payments/providerFactory';
import { paymentFundingOrderRepo } from '@/lib/repositories/paymentRepo';
import type {
  PaymentProvider,
  CreatePaymentInput,
  CapturePaymentInput,
  RefundInput,
} from '@/lib/services/payments/paymentProvider';

export class TestPaidPaymentProvider implements PaymentProvider {
  readonly id = 'paypal' as const;

  async createPayment(input: CreatePaymentInput) {
    return {
      provider: 'paypal' as const,
      provider_order_id: `TEST-ORDER-${input.funding_id}`,
      approve_url: `https://sandbox.paypal.com/checkoutnow?token=TEST-ORDER-${input.funding_id}`,
      raw: {},
    };
  }

  async capturePayment(input: CapturePaymentInput) {
    // Read the pending funding row to authoritatively report the captured amount.
    const funding = await paymentFundingOrderRepo.findByProviderOrderId(input.provider_order_id);
    return {
      provider_order_id: input.provider_order_id,
      provider_capture_id: `TEST-CAPTURE-${input.provider_order_id}`,
      internal_status: 'paid' as const,
      amount_captured_minor: funding?.amount_minor ?? 0,
      currency: 'USD',
      raw: {},
    };
  }

  async retrievePayment(input: CapturePaymentInput) {
    const funding = await paymentFundingOrderRepo.findByProviderOrderId(input.provider_order_id);
    return {
      provider_order_id: input.provider_order_id,
      internal_status: 'paid' as const,
      amount_minor: funding?.amount_minor ?? 0,
      currency: 'USD',
      provider_capture_id: `TEST-CAPTURE-${input.provider_order_id}`,
      raw: {},
    };
  }

  async createRefund(input: RefundInput) {
    return {
      provider_refund_id: `TEST-REFUND-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      internal_status: 'refunded' as const,
      amount_refunded_minor: input.amount_minor,
      raw: {},
    };
  }

  async verifyWebhook() {
    return {
      valid: true,
      event_id: `evt-${Date.now()}-${Math.random()}`,
      event_type: 'PAYMENT.CAPTURE.COMPLETED',
      resource: {},
    };
  }
}

export function installTestPaymentProvider(): TestPaidPaymentProvider {
  const p = new TestPaidPaymentProvider();
  _setPaymentProviderForTesting(p);
  return p;
}

export function restoreDefaultPaymentProvider(): void {
  _setPaymentProviderForTesting(null);
}

/**
 * Drive the canonical funding path end-to-end for a campaign so it becomes
 * genuinely funded (paid capture + ledger credit + reconciliation).
 * The campaign must already be in a fundable state (approved / scheduled /
 * paused). The reconcileCampaign call inside captureAndFinalize will then
 * flip status to `active` (in-window) or `scheduled` (future-start).
 */
export async function fundCampaignForTest(
  campaignId: string,
  ownerUserId: string,
): Promise<void> {
  const { campaignFundingService } = await import('@/lib/services/payments/campaignFundingService');
  const actor = { user: { id: ownerUserId, role: 'user' as const }, session: {} } as unknown as import('@/lib/types').Actor;
  const f = await campaignFundingService.createFundingForCampaign(actor, campaignId);
  await campaignFundingService.captureAndFinalize(f.id);
}
