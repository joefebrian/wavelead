// M18 — PayPal FX (adapter layer, PayPal-specific ON PURPOSE).
//
// Everything PayPal-shaped lives here, inside the provider integration layer.
// Commercial domains never import this file; they talk to
// lib/services/fx/providerFxService.ts, which is provider-neutral.
//
// TWO STRICTLY SEPARATE CONCEPTS
//   A. QUOTED FX      — a provider quote obtained BEFORE a transaction.
//   B. ACTUAL/SETTLEMENT FX — the rate PayPal actually applied to a real
//                        capture, refund or payout. Authoritative when present.
//
// PROVIDER LIMITATION (verified against PayPal docs, Sept 2026)
//   POST /v2/pricing/quote-exchange-rates requires the OAuth privilege
//   https://uri.paypal.com/services/pricing/quote-exchange-rates/read, granted
//   only under an approved PayPal FX-as-a-Service contract. Ordinary Orders v2
//   + Payouts merchant credentials cannot call it. We PROBE it read-only and
//   report PROVIDER_LIMITATION. We never fabricate a rate, and we never label a
//   manual value as a PayPal rate.
import { _internalsForTests } from './paypalProvider';

export type PaypalFxCapability = 'available' | 'provider_limitation' | 'provider_unavailable' | 'not_configured';

export interface PaypalFxCapabilityResult {
  provider: 'paypal';
  capability: 'pre_transaction_quote';
  status: PaypalFxCapability;
  provider_environment: 'sandbox' | 'live' | null;
  http_status: number | null;
  /** Human-readable, never contains credentials or tokens. */
  reason: string;
  checked_at: Date;
}

/** A provider-neutral FX observation extracted from a real PayPal payload. */
export interface ProviderFxObservation {
  provider: 'paypal';
  source: 'provider_quote' | 'provider_settlement';
  source_currency: string;
  target_currency: string;
  /** PayPal's decimal STRING is preserved verbatim — never a float. */
  rate_value: string;
  provider_object_id: string | null;
  provider_payload_path: string;
  provider_environment: 'sandbox' | 'live' | null;
  fx_id?: string | null;
  expiry_time?: Date | null;
  rate_refresh_time?: Date | null;
  observed_at: Date;
}

interface RawRate { source_currency?: string; target_currency?: string; value?: string | number }

function toObservation(
  r: RawRate | undefined | null,
  path: string,
  objectId: string | null,
  env: 'sandbox' | 'live' | null,
  source: 'provider_quote' | 'provider_settlement' = 'provider_settlement',
): ProviderFxObservation | null {
  if (!r || !r.source_currency || !r.target_currency || r.value === undefined || r.value === null) return null;
  const value = String(r.value);
  if (!value.trim() || Number.isNaN(Number(value))) return null;
  return {
    provider: 'paypal',
    source,
    source_currency: String(r.source_currency).toUpperCase(),
    target_currency: String(r.target_currency).toUpperCase(),
    rate_value: value,
    provider_object_id: objectId,
    provider_payload_path: path,
    provider_environment: env,
    observed_at: new Date(),
  };
}

/* ----------------------------------------------------------------- PARSERS */

/**
 * Order capture response (POST /v2/checkout/orders/{id}/capture).
 * Path: purchase_units[].payments.captures[].seller_receivable_breakdown.exchange_rate
 * Absent for same-currency captures — that is NOT an error.
 */
export function parseCaptureResponseFx(payload: unknown, env: 'sandbox' | 'live' | null = null): ProviderFxObservation[] {
  const p = payload as {
    purchase_units?: Array<{ payments?: { captures?: Array<{ id?: string; seller_receivable_breakdown?: { exchange_rate?: RawRate } }> } }>;
  } | null;
  const out: ProviderFxObservation[] = [];
  const units = p?.purchase_units || [];
  units.forEach((u, ui) => {
    (u.payments?.captures || []).forEach((cap, ci) => {
      const o = toObservation(
        cap.seller_receivable_breakdown?.exchange_rate,
        `purchase_units[${ui}].payments.captures[${ci}].seller_receivable_breakdown.exchange_rate`,
        cap.id || null,
        env,
      );
      if (o) out.push(o);
    });
  });
  return out;
}

/** Capture lookup (GET /v2/payments/captures/{id}) — breakdown is top level. */
export function parseCaptureLookupFx(payload: unknown, env: 'sandbox' | 'live' | null = null): ProviderFxObservation[] {
  const p = payload as { id?: string; seller_receivable_breakdown?: { exchange_rate?: RawRate } } | null;
  const o = toObservation(
    p?.seller_receivable_breakdown?.exchange_rate,
    'seller_receivable_breakdown.exchange_rate',
    p?.id || null,
    env,
  );
  return o ? [o] : [];
}

/**
 * Refunds use a DIFFERENT path than captures:
 * seller_payable_breakdown.net_amount_breakdown[].exchange_rate
 */
export function parseRefundFx(payload: unknown, env: 'sandbox' | 'live' | null = null): ProviderFxObservation[] {
  const p = payload as { id?: string; seller_payable_breakdown?: { net_amount_breakdown?: Array<{ exchange_rate?: RawRate }> } } | null;
  const rows = p?.seller_payable_breakdown?.net_amount_breakdown || [];
  const out: ProviderFxObservation[] = [];
  rows.forEach((b, i) => {
    const o = toObservation(
      b.exchange_rate,
      `seller_payable_breakdown.net_amount_breakdown[${i}].exchange_rate`,
      p?.id || null,
      env,
    );
    if (o) out.push(o);
  });
  return out;
}

/**
 * Payout items use yet another shape: currency_conversion.exchange_rate with
 * the currencies nested in from_amount / to_amount.
 */
export function parsePayoutItemFx(item: unknown, env: 'sandbox' | 'live' | null = null): ProviderFxObservation | null {
  const it = item as {
    payout_item_id?: string;
    currency_conversion?: { exchange_rate?: string | number; from_amount?: { currency?: string }; to_amount?: { currency?: string } };
  } | null;
  const c = it?.currency_conversion;
  if (!c?.exchange_rate || !c.from_amount?.currency || !c.to_amount?.currency) return null;
  const value = String(c.exchange_rate);
  if (Number.isNaN(Number(value))) return null;
  return {
    provider: 'paypal',
    source: 'provider_settlement',
    source_currency: c.from_amount.currency.toUpperCase(),
    target_currency: c.to_amount.currency.toUpperCase(),
    rate_value: value,
    provider_object_id: it?.payout_item_id || null,
    provider_payload_path: 'currency_conversion.exchange_rate',
    provider_environment: env,
    observed_at: new Date(),
  };
}

/** Webhook dispatcher — chooses the right path per event family. */
export function parseWebhookFx(event: unknown, env: 'sandbox' | 'live' | null = null): ProviderFxObservation[] {
  const e = event as { event_type?: string; resource?: unknown } | null;
  const type = e?.event_type || '';
  if (type.startsWith('PAYMENT.CAPTURE.')) return parseCaptureLookupFx(e?.resource, env);
  if (type.startsWith('PAYMENT.REFUND.')) return parseRefundFx(e?.resource, env);
  if (type.startsWith('PAYMENT.PAYOUTS-ITEM.')) {
    const o = parsePayoutItemFx(e?.resource, env);
    return o ? [o] : [];
  }
  return [];
}

/* -------------------------------------------------------- CAPABILITY PROBE */

/**
 * Read-only eligibility probe. NEVER used as a production quote source and
 * never converts an error into a rate.
 */
export async function detectQuoteCapability(base = 'USD', quote = 'IDR'): Promise<PaypalFxCapabilityResult> {
  const checked_at = new Date();
  let env: 'sandbox' | 'live' | null = null;
  try {
    const c = await _internalsForTests.cfg();
    env = c.mode;
    const token = await _internalsForTests.getAccessToken();
    const res = await fetch(`${c.base}/v2/pricing/quote-exchange-rates`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ quote_items: [{ base_currency: base, quote_currency: quote }] }),
      cache: 'no-store',
    });
    // Entitlement-style refusals — including PayPal's documented
    // CONTRACT_NOT_FOUND (no FX-as-a-Service contract on the account) — are a
    // PROVIDER LIMITATION, not a transient error. Verified against the live
    // sandbox probe: HTTP 422 / issue CONTRACT_NOT_FOUND.
    let issue: string | null = null;
    if (!res.ok) {
      try {
        const body = await res.clone().json() as { details?: Array<{ issue?: string }> };
        issue = body?.details?.[0]?.issue || null;
      } catch { issue = null; }
    }
    const entitlementIssue = !!issue && /CONTRACT_NOT_FOUND|NOT_ENABLED|NOT_AUTHORIZED|PERMISSION|UNSUPPORTED|FEATURE/i.test(issue);
    if (res.status === 401 || res.status === 403 || res.status === 404 || entitlementIssue) {
      return {
        provider: 'paypal', capability: 'pre_transaction_quote', status: 'provider_limitation',
        provider_environment: env, http_status: res.status,
        reason: `PayPal FX-as-a-Service quote privilege is not enabled for these merchant credentials${issue ? ` (PayPal issue: ${issue})` : ''}. The manual admin reference rate remains the explicitly labelled fallback; actual settlement rates are still captured from real transactions.`,
        checked_at,
      };
    }
    if (!res.ok) {
      return {
        provider: 'paypal', capability: 'pre_transaction_quote', status: 'provider_unavailable',
        provider_environment: env, http_status: res.status,
        reason: `PayPal returned HTTP ${res.status} for the quote probe. No rate was derived.`,
        checked_at,
      };
    }
    return {
      provider: 'paypal', capability: 'pre_transaction_quote', status: 'available',
      provider_environment: env, http_status: res.status,
      reason: 'PayPal quote-exchange-rates is enabled for these credentials.',
      checked_at,
    };
  } catch (e) {
    const msg = (e as Error).message || 'probe failed';
    const notConfigured = /not configured/i.test(msg);
    return {
      provider: 'paypal', capability: 'pre_transaction_quote',
      status: notConfigured ? 'not_configured' : 'provider_unavailable',
      provider_environment: env, http_status: null,
      // Message is provider-supplied text only; credentials are never included.
      reason: notConfigured ? 'PayPal credentials are not configured for this environment.' : 'PayPal FX probe could not be completed.',
      checked_at,
    };
  }
}

/**
 * Parse a successful quote response (only reachable when the account is FXaaS
 * enabled). Kept for completeness — unused while the probe reports a
 * provider limitation.
 */
export function parseQuoteResponseFx(payload: unknown, env: 'sandbox' | 'live' | null = null): ProviderFxObservation[] {
  const p = payload as { quote_id?: string; quote_items?: Array<{ base_currency?: string; quote_currency?: string; rate?: string | number; expiry_time?: string; rate_refresh_time?: string }> } | null;
  const out: ProviderFxObservation[] = [];
  for (const q of p?.quote_items || []) {
    if (!q.base_currency || !q.quote_currency || q.rate === undefined) continue;
    out.push({
      provider: 'paypal',
      source: 'provider_quote',
      source_currency: q.base_currency.toUpperCase(),
      target_currency: q.quote_currency.toUpperCase(),
      rate_value: String(q.rate),
      provider_object_id: p?.quote_id || null,
      provider_payload_path: 'quote_items[].rate',
      provider_environment: env,
      fx_id: p?.quote_id || null,
      expiry_time: q.expiry_time ? new Date(q.expiry_time) : null,
      rate_refresh_time: q.rate_refresh_time ? new Date(q.rate_refresh_time) : null,
      observed_at: new Date(),
    });
  }
  return out;
}
