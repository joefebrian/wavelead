// ============================================================================
// Phase 3 — SAAS Entitlements
// ============================================================================
// Central plan/entitlement resolver. Never gate on `plan === X` in scattered
// places — always go through `resolveEntitlements(actor)` or the helpers below.
//
// Product rule (do not weaken):
//   Free owners MUST be able to fully participate in the marketplace money
//   loop — claim/verify a channel, receive sponsorships, complete jobs,
//   receive earnings, request external payout, and use Promote as
//   pay-per-campaign. Paid tiers monetize advanced operational / intelligence
//   capabilities, not basic marketplace participation.
//
// Admin / super_admin ALWAYS receive unlimited entitlements — they operate
// the platform and must never be limited by SaaS caps.
// ============================================================================
import { HttpError, hasAtLeastRole, ROLES } from './auth/rbac';
import type { Actor, PublicUser } from './types';

export type Plan = 'free' | 'pro' | 'enterprise';

export const PLANS = ['free', 'pro', 'enterprise'] as const satisfies readonly Plan[];

export const PLAN_ORDER: Record<Plan, number> = {
  free: 0,
  pro: 10,
  enterprise: 20,
};

// Sentinel for uncapped numeric quotas.
export const UNLIMITED = Number.POSITIVE_INFINITY;

// ---------------------------------------------------------------------------
// Entitlement shape
// ---------------------------------------------------------------------------
export interface Entitlements {
  plan: Plan;
  // Numeric caps
  max_managed_channels: number;      // 1 for Free, 10 for Pro, UNLIMITED for Ent
  analytics_history_days: number;    // 30 / 365 / UNLIMITED
  team_seats: number;                // 0 / 0 / 10 (Ent-only feature)
  // Boolean flags (OWNER-scoped — never automatically unlocked by a Brand purchase).
  advanced_analytics: boolean;
  revenue_intelligence: boolean;
  benchmarking: boolean;
  rate_card_intelligence: boolean;
  sponsorship_pipeline_intelligence: boolean;
  promote_performance_intelligence: boolean;
  advanced_exports: boolean;
  team_workspace: boolean;
  bulk_operations: boolean;
  portfolio_analytics: boolean;
  api_access: boolean;
  account_management: boolean;
  // Marketplace baseline — always TRUE for every plan (Free-monetization rule).
  marketplace_participation: true;
  earnings_and_payouts: true;
  promote_pay_per_campaign: true;
  basic_rate_card: true;
  basic_analytics: true;
  // M11-Batch6 — BRAND-scoped entitlements. These are ALLOWLISTED per grant
  // via lib/services/brandEntitlementService.ts. They are NEVER unlocked as a
  // side-effect of a Channel Owner Pro plan and NEVER unlock owner-facing
  // capabilities above. A persona='both' account holding both an owner plan
  // and a brand grant sees both — with no cross-leak.
  brand: {
    founding_lifetime: boolean;                       // has an active Founding Lifetime grant
    advanced_channel_discovery: boolean;              // BRAND-side discovery — shipping
    rate_card_intelligence_brand_view: boolean;       // BRAND-side rate-card intel — shipping
    campaign_reporting: boolean;                      // shipping
    campaign_intelligence: boolean;                   // shipping
    ai_campaign_brief: boolean;                       // Coming Soon: catalog only, UI stays gated
    campaign_channel_recommendations: boolean;        // Coming Soon: catalog only, UI stays gated
  };
}

export type EntitlementKey = keyof Omit<Entitlements, 'plan' | 'brand'>;
export type BrandEntitlementFlag = keyof Entitlements['brand'];

// ---------------------------------------------------------------------------
// Plan → Entitlements
// ---------------------------------------------------------------------------
// Baseline BRAND sub-entitlements — every plan starts with brand: {all false}.
// Brand capabilities are ONLY unlocked by an active brand_entitlement_grant
// (see brandEntitlementService.applyToEntitlements), NOT by an owner Plan tier.
const BRAND_NONE: Entitlements['brand'] = {
  founding_lifetime: false,
  advanced_channel_discovery: false,
  rate_card_intelligence_brand_view: false,
  campaign_reporting: false,
  campaign_intelligence: false,
  ai_campaign_brief: false,                        // Coming Soon
  campaign_channel_recommendations: false,         // Coming Soon
};

const FREE: Entitlements = {
  plan: 'free',
  max_managed_channels: 1,
  analytics_history_days: 30,
  team_seats: 0,
  advanced_analytics: false,
  revenue_intelligence: false,
  benchmarking: false,
  rate_card_intelligence: false,
  sponsorship_pipeline_intelligence: false,
  promote_performance_intelligence: false,
  advanced_exports: false,
  team_workspace: false,
  bulk_operations: false,
  portfolio_analytics: false,
  api_access: false,
  account_management: false,
  marketplace_participation: true,
  earnings_and_payouts: true,
  promote_pay_per_campaign: true,
  basic_rate_card: true,
  basic_analytics: true,
  brand: { ...BRAND_NONE },
};

const PRO: Entitlements = {
  ...FREE,
  plan: 'pro',
  max_managed_channels: 10,
  analytics_history_days: 365,
  advanced_analytics: true,
  revenue_intelligence: true,
  benchmarking: true,
  rate_card_intelligence: true,
  sponsorship_pipeline_intelligence: true,
  promote_performance_intelligence: true,
  advanced_exports: true,
  brand: { ...BRAND_NONE },   // Owner Pro NEVER auto-grants brand capabilities
};

const ENTERPRISE: Entitlements = {
  ...PRO,
  plan: 'enterprise',
  max_managed_channels: UNLIMITED,
  analytics_history_days: UNLIMITED,
  team_seats: 10,
  team_workspace: true,
  bulk_operations: true,
  portfolio_analytics: true,
  api_access: true,
  account_management: true,
  brand: { ...BRAND_NONE },
};

// Admin-bypass entitlements — every gate open, every quota unlimited.
// Used when the actor has role >= ADMIN so operational access is never
// accidentally limited by SaaS caps.
const ADMIN_BYPASS: Entitlements = {
  ...ENTERPRISE,
  plan: 'enterprise',
  max_managed_channels: UNLIMITED,
  analytics_history_days: UNLIMITED,
  team_seats: UNLIMITED,
  // Admin bypass: brand capabilities open too, so admin operational UI
  // can inspect the brand surfaces. Coming Soon capabilities remain false —
  // they should not render as "live" for anyone, even admin.
  brand: {
    founding_lifetime: true,
    advanced_channel_discovery: true,
    rate_card_intelligence_brand_view: true,
    campaign_reporting: true,
    campaign_intelligence: true,
    ai_campaign_brief: false,                     // Coming Soon — stays false
    campaign_channel_recommendations: false,      // Coming Soon — stays false
  },
};

/** Pure resolver: plan → entitlements. Never touches the network or DB. */
export function entitlementsForPlan(plan: Plan): Entitlements {
  switch (plan) {
    case 'pro':        return { ...PRO };
    case 'enterprise': return { ...ENTERPRISE };
    case 'free':
    default:           return { ...FREE };
  }
}

/**
 * Extract the effective plan from a user record. Missing / unknown values
 * default to 'free' so pre-existing accounts (no plan field yet) resolve
 * safely to Free without a migration.
 */
export function getUserPlan(user: PublicUser | null | undefined): Plan {
  const raw = (user as (PublicUser & { plan?: unknown }) | null | undefined)?.plan;
  if (raw === 'pro' || raw === 'enterprise' || raw === 'free') return raw;
  return 'free';
}

/**
 * Resolve entitlements for the current actor.
 *   - visitor / null → Free entitlements (read-only anyway; gate on auth first).
 *   - admin / super_admin → ADMIN_BYPASS (never limited by SaaS caps).
 *   - everyone else → entitlementsForPlan(user.plan).
 *
 * NOTE: BRAND-scoped entitlements are LAYERED on top of the owner-facing
 * baseline resolved here. Call sites that need brand capabilities go through
 * lib/services/brandEntitlementService.resolveBrandEntitlementsForUser() and
 * merge into the returned `.brand` sub-object. Owner-plan resolution NEVER
 * grants brand capabilities, so a Channel Owner Pro on a persona='owner'
 * account does not accidentally unlock Brand Pro features.
 */
export function resolveEntitlements(actor: Actor | null | undefined): Entitlements {
  if (!actor) return { ...FREE, brand: { ...BRAND_NONE } };
  if (hasAtLeastRole(actor.user, ROLES.ADMIN)) return { ...ADMIN_BYPASS, brand: { ...ADMIN_BYPASS.brand } };
  const base = entitlementsForPlan(getUserPlan(actor.user));
  return { ...base, brand: { ...BRAND_NONE } };   // brand starts empty; layered by brand service
}

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

/** Boolean check for a flag entitlement. Numeric caps use `hasQuota`. */
export function hasEntitlement(actor: Actor | null | undefined, key: EntitlementKey): boolean {
  const ent = resolveEntitlements(actor);
  const value = ent[key];
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value > 0;
  return false;
}

/**
 * Throws HttpError(403, 'PLAN_REQUIRED: <key>') if the actor's plan does not
 * grant the given flag entitlement. Admin/super_admin always pass.
 */
export function requireEntitlement(actor: Actor | null | undefined, key: EntitlementKey): void {
  if (hasEntitlement(actor, key)) return;
  const err = new HttpError(403, `PLAN_REQUIRED: ${String(key)}`);
  (err as HttpError & { code?: string }).code = 'PLAN_REQUIRED';
  throw err;
}

/** Numeric-cap check. Returns true iff `current < cap`. */
export function hasQuota(actor: Actor | null | undefined, key: EntitlementKey, current: number): boolean {
  const ent = resolveEntitlements(actor);
  const cap = ent[key];
  if (typeof cap !== 'number') return false;
  return current < cap;
}

/**
 * Throws HttpError(403, 'QUOTA_EXCEEDED: <key>') if `current >= cap` for the
 * numeric entitlement `key`. Admin/super_admin always pass.
 */
export function requireQuota(actor: Actor | null | undefined, key: EntitlementKey, current: number): void {
  if (hasQuota(actor, key, current)) return;
  const err = new HttpError(403, `QUOTA_EXCEEDED: ${String(key)}`);
  (err as HttpError & { code?: string }).code = 'QUOTA_EXCEEDED';
  throw err;
}

// ---------------------------------------------------------------------------
// Wire-safe serialization
// ---------------------------------------------------------------------------
// `Number.POSITIVE_INFINITY` doesn't survive JSON. Serialize as null so the
// client can render "Unlimited" without ambiguity.
export function serializeEntitlements(ent: Entitlements): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(ent)) {
    if (typeof v === 'number' && !Number.isFinite(v)) out[k] = null;
    else out[k] = v;
  }
  return out;
}
