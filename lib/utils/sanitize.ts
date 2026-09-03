// Central place to turn an internal Channel record into a safe PublicChannel.
// Never leaks owner_id, verification_status internals, or moderation trail.
import type { Channel, PublicChannel } from '@/lib/types';
import { isActivationRequired } from '@/lib/services/payments/activationFlag';

export function sanitizeChannel(c: Channel): PublicChannel {
  const {
    owner_id,
    verification_status,
    reviewed_by: _rb,
    reviewed_at: _ra,
    rejection_reason: _rr,
    rejection_notes: _rn,
    is_test_fixture: _tf,
    activation_status: _as,
    activation_active_at: _aa,
    activation_revoked_at: _ar,
    ...rest
  } = c;
  void _rb; void _ra; void _rr; void _rn; void _tf; void _as; void _aa; void _ar;
  const hasOwner = !!owner_id;
  const rawVerified = verification_status === 'verified' || verification_status === 'official';
  const rawOfficial = verification_status === 'official';
  // M11-Batch2B release-safety: only gate the public badge on activation once
  // the operator has explicitly flipped `CHANNEL_OWNER_ACTIVATION_REQUIRED`
  // ON. Before that, existing verified owners retain their badge without any
  // activation being required. After that, activation_status must be 'active'.
  const activationRequired = isActivationRequired();
  // Grandfather-safe: a channel explicitly marked 'not_required' (existing
  // ownership-verified owners at the LIVE rollout cutoff) ALWAYS keeps its
  // badge, even after the operator flips CHANNEL_OWNER_ACTIVATION_REQUIRED on.
  // Newly verified channels subject to activation must reach 'active'.
  const activationOk =
    !activationRequired ||
    c.activation_status === 'active' ||
    c.activation_status === 'not_required';
  return {
    ...rest,
    is_verified: rawVerified && hasOwner && activationOk,
    is_official: rawOfficial && hasOwner && activationOk,
    has_owner: hasOwner,
  };
}

export function sanitizeChannels(list: Channel[]): PublicChannel[] {
  return list.map(sanitizeChannel);
}
