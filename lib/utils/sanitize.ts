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
    activation_status: _as,
    activation_active_at: _aa,
    activation_revoked_at: _ar,
    ...rest
  } = c;
  void _rb; void _ra; void _rr; void _rn; void _tf; void _as; void _aa; void _ar;
  const hasOwner = !!owner_id;
  const rawVerified = verification_status === 'verified' || verification_status === 'official';
  const rawOfficial = verification_status === 'official';
  // M11-Batch2B: public "Owner Verified" state requires BOTH ownership
  // verification approved AND the $1 activation being currently active.
  // Ownership alone no longer flips the public badge; internal channel
  // state (verification_status, owner_id, activation_status) is preserved
  // exactly as-is on the source record.
  const activationActive = c.activation_status === 'active';
  return {
    ...rest,
    is_verified: rawVerified && hasOwner && activationActive,
    is_official: rawOfficial && hasOwner && activationActive,
    has_owner: hasOwner,
  };
}

export function sanitizeChannels(list: Channel[]): PublicChannel[] {
  return list.map(sanitizeChannel);
}
