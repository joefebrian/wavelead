// Provider-neutral PaymentProvider interface. Payment funding models are
// domain-agnostic — no PayPal semantics may leak past this boundary.
import type { PaymentFundingOrder } from '@/lib/types';

export type PaymentProviderId = 'paypal' | 'stripe' | 'mock';

export type PaymentInternalStatus =
  | 'created'
  | 'checkout_created'
  | 'pending'
  | 'paid'
  | 'failed'
  | 'cancelled'
  | 'partially_refunded'
  | 'refunded';

export interface CreatePaymentInput {
  funding_id: string;
  amount_minor: number;   // in payment currency minor units (cents for USD)
  currency: string;       // ISO 4217, e.g. "USD"
  description: string;
  return_url: string;     // where the buyer is sent after approve
  cancel_url: string;     // where the buyer is sent after cancel
  metadata: { campaign_id: string; owner_user_id: string };
}

export interface CreatePaymentResult {
  provider: PaymentProviderId;
  provider_order_id: string;      // opaque provider id (safe for client)
  approve_url: string;            // redirect target the client should open
  raw: unknown;                   // provider response for debugging (not exposed publicly)
}

export interface CapturePaymentInput {
  provider_order_id: string;
}

export interface CapturePaymentResult {
  provider_order_id: string;
  provider_capture_id: string | null;   // present when capture succeeds
  internal_status: PaymentInternalStatus;
  amount_captured_minor: number;
  currency: string;
  // B3.2 — exact provider fee/net when the capture response carries a
  // seller_receivable_breakdown. May be null when the breakdown is absent
  // (some sandbox flows, some funding sources). NEVER estimated.
  provider_fee_minor?: number | null;
  provider_net_minor?: number | null;
  raw: unknown;
}

export interface RetrievePaymentResult {
  provider_order_id: string;
  internal_status: PaymentInternalStatus;
  amount_minor: number;
  currency: string;
  provider_capture_id: string | null;
  raw: unknown;
}

// B3.2 — authoritative capture-details lookup (`/v2/payments/captures/:id`)
// returns the seller_receivable_breakdown reliably even when the initial
// capture response did not. Used by fee backfill.
export interface RetrieveCaptureInput {
  provider_capture_id: string;
}
export interface RetrieveCaptureResult {
  provider_capture_id: string;
  internal_status: PaymentInternalStatus;
  amount_minor: number;
  currency: string;
  provider_fee_minor: number | null;
  provider_net_minor: number | null;
  raw: unknown;
}

export interface RefundInput {
  provider_capture_id: string;
  amount_minor: number;   // partial refund allowed
  currency: string;
  reason?: string;
  idempotency_key: string;
}

export interface RefundResult {
  provider_refund_id: string;
  internal_status: 'partially_refunded' | 'refunded';
  amount_refunded_minor: number;
  raw: unknown;
}

export interface WebhookVerifyInput {
  headers: Record<string, string>;
  raw_body: string;
}

export interface WebhookVerifyResult {
  valid: boolean;
  reason?: string;
  event_id?: string;         // provider-side unique id — used for idempotency
  event_type?: string;
  resource?: Record<string, unknown>;
}

export interface PaymentProvider {
  readonly id: PaymentProviderId;
  createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult>;
  capturePayment(input: CapturePaymentInput): Promise<CapturePaymentResult>;
  retrievePayment(input: CapturePaymentInput): Promise<RetrievePaymentResult>;
  retrieveCapture?(input: RetrieveCaptureInput): Promise<RetrieveCaptureResult>;
  createRefund(input: RefundInput): Promise<RefundResult>;
  verifyWebhook(input: WebhookVerifyInput): Promise<WebhookVerifyResult>;
}

// Type helper for repositories.
export type FundingOrder = PaymentFundingOrder;
