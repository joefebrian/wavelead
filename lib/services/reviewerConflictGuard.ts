// P0C — REVIEWER CONFLICT-OF-INTEREST GUARDS (server-side, never client-trusted).
//
// Rules enforced for every ownership review action:
//   • A reviewer can never approve, reject or request info on their OWN claim.
//   • A reviewer can never verify, or combined-approve, a channel they own or
//     submitted themselves.
//   • A reviewer MAY approve a third-party claim on a listing they previously
//     sourced/submitted, but only when: the claimant is a different account,
//     a written evidence review is recorded, the overlap is audited, and the
//     listing is NOT contested (disputed or with competing active claims).
//     Contested overlaps must be escalated to a different administrator.
import { HttpError } from '../auth/rbac';
import type { Channel, ChannelClaim } from '@/lib/types';

export const SELF_REVIEW_MESSAGE =
  'Conflict of interest: you cannot review an ownership decision that involves your own account. Escalate this to a different administrator.';

/** Minimum written evidence review when the reviewer sourced the listing. */
export const OVERLAP_MIN_NOTES = 20;

/** True when the reviewer added this listing to the directory (sourced or submitted). */
export function reviewerSourcedListing(reviewerId: string, channel: Channel | null | undefined): boolean {
  if (!channel || !reviewerId) return false;
  return channel.sourced_by_user_id === reviewerId || channel.submitted_by === reviewerId;
}

export function assertNotOwnClaim(reviewerId: string, claim: Pick<ChannelClaim, 'claimant_user_id'>): void {
  if (claim.claimant_user_id === reviewerId) throw new HttpError(403, SELF_REVIEW_MESSAGE);
}

export function assertNotOwnChannel(reviewerId: string, channel: Channel): void {
  if (channel.owner_id && channel.owner_id === reviewerId) throw new HttpError(403, SELF_REVIEW_MESSAGE);
}

/**
 * Overlap rules for approving a third-party claim on a listing the reviewer
 * sourced. Returns true when the overlap exists (caller must audit it).
 */
export function assertOverlapApprovalAllowed(args: {
  reviewerId: string;
  channel: Channel | null;
  moderatorNotes: string | null | undefined;
  competingActiveClaims: number;
}): boolean {
  const { reviewerId, channel, moderatorNotes, competingActiveClaims } = args;
  if (!reviewerSourcedListing(reviewerId, channel)) return false;
  const ch = channel as Channel & { is_disputed?: boolean };
  if (ch.is_disputed || competingActiveClaims > 0) {
    throw new HttpError(409, 'This listing was added by you and its ownership is contested. Escalate to a different administrator.');
  }
  if (String(moderatorNotes || '').trim().length < OVERLAP_MIN_NOTES) {
    throw new HttpError(400, `You added this listing to the directory. Record your ownership-evidence review in the moderator notes (at least ${OVERLAP_MIN_NOTES} characters) before approving.`);
  }
  return true;
}
