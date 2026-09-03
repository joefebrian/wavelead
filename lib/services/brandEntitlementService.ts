// M11-Batch6 — Brand-scoped entitlement resolver.
//
// Scoping rules (LOAD-BEARING — do not weaken):
//   • Grants live in `brand_entitlement_grants` with product_scope='brand'.
//   • A grant NEVER touches owner-facing entitlements (revenue_intelligence,
//     sponsorship_pipeline_intelligence, benchmarking, rate_card_intelligence
//     for owner rate-card benchmarks, etc.). Owner entitlements resolve from
//     `user.plan` via lib/entitlements.ts and are independent of brand grants.
//   • For persona='both' users: they get owner entitlements from their plan
//     AND brand entitlements from an active grant — with no cross-leak.
//   • Only 'active' grants unlock capabilities. 'past_due' preserves access
//     for the future recurring path (not used in Batch6). 'cancelled' /
//     'expired' / 'refunded' revoke capabilities on the next resolution.
//   • Coming Soon capabilities (ai_campaign_brief,
//     campaign_channel_recommendations) stay FALSE even when granted —
//     admins should not appear to ship them.
//   • Idempotent grant issuance guarded by unique idempotency_key.
import { v4 as uuidv4 } from 'uuid';
import { getCollection } from '@/lib/db/mongo';
import { COLLECTIONS } from '@/lib/db/collections';
import type {
  Actor,
  BrandEntitlementGrant,
  BrandEntitlementSet,
  BrandEntitlementSource,
  BrandEntitlementStatus,
} from '@/lib/types';
import type { Entitlements } from '@/lib/entitlements';

async function grantCol() {
  return getCollection<BrandEntitlementGrant>(COLLECTIONS.BRAND_ENTITLEMENT_GRANTS);
}

// The set of BRAND capabilities each entitlement_set unlocks. This is the
// scoping allowlist — NEVER map a set to owner-facing keys.
type BrandFlags = Entitlements['brand'];

const BRAND_PRO_FLAGS: BrandFlags = {
  founding_lifetime: false,
  advanced_channel_discovery: true,
  rate_card_intelligence_brand_view: true,
  campaign_reporting: true,
  campaign_intelligence: true,
  ai_campaign_brief: false,                     // Coming Soon — stays false even when granted
  campaign_channel_recommendations: false,      // Coming Soon — stays false even when granted
};

const BRAND_FOUNDING_LIFETIME_FLAGS: BrandFlags = {
  ...BRAND_PRO_FLAGS,
  founding_lifetime: true,
};

function flagsForSet(set: BrandEntitlementSet): BrandFlags {
  switch (set) {
    case 'brand_founding_lifetime': return { ...BRAND_FOUNDING_LIFETIME_FLAGS };
    case 'brand_pro':               return { ...BRAND_PRO_FLAGS };
    default:                        return {
      founding_lifetime: false,
      advanced_channel_discovery: false,
      rate_card_intelligence_brand_view: false,
      campaign_reporting: false,
      campaign_intelligence: false,
      ai_campaign_brief: false,
      campaign_channel_recommendations: false,
    };
  }
}

function unionFlags(a: BrandFlags, b: BrandFlags): BrandFlags {
  return {
    founding_lifetime: a.founding_lifetime || b.founding_lifetime,
    advanced_channel_discovery: a.advanced_channel_discovery || b.advanced_channel_discovery,
    rate_card_intelligence_brand_view: a.rate_card_intelligence_brand_view || b.rate_card_intelligence_brand_view,
    campaign_reporting: a.campaign_reporting || b.campaign_reporting,
    campaign_intelligence: a.campaign_intelligence || b.campaign_intelligence,
    ai_campaign_brief: false,                     // Coming Soon — always false
    campaign_channel_recommendations: false,      // Coming Soon — always false
  };
}

const NO_BRAND_FLAGS: BrandFlags = {
  founding_lifetime: false,
  advanced_channel_discovery: false,
  rate_card_intelligence_brand_view: false,
  campaign_reporting: false,
  campaign_intelligence: false,
  ai_campaign_brief: false,
  campaign_channel_recommendations: false,
};

export const brandEntitlementService = {
  /**
   * Resolve the brand sub-entitlements for a user id. Read-only.
   * Union of every 'active' grant. Non-active grants (past_due, cancelled,
   * expired, refunded) do NOT contribute.
   */
  async resolveForUser(user_id: string): Promise<BrandFlags> {
    try {
      const c = await grantCol();
      const rows = await c.find({ user_id, product_scope: 'brand', status: 'active' }).toArray();
      if (!rows.length) return { ...NO_BRAND_FLAGS };
      let acc: BrandFlags = { ...NO_BRAND_FLAGS };
      const now = Date.now();
      for (const g of rows) {
        // Time bounds — a grant with a valid_until in the past does not unlock.
        if (g.valid_until && g.valid_until.getTime() < now) continue;
        acc = unionFlags(acc, flagsForSet(g.entitlement_set));
      }
      return acc;
    } catch { return { ...NO_BRAND_FLAGS }; }
  },

  /**
   * Latest active grant for a specific entitlement_set. Used for "already
   * active" duplicate-purchase guards.
   */
  async findActiveGrant(user_id: string, entitlement_set: BrandEntitlementSet): Promise<BrandEntitlementGrant | null> {
    try {
      const c = await grantCol();
      return await c.findOne({ user_id, product_scope: 'brand', entitlement_set, status: 'active' });
    } catch { return null; }
  },

  /**
   * Idempotently create a grant. Duplicate calls with the same
   * idempotency_key return the existing grant instead of erroring.
   */
  async createGrantIdempotent(input: {
    user_id: string;
    entitlement_set: BrandEntitlementSet;
    source: BrandEntitlementSource;
    source_id: string | null;
    pricing_snapshot_id: string | null;
    idempotency_key: string;
    valid_until?: Date | null;
  }): Promise<{ grant: BrandEntitlementGrant; created: boolean }> {
    const c = await grantCol();
    const existing = await c.findOne({ idempotency_key: input.idempotency_key });
    if (existing) return { grant: existing, created: false };
    const now = new Date();
    const doc: BrandEntitlementGrant = {
      id: uuidv4(),
      user_id: input.user_id,
      product_scope: 'brand',
      entitlement_set: input.entitlement_set,
      source: input.source,
      status: 'active',
      valid_from: now,
      valid_until: input.valid_until ?? null,   // null → lifetime
      source_id: input.source_id,
      pricing_snapshot_id: input.pricing_snapshot_id,
      idempotency_key: input.idempotency_key,
      created_at: now,
      updated_at: now,
    };
    try {
      await c.insertOne(doc as unknown as import('mongodb').OptionalUnlessRequiredId<BrandEntitlementGrant>);
      return { grant: doc, created: true };
    } catch (e) {
      const msg = (e as { message?: string })?.message || '';
      if (msg.includes('E11000') || msg.includes('duplicate key')) {
        const again = await c.findOne({ idempotency_key: input.idempotency_key });
        if (again) return { grant: again, created: false };
      }
      throw e;
    }
  },

  /**
   * Flip an active grant to a terminal / non-active status. Preserves the
   * historical row (never deletes). Idempotent — repeated calls with the
   * same target status are no-ops.
   */
  async setStatus(grantId: string, next: BrandEntitlementStatus): Promise<BrandEntitlementGrant | null> {
    const c = await grantCol();
    const now = new Date();
    await c.updateOne({ id: grantId, status: { $ne: next } }, { $set: { status: next, updated_at: now } });
    return c.findOne({ id: grantId });
  },

  /**
   * Public projection returned to the buyer/actor. Strips internal fields
   * (idempotency_key) that are not useful to the client.
   */
  toPublicView(g: BrandEntitlementGrant) {
    return {
      id: g.id,
      product_scope: g.product_scope,
      entitlement_set: g.entitlement_set,
      source: g.source,
      status: g.status,
      valid_from: g.valid_from,
      valid_until: g.valid_until,
      pricing_snapshot_id: g.pricing_snapshot_id,
      created_at: g.created_at,
    };
  },
};

/**
 * Layer active brand grants onto an already-resolved Entitlements object.
 * Owner-facing entitlements are NEVER modified — only the `brand` sub-object.
 */
export async function applyBrandGrantsToEntitlements(actor: Actor | null | undefined, base: Entitlements): Promise<Entitlements> {
  if (!actor) return base;
  const brand = await brandEntitlementService.resolveForUser(actor.user.id);
  // Union with whatever `base.brand` already has (admin bypass sets some
  // flags true; a grant can only add capabilities, never remove them).
  return {
    ...base,
    brand: {
      founding_lifetime: base.brand.founding_lifetime || brand.founding_lifetime,
      advanced_channel_discovery: base.brand.advanced_channel_discovery || brand.advanced_channel_discovery,
      rate_card_intelligence_brand_view: base.brand.rate_card_intelligence_brand_view || brand.rate_card_intelligence_brand_view,
      campaign_reporting: base.brand.campaign_reporting || brand.campaign_reporting,
      campaign_intelligence: base.brand.campaign_intelligence || brand.campaign_intelligence,
      ai_campaign_brief: false,                     // Coming Soon
      campaign_channel_recommendations: false,      // Coming Soon
    },
  };
}
