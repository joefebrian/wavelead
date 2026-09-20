// M18 — Provider-neutral FX reference service.
//
// Commercial/admin code asks THIS service for "what is the current USD→IDR
// reference, and where did it come from?". It never imports a provider SDK and
// never assumes PayPal: a future gateway registers its own observations with
// the same three source labels.
//
// SOURCE LABELS (exact, user-visible):
//   provider_quote      → "PayPal Quote"                  (pre-transaction)
//   provider_settlement → "PayPal Settlement Rate (Actual)" (authoritative)
//   manual_reference    → "Manual Admin Reference Rate"     (explicit fallback)
//
// A manual value is NEVER presented as a provider rate, and an estimate is
// never presented as a final rate.
import { v4 as uuidv4 } from 'uuid';
import { providerFxSnapshotRepo } from '@/lib/repositories/providerFxSnapshotRepo';
import { fundingFxRateRepo } from '@/lib/repositories/fundingFxRateRepo';
import type { ProviderFxObservation } from '@/lib/services/payments/paypalFx';

export const FX_SOURCES = ['provider_quote', 'provider_settlement', 'manual_reference'] as const;
export type FxSource = typeof FX_SOURCES[number];

export const FX_SOURCE_LABELS: Record<FxSource, string> = {
  provider_quote: 'PayPal Quote',
  provider_settlement: 'PayPal Settlement Rate (Actual)',
  manual_reference: 'Manual Admin Reference Rate',
};

export type FxStatus = 'fresh' | 'expired' | 'manual_fallback' | 'provider_unavailable';

export const FX_STATUS_LABELS: Record<FxStatus, string> = {
  fresh: 'Fresh',
  expired: 'Expired',
  manual_fallback: 'Manual Fallback',
  provider_unavailable: 'Provider Unavailable',
};

/** Label helper — the ONLY place a source string becomes display text. */
export function fxSourceLabel(source: string | null | undefined): string {
  if (source && (FX_SOURCES as readonly string[]).includes(source)) return FX_SOURCE_LABELS[source as FxSource];
  return 'Unknown source';
}

export interface ProviderFxSnapshot extends ProviderFxObservation {
  id: string;
  created_at: Date;
  /** Optional link back to the WaveLead payment this settlement belongs to. */
  payment_id?: string | null;
  purpose?: string | null;
}

export interface FxReferenceView {
  source: FxSource;
  source_label: string;
  status: FxStatus;
  status_label: string;
  base_currency: string;
  quote_currency: string;
  /** Decimal string. Display only — never used to recompute a past payment. */
  rate_value: string | null;
  effective_at: Date | null;
  expires_at: Date | null;
  provider: string | null;
  provider_environment: string | null;
  /** Masked provider reference (fx id / capture id), never a full secret. */
  provider_reference_masked: string | null;
  note: string;
}

function mask(id: string | null | undefined): string | null {
  if (!id) return null;
  const s = String(id);
  if (s.length <= 6) return `${s.slice(0, 2)}***`;
  return `${s.slice(0, 4)}***${s.slice(-2)}`;
}

export const providerFxService = {
  FX_SOURCES,
  FX_SOURCE_LABELS,

  /**
   * Append-only recording of REAL provider FX observations. Nothing is ever
   * updated in place: a settlement rate is an immutable audit fact, so a later
   * event adds a new row instead of rewriting history.
   */
  async recordObservations(
    observations: ProviderFxObservation[],
    link: { payment_id?: string | null; purpose?: string | null } = {},
  ): Promise<number> {
    let written = 0;
    for (const o of observations) {
      const dup = await providerFxSnapshotRepo.findDuplicate({
        provider: o.provider,
        provider_object_id: o.provider_object_id,
        provider_payload_path: o.provider_payload_path,
        rate_value: o.rate_value,
      });
      if (dup) continue;                       // idempotent on webhook replay
      await providerFxSnapshotRepo.insert({
        ...o,
        id: uuidv4(),
        created_at: new Date(),
        payment_id: link.payment_id ?? null,
        purpose: link.purpose ?? null,
      });
      written += 1;
    }
    return written;
  },

  async listSnapshots(limit = 50): Promise<ProviderFxSnapshot[]> {
    return providerFxSnapshotRepo.listRecent(limit);
  },

  /**
   * The current reference for display. Prefers a provider value when one
   * legitimately exists, otherwise falls back to the admin manual rate with an
   * explicit "Manual Fallback" status and "Manual Admin Reference Rate" label.
   */
  async currentReference(base = 'USD', quote = 'IDR'): Promise<FxReferenceView> {
    const providerRow = await providerFxSnapshotRepo.findLatestForPair(base, quote);
    if (providerRow) {
      const expires = providerRow.expiry_time ? new Date(providerRow.expiry_time) : null;
      const expired = !!expires && expires.getTime() < Date.now();
      return {
        source: providerRow.source,
        source_label: FX_SOURCE_LABELS[providerRow.source],
        status: expired ? 'expired' : 'fresh',
        status_label: expired ? FX_STATUS_LABELS.expired : FX_STATUS_LABELS.fresh,
        base_currency: providerRow.source_currency,
        quote_currency: providerRow.target_currency,
        rate_value: providerRow.rate_value,
        effective_at: providerRow.observed_at ? new Date(providerRow.observed_at) : null,
        expires_at: expires,
        provider: providerRow.provider,
        provider_environment: providerRow.provider_environment ?? null,
        provider_reference_masked: mask(providerRow.fx_id || providerRow.provider_object_id),
        note: providerRow.source === 'provider_settlement'
          ? 'Actual rate applied by the provider to a real transaction. Authoritative for that transaction only.'
          : 'Provider quote. Valid until its expiry; not a settlement guarantee.',
      };
    }

    const manual = await fundingFxRateRepo.findActive(base, quote);
    if (manual) {
      const rate = (manual.rate_scaled / manual.rate_scale).toString();
      return {
        source: 'manual_reference',
        source_label: FX_SOURCE_LABELS.manual_reference,
        status: 'manual_fallback',
        status_label: FX_STATUS_LABELS.manual_fallback,
        base_currency: manual.base_currency,
        quote_currency: manual.quote_currency,
        rate_value: rate,
        effective_at: manual.effective_from ? new Date(manual.effective_from) : null,
        expires_at: null,
        provider: null,
        provider_environment: null,
        provider_reference_masked: null,
        note: 'Administrator-entered reference rate. This is NOT a PayPal rate and is for planning/display only.',
      };
    }

    return {
      source: 'manual_reference',
      source_label: FX_SOURCE_LABELS.manual_reference,
      status: 'provider_unavailable',
      status_label: FX_STATUS_LABELS.provider_unavailable,
      base_currency: base,
      quote_currency: quote,
      rate_value: null,
      effective_at: null,
      expires_at: null,
      provider: null,
      provider_environment: null,
      provider_reference_masked: null,
      note: 'No provider FX value and no manual reference rate is configured. No value has been fabricated.',
    };
  },
};
