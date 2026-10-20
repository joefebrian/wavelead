// P0A — Canonical, server-authoritative ownership state for a channel as
// seen by a given viewer. Used by BOTH the claim eligibility service and the
// public channel profile CTA so the two surfaces can never disagree.
//
// Derived from internal fields (owner_id, verification_status,
// activation_status, review flags) — never from the public badge alone.
// The result is an enum + booleans only: it NEVER carries owner identity,
// payment data or any other private field, so it is safe to return to any
// viewer.
import type { Channel } from '@/lib/types';
import { isActivationBadgeSatisfied } from '@/lib/utils/sanitize';

export type OwnershipState =
  | 'not_claimable'                  // listing is not approved (and viewer is not its linked owner)
  | 'unclaimed'                      // A — listed, no owner link, open for claims
  | 'pending_claim'                  // B — viewer has an active claim under review
  | 'self_linked_unverified'         // viewer IS the linked owner, ownership not yet verified
  | 'linked_unverified'              // linked to ANOTHER account, ownership NOT verified
  | 'self_verified'                  // viewer IS the verified owner
  | 'verified_owner'                 // C — verified owner exists, public badge active
  | 'verified_activation_incomplete' // C′ — verified owner exists, public badge not active
  | 'ownership_issue';               // E — inconsistent/under-review ownership data, support required

export const OWNERSHIP_SUPPORT_EMAIL = 'support@p2plabs.asia';

const CANONICAL_UNVERIFIED = new Set(['unclaimed', 'claimed']);

type OwnershipInput = Pick<Channel, 'status' | 'owner_id' | 'verification_status' | 'activation_status'> & {
  is_disputed?: boolean;
  is_suspended?: boolean;
};

export function isVerifiedStatus(v: unknown): boolean {
  return v === 'verified' || v === 'official';
}

/**
 * @param viewerId  signed-in viewer id (null for anonymous)
 * @param viewerHasActiveClaim  viewer has a pending / needs_information claim
 */
export function deriveOwnershipState(
  channel: OwnershipInput,
  viewerId: string | null,
  viewerHasActiveClaim = false,
): OwnershipState {
  const ownerId = channel.owner_id || null;
  const isSelf = !!viewerId && !!ownerId && ownerId === viewerId;
  const verified = isVerifiedStatus(channel.verification_status);

  if (channel.status !== 'approved') {
    if (channel.status === 'pending_review' && isSelf) {
      return viewerHasActiveClaim ? 'pending_claim' : 'self_linked_unverified';
    }
    return 'not_claimable';
  }

  if (channel.is_disputed || channel.is_suspended) return isSelf && verified ? 'self_verified' : 'ownership_issue';

  if (verified) {
    if (!ownerId) return 'ownership_issue'; // verified flag without an owner link — legacy/inconsistent
    if (isSelf) return 'self_verified';
    return isActivationBadgeSatisfied(channel) ? 'verified_owner' : 'verified_activation_incomplete';
  }

  if (ownerId) {
    if (isSelf) return viewerHasActiveClaim ? 'pending_claim' : 'self_linked_unverified';
    // Linked to another account and NOT verified. Non-canonical legacy
    // verification values are surfaced as an ownership issue for support.
    return CANONICAL_UNVERIFIED.has(String(channel.verification_status)) ? 'linked_unverified' : 'ownership_issue';
  }

  return viewerHasActiveClaim ? 'pending_claim' : 'unclaimed';
}

/** Public CTA selection for the channel profile page. */
export type OwnershipCta = 'manage' | 'claim' | 'claim_status' | 'ownership_support';

export function ctaForOwnershipState(state: OwnershipState): OwnershipCta {
  switch (state) {
    case 'self_verified':
    case 'self_linked_unverified':
      return 'manage';
    case 'unclaimed':
      return 'claim';
    case 'pending_claim':
      return 'claim_status';
    case 'linked_unverified':
    case 'verified_owner':
    case 'verified_activation_incomplete':
    case 'ownership_issue':
    case 'not_claimable':
    default:
      return 'ownership_support';
  }
}
