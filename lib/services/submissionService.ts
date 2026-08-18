import { v4 as uuidv4 } from 'uuid';
import { channelRepo } from '../repositories/channelRepo';
import { categoryRepo } from '../repositories/categoryRepo';
import { userRepo } from '../repositories/userRepo';
import { getCollection } from '../db/mongo';
import { COLLECTIONS } from '../db/collections';
import { validateAndNormalizeWhatsAppUrl } from '../utils/whatsapp';
import { slugify } from '../utils/slug';
import { normalizeChannelUrl } from './enrichment/urlNormalizer';
import { submissionSchema } from '../validation/submissionSchema';
import { HttpError } from '../auth/rbac';
import type { Actor, Channel } from '@/lib/types';

async function ensureUniqueSlug(base: string): Promise<string> {
  const coll = await getCollection<Channel>(COLLECTIONS.CHANNELS);
  let candidate = base;
  let i = 2;
  while (await coll.findOne({ slug: candidate })) {
    candidate = `${base}-${i++}`;
    if (i > 500) { candidate = `${base}-${uuidv4().slice(0, 6)}`; break; }
  }
  return candidate;
}

export const submissionService = {
  async validateUrl(url: string) { return validateAndNormalizeWhatsAppUrl(url); },

  async checkDuplicate(url: string) {
    const chk = validateAndNormalizeWhatsAppUrl(url);
    if (!chk.ok) return { duplicate: false };
    const existing = await channelRepo.list({
      filter: { whatsapp_url: chk.normalized },
      limit: 1,
    });
    if (existing.length === 0) return { duplicate: false, normalized: chk.normalized };
    const c = existing[0];
    return {
      duplicate: true,
      normalized: chk.normalized,
      channel: {
        id: c.id, slug: c.slug, name: c.name,
        status: c.status, is_public: c.status === 'approved',
      },
    };
  },

  async submit(actor: Actor, input: unknown) {
    if (!actor) throw new HttpError(401, 'You must be signed in to submit a channel');
    const parsed = submissionSchema.safeParse(input);
    if (!parsed.success) {
      throw new HttpError(400, parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
    }
    const data = parsed.data;

    const urlCheck = validateAndNormalizeWhatsAppUrl(data.whatsapp_url);
    if (!urlCheck.ok || !urlCheck.normalized) throw new HttpError(400, urlCheck.reason || 'Invalid WhatsApp URL');

    // M05.0: derive canonical whatsapp_channel_id for hard duplicate protection.
    const canonical = normalizeChannelUrl(urlCheck.normalized);
    const whatsappChannelId = canonical?.channel_id ?? null;
    const whatsappUrlToStore = canonical?.canonical_url ?? urlCheck.normalized;

    // Duplicate detection — prefer canonical id when available.
    const dupFilter = whatsappChannelId ? { whatsapp_channel_id: whatsappChannelId } : { whatsapp_url: whatsappUrlToStore };
    const dup = await channelRepo.list({ filter: dupFilter, limit: 1 });
    if (dup.length > 0) {
      throw new HttpError(409, 'This WhatsApp channel is already listed on WaveLead');
    }

    const category = await categoryRepo.findBySlug(data.category_slug);
    if (!category) throw new HttpError(400, 'Invalid category');

    const user = await userRepo.findById(actor.user.id);
    if (!user) throw new HttpError(401, 'Session invalid');

    const slug = await ensureUniqueSlug(slugify(data.name));
    const now = new Date();

    const channel: Channel = {
      id: uuidv4(),
      slug,
      name: data.name,
      whatsapp_url: whatsappUrlToStore,
      whatsapp_channel_id: whatsappChannelId,
      description: data.description || null,
      short_description: data.short_description,
      logo_url: data.logo_url || null,
      cover_url: null,
      website_url: data.website_url || null,
      country_code: data.country_code.toUpperCase(),
      primary_language: data.primary_language,
      category_id: category.id,
      owner_id: actor.user.id,
      // SECURITY: normal users can NEVER set moderation state.
      status: 'pending_review',
      verification_status: 'unclaimed',
      is_official: false,
      is_featured: false,
      is_nsfw: false,
      is_demo: false,
      activity_level: 'active',
      follower_count: 0,
      follower_count_source: 'submitter',
      follower_count_updated_at: null,
      created_at: now,
      updated_at: now,
      published_at: null,
    };
    await channelRepo.insert(channel);
    return { channel: { id: channel.id, slug: channel.slug, status: channel.status, name: channel.name } };
  },
};
