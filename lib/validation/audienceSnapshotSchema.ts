// M11-Batch2A — Zod schemas for owner-submitted follower-evidence flow.
import { z } from 'zod';
import { AUDIENCE_REJECTION_REASONS } from '@/lib/types';

// Evidence attachment shape mirrors the UploadThing onUploadComplete response.
// We keep .strict() so unknown fields cannot pollute the DB record.
export const evidenceAttachmentSchema = z.object({
  provider: z.literal('uploadthing'),
  storage_key: z.string().min(1).max(200),
  url: z.string().url().max(2000),
  mime_type: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  file_name_safe: z.string().min(1).max(200),
  size_bytes: z.number().int().min(1).max(10 * 1024 * 1024),
  uploaded_at: z.string().min(1),
}).strict();

export const submitSnapshotSchema = z.object({
  followers: z.number().int().min(0).max(2_000_000_000),
  evidence_attachment: evidenceAttachmentSchema,
  evidence_date: z.string().datetime().nullable().optional(),
  submission_note: z.string().trim().max(500).nullable().optional(),
}).strict();

export type SubmitSnapshotInput = z.infer<typeof submitSnapshotSchema>;

export const rejectSnapshotSchema = z.object({
  rejection_reason: z.enum(AUDIENCE_REJECTION_REASONS),
  review_note: z.string().trim().max(1000).nullable().optional(),
}).strict();

export const verifySnapshotSchema = z.object({
  review_note: z.string().trim().max(1000).nullable().optional(),
}).strict();
