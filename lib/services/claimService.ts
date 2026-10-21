// Claim Flow (M03.1 / M03.2 / M03.6 claimant side).
// Claimants submit claims for approved channels, resubmit when a moderator
// requests more info, cancel their own claim, and list their own claims.
import { v4 as uuidv4 } from 'uuid';
import { channelRepo } from '../repositories/channelRepo';
import { claimRepo, auditRepo } from '../repositories/genericRepo';
import { getCollection } from '../db/mongo';
import { COLLECTIONS } from '../db/collections';
import { HttpError } from '../auth/rbac';
import { claimSubmitSchema, claimResubmitSchema } from '../validation/claimSchemas';
import { deriveOwnershipState, OWNERSHIP_SUPPORT_EMAIL, type OwnershipState } from './ownershipState';
import type {
  Actor, ChannelClaim, ClaimStatus, PublicClaimForClaimant,
} from '@/lib/types';

const ACTIVE_STATUSES: ClaimStatus[] = ['pending', 'needs_information'];

// P0A — claim eligibility contract. `ownershipState` is the canonical state;
// the legacy booleans are kept for backwards compatibility. Never carries
// owner identity or payment data.
export interface ClaimEligibility {
  ownershipState: OwnershipState;
  canClaim: boolean;
  alreadyOwned?: boolean;
  verifiedOwner?: boolean;
  needsAuth?: boolean;
  ownerVerificationMode?: boolean;
  pendingListing?: boolean;
  underReview?: boolean;
  reason?: string;
  existingClaim?: {
    id: string;
    status: ClaimStatus;
    submitted_at: Date;
    request_more_info_message: string | null;
  };
}

function extractDomain(url: string | null | undefined): string | null {
  if (!url) return null;
  try { return new URL(url).hostname.replace(/^www\./i, '').toLowerCase(); }
  catch { return null; }
}

function extractEmailDomain(email: string): string | null {
  const m = email.toLowerCase().match(/@([^@]+)$/);
  return m ? m[1] : null;
}

function sanitizeForClaimant(c: ChannelClaim): PublicClaimForClaimant {
  const { moderator_notes: _mn, ...rest } = c;
  void _mn;
  return rest;
}

async function findActiveClaim(channelId: string, userId: string): Promise<ChannelClaim | null> {
  const coll = await getCollection<ChannelClaim>(COLLECTIONS.CHANNEL_CLAIMS);
  return (await coll.findOne({
    channel_id: channelId,
    claimant_user_id: userId,
    status: { $in: ACTIVE_STATUSES },
  })) as ChannelClaim | null;
}

export const claimService = {
  async getEligibility(channelSlug: string, actor: Actor | null): Promise<ClaimEligibility> {
    const channel = await channelRepo.findBySlug(channelSlug);
    if (!channel) throw new HttpError(404, 'Channel not found');
    const viewerId = actor?.user.id ?? null;
    const active = viewerId ? await findActiveClaim(channel.id, viewerId) : null;
    const existingClaim = active ? {
      id: active.id, status: active.status,
      submitted_at: active.submitted_at,
      request_more_info_message: active.request_more_info_message,
    } : undefined;
    // P0A — ONE canonical, server-authoritative ownership state shared with
    // the public channel CTA. Never derived from the public badge alone and
    // never carries owner identity.
    const ownershipState: OwnershipState = deriveOwnershipState(channel, viewerId, !!active);

    switch (ownershipState) {
      case 'not_claimable':
        return { ownershipState, canClaim: false, reason: 'Only approved channels can be claimed.' };
      case 'self_verified':
        return { ownershipState, canClaim: false, alreadyOwned: true, verifiedOwner: true,
          reason: 'You are the verified owner of this channel.' };
      case 'verified_owner':
        // Genuinely verified ownership — the ONLY state allowed to say so.
        return { ownershipState, canClaim: false, alreadyOwned: true, verifiedOwner: true,
          reason: 'This channel already has a verified owner.' };
      case 'verified_activation_incomplete':
        return { ownershipState, canClaim: false, alreadyOwned: true, verifiedOwner: true,
          reason: 'Ownership of this channel has already been verified by WaveLead, so it cannot be claimed by another account.' };
      case 'linked_unverified':
        // M03.7 takeover protection is preserved: another account is linked,
        // so a new claim would silently transfer ownership. But ownership has
        // NOT been verified — never describe this as a verified owner.
        if (!actor) {
          // The linked account holder may simply not be signed in yet.
          return { ownershipState, canClaim: false, needsAuth: true, verifiedOwner: false,
            reason: `This listing is linked to a WaveLead account, but its ownership has not been verified. If it is your account, sign in to complete verification. Otherwise contact ${OWNERSHIP_SUPPORT_EMAIL}.` };
        }
        return { ownershipState, canClaim: false, alreadyOwned: true, verifiedOwner: false,
          reason: `This listing is linked to another WaveLead account, but its ownership has not been verified. If you run this channel, contact ${OWNERSHIP_SUPPORT_EMAIL} and our team will review it.` };
      case 'ownership_issue':
        return { ownershipState, canClaim: false, alreadyOwned: true, verifiedOwner: false,
          reason: `The ownership record for this channel needs review by WaveLead support. If you run this channel, contact ${OWNERSHIP_SUPPORT_EMAIL}.` };
      case 'pending_claim': {
        const ownerVerificationMode = channel.owner_id === viewerId;
        return {
          ownershipState, canClaim: false, existingClaim,
          ...(ownerVerificationMode ? { ownerVerificationMode: true } : {}),
          ...(channel.status === 'pending_review' ? { underReview: true } : {}),
        };
      }
      case 'self_linked_unverified':
        return {
          ownershipState, canClaim: true, ownerVerificationMode: true,
          ...(channel.status === 'pending_review' ? { pendingListing: true } : {}),
        };
      case 'unclaimed':
      default:
        if (!actor) return { ownershipState, canClaim: true, needsAuth: true };
        return { ownershipState, canClaim: true };
    }
  },

  async submit(actor: Actor | null, channelSlug: string, input: unknown) {
    if (!actor) throw new HttpError(401, 'You must be signed in to claim a channel');
    const parsed = claimSubmitSchema.safeParse(input);
    if (!parsed.success) throw new HttpError(400, parsed.error.issues.map((i) => i.message).join('; '));
    const data = parsed.data;

    const channel = await channelRepo.findBySlug(channelSlug);
    if (!channel) throw new HttpError(404, 'Channel not found');
    const isLinkedOwner = channel.owner_id === actor.user.id;
    // M12 combined onboarding: allow the linked owner to file proof while the
    // listing is pending_review; everyone else still needs an approved listing.
    if (channel.status !== 'approved' && !(channel.status === 'pending_review' && isLinkedOwner)) {
      throw new HttpError(400, 'Only approved channels can be claimed');
    }
    if (channel.owner_id && (channel.verification_status === 'verified' || channel.verification_status === 'official')) {
      throw new HttpError(409, 'This channel already has a verified owner');
    }
    // ── M03.7 — takeover protection. Never allow a claim by a user who is
    // not the currently-assigned owner on an already-owned channel. This
    // is enforced BOTH here and in claim-moderation approval (defence in
    // depth). Route the caller to the ownership-dispute flow instead.
    // P0C — sourcing a listing is directory work, never an ownership right.
    // The sourcing agent who added this listing cannot claim it through the
    // ordinary flow; a genuine ownership case must be escalated to an admin.
    if (channel.source === 'staff_sourced' && channel.sourced_by_user_id === actor.user.id && channel.owner_id !== actor.user.id) {
      throw new HttpError(403, `You added this channel to the directory as a sourcing agent, which does not make you its owner. If you genuinely manage this channel, contact ${OWNERSHIP_SUPPORT_EMAIL} so a different administrator can review it.`);
    }
    if (channel.owner_id && channel.owner_id !== actor.user.id) {
      throw new HttpError(409, `This listing is linked to another WaveLead account and its ownership has not been verified. Please contact ${OWNERSHIP_SUPPORT_EMAIL} instead of filing a new claim.`);
    }

    // Duplicate active claim guard.
    const active = await findActiveClaim(channel.id, actor.user.id);
    if (active) throw new HttpError(409, 'You already have an active claim for this channel');

    // Phase 3 — SaaS entitlement: enforce max_managed_channels quota BEFORE
    // accepting a claim that would grant a new ownership. A claim for a
    // channel already owned by the actor (verification-upgrade path) does
    // not count against the quota because it does not add ownership.
    if (!channel.owner_id || channel.owner_id !== actor.user.id) {
      const ownedCount = await channelRepo.count({ owner_id: actor.user.id });
      const { requireQuota } = await import('../entitlements');
      requireQuota(actor, 'max_managed_channels', ownedCount);
    }

    const emailDomain = extractEmailDomain(actor.user.email);
    const websiteDomain = extractDomain(channel.website_url);
    const domainMatch = !!(emailDomain && websiteDomain && emailDomain === websiteDomain);

    const now = new Date();
    const claim: ChannelClaim = {
      id: uuidv4(),
      channel_id: channel.id,
      claimant_user_id: actor.user.id,
      verification_method: data.verification_method,
      claimant_note: data.claimant_note || null,
      evidence_urls: (data.evidence_urls || []).map((e) => ({
        evidence_type: e.evidence_type,
        evidence_url: e.evidence_url,
        note: e.note ?? null,
      })),
      evidence_metadata: {},
      claimant_email: actor.user.email,
      website_domain: websiteDomain,
      email_domain: emailDomain,
      domain_match: domainMatch,
      status: 'pending',
      moderator_notes: null,
      request_more_info_message: null,
      reject_reason: null,
      submitted_at: now,
      reviewed_at: null,
      reviewed_by: null,
      approved_at: null,
      rejected_at: null,
      created_at: now,
      updated_at: now,
    };
    await claimRepo.insert(claim);
    await auditRepo.insert({
      id: uuidv4(),
      actor_user_id: actor.user.id,
      action: 'CLAIM_SUBMITTED',
      entity_type: 'channel_claim',
      entity_id: claim.id,
      before_data: null,
      after_data: { channel_id: channel.id, verification_method: claim.verification_method, domain_match: domainMatch },
      created_at: now,
    });
    return { claim: sanitizeForClaimant(claim) };
  },

  async resubmit(actor: Actor | null, claimId: string, input: unknown) {
    if (!actor) throw new HttpError(401, 'You must be signed in');
    const parsed = claimResubmitSchema.safeParse(input);
    if (!parsed.success) throw new HttpError(400, parsed.error.issues.map((i) => i.message).join('; '));
    const claim = await claimRepo.findById(claimId);
    if (!claim) throw new HttpError(404, 'Claim not found');
    if (claim.claimant_user_id !== actor.user.id) throw new HttpError(403, 'Not your claim');
    if (claim.status !== 'needs_information') {
      throw new HttpError(400, 'Only claims flagged for more information can be resubmitted');
    }
    const now = new Date();
    await claimRepo.update(claimId, {
      status: 'pending',
      verification_method: parsed.data.verification_method,
      claimant_note: parsed.data.claimant_note,
      evidence_urls: (parsed.data.evidence_urls || []).map((e) => ({
        evidence_type: e.evidence_type,
        evidence_url: e.evidence_url,
        note: e.note ?? null,
      })),
      submitted_at: now,
    });
    await auditRepo.insert({
      id: uuidv4(),
      actor_user_id: actor.user.id,
      action: 'CLAIM_RESUBMITTED',
      entity_type: 'channel_claim',
      entity_id: claim.id,
      before_data: { status: claim.status },
      after_data: { status: 'pending' },
      created_at: now,
    });
    return { ok: true };
  },

  async cancel(actor: Actor | null, claimId: string) {
    if (!actor) throw new HttpError(401, 'You must be signed in');
    const claim = await claimRepo.findById(claimId);
    if (!claim) throw new HttpError(404, 'Claim not found');
    if (claim.claimant_user_id !== actor.user.id) throw new HttpError(403, 'Not your claim');
    if (!['pending', 'needs_information'].includes(claim.status)) {
      throw new HttpError(400, 'Claim cannot be cancelled from this state');
    }
    const now = new Date();
    await claimRepo.update(claimId, { status: 'cancelled' });
    await auditRepo.insert({
      id: uuidv4(),
      actor_user_id: actor.user.id,
      action: 'CLAIM_CANCELLED',
      entity_type: 'channel_claim',
      entity_id: claim.id,
      before_data: { status: claim.status },
      after_data: { status: 'cancelled' },
      created_at: now,
    });
    return { ok: true };
  },

  async listMine(actor: Actor | null): Promise<PublicClaimForClaimant[]> {
    if (!actor) throw new HttpError(401, 'You must be signed in');
    const coll = await getCollection<ChannelClaim>(COLLECTIONS.CHANNEL_CLAIMS);
    const rows = await coll.find({ claimant_user_id: actor.user.id }).sort({ submitted_at: -1 }).toArray();
    return rows.map(({ _id: _unused, ...r }) => sanitizeForClaimant(r as ChannelClaim));
  },
};
