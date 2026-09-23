// Channel-submission thank-you email.
//
// Fires ONCE after a successful, persisted channel submission. Reuses the
// existing SMTP/nodemailer architecture (never a second mailer). Follows the
// same best-effort guarantees as channelLiveNotification:
//
//   • Best-effort: an email failure NEVER rolls back the submission.
//   • Idempotent: the `submission_email_sent_at` marker on the channel row
//     prevents duplicate sends on retries or re-reads.
//   • Zero PII beyond channel name / owner email; no payment/provider IDs,
//     no JWT/session, no internal Mongo IDs in the message body.
//   • Two verification paths surfaced, both linking to EXISTING WaveLead
//     dashboard routes discovered from the current codebase.
import type { Channel, User } from '@/lib/types';
import { channelRepo } from '@/lib/repositories/channelRepo';

export interface ChannelSubmittedNotifyResult {
  sent: boolean;
  reason: 'sent' | 'already_sent' | 'no_recipient' | 'smtp_not_configured' | 'error';
}

interface SubmissionMarker { submission_email_sent_at?: Date | null }

export function buildChannelSubmittedEmail(channelName: string, channelId: string, base: string): { subject: string; text: string } {
  return {
    subject: 'Thank you for submitting your channel to WaveLead',
    text: [
      `Thanks for submitting ${channelName} to WaveLead.`,
      '',
      `We\u2019re reviewing your listing. To go live and start receiving sponsorship opportunities, ${channelName}\u2019s ownership needs to be verified.`,
      '',
      'YOU HAVE TWO PATHS TO VERIFY OWNERSHIP:',
      '',
      '1) Manual Verification \u2014 Free',
      '   A WaveLead moderator reviews your submitted ownership evidence.',
      `   ${base}/dashboard/channels/${channelId}`,
      '',
      '2) Fast Verification \u2014 $1 one-time',
      '   A one-time $1 activation confirms a real, payment-capable owner is behind the channel and helps deter impersonation.',
      '   Payment alone never proves ownership; WaveLead still reviews your ownership evidence.',
      `   ${base}/dashboard/channels/${channelId}#activation`,
      '',
      `Your channel workspace: ${base}/dashboard/channels/${channelId}`,
      '',
      '\u2014 WaveLead',
    ].join('\n'),
  };
}

/**
 * Send the submission thank-you email once. Never throws.
 * `recipientEmail` is passed in so we don't re-query the userRepo when the
 * caller already has the user record.
 */
export async function notifyChannelSubmitted(
  channel: Channel,
  recipientEmail: User['email'] | null | undefined,
): Promise<ChannelSubmittedNotifyResult> {
  try {
    const marker = (channel as unknown as SubmissionMarker).submission_email_sent_at || null;
    if (marker) return { sent: false, reason: 'already_sent' };

    if (!recipientEmail) return { sent: false, reason: 'no_recipient' };

    const { sendMailBestEffort, hasSmtpTransport, appOrigin } = await import('./mailer');
    if (!hasSmtpTransport()) return { sent: false, reason: 'smtp_not_configured' };

    const { subject, text } = buildChannelSubmittedEmail(channel.name, channel.id, appOrigin());
    const res = await sendMailBestEffort({ to: recipientEmail, subject, text });
    if (res.status !== 'sent') return { sent: false, reason: 'error' };

    // Mark AFTER a successful send so transient SMTP failures can retry.
    await channelRepo.update(channel.id, {
      submission_email_sent_at: new Date(),
    } as unknown as Partial<Channel>);
    return { sent: true, reason: 'sent' };
  } catch {
    return { sent: false, reason: 'error' };
  }
}
