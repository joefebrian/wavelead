// M12 — Combined Listing + Ownership review.
//
// One admin action approves BOTH the channel LISTING and the linked OWNERSHIP
// CLAIM for the original submitter/linked owner, by REUSING the existing
// canonical services (no duplicated business logic):
//   1. moderationService.approve       → channel.status = 'approved'  (audit: ADMIN_APPROVE_CHANNEL)
//   2. claimModerationService.approve  → owner_id + verification_status='verified'
//                                        + activation_status (existing helper)
//                                        (audit: CLAIM_APPROVED + CHANNEL_OWNER_ASSIGNED)
//
// Ordering is required: claimModerationService.approve only assigns ownership
// on an ALREADY-approved channel, so the listing must be approved first.
//
// Failure safety (MongoDB standalone → no multi-doc transactions): if the
// ownership step fails after the listing step succeeded, we COMPENSATE by
// reverting the channel back to 'pending_review' and rethrow, so there is no
// state where the listing is approved but ownership silently failed.
//
// This NEVER creates a PayPal order, NEVER issues WaveLead Credit, and NEVER
// changes activation billing policy. Ownership still requires this explicit
// admin action — declaring/filing a claim alone never verifies ownership.
import { requireRole, ROLES, HttpError } from '../auth/rbac';
import { channelRepo } from '../repositories/channelRepo';
import { getCollection } from '../db/mongo';
import { COLLECTIONS } from '../db/collections';
import { moderationService } from './moderationService';
import { claimModerationService } from './claimModerationService';
import type { Actor, Channel, ChannelClaim } from '@/lib/types';

// The single reviewable ownership claim for a channel that belongs to the
// channel's linked owner (the combined-onboarding case). Returns null when no
// such claim exists (→ admin should use "Approve Listing Only").
export async function getReviewableOwnershipClaim(channelId: string): Promise<ChannelClaim | null> {
  const channel = await channelRepo.findById(channelId);
  if (!channel || !channel.owner_id) return null;
  const claims = await getCollection<ChannelClaim>(COLLECTIONS.CHANNEL_CLAIMS);
  const claim = (await claims.findOne({
    channel_id: channelId,
    claimant_user_id: channel.owner_id,
    status: { $in: ['pending', 'needs_information'] },
  })) as ChannelClaim | null;
  return claim;
}

export const combinedReviewService = {
  getReviewableOwnershipClaim,

  async approveListingAndOwnership(actor: Actor | null, channelId: string, body?: unknown) {
    requireRole(actor, ROLES.MODERATOR);
    const channel = await channelRepo.findById(channelId);
    if (!channel) throw new HttpError(404, 'Channel not found');
    if (channel.status === 'approved') {
      throw new HttpError(409, 'Channel listing is already approved. Use the standalone Claims flow to approve ownership.');
    }
    if (channel.status !== 'pending_review') {
      throw new HttpError(409, `Channel is in status "${channel.status}" — combined approval only applies to pending_review listings.`);
    }
    const claim = await getReviewableOwnershipClaim(channelId);
    if (!claim) {
      throw new HttpError(409, 'No reviewable ownership claim from the linked owner exists for this channel. Approve the listing only, or request ownership evidence first.');
    }

    // Snapshot for compensation.
    const prevStatus = channel.status;
    const prevPublishedAt = channel.published_at ?? null;

    // Step 1 — approve the LISTING (reuses existing moderation service + audit).
    const edits = (body as { edits?: Record<string, unknown> } | undefined)?.edits;
    await moderationService.approve(actor, channelId, edits);

    // Step 2 — approve the OWNERSHIP claim (reuses existing claim moderation
    // service + audit + existing activation policy helper). Compensate on fail.
    try {
      await claimModerationService.approve(actor, claim.id, body ?? {});
    } catch (e) {
      // Roll back the listing approval so we never leave listing=approved with
      // ownership unresolved for the combined action.
      await channelRepo.update(channelId, {
        status: prevStatus,
        published_at: prevPublishedAt,
        reviewed_by: null,
        reviewed_at: null,
      } as unknown as Partial<Channel>);
      throw e instanceof HttpError
        ? new HttpError(e.status || 409, `Ownership approval failed — listing approval was rolled back. ${e.message}`)
        : e;
    }

    const after = await channelRepo.findById(channelId);
    return {
      ok: true,
      channel_id: channelId,
      claim_id: claim.id,
      channel_status: after?.status ?? 'approved',
      verification_status: after?.verification_status ?? 'verified',
      activation_status: after?.activation_status ?? null,
    };
  },
};
