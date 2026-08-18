// Claim Moderation (M03.3 + M03.4). Only moderator+ can invoke.
// Approvals atomically assign ownership to prevent double-owner races.
import { v4 as uuidv4 } from 'uuid';
import { claimRepo, auditRepo } from '../repositories/genericRepo';
import { channelRepo } from '../repositories/channelRepo';
import { userRepo } from '../repositories/userRepo';
import { getCollection } from '../db/mongo';
import { COLLECTIONS } from '../db/collections';
import { HttpError, requireRole, ROLES } from '../auth/rbac';
import {
  claimApproveSchema, claimRejectSchema, claimRequestInfoSchema,
} from '../validation/claimSchemas';
import type { Actor, Channel, ChannelClaim, ClaimStatus } from '@/lib/types';

const ALLOWED_STATUS_FILTERS: ClaimStatus[] = [
  'pending', 'needs_information', 'approved', 'rejected', 'cancelled',
];

export const claimModerationService = {
  async listQueue(actor: Actor | null, { status = 'pending', limit = 100 }: { status?: string; limit?: number } = {}) {
    requireRole(actor, ROLES.MODERATOR);
    const safe = ALLOWED_STATUS_FILTERS.includes(status as ClaimStatus) ? (status as ClaimStatus) : 'pending';
    const coll = await getCollection<ChannelClaim>(COLLECTIONS.CHANNEL_CLAIMS);
    const rows = await coll.find({ status: safe }).sort({ submitted_at: -1 }).limit(limit).toArray();
    // Enrich with channel + claimant summary.
    const channelIds = Array.from(new Set(rows.map((r) => r.channel_id)));
    const userIds = Array.from(new Set(rows.map((r) => r.claimant_user_id)));
    const channels = await (await getCollection<Channel>(COLLECTIONS.CHANNELS)).find({ id: { $in: channelIds } }).toArray();
    const users = await (await getCollection(COLLECTIONS.USERS)).find({ id: { $in: userIds } }, { projection: { _id: 0, id: 1, email: 1, display_name: 1 } }).toArray();
    const channelById = new Map(channels.map((c) => [c.id, c]));
    const userById = new Map(users.map((u) => [u.id as string, u]));
    return rows.map(({ _id: _u, ...c }) => ({
      ...(c as ChannelClaim),
      channel: (() => {
        const ch = channelById.get((c as ChannelClaim).channel_id);
        if (!ch) return null;
        return { id: ch.id, name: ch.name, slug: ch.slug, whatsapp_url: ch.whatsapp_url, website_url: ch.website_url, owner_id: ch.owner_id, verification_status: ch.verification_status };
      })(),
      claimant: userById.get((c as ChannelClaim).claimant_user_id) || null,
    }));
  },

  async getDetail(actor: Actor | null, claimId: string) {
    requireRole(actor, ROLES.MODERATOR);
    const claim = await claimRepo.findById(claimId);
    if (!claim) throw new HttpError(404, 'Claim not found');
    const channel = await channelRepo.findById(claim.channel_id);
    const claimant = await userRepo.findById(claim.claimant_user_id);
    const priorClaimsColl = await getCollection<ChannelClaim>(COLLECTIONS.CHANNEL_CLAIMS);
    const priorClaims = await priorClaimsColl.find({
      channel_id: claim.channel_id,
      id: { $ne: claim.id },
    }).project({ _id: 0, id: 1, status: 1, submitted_at: 1, verification_method: 1 }).sort({ submitted_at: -1 }).limit(20).toArray();
    return {
      claim,
      channel: channel ? { id: channel.id, name: channel.name, slug: channel.slug, whatsapp_url: channel.whatsapp_url, website_url: channel.website_url, owner_id: channel.owner_id, verification_status: channel.verification_status, status: channel.status } : null,
      claimant: claimant ? { id: claimant.id, email: claimant.email, display_name: claimant.display_name, role: claimant.role, created_at: claimant.created_at } : null,
      prior_claims: priorClaims,
    };
  },

  async approve(actor: Actor | null, claimId: string, body: unknown) {
    requireRole(actor, ROLES.MODERATOR);
    const parsed = claimApproveSchema.safeParse(body || {});
    if (!parsed.success) throw new HttpError(400, 'Invalid approve payload');
    const claim = await claimRepo.findById(claimId);
    if (!claim) throw new HttpError(404, 'Claim not found');
    if (!['pending', 'needs_information'].includes(claim.status)) {
      throw new HttpError(409, 'Claim cannot be approved from status ' + claim.status);
    }

    // Atomic ownership assignment. Only assign if the channel is still
    // approved and does NOT yet have a verified owner. This prevents two
    // concurrent approvals from both winning.
    const channelsColl = await getCollection<Channel>(COLLECTIONS.CHANNELS);
    const now = new Date();
    const assign = (await channelsColl.findOneAndUpdate(
      {
        id: claim.channel_id,
        status: 'approved',
        $or: [
          { owner_id: null },
          { owner_id: { $exists: false } },
          { verification_status: { $ne: 'verified' } },
        ],
      },
      {
        $set: {
          owner_id: claim.claimant_user_id,
          verification_status: 'verified',
          updated_at: now,
        },
      },
      { returnDocument: 'after' },
    )) as unknown as (Channel | { value: Channel } | null);
    const updated: Channel | null = assign && 'value' in (assign as object)
      ? ((assign as { value: Channel }).value ?? null)
      : (assign as Channel | null);
    if (!updated || updated.owner_id !== claim.claimant_user_id) {
      throw new HttpError(409, 'Channel is no longer eligible (may already be owned or not approved)');
    }

    // Cancel any other active claims on this channel — a channel can have
    // only one verified owner.
    const claimsColl = await getCollection<ChannelClaim>(COLLECTIONS.CHANNEL_CLAIMS);
    await claimsColl.updateMany(
      { channel_id: claim.channel_id, id: { $ne: claim.id }, status: { $in: ['pending', 'needs_information'] } },
      { $set: {
          status: 'cancelled',
          moderator_notes: 'Cancelled because a different claim for this channel was approved.',
          reviewed_at: now, reviewed_by: actor!.user.id, updated_at: now,
        },
      },
    );

    // Approve THIS claim.
    await claimRepo.update(claim.id, {
      status: 'approved',
      approved_at: now,
      reviewed_at: now,
      reviewed_by: actor!.user.id,
      moderator_notes: parsed.data.moderator_notes || claim.moderator_notes,
    });

    await auditRepo.insert({
      id: uuidv4(),
      actor_user_id: actor!.user.id,
      action: 'CLAIM_APPROVED',
      entity_type: 'channel_claim',
      entity_id: claim.id,
      before_data: { status: claim.status },
      after_data: { status: 'approved', channel_id: claim.channel_id, new_owner_id: claim.claimant_user_id },
      created_at: now,
    });
    await auditRepo.insert({
      id: uuidv4(),
      actor_user_id: actor!.user.id,
      action: 'CHANNEL_OWNER_ASSIGNED',
      entity_type: 'channel',
      entity_id: claim.channel_id,
      before_data: { owner_id: null, verification_status: 'unclaimed' },
      after_data: { owner_id: claim.claimant_user_id, verification_status: 'verified' },
      created_at: now,
    });
    return { ok: true };
  },

  async reject(actor: Actor | null, claimId: string, body: unknown) {
    requireRole(actor, ROLES.MODERATOR);
    const parsed = claimRejectSchema.safeParse(body);
    if (!parsed.success) throw new HttpError(400, parsed.error.issues.map((i) => i.message).join('; '));
    const claim = await claimRepo.findById(claimId);
    if (!claim) throw new HttpError(404, 'Claim not found');
    if (!['pending', 'needs_information'].includes(claim.status)) {
      throw new HttpError(409, 'Claim cannot be rejected from status ' + claim.status);
    }
    const now = new Date();
    await claimRepo.update(claim.id, {
      status: 'rejected',
      rejected_at: now,
      reviewed_at: now,
      reviewed_by: actor!.user.id,
      reject_reason: parsed.data.reason,
      moderator_notes: parsed.data.moderator_notes || null,
    });
    await auditRepo.insert({
      id: uuidv4(),
      actor_user_id: actor!.user.id,
      action: 'CLAIM_REJECTED',
      entity_type: 'channel_claim',
      entity_id: claim.id,
      before_data: { status: claim.status },
      after_data: { status: 'rejected', reason: parsed.data.reason },
      created_at: now,
    });
    return { ok: true };
  },

  async requestInfo(actor: Actor | null, claimId: string, body: unknown) {
    requireRole(actor, ROLES.MODERATOR);
    const parsed = claimRequestInfoSchema.safeParse(body);
    if (!parsed.success) throw new HttpError(400, parsed.error.issues.map((i) => i.message).join('; '));
    const claim = await claimRepo.findById(claimId);
    if (!claim) throw new HttpError(404, 'Claim not found');
    if (claim.status !== 'pending') throw new HttpError(409, 'Only pending claims can be flagged for more info');
    const now = new Date();
    await claimRepo.update(claim.id, {
      status: 'needs_information',
      request_more_info_message: parsed.data.message,
      reviewed_at: now,
      reviewed_by: actor!.user.id,
      moderator_notes: parsed.data.moderator_notes || claim.moderator_notes,
    });
    await auditRepo.insert({
      id: uuidv4(),
      actor_user_id: actor!.user.id,
      action: 'CLAIM_MORE_INFO_REQUESTED',
      entity_type: 'channel_claim',
      entity_id: claim.id,
      before_data: { status: claim.status },
      after_data: { status: 'needs_information', message: parsed.data.message },
      created_at: now,
    });
    return { ok: true };
  },
};
