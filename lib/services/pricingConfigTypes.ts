// M11-Batch5 — Client-safe types + display helpers for commercial pricing.
//
// This module is SAFE to import from React Client Components and from
// server code alike. It contains ONLY:
//   • plain TypeScript interfaces
//   • pure display helpers (formatMinorUSD)
//   • default constants
//
// It intentionally has ZERO imports from mongodb, auth, or anything else
// that would drag server-only modules into a client bundle.
//
// The full service (getAdminPricing / getPublicPricing / updatePricing) lives
// in pricingConfigService.ts and MUST stay server-only.

export interface CommercialPricingConfig {
  id: string;                              // always 'active' in this patch
  currency: 'USD';
  brand_free:       { price_minor: number; enabled: boolean };
  brand_pro:        { beta_price_minor: number; regular_price_minor: number; beta_duration_months: number; enabled: boolean };
  brand_lifetime:   { price_minor: number; enabled: boolean; availability: 'public_beta' | 'always' };
  enterprise:       { pricing_type: 'custom'; enabled: boolean };
  owner_activation: { display_price_minor: number; enabled: boolean };
  updated_at: Date;
  updated_by_user_id: string | null;
  created_at: Date;
}

// Public-safe projection returned to unauthenticated visitors. Strips ALL
// internal audit metadata (updated_by_user_id, updated_at, created_at) —
// only commercial-display fields are exposed publicly.
export type PublicPricing = Omit<
  CommercialPricingConfig,
  'updated_by_user_id' | 'created_at' | 'updated_at'
> & {
  // Note: the OWNER activation price surfaced publicly is display-only.
  //       Real billing amount remains locked server-side.
  owner_activation_display_only: true;
};

export const DEFAULT_PRICING_CONFIG: CommercialPricingConfig = {
  id: 'active',
  currency: 'USD',
  brand_free:       { price_minor: 0,       enabled: true },
  brand_pro:        { beta_price_minor: 1500, regular_price_minor: 2500, beta_duration_months: 3, enabled: true },
  brand_lifetime:   { price_minor: 10000,   enabled: true, availability: 'public_beta' },
  enterprise:       { pricing_type: 'custom', enabled: true },
  owner_activation: { display_price_minor: 100, enabled: true },
  updated_at: new Date(0),
  updated_by_user_id: null,
  created_at: new Date(0),
};

// -------- Display helpers (server + client safe) --------
export function formatMinorUSD(minor: number): string {
  if (!Number.isFinite(minor) || minor < 0) return '$0';
  const dollars = minor / 100;
  // Whole-dollar amounts render without ".00", cents render with 2 dp.
  return minor % 100 === 0 ? `$${dollars.toFixed(0)}` : `$${dollars.toFixed(2)}`;
}
