// P0A — Ownership-conflict exceptions for captured Owner Activation / Fast
// Verification payments.
//
// When a CAPTURED payment can no longer finalize ownership because the
// eligible ownership state changed (another verified owner, a different
// linked account, a blocked listing, an ownership review), we:
//   • NEVER overwrite owner_id / verification_status,
//   • NEVER refund automatically and NEVER change amounts / status / fees,
//   • record an additive, reviewable marker on the EXISTING payment row
//     (channel_activation_payments.ownership_conflict) plus an audit-log
//     entry, so an authorized admin can review it for a refund through the
//     existing refund pipeline.
// The marker contains no PII and no provider identifiers.
import { v4 as uuidv4 } from 'uuid';
import { getCollection } from '@/lib/db/mongo';
import { COLLECTIONS } from '@/lib/db/collections';
import type { Channel, ChannelActivationPayment } from '@/lib/types';

export type OwnershipConflictReason =
  | 'verified_owner_exists'      // another account already holds verified/official ownership
  | 'linked_to_other_account'    // another account is linked as owner (unverified)
  | 'not_eligible_claimant'      // payer is neither the linked owner nor the original submitter
  | 'listing_blocked'            // listing rejected / archived / suspended / removed
  | 'ownership_under_review'     // dispute / suspension / inconsistent ownership data
  | 'ownership_state_changed';   // atomic guard refused the write (state moved underneath)

export const OWNERSHIP_CONFLICT_REVIEW_STATUS = 'pending_admin_refund_review' as const;

export interface ActivationOwnershipConflict {
  reason: OwnershipConflictReason;
  flow: 'fast' | 'activation';
  detected_at: Date;
  review_status: typeof OWNERSHIP_CONFLICT_REVIEW_STATUS;
}

const FAST_BLOCKED = new Set(['rejected', 'archived', 'suspended', 'removed']);
const CAPTURED_STATUSES = ['captured_pending_fee', 'captured_finalized'];

/**
 * Server-authoritative Fast Verification ownership eligibility for `userId`
 * at THIS moment. Returns null when eligible, otherwise the conflict reason.
 * Eligible ONLY as: the linked owner, or (no owner linked) the original
 * submitter. A user whose only link is a pending claim is NOT eligible —
 * they must go through the free Manual Verification moderator review.
 */
export function fastOwnershipConflictReason(channel: Channel, userId: string): OwnershipConflictReason | null {
  const ch = channel as Channel & { is_disputed?: boolean; is_suspended?: boolean; submitted_by?: string | null };
  if (FAST_BLOCKED.has(String(ch.status))) return 'listing_blocked';
  if (ch.is_disputed || ch.is_suspended) return 'ownership_under_review';
  const verified = ch.verification_status === 'verified' || ch.verification_status === 'official';
  if (ch.owner_id) {
    if (ch.owner_id === userId) return null;
    return verified ? 'verified_owner_exists' : 'linked_to_other_account';
  }
  if (verified) return 'ownership_under_review'; // verified flag without owner link — inconsistent
  if (ch.submitted_by && ch.submitted_by === userId) return null;
  return 'not_eligible_claimant';
}

/**
 * Idempotently mark a CAPTURED payment as an ownership-conflict exception.
 * Returns true only when a new marker was written.
 */
export async function recordActivationOwnershipConflict(args: {
  paymentId: string;
  channelId: string;
  userId: string;
  reason: OwnershipConflictReason;
  flow: 'fast' | 'activation';
}): Promise<boolean> {
  const pay = await getCollection<ChannelActivationPayment>(COLLECTIONS.CHANNEL_ACTIVATION_PAYMENTS);
  const now = new Date();
  const marker: ActivationOwnershipConflict = {
    reason: args.reason, flow: args.flow, detected_at: now, review_status: OWNERSHIP_CONFLICT_REVIEW_STATUS,
  };
  const res = await pay.updateOne(
    {
      id: args.paymentId,
      channel_id: args.channelId,
      status: { $in: CAPTURED_STATUSES },
      $or: [{ ownership_conflict: { $exists: false } }, { ownership_conflict: null }],
    } as never,
    { $set: { ownership_conflict: marker, updated_at: now } } as never,
  );
  if (res.modifiedCount !== 1) return false;
  try {
    const audit = await getCollection<Record<string, unknown>>(COLLECTIONS.AUDIT_LOGS);
    await audit.insertOne({
      id: uuidv4(),
      actor_user_id: args.userId,
      action: 'ACTIVATION_OWNERSHIP_CONFLICT',
      entity_type: 'channel_activation_payment',
      entity_id: args.paymentId,
      before_data: null,
      after_data: {
        channel_id: args.channelId, reason: args.reason, flow: args.flow,
        review_status: OWNERSHIP_CONFLICT_REVIEW_STATUS, owner_overwritten: false, auto_refund: false,
      },
      created_at: now,
    } as never);
  } catch { /* audit is best-effort; the payment marker is the durable record */ }
  return true;
}

/**
 * If a payment previously flagged for refund review is later used for a
 * LEGITIMATE ownership finalization (e.g. a moderator approved the payer's
 * manual claim first), close the flag so admins are never prompted to refund
 * a payment that now backs an active, verified ownership. Additive only:
 * never touches amounts, status or provider data. Idempotent.
 */
export async function resolveActivationOwnershipConflict(paymentId: string, userId: string): Promise<boolean> {
  const pay = await getCollection<ChannelActivationPayment>(COLLECTIONS.CHANNEL_ACTIVATION_PAYMENTS);
  const now = new Date();
  const res = await pay.updateOne(
    { id: paymentId, 'ownership_conflict.review_status': OWNERSHIP_CONFLICT_REVIEW_STATUS } as never,
    { $set: { 'ownership_conflict.review_status': 'resolved_finalized', 'ownership_conflict.resolved_at': now, updated_at: now } } as never,
  );
  if (res.modifiedCount !== 1) return false;
  try {
    const audit = await getCollection<Record<string, unknown>>(COLLECTIONS.AUDIT_LOGS);
    await audit.insertOne({
      id: uuidv4(), actor_user_id: userId, action: 'ACTIVATION_OWNERSHIP_CONFLICT_RESOLVED',
      entity_type: 'channel_activation_payment', entity_id: paymentId, before_data: null,
      after_data: { review_status: 'resolved_finalized' }, created_at: now,
    } as never);
  } catch { /* audit is best-effort */ }
  return true;
}

/** Latest captured payment for (channel, user), any flow. */
export async function findCapturedPayment(channelId: string, userId: string): Promise<ChannelActivationPayment | null> {
  const pay = await getCollection<ChannelActivationPayment>(COLLECTIONS.CHANNEL_ACTIVATION_PAYMENTS);
  return pay.find({ channel_id: channelId, owner_user_id: userId, status: { $in: CAPTURED_STATUSES } } as never)
    .sort({ created_at: -1 }).limit(1).next();
}
