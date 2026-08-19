// Provider-neutral capability metadata.
//
// Business logic must consult capabilities rather than string-comparing
// against a provider name (e.g. `if (provider === 'paypal')`). Future local
// providers will register their own capability object.

export interface PaymentProviderCapabilities {
  /** Whether this provider is currently wired up for real customer traffic. */
  configured: boolean;
  /** ISO 4217 codes accepted as `payment_currency`. */
  supported_payment_currencies: readonly string[];
  /** True if the provider requires a separate capture step after authorization. */
  explicit_capture_required: boolean;
  /** True if the provider confirms payment asynchronously (webhook-driven). */
  asynchronous_confirmation: boolean;
  /** True if the provider supports refunds at the API level (channel-level rules may still apply). */
  supports_refund: boolean;
  /** True if the provider supports partial refunds at the API level. */
  supports_partial_refund: boolean;
  /** True if the customer is redirected to a hosted checkout URL. */
  hosted_checkout: boolean;
}

export const PAYPAL_CAPABILITIES: PaymentProviderCapabilities = {
  configured: true,
  supported_payment_currencies: ['USD'],
  explicit_capture_required: true,
  asynchronous_confirmation: true,
  supports_refund: true,
  supports_partial_refund: true,
  hosted_checkout: true,
};

/** Placeholder for future local (IDR) provider. `configured: false` guarantees
 * no code path attempts to route a payment to it in M06.1. */
export const LOCAL_PAYMENT_CAPABILITIES: PaymentProviderCapabilities = {
  configured: false,
  supported_payment_currencies: ['IDR'],
  explicit_capture_required: false,
  asynchronous_confirmation: true,
  supports_refund: false,
  supports_partial_refund: false,
  hosted_checkout: true,
};

export const PROVIDER_CAPABILITIES: Record<'paypal' | 'local', PaymentProviderCapabilities> = {
  paypal: PAYPAL_CAPABILITIES,
  local: LOCAL_PAYMENT_CAPABILITIES,
};
