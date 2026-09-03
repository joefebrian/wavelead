// M11-Batch5 — Admin-configurable commercial pricing.
//
// Contract:
//   • Single active pricing config document (id = 'active').
//   • Public pricing pages ALWAYS read through pricingConfigService —
//     never hardcode dollar amounts inside display components.
//   • owner_activation.display_price_minor is DISPLAY-ONLY in this patch.
//     The actual $1 activation charge lives in channelActivationService and
//     is NOT wired to this config — live activation billing is not enabled.
//   • Missing config row is not an error — defaults are returned WITHOUT
//     any DB mutation (public reads never write).
//
// Client-safe types + formatMinorUSD live in ./pricingConfigTypes so React
// Client Components can import them WITHOUT dragging mongodb into the bundle.
import { z } from 'zod';
import { getCollection } from '@/lib/db/mongo';
import { COLLECTIONS } from '@/lib/db/collections';
import { HttpError, requireAuth, ROLES, rankOf } from '@/lib/auth/rbac';
import type { Actor } from '@/lib/types';
import {
  DEFAULT_PRICING_CONFIG,
  type CommercialPricingConfig,
  type PublicPricing,
  formatMinorUSD,
} from './pricingConfigTypes';

const ACTIVE_ID = 'active';

// Re-export for existing server-side call sites.
export { DEFAULT_PRICING_CONFIG, formatMinorUSD };
export type { CommercialPricingConfig, PublicPricing };

async function coll() { return getCollection<CommercialPricingConfig>(COLLECTIONS.COMMERCIAL_PRICING_CONFIG); }

function requireAdmin(actor: Actor | null): void {
  requireAuth(actor);
  if (rankOf(actor!.user.role) < rankOf(ROLES.ADMIN)) throw new HttpError(403, 'Admin only');
}

// -------- Validation (server-authoritative) --------
// Prices: integer minor units, non-negative, sane upper bound.
// Beta duration: integer months, sane upper bound.
const sectionBrandFree = z.object({
  price_minor: z.number().int().min(0).max(1_000_000),
  enabled: z.boolean(),
}).strict();

const sectionBrandPro = z.object({
  beta_price_minor: z.number().int().min(0).max(1_000_000),
  regular_price_minor: z.number().int().min(0).max(1_000_000),
  beta_duration_months: z.number().int().min(0).max(36),
  enabled: z.boolean(),
}).strict();

const sectionBrandLifetime = z.object({
  price_minor: z.number().int().min(0).max(1_000_000),
  enabled: z.boolean(),
  availability: z.enum(['public_beta', 'always']),
}).strict();

const sectionEnterprise = z.object({
  pricing_type: z.literal('custom'),
  enabled: z.boolean(),
}).strict();

const sectionOwnerActivation = z.object({
  display_price_minor: z.number().int().min(0).max(1_000_000),
  enabled: z.boolean(),
}).strict();

export const pricingUpdateSchema = z.object({
  brand_free: sectionBrandFree.optional(),
  brand_pro: sectionBrandPro.optional(),
  brand_lifetime: sectionBrandLifetime.optional(),
  enterprise: sectionEnterprise.optional(),
  owner_activation: sectionOwnerActivation.optional(),
}).strict();
export type PricingUpdateInput = z.infer<typeof pricingUpdateSchema>;

function toPublic(cfg: CommercialPricingConfig): PublicPricing {
  return {
    id: cfg.id,
    currency: cfg.currency,
    brand_free: cfg.brand_free,
    brand_pro: cfg.brand_pro,
    brand_lifetime: cfg.brand_lifetime,
    enterprise: cfg.enterprise,
    owner_activation: cfg.owner_activation,
    owner_activation_display_only: true,
  };
}

export const pricingConfigService = {
  DEFAULT: DEFAULT_PRICING_CONFIG,

  // Read-only. Falls back to defaults if the DB row does not yet exist.
  // NEVER performs a write — public traffic cannot cause a mutation.
  async getAdminPricing(): Promise<CommercialPricingConfig> {
    try {
      const c = await coll();
      const doc = await c.findOne({ id: ACTIVE_ID });
      return (doc as CommercialPricingConfig | null) || DEFAULT_PRICING_CONFIG;
    } catch { return DEFAULT_PRICING_CONFIG; }
  },

  async getPublicPricing(): Promise<PublicPricing> {
    const cfg = await this.getAdminPricing();
    return toPublic(cfg);
  },

  async updatePricing(actor: Actor | null, patch: unknown): Promise<CommercialPricingConfig> {
    requireAdmin(actor);
    const parsed = pricingUpdateSchema.safeParse(patch);
    if (!parsed.success) throw new HttpError(400, parsed.error.issues.map((i) => i.message).join('; '));
    // Defensive: regular price must not be lower than beta price when both
    // are >0. (Beta is the promo, regular is the post-beta.)
    if (parsed.data.brand_pro) {
      const bp = parsed.data.brand_pro;
      if (bp.regular_price_minor > 0 && bp.beta_price_minor > 0 && bp.regular_price_minor < bp.beta_price_minor) {
        throw new HttpError(400, 'Regular price cannot be lower than beta price');
      }
    }
    const c = await coll();
    const current = (await c.findOne({ id: ACTIVE_ID })) as CommercialPricingConfig | null;
    const now = new Date();
    const next: CommercialPricingConfig = {
      id: ACTIVE_ID,
      currency: 'USD',
      brand_free: parsed.data.brand_free ?? current?.brand_free ?? DEFAULT_PRICING_CONFIG.brand_free,
      brand_pro: parsed.data.brand_pro ?? current?.brand_pro ?? DEFAULT_PRICING_CONFIG.brand_pro,
      brand_lifetime: parsed.data.brand_lifetime ?? current?.brand_lifetime ?? DEFAULT_PRICING_CONFIG.brand_lifetime,
      enterprise: parsed.data.enterprise ?? current?.enterprise ?? DEFAULT_PRICING_CONFIG.enterprise,
      owner_activation: parsed.data.owner_activation ?? current?.owner_activation ?? DEFAULT_PRICING_CONFIG.owner_activation,
      updated_at: now,
      updated_by_user_id: actor!.user.id,
      created_at: current?.created_at || now,
    };
    await c.updateOne({ id: ACTIVE_ID }, { $set: next }, { upsert: true });
    return next;
  },
};
