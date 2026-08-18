import { v4 as uuidv4 } from 'uuid';
import { channelRepo } from '../repositories/channelRepo';
import { categoryRepo } from '../repositories/categoryRepo';
import { auditRepo } from '../repositories/genericRepo';
import { requireRole, ROLES, HttpError } from '../auth/rbac';
import { editSchema, rejectSchema } from '../validation/submissionSchema';
import type { Actor, Channel, ChannelStatus } from '@/lib/types';

const ALLOWED_STATUS_FILTERS: ChannelStatus[] = [
  'pending_review', 'approved', 'rejected', 'suspended', 'archived',
];

export const moderationService = {
  async listQueue(
    actor: Actor | null,
    { status = 'pending_review', limit = 50 }: { status?: string; limit?: number } = {}
  ) {
    requireRole(actor, ROLES.MODERATOR);
    const safeStatus = ALLOWED_STATUS_FILTERS.includes(status as ChannelStatus)
      ? (status as ChannelStatus)
      : 'pending_review';
    const items = await channelRepo.list({
      filter: { status: safeStatus },
      sort: { created_at: -1 },
      limit,
    });
    // Enrich lightly with category name (no owner PII).
    const cats = await categoryRepo.listActive();
    const byId = new Map(cats.map((c) => [c.id, c.name]));
    return items.map((c) => ({
      ...c,
      category_name: c.category_id ? byId.get(c.category_id) || null : null,
    }));
  },

  async getById(actor: Actor | null, id: string) {
    requireRole(actor, ROLES.MODERATOR);
    const c = await channelRepo.findById(id);
    if (!c) throw new HttpError(404, 'Channel not found');
    let category_name: string | null = null;
    if (c.category_id) {
      const cats = await categoryRepo.listActive();
      category_name = cats.find((x) => x.id === c.category_id)?.name ?? null;
    }
    return { ...c, category_name };
  },

  async approve(
    actor: Actor | null,
    channelId: string,
    edits?: Record<string, unknown>
  ) {
    requireRole(actor, ROLES.MODERATOR);
    const channel = await channelRepo.findById(channelId);
    if (!channel) throw new HttpError(404, 'Channel not found');
    if (channel.status === 'approved') throw new HttpError(409, 'Channel already approved');

    const now = new Date();
    const patch: Partial<Channel> = {
      status: 'approved',
      published_at: channel.published_at ?? now,
      reviewed_by: actor!.user.id,
      reviewed_at: now,
      rejection_reason: null,
      rejection_notes: null,
    };

    if (edits && Object.keys(edits).length > 0) {
      const parsed = editSchema.safeParse(edits);
      if (!parsed.success) throw new HttpError(400, parsed.error.issues.map((i) => i.message).join('; '));
      const d = parsed.data;
      if (d.name !== undefined) patch.name = d.name;
      if (d.short_description !== undefined) patch.short_description = d.short_description;
      if (d.description !== undefined) patch.description = d.description;
      if (d.country_code !== undefined) patch.country_code = d.country_code.toUpperCase();
      if (d.primary_language !== undefined) patch.primary_language = d.primary_language;
      if (d.is_featured !== undefined) patch.is_featured = d.is_featured;
      if (d.verification_status !== undefined) patch.verification_status = d.verification_status;
      if (d.category_slug) {
        const cat = await categoryRepo.findBySlug(d.category_slug);
        if (!cat) throw new HttpError(400, 'Invalid category');
        patch.category_id = cat.id;
      }
    }

    await channelRepo.update(channelId, patch);
    await auditRepo.insert({
      id: uuidv4(),
      actor_user_id: actor!.user.id,
      action: 'ADMIN_APPROVE_CHANNEL',
      entity_type: 'channel',
      entity_id: channelId,
      before_data: { status: channel.status },
      after_data: { status: 'approved', ...patch },
      created_at: now,
    });
    return { ok: true };
  },

  async reject(actor: Actor | null, channelId: string, body: unknown) {
    requireRole(actor, ROLES.MODERATOR);
    const parsed = rejectSchema.safeParse(body);
    if (!parsed.success) throw new HttpError(400, 'Invalid rejection payload');
    const channel = await channelRepo.findById(channelId);
    if (!channel) throw new HttpError(404, 'Channel not found');
    if (channel.status === 'rejected') throw new HttpError(409, 'Already rejected');

    const now = new Date();
    const patch: Partial<Channel> = {
      status: 'rejected',
      reviewed_by: actor!.user.id,
      reviewed_at: now,
      rejection_reason: parsed.data.reason,
      rejection_notes: parsed.data.notes || null,
    };
    await channelRepo.update(channelId, patch);
    await auditRepo.insert({
      id: uuidv4(),
      actor_user_id: actor!.user.id,
      action: 'ADMIN_REJECT_CHANNEL',
      entity_type: 'channel',
      entity_id: channelId,
      before_data: { status: channel.status },
      after_data: { status: 'rejected', reason: parsed.data.reason, notes: parsed.data.notes || null },
      created_at: now,
    });
    return { ok: true };
  },
};
