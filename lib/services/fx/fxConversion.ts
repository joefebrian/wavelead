// Deterministic integer-safe USD/IDR conversion.
//
// Design invariants:
//   • Never use JavaScript floating-point arithmetic (`parseFloat`, `Number`
//     multiplication of monetary values, `toFixed` as accounting logic).
//   • Use BigInt throughout so we cannot silently overflow safe-integer range.
//   • Rate is represented as `rate_scaled / 10^rate_scale`. For a rate of
//     16500 exactly, use `rate_scaled=16500, rate_scale=0`. For a rate of
//     16523.4567, use `rate_scaled=165234567, rate_scale=4`.
//   • Checkout rounding = CEIL (do not under-collect against the USD budget).
//   • Refund   rounding = FLOOR (do not over-refund against unused USD).
//   • Any residual sub-rupiah delta must be reported to callers explicitly so
//     it can be persisted as an `fx_rounding_adjustment` if needed.
//
// Formula:
//   idr_whole = usd_micros × rate_scaled / (1_000_000 × 10^rate_scale)

export type Rounding = 'ceil' | 'floor';

export interface ConversionInputs {
  usd_micros: number;
  rate_scaled: number;
  rate_scale: number;
  rounding: Rounding;
}

export interface ConversionResult {
  idr_whole: number;             // integer whole rupiah
  idr_rounding_adjustment_micros: number; // signed USD-micros representation of the residual
}

function pow10(n: number): bigint {
  if (!Number.isInteger(n) || n < 0 || n > 18) throw new Error('rate_scale out of range');
  let out = 1n;
  for (let i = 0; i < n; i++) out *= 10n;
  return out;
}

export function convertUsdMicrosToIdr({ usd_micros, rate_scaled, rate_scale, rounding }: ConversionInputs): ConversionResult {
  if (!Number.isInteger(usd_micros) || usd_micros < 0) throw new Error('usd_micros must be a non-negative integer');
  if (!Number.isInteger(rate_scaled) || rate_scaled <= 0) throw new Error('rate_scaled must be a positive integer');
  if (!Number.isInteger(rate_scale) || rate_scale < 0) throw new Error('rate_scale must be a non-negative integer');

  const bnUsd = BigInt(usd_micros);
  const bnRate = BigInt(rate_scaled);
  const bnScale = pow10(rate_scale);
  const bnDenom = 1_000_000n * bnScale;

  const numerator = bnUsd * bnRate;
  const quotient = numerator / bnDenom;
  const remainder = numerator % bnDenom;

  let idr_whole_bn: bigint;
  if (remainder === 0n) idr_whole_bn = quotient;
  else if (rounding === 'ceil') idr_whole_bn = quotient + 1n;
  else idr_whole_bn = quotient;

  // Residual expressed back in USD micros for auditability:
  // adjustment_micros = (idr_whole × denom / rate) - usd_micros
  // A positive value means we over-collected in USD (customer pays a hair more)
  // A negative value means we under-refunded (never happens with floor if we compute correctly)
  const backConversionNumerator = idr_whole_bn * bnDenom;
  const equivalent_usd_micros = backConversionNumerator / bnRate;
  const adjustment = equivalent_usd_micros - bnUsd;

  const idr_whole = Number(idr_whole_bn);
  const idr_rounding_adjustment_micros = Number(adjustment);
  if (!Number.isSafeInteger(idr_whole) || !Number.isSafeInteger(idr_rounding_adjustment_micros)) {
    throw new Error('conversion overflowed safe integer range');
  }
  return { idr_whole, idr_rounding_adjustment_micros };
}
