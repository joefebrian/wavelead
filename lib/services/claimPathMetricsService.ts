// P0B — CLAIM-PATH METRICS (read-only operational diagnostics).
//
// Answers one question only: "of the channels the public can actually see,
// how many are claimable, how many are linked but unverified, how many have
// genuinely verified ownership, and how many need admin attention?"
//
// Hard rules:
//   • Public inventory is NOT creator acquisition. These counts describe
//     directory state, never commercial traction.
//   • Verified ownership is NEVER inferred from `owner_id` alone — it
//     requires a verified/official `verification_status` WITH an owner link,
//     exactly as `deriveOwnershipState` / `sanitizeChannel` treat it.
//   • The canonical public visibility filter is the only definition of
//     "public" (no second opinion, no hand-rolled slug rules here).
//   • Channel buckets are MUTUALLY EXCLUSIVE and sum to the public approved
//     total; `sum_matches_total` proves it on every read.
//   • Point-in-time counts only — no historical series is invented.
import { getCollection } from '../db/mongo';
import { COLLECTIONS } from '../db/collections';
import { buildPublicChannelMongoFilter } from './publicChannelVisibility';
import type { Channel } from '@/lib/types';

/** Verification values that mean "ownership approved by WaveLead". */
const VERIFIED_VALUES = ['verified', 'official'];
/** The only verification values that legitimately mean "not yet verified". */
const CANONICAL_UNVERIFIED = ['unclaimed', 'claimed'];

export type ClaimPathBucket =
  | 'claimable'
  | 'linked_unverified'
  | 'verified_ownership'
  | 'needs_review';

export interface ClaimPathMetrics {
  counted_at: Date;
  /** Approved channels that pass the canonical public visibility filter. */
  public_approved_total: number;
  /** No owner link and not verified — a rightful owner can claim it today. */
  claimable: number;
  /** Linked to an account whose ownership is NOT verified. */
  linked_unverified: number;
  /** verification_status verified/official WITH an owner link. */
  verified_ownership: number;
  /** Inconsistent or under-review ownership data — needs an admin. */
  needs_review: number;
  /** Integrity assertion: buckets sum to public_approved_total. */
  sum_matches_total: boolean;
  /** Open ownership claims (channel_claims), not a channel bucket. */
  pending_claims: number;
  /** Verified owners whose public activation is active (badge satisfied). */
  activation_active: number;
  /** Captured activation payments flagged as ownership conflicts for review. */
  activation_ownership_conflicts: number;
}

/**
 * Classification precedence (first match wins) — this is what makes the
 * buckets mutually exclusive:
 *   1. needs_review  — disputed/suspended, verified-without-owner, or an
 *                      owner link carrying a non-canonical verification value
 *   2. verified_ownership
 *   3. linked_unverified
 *   4. claimable
 */
const CLASSIFY_SWITCH = {
  $switch: {
    branches: [
      {
        case: {
          $or: [
            { $eq: ['$is_disputed', true] },
            { $eq: ['$is_suspended', true] },
            // verified flag with no owner link — inconsistent legacy record
            {
              $and: [
                { $in: ['$verification_status', VERIFIED_VALUES] },
                { $in: ['$owner_id', [null, undefined, '']] },
              ],
            },
            // owner link with a verification value that is neither verified
            // nor a canonical unverified value
            {
              $and: [
                { $not: [{ $in: ['$owner_id', [null, undefined, '']] }] },
                { $not: [{ $in: ['$verification_status', [...VERIFIED_VALUES, ...CANONICAL_UNVERIFIED]] }] },
              ],
            },
          ],
        },
        then: 'needs_review',
      },
      {
        case: {
          $and: [
            { $in: ['$verification_status', VERIFIED_VALUES] },
            { $not: [{ $in: ['$owner_id', [null, undefined, '']] }] },
          ],
        },
        then: 'verified_ownership',
      },
      {
        case: { $not: [{ $in: ['$owner_id', [null, undefined, '']] }] },
        then: 'linked_unverified',
      },
    ],
    default: 'claimable',
  },
};

export const claimPathMetricsService = {
  async compute(): Promise<ClaimPathMetrics> {
    const channels = await getCollection<Channel>(COLLECTIONS.CHANNELS);
    const match = buildPublicChannelMongoFilter({ status: 'approved' }) as never;

    const grouped = await channels.aggregate<{ _id: ClaimPathBucket; n: number }>([
      { $match: match },
      { $group: { _id: CLASSIFY_SWITCH, n: { $sum: 1 } } },
    ]).toArray();

    const by = (k: ClaimPathBucket) => grouped.find((g) => g._id === k)?.n ?? 0;
    const claimable = by('claimable');
    const linked = by('linked_unverified');
    const verified = by('verified_ownership');
    const review = by('needs_review');
    const total = await channels.countDocuments(match);

    // Activation signal, only where it is reliably recorded.
    const activationActive = await channels.countDocuments(
      buildPublicChannelMongoFilter({
        status: 'approved',
        verification_status: { $in: VERIFIED_VALUES },
        owner_id: { $nin: [null, ''] },
        activation_status: 'active',
      } as never) as never,
    );

    const claims = await getCollection<{ status: string }>(COLLECTIONS.CHANNEL_CLAIMS);
    const pendingClaims = await claims.countDocuments({
      status: { $in: ['pending', 'needs_information'] },
    } as never);

    const pays = await getCollection<Record<string, unknown>>(COLLECTIONS.CHANNEL_ACTIVATION_PAYMENTS);
    const conflicts = await pays.countDocuments({
      'ownership_conflict.review_status': 'pending_admin_refund_review',
    } as never);

    return {
      counted_at: new Date(),
      public_approved_total: total,
      claimable,
      linked_unverified: linked,
      verified_ownership: verified,
      needs_review: review,
      sum_matches_total: claimable + linked + verified + review === total,
      pending_claims: pendingClaims,
      activation_active: activationActive,
      activation_ownership_conflicts: conflicts,
    };
  },
};
