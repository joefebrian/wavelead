// Zod schemas for Milestone 03: claims, change requests, owner edits.
import { z } from 'zod';

const httpsUrl = z.string().url().refine((u) => /^https?:\/\//i.test(u), 'URL must be http(s)');

export const evidenceItemSchema = z.object({
  evidence_type: z.enum(['website', 'youtube', 'instagram', 'tiktok', 'x', 'facebook', 'other']),
  evidence_url: httpsUrl,
  note: z.string().max(500).optional().nullable(),
});

export const claimSubmitSchema = z.object({
  verification_method: z.enum(['domain', 'social', 'manual']),
  claimant_note: z.string().max(2000).optional().default(''),
  evidence_urls: z.array(evidenceItemSchema).max(10).optional().default([]),
});

export const claimResubmitSchema = claimSubmitSchema.extend({
  // resubmission responds to a request-for-info; must include a note.
  claimant_note: z.string().min(10, 'Please describe what changed.').max(2000),
});

export const claimRejectSchema = z.object({
  reason: z.enum([
    'insufficient_evidence',
    'evidence_mismatch',
    'channel_already_owned',
    'impersonation',
    'duplicate_claim',
    'fraud',
    'invalid_information',
    'other',
  ]),
  moderator_notes: z.string().max(2000).optional(),
});

export const claimRequestInfoSchema = z.object({
  message: z.string().min(10, 'Please describe what info is required.').max(2000),
  moderator_notes: z.string().max(2000).optional(),
});

export const claimApproveSchema = z.object({
  moderator_notes: z.string().max(2000).optional(),
});

// M03.6 owner-editable safe fields ONLY. Anything not listed here is
// stripped by Zod, which prevents privilege field injection.
export const ownerSafeEditSchema = z.object({
  logo_url: z.string().url().max(2048).optional().or(z.literal('')),
  cover_url: z.string().url().max(2048).optional().or(z.literal('')),
  short_description: z.string().min(10).max(180).optional(),
  description: z.string().max(2000).optional(),
  website_url: z.string().url().max(2048).optional().or(z.literal('')),
  primary_language: z.string().min(2).max(8).optional(),
}).strict();

// M03.7 sensitive change request fields — a submission goes through
// moderator review before the public listing changes.
export const changeRequestSubmitSchema = z.object({
  changes: z.object({
    name: z.string().min(2).max(80).optional(),
    whatsapp_url: httpsUrl.optional(),
    website_url: httpsUrl.optional().or(z.literal('')),
    category_slug: z.string().min(2).max(60).optional(),
    country_code: z.string().length(2).optional(),
  }).strict().refine((v) => Object.keys(v).length > 0, 'At least one sensitive field is required'),
});

export const changeRequestDecisionSchema = z.object({
  moderator_notes: z.string().max(2000).optional(),
});

export type ClaimSubmitInput = z.infer<typeof claimSubmitSchema>;
export type EvidenceItem = z.infer<typeof evidenceItemSchema>;
export type OwnerSafeEditInput = z.infer<typeof ownerSafeEditSchema>;
export type ChangeRequestSubmitInput = z.infer<typeof changeRequestSubmitSchema>;
