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
import type {
  Actor, ChannelClaim, ClaimStatus, PublicClaimForClaimant,
} from '@/lib/types';

const ACTIVE_STATUSES: ClaimStatus[] = ['pending', 'needs_information'];

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
  async getEligibility(channelSlug: string, actor: Actor | null) {
    const channel = await channelRepo.findBySlug(channelSlug);
    if (!channel) throw new HttpError(404, 'Channel not found');
    if (channel.status !== 'approved') {
      return { canClaim: false, reason: 'Only approved channels can be claimed.' };
    }
    // If already verified with an owner, only support "report an issue" path.
    if (channel.owner_id && channel.verification_status === 'verified') {
      return {
        canClaim: false,
        alreadyOwned: true,
        reason: 'This channel already has a verified owner.',
      };
    }
    // ── M03.7 — assigned-but-not-yet-verified ownership state. ──────────────
    // Channel has an owner_id but verification_status is not 'verified'.
    // - The current owner may submit ownership evidence (self-verification).
    // - Any OTHER signed-in user must NOT be allowed to file a claim here —
    //   approving such a claim would silently transfer ownership. Route them
    //   into the ownership-dispute / report-ownership flow instead.
    if (channel.owner_id) {
      if (!actor) return { canClaim: false, needsAuth: true, reason: 'Sign in to complete ownership verification for this channel.' };
      if (channel.owner_id !== actor.user.id) {
        return {
          canClaim: false,
          alreadyOwned: true,
          reason: 'This channel is already linked to a WaveLead owner. If you believe this is wrong, please report an ownership issue.',
        };
      }
      // Actor IS the current owner and channel is not yet verified.
      const active = await findActiveClaim(channel.id, actor.user.id);
      if (active) {
        return {
          canClaim: false,
          ownerVerificationMode: true,
          existingClaim: {
            id: active.id, status: active.status,
            submitted_at: active.submitted_at,
            request_more_info_message: active.request_more_info_message,
          },
        };
      }
      return { canClaim: true, ownerVerificationMode: true };
    }
    // Unclaimed channel — standard claim flow.
    if (!actor) return { canClaim: true, needsAuth: true };
    const active = await findActiveClaim(channel.id, actor.user.id);
    if (active) {
      return {
        canClaim: false,
        existingClaim: {
          id: active.id, status: active.status,
          submitted_at: active.submitted_at,
          request_more_info_message: active.request_more_info_message,
        },
      };
    }
    return { canClaim: true };
  },

  async submit(actor: Actor | null, channelSlug: string, input: unknown) {
    if (!actor) throw new HttpError(401, 'You must be signed in to claim a channel');
    const parsed = claimSubmitSchema.safeParse(input);
    if (!parsed.success) throw new HttpError(400, parsed.error.issues.map((i) => i.message).join('; '));
    const data = parsed.data;

    const channel = await channelRepo.findBySlug(channelSlug);
    if (!channel) throw new HttpError(404, 'Channel not found');
    if (channel.status !== 'approved') throw new HttpError(400, 'Only approved channels can be claimed');
    if (channel.owner_id && channel.verification_status === 'verified') {
      throw new HttpError(409, 'This channel already has a verified owner');
    }
    // ── M03.7 — takeover protection. Never allow a claim by a user who is
    // not the currently-assigned owner on an already-owned channel. This
    // is enforced BOTH here and in claim-moderation approval (defence in
    // depth). Route the caller to the ownership-dispute flow instead.
    if (channel.owner_id && channel.owner_id !== actor.user.id) {
      throw new HttpError(409, 'This channel is already linked to a WaveLead owner. Please report an ownership issue instead of filing a new claim.');
    }

    // Duplicate active claim guard.
    const active = await findActiveClaim(channel.id, actor.user.id);
    if (active) throw new HttpError(409, 'You already have an active claim for this channel');

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
