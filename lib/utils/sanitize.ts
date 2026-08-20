// Central place to turn an internal Channel record into a safe PublicChannel.
// Never leaks owner_id, verification_status internals, or moderation trail.
import type { Channel, PublicChannel } from '@/lib/types';

export function sanitizeChannel(c: Channel): PublicChannel {
  const {
    owner_id,
    verification_status,
    reviewed_by: _rb,
    reviewed_at: _ra,
    rejection_reason: _rr,
    rejection_notes: _rn,
    is_test_fixture: _tf,
    ...rest
  } = c;
  void _rb; void _ra; void _rr; void _rn; void _tf;
  const hasOwner = !!owner_id;
  const rawVerified = verification_status === 'verified' || verification_status === 'official';
  const rawOfficial = verification_status === 'official';
  // Trust-state invariant: is_verified / is_official ONLY when an owner is
  // actually assigned. This prevents an inconsistent public state (Verified
  // badge alongside a Claim CTA) even if legacy DB rows drift out of sync.
  return {
    ...rest,
    is_verified: rawVerified && hasOwner,
    is_official: rawOfficial && hasOwner,
    has_owner: hasOwner,
  };
}

export function sanitizeChannels(list: Channel[]): PublicChannel[] {
  return list.map(sanitizeChannel);
}
