// Change Request Moderation (M03.7). Moderator+ reviews sensitive channel
// edits before they overwrite the live listing.
import { v4 as uuidv4 } from 'uuid';
import { changeRequestRepo, auditRepo } from '../repositories/genericRepo';
import { channelRepo } from '../repositories/channelRepo';
import { categoryRepo } from '../repositories/categoryRepo';
import { userRepo } from '../repositories/userRepo';
import { getCollection } from '../db/mongo';
import { COLLECTIONS } from '../db/collections';
import { HttpError, requireRole, ROLES } from '../auth/rbac';
import { changeRequestDecisionSchema } from '../validation/claimSchemas';
import { validateAndNormalizeWhatsAppUrl } from '../utils/whatsapp';
import type { Actor, Channel, ChannelChangeRequest, ChangeRequestStatus } from '@/lib/types';

const ALLOWED_STATUS: ChangeRequestStatus[] = ['pending', 'approved', 'rejected', 'cancelled'];

export const changeRequestModerationService = {
  async listQueue(actor: Actor | null, { status = 'pending', limit = 100 }: { status?: string; limit?: number } = {}) {
    requireRole(actor, ROLES.MODERATOR);
    const safe = ALLOWED_STATUS.includes(status as ChangeRequestStatus) ? (status as ChangeRequestStatus) : 'pending';
    const coll = await getCollection<ChannelChangeRequest>(COLLECTIONS.CHANNEL_CHANGE_REQUESTS);
    const rows = await coll.find({ status: safe }).sort({ submitted_at: -1 }).limit(limit).toArray();
    const channelIds = Array.from(new Set(rows.map((r) => r.channel_id)));
    const ownerIds = Array.from(new Set(rows.map((r) => r.owner_id)));
    const channels = await (await getCollection<Channel>(COLLECTIONS.CHANNELS)).find({ id: { $in: channelIds } }).toArray();
    const owners = await (await getCollection(COLLECTIONS.USERS)).find({ id: { $in: ownerIds } }, { projection: { _id: 0, id: 1, email: 1, display_name: 1 } }).toArray();
    const channelById = new Map(channels.map((c) => [c.id, c]));
    const ownerById = new Map(owners.map((u) => [u.id as string, u]));
    return rows.map(({ _id: _u, ...r }) => ({
      ...(r as ChannelChangeRequest),
      channel: (() => {
        const ch = channelById.get((r as ChannelChangeRequest).channel_id);
        if (!ch) return null;
        return { id: ch.id, name: ch.name, slug: ch.slug, whatsapp_url: ch.whatsapp_url, website_url: ch.website_url, country_code: ch.country_code, category_id: ch.category_id };
      })(),
      owner: ownerById.get((r as ChannelChangeRequest).owner_id) || null,
    }));
  },

  async getDetail(actor: Actor | null, id: string) {
    requireRole(actor, ROLES.MODERATOR);
    const cr = await changeRequestRepo.findById(id);
    if (!cr) throw new HttpError(404, 'Change request not found');
    const channel = await channelRepo.findById(cr.channel_id);
    const owner = await userRepo.findById(cr.owner_id);
    return { cr, channel, owner: owner ? { id: owner.id, email: owner.email, display_name: owner.display_name } : null };
  },

  async approve(actor: Actor | null, id: string, body: unknown) {
    requireRole(actor, ROLES.MODERATOR);
    const parsed = changeRequestDecisionSchema.safeParse(body || {});
    if (!parsed.success) throw new HttpError(400, 'Invalid decision payload');
    const cr = await changeRequestRepo.findById(id);
    if (!cr) throw new HttpError(404, 'Change request not found');
    if (cr.status !== 'pending') throw new HttpError(409, 'Only pending change requests can be approved');
    const channel = await channelRepo.findById(cr.channel_id);
    if (!channel) throw new HttpError(404, 'Channel no longer exists');

    const patch: Partial<Channel> = {};
    const c = cr.changes as Record<string, unknown>;
    if (typeof c.name === 'string') patch.name = c.name;
    if (typeof c.whatsapp_url === 'string') {
      const chk = validateAndNormalizeWhatsAppUrl(c.whatsapp_url);
      if (!chk.ok || !chk.normalized) throw new HttpError(400, chk.reason || 'Invalid WhatsApp URL');
      // Prevent stealing another channel's URL.
      const channelsColl = await getCollection<Channel>(COLLECTIONS.CHANNELS);
      const dup = await channelsColl.findOne({ whatsapp_url: chk.normalized, id: { $ne: channel.id } });
      if (dup) throw new HttpError(409, 'This WhatsApp URL is already used by another listing');
      patch.whatsapp_url = chk.normalized;
    }
    if (typeof c.website_url === 'string') patch.website_url = c.website_url || null;
    if (typeof c.country_code === 'string') patch.country_code = c.country_code.toUpperCase();
    if (typeof c.category_slug === 'string') {
      const cat = await categoryRepo.findBySlug(c.category_slug);
      if (!cat) throw new HttpError(400, 'Invalid category');
      patch.category_id = cat.id;
    }

    const now = new Date();
    await channelRepo.update(channel.id, patch);
    await changeRequestRepo.update(cr.id, {
      status: 'approved',
      reviewed_at: now,
      reviewed_by: actor!.user.id,
      moderator_notes: parsed.data.moderator_notes || null,
    });
    await auditRepo.insert({
      id: uuidv4(),
      actor_user_id: actor!.user.id,
      action: 'CHANNEL_CHANGE_APPROVED',
      entity_type: 'channel_change_request',
      entity_id: cr.id,
      before_data: { channel_id: channel.id, previous: { name: channel.name, whatsapp_url: channel.whatsapp_url, website_url: channel.website_url, country_code: channel.country_code, category_id: channel.category_id } },
      after_data: { changes_applied: patch },
      created_at: now,
    });
    return { ok: true };
  },

  async reject(actor: Actor | null, id: string, body: unknown) {
    requireRole(actor, ROLES.MODERATOR);
    const parsed = changeRequestDecisionSchema.safeParse(body || {});
    if (!parsed.success) throw new HttpError(400, 'Invalid decision payload');
    const cr = await changeRequestRepo.findById(id);
    if (!cr) throw new HttpError(404, 'Change request not found');
    if (cr.status !== 'pending') throw new HttpError(409, 'Only pending change requests can be rejected');
    const now = new Date();
    await changeRequestRepo.update(cr.id, {
      status: 'rejected',
      reviewed_at: now,
      reviewed_by: actor!.user.id,
      moderator_notes: parsed.data.moderator_notes || null,
    });
    await auditRepo.insert({
      id: uuidv4(),
      actor_user_id: actor!.user.id,
      action: 'CHANNEL_CHANGE_REJECTED',
      entity_type: 'channel_change_request',
      entity_id: cr.id,
      before_data: { status: cr.status },
      after_data: { status: 'rejected', notes: parsed.data.moderator_notes || null },
      created_at: now,
    });
    return { ok: true };
  },
};
