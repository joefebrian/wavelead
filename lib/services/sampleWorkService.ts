// M18.1 Phase H — Sample Work (lightweight creator portfolio).
//
// Purpose: help BRANDS evaluate a channel before sending or approving a
// sponsorship. Deliberately minimal:
//   • no file hosting — public https:// links only
//   • no requirement that the work was a paid WaveLead campaign
//   • never fabricated: WaveLead does not create work on a creator's behalf.
//     The UI templates are clearly labelled as examples and are NOT stored.
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { getCollection } from '@/lib/db/mongo';
import { COLLECTIONS } from '@/lib/db/collections';
import { channelRepo } from '@/lib/repositories/channelRepo';
import { HttpError, requireAuth, rankOf, ROLES } from '@/lib/auth/rbac';
import type { Actor, ChannelSampleWork } from '@/lib/types';

export const SAMPLE_WORK_TYPES = [
  'sponsored_post', 'product_feature', 'affiliate_promotion', 'campaign_announcement', 'other',
] as const;
export type SampleWorkType = typeof SAMPLE_WORK_TYPES[number];

export const SAMPLE_WORK_TYPE_LABELS: Record<SampleWorkType, string> = {
  sponsored_post: 'Sponsored Post',
  product_feature: 'Product / Deal Feature',
  affiliate_promotion: 'Affiliate Promotion',
  campaign_announcement: 'Campaign Announcement',
  other: 'Other',
};

/** Educational examples for the UI. Never persisted, never attributed to a creator. */
export const SAMPLE_WORK_TEMPLATES = [
  { work_type: 'sponsored_post', title: 'Sponsored Post — example', description: 'A single post introducing a brand to your channel audience, with a clear disclosure.' },
  { work_type: 'product_feature', title: 'Product / Deal Feature — example', description: 'A short feature of a product or limited-time deal, including the key offer details.' },
  { work_type: 'affiliate_promotion', title: 'Affiliate Promotion — example', description: 'A recurring affiliate recommendation with your tracked link.' },
  { work_type: 'campaign_announcement', title: 'Campaign Announcement — example', description: 'An announcement post kicking off a multi-post brand campaign.' },
] as const;

export const MAX_SAMPLE_WORKS = 12;

export const sampleWorkSchema = z.object({
  title: z.string().trim().min(3, 'title: at least 3 characters').max(120, 'title: max 120 characters'),
  work_type: z.enum(SAMPLE_WORK_TYPES),
  description: z.string().trim().max(400, 'description: max 400 characters').optional().nullable(),
  content_url: z.string().trim().url('content_url: must be a valid URL')
    .refine((u) => /^https:\/\//i.test(u), 'content_url: must start with https://')
    .refine((u) => {
      try {
        const h = new URL(u).hostname.toLowerCase();
        // No private/loopback targets — public evidence only.
        return !(h === 'localhost' || h.endsWith('.local') || /^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h) || h === '[::1]');
      } catch { return false; }
    }, 'content_url: must be a public https link'),
  brand_name: z.string().trim().max(80, 'brand_name: max 80 characters').optional().nullable(),
  published_on: z.string().trim().max(10).optional().nullable(),   // YYYY-MM-DD
});

async function coll() { return getCollection<ChannelSampleWork>(COLLECTIONS.CHANNEL_SAMPLE_WORKS); }

async function assertOwnerOrAdmin(actor: Actor | null, channelId: string) {
  requireAuth(actor);
  const channel = await channelRepo.findById(channelId);
  if (!channel) throw new HttpError(404, 'Channel not found');
  const isOwner = channel.owner_id === actor!.user.id
    || (channel as unknown as { submitted_by?: string | null }).submitted_by === actor!.user.id;
  const isAdmin = rankOf(actor!.user.role) >= rankOf(ROLES.MODERATOR);
  if (!isOwner && !isAdmin) throw new HttpError(403, 'Not authorized for this channel');
  return channel;
}

export const sampleWorkService = {
  SAMPLE_WORK_TYPES,
  SAMPLE_WORK_TYPE_LABELS,
  SAMPLE_WORK_TEMPLATES,
  MAX_SAMPLE_WORKS,

  async listForOwner(actor: Actor | null, channelId: string): Promise<ChannelSampleWork[]> {
    await assertOwnerOrAdmin(actor, channelId);
    const c = await coll();
    return (await c.find({ channel_id: channelId }, { projection: { _id: 0 } }).sort({ created_at: -1 }).toArray()) as ChannelSampleWork[];
  },

  /** Public read — used by brands on the channel profile. */
  async listPublic(channelId: string, limit = MAX_SAMPLE_WORKS): Promise<ChannelSampleWork[]> {
    const c = await coll();
    return (await c.find({ channel_id: channelId }, { projection: { _id: 0 } }).sort({ created_at: -1 }).limit(limit).toArray()) as ChannelSampleWork[];
  },

  async create(actor: Actor | null, channelId: string, input: unknown): Promise<ChannelSampleWork> {
    await assertOwnerOrAdmin(actor, channelId);
    const parsed = sampleWorkSchema.safeParse(input);
    if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message || 'Invalid sample work');
    const c = await coll();
    const existing = await c.countDocuments({ channel_id: channelId });
    if (existing >= MAX_SAMPLE_WORKS) throw new HttpError(409, `At most ${MAX_SAMPLE_WORKS} sample work entries per channel`);
    const now = new Date();
    const row: ChannelSampleWork = {
      id: uuidv4(),
      channel_id: channelId,
      created_by: actor!.user.id,
      title: parsed.data.title,
      work_type: parsed.data.work_type,
      description: parsed.data.description?.trim() || null,
      content_url: parsed.data.content_url,
      brand_name: parsed.data.brand_name?.trim() || null,
      published_on: parsed.data.published_on?.trim() || null,
      created_at: now,
      updated_at: now,
    };
    await c.insertOne(row as never);
    return row;
  },

  async remove(actor: Actor | null, id: string): Promise<{ deleted: boolean }> {
    requireAuth(actor);
    const c = await coll();
    const row = (await c.findOne({ id })) as ChannelSampleWork | null;
    if (!row) return { deleted: false };                      // idempotent
    await assertOwnerOrAdmin(actor, row.channel_id);
    await c.deleteOne({ id });
    return { deleted: true };
  },

  /**
   * Owner onboarding checklist. Read-only derivation from existing domains —
   * none of these items is a new gate on the listing staying public.
   */
  async onboardingChecklist(actor: Actor | null, channelId: string): Promise<{
    items: { key: string; label: string; done: boolean; href: string | null }[];
    complete: boolean;
  }> {
    const channel = await assertOwnerOrAdmin(actor, channelId);
    const rc = await getCollection<{ channel_id: string; packages?: unknown[] }>(COLLECTIONS.CHANNEL_RATE_CARDS);
    const card = await rc.findOne({ channel_id: channelId });
    const hasRateCard = !!card && Array.isArray(card.packages) && card.packages.length > 0;
    const c = await coll();
    const sampleCount = await c.countDocuments({ channel_id: channelId });
    const profileComplete = !!channel.description && !!channel.category_id && !!channel.country_code;
    const items = [
      { key: 'approved', label: 'Channel approved', done: channel.status === 'approved', href: null },
      { key: 'rate_card', label: 'Set rate card', done: hasRateCard, href: `/dashboard/channels/${channelId}/monetization` },
      { key: 'sample_work', label: 'Add sample work', done: sampleCount > 0, href: `/dashboard/channels/${channelId}/monetization#sample-work` },
      { key: 'profile', label: 'Complete sponsorship profile', done: profileComplete, href: `/dashboard/channels/${channelId}` },
    ];
    return { items, complete: items.every((i) => i.done) };
  },
};
