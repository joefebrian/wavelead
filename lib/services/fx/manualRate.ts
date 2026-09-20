// M18.1 hotfix — canonical manual FX rate resolution.
//
// ROOT CAUSE THIS FILE EXISTS FOR:
//   providerFxService previously computed the manual reference as
//     rate_scaled / rate_scale
//   instead of
//     rate_scaled / 10 ** rate_scale
//   The production row is { rate_scaled: 18200, rate_scale: 0 }, so the
//   division was 18200 / 0 = Infinity and /admin/fx-rates rendered
//   "1 USD = ∞ IDR". For rate_scale > 0 it produced a silently wrong number.
//
// CANONICAL RULE (single source of truth):
//   canonical_rate = rate_scaled / (10 ** rate_scale)
// A rate is only usable when it is finite AND strictly positive.
import type { FundingFxRate } from '@/lib/types';

export const FX_UNAVAILABLE_LABEL = 'FX Reference Unavailable';

/** True when the stored row can produce a finite, strictly positive rate. */
export function isValidManualRateRow(row: Pick<FundingFxRate, 'rate_scaled' | 'rate_scale'> | null | undefined): boolean {
  return canonicalManualRate(row) !== null;
}

/**
 * canonical_rate = rate_scaled / 10^rate_scale.
 * Returns null for anything that is not a finite positive rate — never
 * Infinity, -Infinity, NaN or 0.
 */
export function canonicalManualRate(row: Pick<FundingFxRate, 'rate_scaled' | 'rate_scale'> | null | undefined): number | null {
  if (!row) return null;
  const scaled = Number(row.rate_scaled);
  const scale = Number(row.rate_scale);
  if (!Number.isFinite(scaled) || !Number.isInteger(scaled) || scaled <= 0) return null;
  if (!Number.isFinite(scale) || !Number.isInteger(scale) || scale < 0 || scale > 18) return null;
  const rate = scaled / 10 ** scale;
  if (!Number.isFinite(rate) || rate <= 0) return null;
  return rate;
}

/** Display string (grouped, no fabricated precision). null when unusable. */
export function formatManualRate(row: Pick<FundingFxRate, 'rate_scaled' | 'rate_scale'> | null | undefined): string | null {
  const rate = canonicalManualRate(row);
  if (rate === null) return null;
  return rate.toLocaleString('en-US', { maximumFractionDigits: 8 });
}

/** Plain decimal string for API/view payloads. null when unusable. */
export function canonicalManualRateString(row: Pick<FundingFxRate, 'rate_scaled' | 'rate_scale'> | null | undefined): string | null {
  const rate = canonicalManualRate(row);
  if (rate === null) return null;
  return String(rate);
}

/**
 * Resolve the rate to display from existing history WITHOUT rewriting it:
 *   1. the active row, when it yields a valid rate;
 *   2. otherwise the most recent historical row that yields a valid rate;
 *   3. otherwise null → callers must show FX_UNAVAILABLE_LABEL.
 * `rows` may be in any order; recency is decided by effective_from/created_at.
 */
export function resolveLatestValidManualRate(
  rows: FundingFxRate[],
  base = 'USD',
  quote = 'IDR',
): { row: FundingFxRate; rate: number; from_active: boolean } | null {
  const pair = (rows || []).filter((r) => r.base_currency === base && r.quote_currency === quote);
  const active = pair.find((r) => r.active);
  const activeRate = canonicalManualRate(active);
  if (active && activeRate !== null) return { row: active, rate: activeRate, from_active: true };

  const ts = (r: FundingFxRate) => {
    const d = r.effective_from || r.created_at;
    const t = d ? new Date(d).getTime() : 0;
    return Number.isFinite(t) ? t : 0;
  };
  const candidates = pair
    .filter((r) => canonicalManualRate(r) !== null)
    .sort((a, b) => ts(b) - ts(a));
  const best = candidates[0];
  if (!best) return null;
  return { row: best, rate: canonicalManualRate(best) as number, from_active: false };
}
