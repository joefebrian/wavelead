// Phase B1 — deterministic 90/10 marketplace split.
//
// All amounts are INTEGER minor units (USD cents). We never use floating
// point for money. The split rule is:
//
//    owner_earnings_minor    = floor(net_minor * owner_share_bps / 10000)
//    wavelead_commission_minor = net_minor - owner_earnings_minor
//
// This guarantees the two shares SUM EXACTLY to `net_minor`. Any rounding
// residue lands entirely on WaveLead's side; never on the seller.
export const OWNER_SHARE_BPS = 9000 as const;
export const PLATFORM_SHARE_BPS = 1000 as const;

export interface SplitResult {
  net_minor: number;
  owner_earnings_minor: number;
  wavelead_commission_minor: number;
}

export function computeSplit(gross_minor: number, gateway_fee_minor: number): SplitResult {
  if (!Number.isInteger(gross_minor) || gross_minor < 0) throw new Error('gross_minor must be a non-negative integer');
  if (!Number.isInteger(gateway_fee_minor) || gateway_fee_minor < 0) throw new Error('gateway_fee_minor must be a non-negative integer');
  if (gateway_fee_minor > gross_minor) throw new Error('gateway_fee_minor cannot exceed gross_minor');
  const net_minor = gross_minor - gateway_fee_minor;
  const owner_earnings_minor = Math.floor((net_minor * OWNER_SHARE_BPS) / 10_000);
  const wavelead_commission_minor = net_minor - owner_earnings_minor;
  return { net_minor, owner_earnings_minor, wavelead_commission_minor };
}
