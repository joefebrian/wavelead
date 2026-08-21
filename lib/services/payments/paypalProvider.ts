// PayPal REST v2 adapter (sandbox + live compatible). Never exports secrets
// nor raw PayPal state to the domain layer.
import type {
  PaymentProvider,
  CreatePaymentInput,
  CreatePaymentResult,
  CapturePaymentInput,
  CapturePaymentResult,
  RetrievePaymentResult,
  RefundInput,
  RefundResult,
  WebhookVerifyInput,
  WebhookVerifyResult,
  PaymentInternalStatus,
} from './paymentProvider';

const SANDBOX_BASE = 'https://api-m.sandbox.paypal.com';
const LIVE_BASE = 'https://api-m.paypal.com';

// M07-security: PayPal credentials now resolve through paypalConfigService
// (vault → env fallback). Payment/refund/webhook LOGIC is unchanged; only
// the read path for credentials moved. Live mode is impossible outside
// production (paypalConfigService enforces this).
async function cfg() {
  const { paypalConfigService } = await import('./paypalConfigService');
  const resolved = await paypalConfigService.resolveActive();
  if (!resolved) {
    throw new Error('PayPal credentials not configured (no admin-vault entry and no PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET env)');
  }
  return {
    base: resolved.environment === 'live' ? LIVE_BASE : SANDBOX_BASE,
    clientId: resolved.client_id,
    clientSecret: resolved.client_secret,
    webhookId: resolved.webhook_id,
    mode: resolved.environment,
    source: resolved.source,
  };
}

function toCurrencyValue(minor: number): string {
  // 2-decimal string for USD-like currencies. PayPal wants a string.
  return (minor / 100).toFixed(2);
}

function fromCurrencyValue(value: string): number {
  return Math.round(parseFloat(value) * 100);
}

// In-process access-token cache. Emergent's container is single-process; if
// scale-out is added later, swap for a shared cache. Cached until 60s before
// expiry to avoid clock-skew edge cases.
let tokenCache: { access_token: string; expires_at: number } | null = null;

async function getAccessToken(): Promise<string> {
  const c = await cfg();
  const now = Date.now();
  if (tokenCache && tokenCache.expires_at > now + 60_000) return tokenCache.access_token;
  const res = await fetch(`${c.base}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${c.clientId}:${c.clientSecret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`PayPal oauth failed: ${res.status} ${t.slice(0, 200)}`);
  }
  const j = (await res.json()) as { access_token: string; expires_in: number };
  tokenCache = { access_token: j.access_token, expires_at: now + j.expires_in * 1000 };
  return j.access_token;
}

function mapPayPalOrderStatus(s: string | undefined): PaymentInternalStatus {
  switch ((s || '').toUpperCase()) {
    case 'CREATED': return 'checkout_created';
    case 'PAYER_ACTION_REQUIRED': return 'checkout_created';
    case 'APPROVED': return 'pending';
    case 'COMPLETED': return 'paid';
    case 'VOIDED': return 'cancelled';
    default: return 'failed';
  }
}

function mapCaptureStatus(s: string | undefined, refundedAmountMinor = 0, capturedMinor = 0): PaymentInternalStatus {
  const u = (s || '').toUpperCase();
  if (u === 'COMPLETED') return refundedAmountMinor === 0 ? 'paid' : (refundedAmountMinor < capturedMinor ? 'partially_refunded' : 'refunded');
  if (u === 'DECLINED' || u === 'FAILED') return 'failed';
  if (u === 'REFUNDED') return 'refunded';
  if (u === 'PARTIALLY_REFUNDED') return 'partially_refunded';
  if (u === 'PENDING') return 'pending';
  return 'failed';
}

export class PayPalPaymentProvider implements PaymentProvider {
  readonly id = 'paypal' as const;
  // Optional injection point for tests. When set, replaces global fetch.
  private readonly _fetch: typeof fetch;
  constructor(fetchImpl?: typeof fetch) {
    this._fetch = fetchImpl || (globalThis.fetch as typeof fetch);
  }

  async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    const token = await getAccessToken();
    const c = await cfg();
    const body = {
      intent: 'CAPTURE',
      purchase_units: [
        {
          reference_id: input.funding_id,
          custom_id: input.metadata.campaign_id,
          invoice_id: input.funding_id,
          description: input.description.slice(0, 127),
          amount: {
            currency_code: input.currency.toUpperCase(),
            value: toCurrencyValue(input.amount_minor),
          },
        },
      ],
      application_context: {
        brand_name: 'WaveLead',
        landing_page: 'NO_PREFERENCE',
        shipping_preference: 'NO_SHIPPING',
        user_action: 'PAY_NOW',
        return_url: input.return_url,
        cancel_url: input.cancel_url,
      },
    };
    const res = await this._fetch(`${c.base}/v2/checkout/orders`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'PayPal-Request-Id': input.funding_id, // idempotency on retries
      },
      body: JSON.stringify(body),
    });
    const j = (await res.json()) as {
      id?: string;
      links?: Array<{ rel: string; href: string; method: string }>;
      status?: string;
      message?: string;
    };
    if (!res.ok || !j.id) {
      throw new Error(`PayPal createOrder failed: ${res.status} ${j.message || ''}`);
    }
    const approve = j.links?.find((l) => l.rel === 'approve')?.href;
    if (!approve) throw new Error('PayPal createOrder returned no approve link');
    return {
      provider: 'paypal',
      provider_order_id: j.id,
      approve_url: approve,
      raw: j,
    };
  }

  async capturePayment(input: CapturePaymentInput): Promise<CapturePaymentResult> {
    const token = await getAccessToken();
    const c = await cfg();
    const res = await this._fetch(`${c.base}/v2/checkout/orders/${encodeURIComponent(input.provider_order_id)}/capture`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        // A capture retry should be idempotent by the order id itself.
        'PayPal-Request-Id': `capture:${input.provider_order_id}`,
      },
      body: '{}',
    });
    const j = (await res.json()) as {
      id?: string;
      status?: string;
      purchase_units?: Array<{
        payments?: {
          captures?: Array<{ id: string; status: string; amount: { currency_code: string; value: string } }>;
        };
      }>;
      message?: string;
      name?: string;
      details?: Array<{ issue?: string; description?: string }>;
    };
    if (!res.ok) {
      // ORDER_ALREADY_CAPTURED (422) — either the return callback and the webhook
      // both raced to capture, or a retry hit an already-captured order. Fall back
      // to retrieval so the ledger still gets its one authoritative record.
      const alreadyCaptured = res.status === 422 && (j.details || []).some((d) => d.issue === 'ORDER_ALREADY_CAPTURED');
      if (alreadyCaptured) {
        return await this.retrievePayment({ provider_order_id: input.provider_order_id }).then((r) => ({
          provider_order_id: r.provider_order_id,
          provider_capture_id: r.provider_capture_id,
          internal_status: r.internal_status,
          amount_captured_minor: r.amount_minor,
          currency: r.currency,
          raw: r.raw,
        }));
      }
      // 422 UNPROCESSABLE_ENTITY (INSTRUMENT_DECLINED, PAYER_ACTION_REQUIRED, etc.) is a failed capture, not an infra error.
      return {
        provider_order_id: input.provider_order_id,
        provider_capture_id: null,
        internal_status: 'failed',
        amount_captured_minor: 0,
        currency: 'USD',
        raw: j,
      };
    }
    const cap = j.purchase_units?.[0]?.payments?.captures?.[0];
    if (!cap) {
      return {
        provider_order_id: input.provider_order_id,
        provider_capture_id: null,
        internal_status: mapPayPalOrderStatus(j.status),
        amount_captured_minor: 0,
        currency: 'USD',
        raw: j,
      };
    }
    return {
      provider_order_id: input.provider_order_id,
      provider_capture_id: cap.id,
      internal_status: mapCaptureStatus(cap.status),
      amount_captured_minor: fromCurrencyValue(cap.amount.value),
      currency: cap.amount.currency_code,
      raw: j,
    };
  }

  async retrievePayment(input: CapturePaymentInput): Promise<RetrievePaymentResult> {
    const token = await getAccessToken();
    const c = await cfg();
    const res = await this._fetch(`${c.base}/v2/checkout/orders/${encodeURIComponent(input.provider_order_id)}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
    const j = (await res.json()) as {
      id: string;
      status: string;
      purchase_units?: Array<{ amount?: { currency_code: string; value: string }; payments?: { captures?: Array<{ id: string; status: string; amount: { currency_code: string; value: string } }> } }>;
    };
    const cap = j.purchase_units?.[0]?.payments?.captures?.[0];
    const amt = j.purchase_units?.[0]?.amount;
    return {
      provider_order_id: input.provider_order_id,
      internal_status: cap ? mapCaptureStatus(cap.status) : mapPayPalOrderStatus(j.status),
      amount_minor: amt ? fromCurrencyValue(amt.value) : 0,
      currency: amt?.currency_code || 'USD',
      provider_capture_id: cap?.id ?? null,
      raw: j,
    };
  }

  async createRefund(input: RefundInput): Promise<RefundResult> {
    const token = await getAccessToken();
    const c = await cfg();
    const res = await this._fetch(`${c.base}/v2/payments/captures/${encodeURIComponent(input.provider_capture_id)}/refund`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'PayPal-Request-Id': input.idempotency_key,
      },
      body: JSON.stringify({
        amount: { currency_code: input.currency.toUpperCase(), value: toCurrencyValue(input.amount_minor) },
        note_to_payer: input.reason?.slice(0, 255) || 'Campaign refund',
      }),
    });
    const j = (await res.json()) as { id?: string; status?: string; amount?: { value: string }; message?: string };
    if (!res.ok || !j.id) throw new Error(`PayPal refund failed: ${res.status} ${j.message || ''}`);
    // Determine whether it's a full or partial refund. Caller decides based on
    // total captured amount; here we return a conservative internal_status.
    return {
      provider_refund_id: j.id,
      internal_status: 'partially_refunded',
      amount_refunded_minor: j.amount ? fromCurrencyValue(j.amount.value) : input.amount_minor,
      raw: j,
    };
  }

  async verifyWebhook(input: WebhookVerifyInput): Promise<WebhookVerifyResult> {
    const c = await cfg();
    if (!c.webhookId) {
      // Without a configured webhook id we cannot verify signature server-side.
      // Fail closed — never process the event.
      return { valid: false, reason: 'webhook_id_not_configured' };
    }
    const h = input.headers;
    // PayPal sends these headers (case-insensitive). Grab them defensively.
    const authAlgo = h['paypal-auth-algo'] || h['PAYPAL-AUTH-ALGO'] || h['Paypal-Auth-Algo'];
    const certUrl = h['paypal-cert-url'] || h['PAYPAL-CERT-URL'] || h['Paypal-Cert-Url'];
    const transmissionId = h['paypal-transmission-id'] || h['PAYPAL-TRANSMISSION-ID'] || h['Paypal-Transmission-Id'];
    const transmissionSig = h['paypal-transmission-sig'] || h['PAYPAL-TRANSMISSION-SIG'] || h['Paypal-Transmission-Sig'];
    const transmissionTime = h['paypal-transmission-time'] || h['PAYPAL-TRANSMISSION-TIME'] || h['Paypal-Transmission-Time'];
    if (!authAlgo || !certUrl || !transmissionId || !transmissionSig || !transmissionTime) {
      return { valid: false, reason: 'missing_paypal_headers' };
    }
    let webhookEvent: Record<string, unknown>;
    try {
      webhookEvent = JSON.parse(input.raw_body);
    } catch {
      return { valid: false, reason: 'malformed_body' };
    }
    const token = await getAccessToken();
    const res = await this._fetch(`${c.base}/v1/notifications/verify-webhook-signature`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        auth_algo: authAlgo,
        cert_url: certUrl,
        transmission_id: transmissionId,
        transmission_sig: transmissionSig,
        transmission_time: transmissionTime,
        webhook_id: c.webhookId,
        webhook_event: webhookEvent,
      }),
    });
    if (!res.ok) return { valid: false, reason: `verify_http_${res.status}` };
    const j = (await res.json()) as { verification_status?: string };
    if (j.verification_status !== 'SUCCESS') return { valid: false, reason: 'verification_failure' };
    return {
      valid: true,
      event_id: String((webhookEvent as { id?: string }).id || ''),
      event_type: String((webhookEvent as { event_type?: string }).event_type || ''),
      resource: (webhookEvent as { resource?: Record<string, unknown> }).resource,
    };
  }
}

export const _internalsForTests = { getAccessToken, cfg, mapPayPalOrderStatus, mapCaptureStatus };
