// Central place to turn an internal Channel record into a safe PublicChannel.
// Never leaks owner_id, verification_status internals, or moderation trail.
import type { Channel, PublicChannel } from '@/lib/types';

export function sanitizeChannel(c: Channel): PublicChannel {
  const {
    owner_id: _o,
    verification_status,
    reviewed_by: _rb,
    reviewed_at: _ra,
    rejection_reason: _rr,
    rejection_notes: _rn,
    ...rest
  } = c;
  void _o; void _rb; void _ra; void _rr; void _rn;
  return {
    ...rest,
    is_verified: verification_status === 'verified' || verification_status === 'official',
  };
}

export function sanitizeChannels(list: Channel[]): PublicChannel[] {
  return list.map(sanitizeChannel);
}
