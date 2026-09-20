// M19 — Brand Campaign notifications (best-effort, existing mailer only).
//
// Scope (as authorized): creator "application received", brand "new
// application", creator "approved". Shortlisted / rejected emails are DEFERRED.
// A notification failure must never corrupt campaign or application state.
import type { BrandCampaign, BrandCampaignApplication } from '@/lib/services/brandCampaignService';

async function send(userId: string, subject: string, text: string): Promise<boolean> {
  try {
    const { sendMailBestEffort, hasSmtpTransport } = await import('./mailer');
    if (!hasSmtpTransport()) return false;
    const { userRepo } = await import('@/lib/repositories/userRepo');
    const u = await userRepo.findById(userId);
    if (!u?.email) return false;
    const res = await sendMailBestEffort({ to: u.email, subject, text });
    return res.status === 'sent';
  } catch { return false; }
}

function origin(): string {
  return (process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
}

export const campaignNotificationService = {
  /** Creator confirmation + brand alert, both best-effort. */
  async applicationSubmitted(campaign: BrandCampaign, app: BrandCampaignApplication, channelName: string): Promise<void> {
    const base = origin();
    await send(app.creator_user_id,
      `Application received — ${campaign.name}`,
      [`We received your application to "${campaign.name}" from ${campaign.brand_name}.`,
        '',
        `Channel: ${channelName}`,
        `Proposed rate: $${((app.proposed_rate_usd_minor ?? 0) / 100).toFixed(2)}`,
        '',
        `Track it under My Applications: ${base}/dashboard/applications`,
        '',
        'The brand reviews applications and may shortlist or approve you. Nothing is charged to you at any point.',
        '— WaveLead'].join('\n'));
    await send(campaign.brand_user_id,
      `New creator application — ${campaign.name}`,
      [`${channelName} applied to your campaign "${campaign.name}".`,
        '',
        `Proposed rate: $${((app.proposed_rate_usd_minor ?? 0) / 100).toFixed(2)}`,
        '',
        `Review your applicant pool: ${base}/dashboard/campaigns/${campaign.id}`,
        '— WaveLead'].join('\n'));
  },

  /** Creator approved → guide them to the existing marketplace booking. */
  async applicationApproved(campaign: BrandCampaign, app: BrandCampaignApplication): Promise<void> {
    const base = origin();
    await send(app.creator_user_id,
      `You were approved for ${campaign.name}`,
      [`${campaign.brand_name} approved your application to "${campaign.name}".`,
        '',
        'Next: the brand continues into a WaveLead booking, which is where the price, Payment Protection,',
        'delivery, acceptance and your payout are handled. Approval alone does not start delivery or pay you.',
        '',
        `Your applications: ${base}/dashboard/applications`,
        '— WaveLead'].join('\n'));
  },
};
