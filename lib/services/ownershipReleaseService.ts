// P0B — "RELEASE UNVERIFIED OWNERSHIP LINK" (admin-only, one channel at a time).
//
// PROBLEM THIS SOLVES
// Every submission historically set `owner_id` to the submitter. When a staff
// sourcing agent added a public listing, that agent became the LINKED owner,
// which blocked the rightful owner from ever claiming it. This service lets an
// authorized admin clear an UNVERIFIED owner link — after individual,
// evidence-backed review — so the rightful owner can use the normal claim and
// Manual Verification flow.
//
// SAFETY MODEL (every point is enforced server-side):
//   • Admin+ only. The action is never exposed on a read-only dashboard.
//   • ONE channel per call. There is deliberately no bulk endpoint.
//   • A verified or official ownership record is NEVER released.
//   • Activation-active channels and channels with captured activation
//     payments by the linked owner are NEVER released (money in flight).
//   • Disputed / suspended channels are never released.
//   • The caller must state `expected_owner_user_id`; the write is a
//     conditional compare-and-set on that exact owner plus the unverified
//     state, so a concurrent verification or claim approval makes the release
//     fail closed instead of clobbering it.
//   • Ownership is NEVER transferred to a claimant. The link is cleared and
//     the listing returns to 'unclaimed' so the rightful owner must still
//     pass the normal claim review.
//   • Submission history is preserved (`submitted_by`, sourcing attribution)
//     and the previous owner is retained on the row plus in a protected
//     audit-log entry.
//   • Candidate labelling is a READ-ONLY heuristic. It never assumes that a
//     linked-unverified record is staff-sourced, and never releases anything
//     on its own.
import { v4 as uuidv4 } from 'uuid';
import { getCollection } from '../db/mongo';
import { COLLECTIONS } from '../db/collections';
import { auditRepo } from '../repositories/genericRepo';
import { channelRepo } from '../repositories/channelRepo';
import { HttpError, requireRole, ROLES } from '../auth/rbac';
import { buildPublicChannelMongoFilter } from './publicChannelVisibility';
import type { Actor, Channel, User } from '@/lib/types';

const VERIFIED_VALUES = ['verified', 'official'];
const CANONICAL_UNVERIFIED = ['unclaimed', 'claimed'];
const CAPTURED_STATUSES = ['captured_pending_fee', 'captured_finalized'];
const ACTIVE_CLAIM_STATUSES = ['pending', 'needs_information'];

export type ReleaseLabel =
  | 'likely_staff_sourced'
  | 'linked_unverified'
  | 'needs_review'
  | 'not_eligible_for_release';

export interface ReleaseAssessment {
  channel_id: string;
  slug: string;
  name: string;
  label: ReleaseLabel;
  /** True only when every hard precondition is currently satisfied. */
  eligible: boolean;
  /** Hard reasons the release is refused right now. */
  blockers: string[];
  /** Soft findings an admin must weigh before releasing. */
  warnings: string[];
  /** Evidence supporting (or contradicting) the staff-sourced reading. */
  evidence: {
    linked_owner_user_id: string | null;
    linked_owner_is_designated_sourcing_agent: boolean;
    source: string | null;
    sourced_by_user_id: string | null;
    submitted_by: string | null;
    submitter_is_linked_owner: boolean;
    verification_status: string;
    activation_status: string | null;
    active_claims: number;
    captured_activation_payments: number;
    owner_identity_profiles: number;
    owner_audience_evidence: number;
  };
}

async function designatedAgentIds(): Promise<Set<string>> {
  const users = await getCollection<User>(COLLECTIONS.USERS);
  const rows = await users.find({ is_sourcing_agent: true } as never, { projection: { id: 1 } } as never)
    .limit(500).toArray();
  return new Set(rows.map((r) => r.id));
}

async function assess(channel: Channel, agentIds: Set<string>): Promise<ReleaseAssessment> {
  const ch = channel as Channel & { is_disputed?: boolean; is_suspended?: boolean };
  const ownerId = ch.owner_id || null;
  const verified = VERIFIED_VALUES.includes(String(ch.verification_status));

  const claims = await getCollection<{ channel_id: string; status: string }>(COLLECTIONS.CHANNEL_CLAIMS);
  const activeClaims = await claims.countDocuments({
    channel_id: ch.id, status: { $in: ACTIVE_CLAIM_STATUSES },
  } as never);

  const pays = await getCollection<Record<string, unknown>>(COLLECTIONS.CHANNEL_ACTIVATION_PAYMENTS);
  const capturedPayments = ownerId
    ? await pays.countDocuments({ channel_id: ch.id, owner_user_id: ownerId, status: { $in: CAPTURED_STATUSES } } as never)
    : 0;

  const identities = await getCollection<Record<string, unknown>>(COLLECTIONS.OWNER_IDENTITY_PROFILES);
  const identityCount = ownerId
    ? await identities.countDocuments({ channel_id: ch.id, user_id: ownerId } as never)
    : 0;

  const snaps = await getCollection<Record<string, unknown>>(COLLECTIONS.CHANNEL_AUDIENCE_SNAPSHOTS);
  const audienceCount = ownerId
    ? await snaps.countDocuments({ channel_id: ch.id, submitted_by: ownerId } as never)
    : 0;

  const blockers: string[] = [];
  const warnings: string[] = [];

  if (!ownerId) blockers.push('no_owner_link_to_release');
  if (verified) blockers.push('ownership_is_verified_or_official');
  if (ch.is_official) blockers.push('listing_is_official');
  if (ch.activation_status === 'active') blockers.push('activation_is_active');
  if (capturedPayments > 0) blockers.push('captured_activation_payment_exists');
  if (ch.is_disputed) blockers.push('channel_is_disputed');
  if (ch.is_suspended) blockers.push('channel_is_suspended');
  if (ownerId && !verified && !CANONICAL_UNVERIFIED.includes(String(ch.verification_status))) {
    blockers.push('non_canonical_verification_status');
  }

  if (activeClaims > 0) warnings.push('active_claims_present');
  if (identityCount > 0) warnings.push('linked_owner_submitted_identity_evidence');
  if (audienceCount > 0) warnings.push('linked_owner_submitted_audience_evidence');
  if (ownerId && !agentIds.has(ownerId) && ch.source !== 'staff_sourced') {
    warnings.push('no_sourcing_evidence_for_linked_owner');
  }

  const isAgentLinked = !!ownerId && agentIds.has(ownerId);
  const sourcedByLinked = ch.source === 'staff_sourced';

  // Precedence: hard blockers → needs admin judgement → likely sourced → plain.
  let label: ReleaseLabel;
  if (blockers.length > 0) label = 'not_eligible_for_release';
  else if (identityCount > 0 || audienceCount > 0 || activeClaims > 0) label = 'needs_review';
  else if (isAgentLinked || sourcedByLinked) label = 'likely_staff_sourced';
  else label = 'linked_unverified';

  return {
    channel_id: ch.id,
    slug: ch.slug,
    name: ch.name,
    label,
    eligible: blockers.length === 0,
    blockers,
    warnings,
    evidence: {
      linked_owner_user_id: ownerId,
      linked_owner_is_designated_sourcing_agent: isAgentLinked,
      source: ch.source ?? null,
      sourced_by_user_id: ch.sourced_by_user_id ?? null,
      submitted_by: ch.submitted_by ?? null,
      submitter_is_linked_owner: !!ownerId && ch.submitted_by === ownerId,
      verification_status: String(ch.verification_status),
      activation_status: ch.activation_status ?? null,
      active_claims: activeClaims,
      captured_activation_payments: capturedPayments,
      owner_identity_profiles: identityCount,
      owner_audience_evidence: audienceCount,
    },
  };
}

export const ownershipReleaseService = {
  /**
   * READ-ONLY review queue of linked-but-unverified public listings.
   * Returns labels and evidence only — it changes nothing and it never
   * asserts that a record IS staff-sourced.
   */
  async listCandidates(
    actor: Actor | null,
    opts: { limit?: number; skip?: number; label?: ReleaseLabel } = {},
  ): Promise<{ items: ReleaseAssessment[]; total: number; limit: number; skip: number }> {
    requireRole(actor, ROLES.ADMIN);
    const limit = Math.min(Math.max(Math.trunc(opts.limit ?? 25) || 25, 1), 100);
    const skip = Math.max(Math.trunc(opts.skip ?? 0) || 0, 0);

    const channels = await getCollection<Channel>(COLLECTIONS.CHANNELS);
    // Only linked-but-unverified, publicly visible, approved listings can ever
    // be candidates. Verified/official records are excluded at the query level.
    const filter = buildPublicChannelMongoFilter({
      status: 'approved',
      owner_id: { $nin: [null, ''] },
      verification_status: { $nin: VERIFIED_VALUES },
    } as never) as never;

    const total = await channels.countDocuments(filter);
    const rows = await channels.find(filter).sort({ created_at: -1 }).skip(skip).limit(limit).toArray();
    const agentIds = await designatedAgentIds();
    const items: ReleaseAssessment[] = [];
    for (const r of rows) items.push(await assess(r, agentIds));
    const filtered = opts.label ? items.filter((i) => i.label === opts.label) : items;
    return { items: filtered, total, limit, skip };
  },

  /** Full single-channel assessment, for the confirm dialog. */
  async getAssessment(actor: Actor | null, channelId: string): Promise<ReleaseAssessment> {
    requireRole(actor, ROLES.ADMIN);
    const channel = await channelRepo.findById(channelId);
    if (!channel) throw new HttpError(404, 'Channel not found');
    return assess(channel, await designatedAgentIds());
  },

  /**
   * Clear ONE unverified owner link after evidence-backed admin review.
   * Fails closed if the ownership state moved since the assessment was read.
   */
  async releaseUnverifiedLink(
    actor: Actor | null,
    channelId: string,
    input: {
      expected_owner_user_id?: string;
      reason?: string;
      evidence_ref?: string;
      acknowledge_warnings?: boolean;
    },
  ): Promise<{ released: true; channel_id: string; previous_owner_user_id: string; assessment: ReleaseAssessment }> {
    requireRole(actor, ROLES.ADMIN);
    const admin = actor!;

    const reason = String(input?.reason || '').trim();
    if (reason.length < 10) {
      throw new HttpError(400, 'A written reason of at least 10 characters is required to release an ownership link.');
    }
    const evidenceRef = String(input?.evidence_ref || '').trim();
    if (evidenceRef.length < 3) {
      throw new HttpError(400, 'An evidence reference (ticket, e-mail or review note) is required to release an ownership link.');
    }
    const expectedOwner = String(input?.expected_owner_user_id || '').trim();
    if (!expectedOwner) {
      throw new HttpError(400, 'expected_owner_user_id is required so the release can verify it is clearing the owner link you reviewed.');
    }

    // P0C — an admin can never release an ownership link held by their own
    // account; that decision must be made by a different administrator.
    if (expectedOwner === admin.user.id) {
      throw new HttpError(403, 'Conflict of interest: this ownership link belongs to your own account. A different administrator must review and release it.');
    }

    const channel = await channelRepo.findById(channelId);
    if (!channel) throw new HttpError(404, 'Channel not found');
    if (channel.owner_id && channel.owner_id === admin.user.id) {
      throw new HttpError(403, 'Conflict of interest: this ownership link belongs to your own account. A different administrator must review and release it.');
    }

    const assessment = await assess(channel, await designatedAgentIds());
    if (!assessment.eligible) {
      throw new HttpError(409, `This ownership link cannot be released: ${assessment.blockers.join(', ')}.`);
    }
    if (assessment.evidence.linked_owner_user_id !== expectedOwner) {
      throw new HttpError(409, 'The linked owner has changed since you reviewed this channel. Re-open the assessment and try again.');
    }
    if (assessment.warnings.length > 0 && input?.acknowledge_warnings !== true) {
      throw new HttpError(409, `This channel has findings that must be acknowledged before release: ${assessment.warnings.join(', ')}.`);
    }

    const now = new Date();
    const channels = await getCollection<Channel>(COLLECTIONS.CHANNELS);
    // ATOMIC compare-and-set. Every precondition that protects a real owner is
    // repeated here so a concurrent verification, activation or claim approval
    // makes this write fail instead of clobbering the new state.
    const res = await channels.findOneAndUpdate(
      {
        id: channelId,
        owner_id: expectedOwner,
        verification_status: { $in: CANONICAL_UNVERIFIED },
        is_official: { $ne: true },
        is_disputed: { $ne: true },
        is_suspended: { $ne: true },
        activation_status: { $ne: 'active' },
      } as never,
      {
        $set: {
          owner_id: null,
          verification_status: 'unclaimed',
          // Preserve the previous link for admin traceability. Submission
          // history and sourcing attribution are deliberately untouched.
          released_from_owner_id: expectedOwner,
          ownership_released_at: now,
          ownership_released_by: admin.user.id,
          updated_at: now,
        },
      } as never,
      { returnDocument: 'after' },
    );
    const updated = (res && typeof res === 'object' && 'value' in (res as object)
      ? (res as unknown as { value: Channel | null }).value
      : (res as unknown as Channel | null));
    if (!updated || updated.owner_id) {
      throw new HttpError(409, 'The ownership state changed while releasing. Nothing was modified — re-open the assessment and try again.');
    }

    await auditRepo.insert({
      id: uuidv4(),
      actor_user_id: admin.user.id,
      action: 'OWNERSHIP_LINK_RELEASED',
      entity_type: 'channel',
      entity_id: channelId,
      before_data: {
        owner_id: expectedOwner,
        verification_status: String(channel.verification_status),
        activation_status: channel.activation_status ?? null,
      },
      after_data: {
        owner_id: null,
        verification_status: 'unclaimed',
        previous_owner_user_id: expectedOwner,
        reason,
        evidence_ref: evidenceRef,
        label_at_review: assessment.label,
        warnings_acknowledged: assessment.warnings,
        reassigned_to_claimant: false,
        bulk_operation: false,
      },
      created_at: now,
    } as never);

    return { released: true, channel_id: channelId, previous_owner_user_id: expectedOwner, assessment };
  },
};
