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
import { isActivationRequired } from '../services/payments/activationFlag';

// M11-Batch2B — activation state to stamp on a channel at ownership approval.
//   • requirement ON  → 'pending' (owner must complete the $1 activation)
//   • requirement OFF → 'not_required' (badge granted on ownership alone; no
//     forced paywall during the controlled-rollout window)
// Never applied to a channel already 'active' (guarded by the update filter).
function activationStateForNewlyVerified(): 'pending' | 'not_required' {
  return isActivationRequired() ? 'pending' : 'not_required';
}

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
    // approved and either (a) has no assigned owner_id, or (b) the assigned
    // owner_id equals this claim's claimant (i.e. the CURRENT owner is
    // self-verifying). This prevents two concurrent approvals from both
    // winning AND blocks silent takeover of an already-assigned channel
    // via approval of a claim from a different user.
    const channelsColl = await getCollection<Channel>(COLLECTIONS.CHANNELS);
    const now = new Date();
    const assign = (await channelsColl.findOneAndUpdate(
      {
        id: claim.channel_id,
        status: 'approved',
        $or: [
          { owner_id: null },
          { owner_id: { $exists: false } },
          { owner_id: claim.claimant_user_id },     // self-verification (same-user, unverified)
        ],
      },
      {
        $set: {
          owner_id: claim.claimant_user_id,
          verification_status: 'verified',
          verified_at: now,
          updated_at: now,
        },
      },
      { returnDocument: 'after' },
    )) as unknown as (Channel | { value: Channel } | null);
    const updated: Channel | null = assign && 'value' in (assign as object)
      ? ((assign as { value: Channel }).value ?? null)
      : (assign as Channel | null);
    if (!updated || updated.owner_id !== claim.claimant_user_id) {
      throw new HttpError(409, 'Channel is no longer eligible for this claim (it may already have a different owner). Use "Verify Current Owner" if the claimant is the existing owner.');
    }

    // M11-Batch2B — stamp post-cutoff activation state. Never downgrades an
    // already-active channel (filter guards activation_status != 'active').
    await channelsColl.updateOne(
      { id: claim.channel_id, activation_status: { $ne: 'active' } },
      { $set: { activation_status: activationStateForNewlyVerified(), updated_at: now } },
    );

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

  /**
   * M03.7 — "Verify Current Owner" admin action.
   * Used when a channel is already assigned to a legitimate owner (owner_id
   * set) but `verification_status` has not yet been flipped to 'verified' —
   * for example, when moderation approved the channel listing but nobody
   * completed the ownership-verification workflow.
   *
   * Contract:
   *   - Preserves the existing `owner_id` — this action MUST NOT reassign
   *     ownership. To assign ownership, use the claim-approval flow instead.
   *   - Requires the channel to already have an owner_id.
   *   - Refuses if the channel is not approved or already verified.
   *   - Sets `verification_status = 'verified'` + `verified_at = now`.
   *   - Writes a `CHANNEL_OWNER_VERIFIED` audit event carrying the acting
   *     admin's id and the preserved owner_id.
   *   - Never creates a claim owned by the acting admin.
   */
  async verifyCurrentOwner(actor: Actor | null, channelId: string, body?: unknown) {
    requireRole(actor, ROLES.MODERATOR);
    const notesRaw = body && typeof body === 'object' && body !== null && 'moderator_notes' in body
      ? (body as { moderator_notes?: unknown }).moderator_notes
      : undefined;
    const moderator_notes = typeof notesRaw === 'string' && notesRaw.trim().length > 0
      ? notesRaw.trim().slice(0, 2000)
      : null;

    const channel = await channelRepo.findById(channelId);
    if (!channel) throw new HttpError(404, 'Channel not found');
    if (channel.status !== 'approved') {
      throw new HttpError(409, `Channel is in status "${channel.status}" — only approved channels can have ownership verified.`);
    }
    if (!channel.owner_id) {
      throw new HttpError(409, 'Channel has no assigned owner. Approve an ownership claim first to assign an owner.');
    }
    if (channel.verification_status === 'verified' || channel.verification_status === 'official') {
      throw new HttpError(409, 'Channel ownership is already verified.');
    }

    const now = new Date();
    const preservedOwnerId = channel.owner_id;

    // Atomic update: verify ONLY if the currently-assigned owner_id is unchanged.
    const channelsColl = await getCollection<Channel>(COLLECTIONS.CHANNELS);
    const res = (await channelsColl.findOneAndUpdate(
      { id: channelId, owner_id: preservedOwnerId, status: 'approved', verification_status: { $ne: 'verified' } },
      { $set: { verification_status: 'verified', verified_at: now, updated_at: now } },
      { returnDocument: 'after' },
    )) as unknown as (Channel | { value: Channel } | null);
    const updated: Channel | null = res && typeof res === 'object' && 'value' in (res as object)
      ? ((res as { value: Channel }).value ?? null)
      : (res as Channel | null);
    if (!updated || updated.owner_id !== preservedOwnerId || updated.verification_status !== 'verified') {
      throw new HttpError(409, 'Channel state changed under this operation. Refresh and try again.');
    }

    // M11-Batch2B — stamp post-cutoff activation state (never downgrades active).
    await channelsColl.updateOne(
      { id: channelId, activation_status: { $ne: 'active' } },
      { $set: { activation_status: activationStateForNewlyVerified(), updated_at: now } },
    );

    // Best-effort: if the current owner has an active claim (pending or
    // needs_information), mark it approved so it stops appearing in the queue.
    // A missing/no claim is fine — the audit trail lives on the channel and the
    // audit_events row we insert below.
    try {
      const activeClaim = (await (await getCollection<ChannelClaim>(COLLECTIONS.CHANNEL_CLAIMS)).findOne({
        channel_id: channelId, claimant_user_id: preservedOwnerId, status: { $in: ['pending', 'needs_information'] },
      })) as ChannelClaim | null;
      if (activeClaim) {
        await claimRepo.update(activeClaim.id, {
          status: 'approved',
          approved_at: now,
          reviewed_at: now,
          reviewed_by: actor!.user.id,
          moderator_notes: moderator_notes || activeClaim.moderator_notes,
        });
        await auditRepo.insert({
          id: uuidv4(),
          actor_user_id: actor!.user.id,
          action: 'CLAIM_APPROVED',
          entity_type: 'channel_claim',
          entity_id: activeClaim.id,
          before_data: { status: activeClaim.status },
          after_data: { status: 'approved', via: 'verify_current_owner', channel_id: channelId, owner_id: preservedOwnerId },
          created_at: now,
        });
      }
    } catch { /* auxiliary bookkeeping only — never fail the verification */ }

    await auditRepo.insert({
      id: uuidv4(),
      actor_user_id: actor!.user.id,
      action: 'CHANNEL_OWNER_VERIFIED',
      entity_type: 'channel',
      entity_id: channelId,
      before_data: { owner_id: preservedOwnerId, verification_status: channel.verification_status },
      after_data: { owner_id: preservedOwnerId, verification_status: 'verified', verified_at: now, admin_action: 'verify_current_owner', moderator_notes },
      created_at: now,
    });

    return {
      ok: true,
      channel: {
        id: updated.id, slug: updated.slug, name: updated.name,
        owner_id: updated.owner_id, verification_status: updated.verification_status,
        verified_at: updated.verified_at ?? now,
      },
    };
  },
};
