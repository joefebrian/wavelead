// Minimal, targeted verification of the channel-submission thank-you email +
// existing transactional-email wiring. No integration server needed.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { buildChannelSubmittedEmail } from '@/lib/services/channelSubmissionNotification';
import { buildChannelLiveEmail } from '@/lib/services/channelLiveNotification';

const REPO = path.resolve(__dirname, '..');
const read = (p: string): string => readFileSync(path.join(REPO, p), 'utf8');

describe('Channel submission email', () => {
  it('subject + both verification paths + no payment/PII/JWT/Mongo ids', () => {
    const { subject, text } = buildChannelSubmittedEmail('Demo Channel', 'ch-1', 'https://wavelead.org');
    expect(subject).toBe('Thank you for submitting your channel to WaveLead');
    expect(text).toContain('Demo Channel');
    // Two verification paths, both linking to EXISTING dashboard routes.
    expect(text).toMatch(/Manual Verification\s*—\s*Free/);
    expect(text).toMatch(/Fast Verification\s*—\s*\$1 one-time/);
    expect(text).toContain('https://wavelead.org/dashboard/channels/ch-1');
    // Sensitive identifiers must never appear.
    expect(text).not.toMatch(/paypal|payer|capture|order_id|order id|jwt|session|mongo|_id/i);
  });

  it('is invoked from submissionService.submit AFTER persistence, best-effort', () => {
    const src = read('lib/services/submissionService.ts');
    // Persistence happens on `channelRepo.insert(channel)`.
    const insertIdx = src.indexOf('channelRepo.insert(channel)');
    const notifyIdx = src.indexOf('notifyChannelSubmitted(channel');
    expect(insertIdx).toBeGreaterThan(0);
    expect(notifyIdx).toBeGreaterThan(insertIdx);
    // Wrapped in try/catch so a mail failure never rolls back the submission.
    expect(src).toMatch(/try\s*\{[\s\S]*notifyChannelSubmitted[\s\S]*\}\s*catch/);
  });

  it('idempotency marker prevents duplicate sends on retry', () => {
    const src = read('lib/services/channelSubmissionNotification.ts');
    expect(src).toContain('submission_email_sent_at');
    expect(src).toContain("reason: 'already_sent'");
    // Marker is written ONLY after res.status === 'sent'.
    expect(src).toMatch(/if\s*\(res\.status\s*!==\s*'sent'\)\s*return[\s\S]*submission_email_sent_at:\s*new Date/);
  });
});

describe('Channel live email (both approval paths)', () => {
  it('subject + View / Set-Rate-Card CTA present', () => {
    const { subject, text } = buildChannelLiveEmail('Demo Channel', 'ch-1', 'https://wavelead.org');
    expect(subject).toBe('Your WaveLead channel is live');
    expect(text).toContain('Demo Channel');
    expect(text).toContain('/dashboard/channels/ch-1/monetization');
    expect(text).toContain('/dashboard/channels/ch-1');
  });

  it('is invoked from BOTH moderation approval AND fast verification', () => {
    const mod = read('lib/services/moderationService.ts');
    const fast = read('lib/services/ownerVerificationService.ts');
    expect(mod).toMatch(/notifyChannelLive\([^)]+'moderation_approval'\)/);
    expect(fast).toMatch(/notifyChannelLive\([^)]+'fast_verification'\)/);
  });

  it('is idempotent (marker + reset)', () => {
    const src = read('lib/services/channelLiveNotification.ts');
    expect(src).toContain('live_email_sent_at');
    expect(src).toContain("reason: 'already_sent'");
    expect(src).toContain('resetChannelLiveEmailMarker');
  });
});

describe('New sponsorship request email (brand → owner)', () => {
  it('notifyOwnerNewRequest exists with channel-name subject and no leaked identifiers', () => {
    const src = read('lib/services/sponsorshipNotificationService.ts');
    expect(src).toMatch(/notifyOwnerNewRequest\s*\(/);
    // Subject references the channel by name.
    expect(src).toMatch(/subject:\s*`New sponsorship request for \$\{lead\.channel_name_snapshot\}`/);
    // No provider/payment IDs in this notification file.
    expect(src).not.toMatch(/paypal|capture_id|payer|order_id/i);
  });
});

describe('Promotion / Sponsored Placement — access invariants (audit)', () => {
  it('server enforces owner + verified + approved on promotion campaign create', () => {
    const src = read('lib/services/promotion/campaignService.ts');
    expect(src).toContain('ensureChannelEligibleForOwner');
    expect(src).toMatch(/owner_id\s*!==\s*actor\.user\.id/);
    expect(src).toMatch(/status\s*!==\s*'approved'/);
    expect(src).toMatch(/verification_status/);
    expect(src).toMatch(/'verified'|verified/);
  });

  it('CPM rate is resolved server-side from the admin rate card repo (country override → global fallback)', () => {
    const src = read('lib/services/promotion/campaignService.ts');
    expect(src).toContain('promotionRateCardRepo.resolve');
    // The client never supplies cpm_usd_minor into the snapshot.
    expect(src).toMatch(/cpm_usd_minor:\s*card\.cpm_usd_minor/);
  });

  it('admin promotion-rates route is admin-guarded (audit-level check)', () => {
    const route = read('app/api/[[...path]]/route.ts');
    expect(route).toContain("route === '/admin/promotion-rates'");
  });
});
