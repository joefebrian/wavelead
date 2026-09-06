// M16 — Sponsorship email notifications (best-effort, never blocking).
//
// Rules enforced here:
//   • Uses the EXISTING SMTP transport only (lib/services/mailer).
//   • Recipient addresses are resolved from accounts already stored in
//     WaveLead. Addresses are NEVER echoed back to the other party's UI.
//   • Emails never contain secrets or internal identifiers beyond the
//     request deep-link the recipient is already authorized to open.
//   • Every function returns a status and NEVER throws — the commercial
//     action (request / accept / decline / message) has already succeeded.
import { channelRepo } from '../repositories/channelRepo';
import { userRepo } from '../repositories/userRepo';
import { sendMailBestEffort, hasSmtpTransport, appOrigin, type MailDeliveryStatus } from './mailer';
import type { SponsorshipLead, SponsorshipRequestMessage } from '@/lib/types';

function requestUrl(leadId: string): string {
  const base = appOrigin();
  const path = `/dashboard/sponsorship-requests/${leadId}`;
  return base ? `${base}${path}` : path;
}

function preview(text: string, max = 240): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

async function ownerEmailFor(lead: SponsorshipLead): Promise<string | null> {
  const channel = await channelRepo.findById(lead.channel_id);
  if (!channel?.owner_id) return null;
  const owner = await userRepo.findById(channel.owner_id);
  return owner?.email || null;
}

async function requesterEmailFor(lead: SponsorshipLead): Promise<string | null> {
  if (lead.requester_user_id) {
    const u = await userRepo.findById(lead.requester_user_id);
    if (u?.email) return u.email;
  }
  // Fallback: the work email the brand supplied on the request itself.
  return lead.work_email || null;
}

const FOOTER = [
  '',
  'Payments and confirmed sponsorships remain protected through WaveLead Payment Protection.',
  'Channel owners receive 90% of the applicable net; WaveLead retains 10%.',
  '',
  '— WaveLead',
].join('\n');

export const sponsorshipNotificationService = {
  smtpConfigured(): boolean { return hasSmtpTransport(); },

  /** A — brand sent a new sponsorship request → notify the channel owner. */
  async notifyOwnerNewRequest(lead: SponsorshipLead): Promise<{ status: MailDeliveryStatus }> {
    try {
      if (!hasSmtpTransport()) return { status: 'smtp_not_configured' };
      const to = await ownerEmailFor(lead);
      if (!to) return { status: 'send_failed' };
      const res = await sendMailBestEffort({
        to,
        subject: `New sponsorship request for ${lead.channel_name_snapshot}`,
        text: [
          `You have a new sponsorship request for ${lead.channel_name_snapshot}.`,
          '',
          `From: ${lead.company_name}`,
          `Campaign brief: ${preview(lead.brief)}`,
          '',
          `Open the request: ${requestUrl(lead.id)}`,
          '',
          'You can accept, decline, or message the brand from the request page.',
          FOOTER,
        ].join('\n'),
      });
      return { status: res.status };
    } catch { return { status: 'send_failed' }; }
  },

  /** B — a new conversation message → notify the OTHER participant. */
  async notifyNewMessage(
    lead: SponsorshipLead,
    message: SponsorshipRequestMessage,
  ): Promise<{ status: MailDeliveryStatus }> {
    try {
      if (!hasSmtpTransport()) return { status: 'smtp_not_configured' };
      const to = message.sender_side === 'owner'
        ? await requesterEmailFor(lead)
        : await ownerEmailFor(lead);
      if (!to) return { status: 'send_failed' };
      const res = await sendMailBestEffort({
        to,
        subject: `New message about ${lead.company_name} — ${lead.channel_name_snapshot}`,
        text: [
          `${message.sender_display_name} sent you a message about the sponsorship request for ${lead.channel_name_snapshot}.`,
          '',
          `"${preview(message.message)}"`,
          '',
          `Reply in the conversation: ${requestUrl(lead.id)}`,
          FOOTER,
        ].join('\n'),
      });
      return { status: res.status };
    } catch { return { status: 'send_failed' }; }
  },

  /** C / D — owner accepted or declined → notify the brand / requester. */
  async notifyRequesterOwnerResponse(
    lead: SponsorshipLead,
    action: 'accept' | 'decline',
  ): Promise<{ status: MailDeliveryStatus }> {
    try {
      if (!hasSmtpTransport()) return { status: 'smtp_not_configured' };
      const to = await requesterEmailFor(lead);
      if (!to) return { status: 'send_failed' };
      const accepted = action === 'accept';
      const res = await sendMailBestEffort({
        to,
        subject: accepted ? 'Your sponsorship request was accepted' : 'Update on your sponsorship request',
        text: accepted
          ? [
              `${lead.channel_name_snapshot} accepted your sponsorship request.`,
              '',
              'Next step: open the request on WaveLead and use "Continue to Booking" to choose the sponsorship package and complete payment. Payment always stays on WaveLead — never off-platform.',
              '',
              `View request: ${requestUrl(lead.id)}`,
              FOOTER,
            ].join('\n')
          : [
              `There is an update on your sponsorship request for ${lead.channel_name_snapshot}.`,
              '',
              'The channel owner is not moving forward with this request right now. You can explore other channels on WaveLead.',
              '',
              `View request: ${requestUrl(lead.id)}`,
              FOOTER,
            ].join('\n'),
      });
      return { status: res.status };
    } catch { return { status: 'send_failed' }; }
  },
};
