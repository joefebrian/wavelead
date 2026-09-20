// M18.1 Phase F/I — "Your WaveLead channel is live" transactional email.
//
// ONE notifier, reused by BOTH approval paths:
//   • normal moderation approval (moderationService.approve)
//   • successful Fast Verification (ownerVerificationService.finalizeIfComplete)
//
// Guarantees:
//   • Best-effort: a mail failure must NEVER roll back channel approval.
//   • Idempotent: exactly one email per approval transition. The marker lives
//     on the channel row (`live_email_sent_at`) and is cleared whenever the
//     channel genuinely leaves the approved state, so a real re-approval
//     sends again and a page refresh never does.
//   • Uses the existing SMTP/mailer architecture — no second mail system.
import type { Channel } from '@/lib/types';
import { channelRepo } from '@/lib/repositories/channelRepo';

export type ChannelLiveVia = 'moderation_approval' | 'fast_verification';

export interface ChannelLiveNotifyResult {
  sent: boolean;
  reason: 'sent' | 'already_sent' | 'no_recipient' | 'smtp_not_configured' | 'error';
}

interface ChannelLiveMarker { live_email_sent_at?: Date | null }

/** Clear the marker when a channel leaves the approved state (re-approval can email again). */
export async function resetChannelLiveEmailMarker(channelId: string): Promise<void> {
  try {
    await channelRepo.update(channelId, { live_email_sent_at: null } as unknown as Partial<Channel>);
  } catch { /* marker-only */ }
}

export function buildChannelLiveEmail(channelName: string, channelId: string, base: string): { subject: string; text: string } {
  return {
    subject: 'Your WaveLead channel is live',
    text: [
      `${channelName} is now live on WaveLead.`,
      '',
      'NEXT STEP — Set Your Rate Card',
      `${base}/dashboard/channels/${channelId}/monetization`,
      'Brands cannot book you until your rate card is published, so this is the one step worth doing today.',
      '',
      'Then finish your profile:',
      `• Add sample work so brands can evaluate you: ${base}/dashboard/channels/${channelId}/monetization#sample-work`,
      '• Complete your channel profile (description, category, country, language)',
      '• Start receiving sponsorship opportunities in your dashboard',
      '',
      `Your channel workspace: ${base}/dashboard/channels/${channelId}`,
      '',
      '— WaveLead',
    ].join('\n'),
  };
}

/**
 * Send the approval/live email once per approval transition.
 * Never throws.
 */
export async function notifyChannelLive(channel: Channel, via: ChannelLiveVia): Promise<ChannelLiveNotifyResult> {
  try {
    const marker = (channel as unknown as ChannelLiveMarker).live_email_sent_at || null;
    if (marker) return { sent: false, reason: 'already_sent' };     // idempotent

    const recipientId = (channel as unknown as { submitted_by?: string | null }).submitted_by
      || channel.owner_id
      || null;
    if (!recipientId) return { sent: false, reason: 'no_recipient' };

    const { sendMailBestEffort, hasSmtpTransport, appOrigin } = await import('./mailer');
    if (!hasSmtpTransport()) return { sent: false, reason: 'smtp_not_configured' };

    const { userRepo } = await import('@/lib/repositories/userRepo');
    const user = await userRepo.findById(recipientId);
    if (!user?.email) return { sent: false, reason: 'no_recipient' };

    const { subject, text } = buildChannelLiveEmail(channel.name, channel.id, appOrigin());
    const res = await sendMailBestEffort({ to: user.email, subject, text });
    if (res.status !== 'sent') return { sent: false, reason: 'error' };

    // Mark AFTER a successful send so a transient SMTP failure can retry.
    await channelRepo.update(channel.id, {
      live_email_sent_at: new Date(),
      live_email_via: via,
    } as unknown as Partial<Channel>);
    return { sent: true, reason: 'sent' };
  } catch {
    return { sent: false, reason: 'error' };                        // never blocks approval
  }
}
