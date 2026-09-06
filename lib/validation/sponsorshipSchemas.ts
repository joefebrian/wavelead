import { z } from 'zod';

export const OBJECTIVES = ['brand_awareness', 'traffic', 'product_launch', 'promotion', 'other'] as const;
export const BUDGET_RANGES = ['under_500', '500_1000', '1000_2500', '2500_5000', '5000_plus'] as const;
export const LEAD_STATUSES = ['new', 'contacted', 'qualified', 'won', 'lost', 'accepted_by_owner', 'declined_by_owner'] as const;

export const OBJECTIVE_LABEL: Record<(typeof OBJECTIVES)[number], string> = {
  brand_awareness: 'Brand Awareness', traffic: 'Traffic', product_launch: 'Product Launch', promotion: 'Promotion', other: 'Other',
};
export const BUDGET_LABEL: Record<(typeof BUDGET_RANGES)[number], string> = {
  under_500: 'Under $500', '500_1000': '$500 – $1,000', '1000_2500': '$1,000 – $2,500', '2500_5000': '$2,500 – $5,000', '5000_plus': '$5,000+',
};
export const BUDGET_MID_USD_MINOR: Record<(typeof BUDGET_RANGES)[number], number> = {
  under_500: 25_000, '500_1000': 75_000, '1000_2500': 175_000, '2500_5000': 375_000, '5000_plus': 750_000,
};

// M15 — safe materials link validator. HTTPS-only, restricted to Google
// Workspace shareable file surfaces to prevent SSRF-flavored abuse of the
// stored URL. Bytes are never proxied; only the URL is stored.
const GOOGLE_DRIVE_HOSTS = new Set(['drive.google.com', 'docs.google.com']);
const materialsUrlSchema = z.string().trim().max(500).refine((s) => {
  try {
    const u = new URL(s);
    if (u.protocol !== 'https:') return false;
    return GOOGLE_DRIVE_HOSTS.has(u.hostname);
  } catch { return false; }
}, 'materials_url must be an https://drive.google.com or https://docs.google.com link');

// Public brand submission — Zod `.strip()` semantics silently drop unknown
// client keys (channel_id/status/is_test_fixture injection attempts are
// safely ignored). channel_slug is REQUIRED and resolved server-side to
// the authoritative channel_id.
export const sponsorshipLeadCreateSchema = z.object({
  channel_slug: z.string().min(1).max(120),
  company_name: z.string().trim().min(1).max(200),
  contact_name: z.string().trim().min(1).max(200),
  work_email: z.string().trim().toLowerCase().email().max(200),
  objective: z.enum(OBJECTIVES),
  budget_range: z.enum(BUDGET_RANGES),
  target_country: z.string().trim().toUpperCase().length(2).nullable().optional().transform((v) => v ?? null),
  desired_start_at: z.string().datetime().nullable().optional().transform((v) => v ?? null),
  brief: z.string().trim().min(10).max(4000),
  materials_url: materialsUrlSchema.nullable().optional().transform((v) => v ?? null),
});

export const sponsorshipLeadPatchSchema = z.object({
  status: z.enum(LEAD_STATUSES).optional(),
  admin_notes: z.string().max(4000).nullable().optional(),
});

export type SponsorshipLeadCreateInput = z.infer<typeof sponsorshipLeadCreateSchema>;
export type SponsorshipLeadPatchInput = z.infer<typeof sponsorshipLeadPatchSchema>;
