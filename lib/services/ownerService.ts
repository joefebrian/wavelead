// Owner Channel Management (M03.6). Owners edit safe fields directly and
// submit sensitive change requests for review. Ownership is checked server-
// side against the CURRENT channel record — client-supplied channel_id is
// never trusted alone.
import { v4 as uuidv4 } from 'uuid';
import { channelRepo } from '../repositories/channelRepo';
import { changeRequestRepo, auditRepo } from '../repositories/genericRepo';
import { categoryRepo } from '../repositories/categoryRepo';
import { getCollection } from '../db/mongo';
import { COLLECTIONS } from '../db/collections';
import { HttpError } from '../auth/rbac';
import { ownerSafeEditSchema, changeRequestSubmitSchema } from '../validation/claimSchemas';
import type { Actor, Channel, ChannelChangeRequest, PublicChannel } from '@/lib/types';
import { sanitizeChannel } from '../utils/sanitize';

async function requireOwner(actor: Actor | null, channelId: string): Promise<Channel> {
  if (!actor) throw new HttpError(401, 'You must be signed in');
  const channel = await channelRepo.findById(channelId);
  if (!channel) throw new HttpError(404, 'Channel not found');
  if (channel.owner_id !== actor.user.id) throw new HttpError(403, 'You do not own this channel');
  return channel;
}

export const ownerService = {
  async listMine(actor: Actor | null): Promise<PublicChannel[]> {
    if (!actor) throw new HttpError(401, 'You must be signed in');
    const items = await channelRepo.list({
      filter: { owner_id: actor.user.id },
      sort: { updated_at: -1 },
      limit: 100,
    });
    return items.map(sanitizeChannel);
  },

  async getMine(actor: Actor | null, channelId: string) {
    const channel = await requireOwner(actor, channelId);
    // Include an active pending change request if any so the owner UI can
    // show "pending moderator review" state.
    const crColl = await getCollection<ChannelChangeRequest>(COLLECTIONS.CHANNEL_CHANGE_REQUESTS);
    const pendingCr = (await crColl.findOne({ channel_id: channelId, owner_id: actor!.user.id, status: 'pending' })) as ChannelChangeRequest | null;
    // Include category name.
    let categoryName: string | null = null;
    if (channel.category_id) {
      const cats = await categoryRepo.listActive();
      categoryName = cats.find((c) => c.id === channel.category_id)?.name ?? null;
    }
    const { _id: _u, ...safe } = { ...channel } as Channel & { _id?: unknown };
    void _u;
    return {
      channel: sanitizeChannel(safe as Channel),
      pending_change_request: pendingCr ? { id: pendingCr.id, changes: pendingCr.changes, submitted_at: pendingCr.submitted_at } : null,
      category_name: categoryName,
    };
  },

  async updateSafeFields(actor: Actor | null, channelId: string, input: unknown) {
    const channel = await requireOwner(actor, channelId);
    const parsed = ownerSafeEditSchema.safeParse(input);
    if (!parsed.success) throw new HttpError(400, parsed.error.issues.map((i) => i.message).join('; '));
    const data = parsed.data;
    const patch: Partial<Channel> = {};
    if (data.logo_url !== undefined) patch.logo_url = data.logo_url || null;
    if (data.cover_url !== undefined) patch.cover_url = data.cover_url || null;
    if (data.short_description !== undefined) patch.short_description = data.short_description || null;
    if (data.description !== undefined) patch.description = data.description || null;
    if (data.website_url !== undefined) patch.website_url = data.website_url || null;
    if (data.primary_language !== undefined) patch.primary_language = data.primary_language || null;
    if (Object.keys(patch).length === 0) return { ok: true, updated: false };
    await channelRepo.update(channel.id, patch);
    await auditRepo.insert({
      id: uuidv4(),
      actor_user_id: actor!.user.id,
      action: 'OWNER_UPDATED_CHANNEL',
      entity_type: 'channel',
      entity_id: channel.id,
      before_data: {
        logo_url: channel.logo_url, cover_url: channel.cover_url,
        short_description: channel.short_description, description: channel.description,
        website_url: channel.website_url, primary_language: channel.primary_language,
      },
      after_data: patch,
      created_at: new Date(),
    });
    return { ok: true, updated: true };
  },

  async submitChangeRequest(actor: Actor | null, channelId: string, input: unknown) {
    const channel = await requireOwner(actor, channelId);
    const parsed = changeRequestSubmitSchema.safeParse(input);
    if (!parsed.success) throw new HttpError(400, parsed.error.issues.map((i) => i.message).join('; '));

    // At most one active pending change request per channel — keeps the
    // reviewer's decision unambiguous.
    const crColl = await getCollection<ChannelChangeRequest>(COLLECTIONS.CHANNEL_CHANGE_REQUESTS);
    const existing = await crColl.findOne({ channel_id: channel.id, status: 'pending' });
    if (existing) throw new HttpError(409, 'A change request for this channel is already pending review');

    const now = new Date();
    const cr: ChannelChangeRequest = {
      id: uuidv4(),
      channel_id: channel.id,
      owner_id: channel.owner_id!,
      changes: parsed.data.changes,
      status: 'pending',
      submitted_at: now,
      reviewed_at: null,
      reviewed_by: null,
      moderator_notes: null,
      created_at: now,
      updated_at: now,
    };
    await changeRequestRepo.insert(cr);
    await auditRepo.insert({
      id: uuidv4(),
      actor_user_id: actor!.user.id,
      action: 'CHANNEL_CHANGE_REQUESTED',
      entity_type: 'channel_change_request',
      entity_id: cr.id,
      before_data: null,
      after_data: { channel_id: channel.id, changes: parsed.data.changes },
      created_at: now,
    });
    return { change_request_id: cr.id, status: cr.status };
  },
};
