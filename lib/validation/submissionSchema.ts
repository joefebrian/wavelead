import { z } from 'zod';

export const submissionSchema = z.object({
  whatsapp_url: z.string().url(),
  name: z.string().min(2).max(80),
  short_description: z.string().min(10).max(180),
  description: z.string().max(2000).optional(),
  category_slug: z.string().min(2).max(60),
  country_code: z.string().length(2),
  primary_language: z.string().min(2).max(8),
  website_url: z.string().url().optional().or(z.literal('')),
  logo_url: z.string().url().optional().or(z.literal('')),
});
export type SubmissionInput = z.infer<typeof submissionSchema>;

export const rejectSchema = z.object({
  reason: z.enum([
    'duplicate','invalid_url','spam','misleading','unsupported_content',
    'missing_information','impersonation','other',
  ]),
  notes: z.string().max(1000).optional(),
});

export const editSchema = z.object({
  name: z.string().min(2).max(80).optional(),
  short_description: z.string().min(10).max(180).optional(),
  description: z.string().max(2000).optional(),
  category_slug: z.string().optional(),
  country_code: z.string().length(2).optional(),
  primary_language: z.string().optional(),
  is_featured: z.boolean().optional(),
  verification_status: z.enum(['unclaimed','claimed','verified','official']).optional(),
});

export const slotSchema = z.object({
  section: z.enum(['popular','new_noteworthy','featured']),
  channel_id: z.string().min(1),
  priority: z.number().int().min(0).max(1000).optional(),
});

export const searchSchema = z.object({
  q: z.string().optional(),
  category: z.string().optional(),
  country: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(60).optional(),
});
