import { z } from 'zod';
import { SPONSORED_PLACEMENTS, CAMPAIGN_OBJECTIVES, type SponsoredPlacement, type CampaignObjective } from '@/lib/types';

const PLACEMENT_ENUM = z.enum(SPONSORED_PLACEMENTS as unknown as [SponsoredPlacement, ...SponsoredPlacement[]]);
const OBJECTIVE_ENUM = z.enum(CAMPAIGN_OBJECTIVES as unknown as [CampaignObjective, ...CampaignObjective[]]);
const REJECT_REASONS = ['invalid_targeting','invalid_budget','channel_not_eligible','placement_unavailable','policy_concern','duplicate_or_test','other'] as const;

export const promotionCreateSchema = z.object({
  channel_id: z.string().uuid('Invalid channel id'),
  name: z.string().min(1).max(80).optional(),
  objective: OBJECTIVE_ENUM,
  placements: z.array(PLACEMENT_ENUM).min(1, 'Choose at least one placement').max(5),
  targeting: z.object({
    countries: z.array(z.string().regex(/^[A-Z]{2}$/, 'Country must be ISO alpha-2')).max(50).default([]),
    languages: z.array(z.string().regex(/^[a-z]{2}$/, 'Language must be ISO 639-1')).max(30).default([]),
    categories: z.array(z.string().min(1).max(60)).max(30).default([]),
  }),
  budget_total_usd_minor: z.number().int().positive().max(100_000_00 /* $100k */),
  budget_daily_usd_minor: z.number().int().positive().nullable().optional(),
  start_at: z.string().datetime(),
  end_at: z.string().datetime(),
}).superRefine((v, ctx) => {
  const s = new Date(v.start_at).getTime();
  const e = new Date(v.end_at).getTime();
  if (!(e > s)) ctx.addIssue({ code: 'custom', path: ['end_at'], message: 'end_at must be after start_at' });
  if (v.budget_daily_usd_minor && v.budget_daily_usd_minor > v.budget_total_usd_minor) {
    ctx.addIssue({ code: 'custom', path: ['budget_daily_usd_minor'], message: 'daily budget cannot exceed total' });
  }
});

export type PromotionCreateInput = z.infer<typeof promotionCreateSchema>;

export const promotionPatchSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  objective: OBJECTIVE_ENUM.optional(),
  placements: z.array(PLACEMENT_ENUM).min(1).max(5).optional(),
  targeting: z.object({
    countries: z.array(z.string().regex(/^[A-Z]{2}$/)).max(50),
    languages: z.array(z.string().regex(/^[a-z]{2}$/)).max(30),
    categories: z.array(z.string().min(1).max(60)).max(30),
  }).optional(),
  budget_total_usd_minor: z.number().int().positive().max(100_000_00).optional(),
  budget_daily_usd_minor: z.number().int().positive().nullable().optional(),
  start_at: z.string().datetime().optional(),
  end_at: z.string().datetime().optional(),
});

export const rateCardUpsertSchema = z.object({
  placement: PLACEMENT_ENUM,
  country_code: z.string().regex(/^[A-Z]{2}$/).nullable(),
  cpm_usd_minor: z.number().int().positive().max(1_000_00 /* $1,000 CPM ceiling */),
  active: z.boolean().default(true),
  effective_from: z.string().datetime().optional(),
  effective_to: z.string().datetime().nullable().optional(),
});

export const rejectSchema = z.object({
  reason: z.enum(REJECT_REASONS),
  notes: z.string().max(1000).optional(),
});
