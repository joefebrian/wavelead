// Phase B1 — deterministic 90/10 marketplace split.
//
// FINANCIAL SAFETY (B1.1.2 hardening):
//   * All amounts are INTEGER minor units (USD cents).
//   * Arithmetic is performed as BigInt to eliminate any possibility of
//     floating-point error, then narrowed back to `number` only after we
//     prove the result is a safe non-negative integer.
//   * Persisted schema remains JS `number` (no Decimal128, no BigInt on the
//     wire) — BigInt is a calculation primitive only.
//   * Invariant (proved by tests): `owner + platform === net` exactly, for
//     every supported input, including odd-cent / smallest-non-zero / bound.
//
// Split rule (unchanged policy):
//     net_minor              = gross_minor − gateway_fee_minor
//     owner_earnings_minor   = floor(net_minor * 9000 / 10000)
//     wavelead_commission    = net_minor − owner_earnings_minor
//
// Rounding residue always accrues to WaveLead — never to the seller.
export const OWNER_SHARE_BPS = 9000 as const;
export const PLATFORM_SHARE_BPS = 1000 as const;
const BPS_DENOM_BI = 10_000n;
const OWNER_SHARE_BI = BigInt(OWNER_SHARE_BPS);

// Domain bounds. Any minor-unit money value that flows through the marketplace
// must be a non-negative safe integer AND ≤ MAX_MONEY_MINOR. This is
// intentionally set well below Number.MAX_SAFE_INTEGER so that any downstream
// arithmetic on `number` (e.g. sums in KPIs) can never lose precision either.
// $10,000,000.00 USD ceiling per single order value — production is nowhere
// close and Zod caps individual amounts far below this.
export const MAX_MONEY_MINOR = 1_000_000_000 as const;   // 10^9 cents

export function assertSafeMoney(v: unknown, label = 'amount_minor'): asserts v is number {
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new Error(`${label} must be a finite number`);
  }
  if (!Number.isSafeInteger(v)) {
    throw new Error(`${label} must be a safe integer (received ${v})`);
  }
  if (v < 0) throw new Error(`${label} must be non-negative (received ${v})`);
  if (v > MAX_MONEY_MINOR) {
    throw new Error(`${label} exceeds MAX_MONEY_MINOR (${MAX_MONEY_MINOR}) — received ${v}`);
  }
}

export interface SplitResult {
  net_minor: number;
  owner_earnings_minor: number;
  wavelead_commission_minor: number;
}

/**
 * Compute the exact 90/10 split of `net_minor = gross − fee` using BigInt.
 * Guarantees: owner + platform === net, both non-negative safe integers.
 */
export function computeSplit(gross_minor: number, gateway_fee_minor: number): SplitResult {
  assertSafeMoney(gross_minor, 'gross_minor');
  assertSafeMoney(gateway_fee_minor, 'gateway_fee_minor');
  if (gateway_fee_minor > gross_minor) {
    throw new Error(`gateway_fee_minor (${gateway_fee_minor}) cannot exceed gross_minor (${gross_minor})`);
  }

  // BigInt arithmetic — no floating point involved.
  const grossBi = BigInt(gross_minor);
  const feeBi = BigInt(gateway_fee_minor);
  const netBi = grossBi - feeBi;
  const ownerBi = (netBi * OWNER_SHARE_BI) / BPS_DENOM_BI;   // integer division floors
  const platformBi = netBi - ownerBi;

  // Provably-safe narrowing: net ≤ gross ≤ MAX_MONEY_MINOR, and both
  // owner/platform ≤ net, so all three remain within safe-integer bounds.
  const net_minor = Number(netBi);
  const owner_earnings_minor = Number(ownerBi);
  const wavelead_commission_minor = Number(platformBi);

  // Defensive re-check: assert the invariant we just computed.
  // (If this ever fires it indicates a runtime environment bug, not a policy bug.)
  if (owner_earnings_minor + wavelead_commission_minor !== net_minor) {
    throw new Error(`INVARIANT_BREACH: owner (${owner_earnings_minor}) + platform (${wavelead_commission_minor}) !== net (${net_minor})`);
  }
  assertSafeMoney(net_minor, 'net_minor');
  assertSafeMoney(owner_earnings_minor, 'owner_earnings_minor');
  assertSafeMoney(wavelead_commission_minor, 'wavelead_commission_minor');

  return { net_minor, owner_earnings_minor, wavelead_commission_minor };
}
