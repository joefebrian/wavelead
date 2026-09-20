// M19 — Campaign Pooler / Brand Campaign Marketplace + 5% Campaign Commitment
// Deposit. Financial behaviour is asserted against the real services with a
// MOCK payment provider (no real money, no PayPal calls).
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { MongoClient, type Db } from 'mongodb';
import { v4 as uuidv4 } from 'uuid';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { COLLECTIONS } from '@/lib/db/collections';
import type { Actor } from '@/lib/types';

vi.mock('nodemailer', () => ({ createTransport: () => ({ sendMail: async () => ({ messageId: 'm19' }) }) }));

import { brandCampaignService } from '@/lib/services/brandCampaignService';
import {
  campaignCommitmentService, requiredCommitmentMinor,
  CAMPAIGN_COMMITMENT_DEPOSIT, COMMITMENT_PERCENT,
} from '@/lib/services/payments/campaignCommitmentService';
import { _setPaymentProviderForTesting } from '@/lib/services/payments/providerFactory';
import type { PaymentProvider } from '@/lib/services/payments/paymentProvider';

const REPO = path.resolve(__dirname, '..');
const src = (p: string) => readFileSync(path.join(REPO, p), 'utf8');
const RUN = `m19-${Date.now()}`;

async function withDb<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  const client = new MongoClient(process.env.MONGO_URL || 'mongodb://localhost:27017');
  await client.connect();
  try { return await fn(client.db(process.env.DB_NAME || 'wavelead')); } finally { await client.close(); }
}

const brandId = uuidv4();
const creatorId = uuidv4();
const strangerId = uuidv4();
const channelId = uuidv4();
const brand = { user: { id: brandId, email: `${RUN}-b@t.test`, role: 'user' } } as unknown as Actor;
const creator = { user: { id: creatorId, email: `${RUN}-c@t.test`, role: 'user' } } as unknown as Actor;
const stranger = { user: { id: strangerId, email: `${RUN}-s@t.test`, role: 'user' } } as unknown as Actor;

let captureStatus: 'paid' | 'failed' = 'paid';
let captureAmount = 0;
const mockProvider = {
  id: 'mock',
  async createPayment({ amount_minor }: { amount_minor: number }) {
    captureAmount = amount_minor;
    return { provider_order_id: `mock-${uuidv4()}`, approve_url: 'https://provider.example/approve', internal_status: 'checkout_created' };
  },
  async capturePayment() {
    return { internal_status: captureStatus, provider_capture_id: captureStatus === 'paid' ? `cap-${uuidv4()}` : null, amount_captured_minor: captureStatus === 'paid' ? captureAmount : 0 };
  },
} as unknown as PaymentProvider;

const CAMPAIGN_INPUT = {
  name: `${RUN} launch`, brand_name: 'Acme Labs', objective: 'Awareness',
  brief: 'Introduce our new app to Indonesian tech audiences.',
  target_country_codes: ['ID'], target_category_ids: [],
  budget_total_usd_minor: 1_000_000,          // $10,000
  deliverables: '1 sponsored post', creator_requirements: 'Tech audience',
};

async function freshCampaign() {
  return brandCampaignService.createDraft(brand, { ...CAMPAIGN_INPUT, name: `${RUN}-${uuidv4().slice(0, 6)}` });
}

beforeAll(async () => {
  _setPaymentProviderForTesting(mockProvider);
  await withDb(async (db) => {
    for (const [id, email] of [[brandId, `${RUN}-b@t.test`], [creatorId, `${RUN}-c@t.test`], [strangerId, `${RUN}-s@t.test`]]) {
      await db.collection(COLLECTIONS.USERS).insertOne({ id, email, role: 'user', created_at: new Date() } as never);
    }
    await db.collection(COLLECTIONS.CHANNELS).insertOne({
      id: channelId, slug: `${RUN}-ch`, name: `${RUN} channel`, status: 'approved',
      owner_id: creatorId, submitted_by: creatorId, verification_status: 'verified',
      whatsapp_url: 'https://whatsapp.com/channel/0029Vm19', country_code: 'ID',
      public_followers_count: 12000, created_at: new Date(), updated_at: new Date(),
    } as never);
  });
});

afterAll(async () => {
  _setPaymentProviderForTesting(null);
  await withDb(async (db) => {
    await db.collection(COLLECTIONS.USERS).deleteMany({ email: { $regex: `^${RUN}` } });
    await db.collection(COLLECTIONS.CHANNELS).deleteMany({ id: channelId });
    await db.collection(COLLECTIONS.BRAND_CAMPAIGNS).deleteMany({ brand_user_id: brandId });
    await db.collection(COLLECTIONS.BRAND_CAMPAIGN_COMMITMENTS).deleteMany({ brand_user_id: brandId });
    await db.collection(COLLECTIONS.BRAND_CAMPAIGN_APPLICATIONS).deleteMany({ creator_user_id: { $in: [creatorId, strangerId] } });
  });
});

beforeEach(() => { captureStatus = 'paid'; });

/* ------------------------------------------- 5% COMMITMENT (server-side) */
describe('M19 §1 Campaign Commitment Deposit — 5%, server-authoritative', () => {
  it('1.1 required = budget × 5% ($10,000 → $500)', () => {
    expect(COMMITMENT_PERCENT).toBe(5);
    expect(requiredCommitmentMinor(1_000_000)).toBe(50_000);
    expect(requiredCommitmentMinor(2_000_000)).toBe(100_000);
    expect(requiredCommitmentMinor(0)).toBe(0);
    expect(requiredCommitmentMinor(-5)).toBe(0);
  });

  it('1.2 the amount comes from the stored budget — client input is ignored', async () => {
    const c = await freshCampaign();
    const row = await campaignCommitmentService.createCheckout(brand, c.id);
    expect(row.required_commitment_amount_minor).toBe(50_000);
    expect(row.amount_minor).toBe(50_000);
    expect(row.campaign_budget_snapshot_minor).toBe(1_000_000);
    expect(row.commitment_percent).toBe(5);
    expect(row.payment_purpose).toBe(CAMPAIGN_COMMITMENT_DEPOSIT);
    expect(row.status).toBe('checkout_created');
    const route = src('app/api/[[...path]]/route.ts');
    expect(route).toContain("path[3] === 'commitment' && method === 'POST'");
    expect(route).not.toMatch(/commitment[^\n]*body\?\.\s*amount/);
  });

  it('1.3 an unfunded campaign can NOT open and is parked in commitment_required', async () => {
    const c = await freshCampaign();
    await expect(brandCampaignService.open(brand, c.id)).rejects.toMatchObject({ status: 402 });
    const again = await brandCampaignService.getForBrand(brand, c.id);
    expect(again.campaign.status).toBe('commitment_required');
    // Creators cannot see it.
    const opps = await brandCampaignService.listOpportunities();
    expect(opps.find((o) => o.id === c.id)).toBeUndefined();
    await expect(brandCampaignService.getOpportunity(c.id)).rejects.toMatchObject({ status: 404 });
  });

  it('1.4 a browser return alone never unlocks a campaign — only a real capture does', async () => {
    const c = await freshCampaign();
    const row = await campaignCommitmentService.createCheckout(brand, c.id);
    // Simulated "return to site" without a provider capture: still unfunded.
    let sum = await campaignCommitmentService.summary(c.id);
    expect(sum.funded).toBe(false);
    await expect(brandCampaignService.open(brand, c.id)).rejects.toMatchObject({ status: 402 });
    // Provider says NOT paid → still locked.
    captureStatus = 'failed';
    await campaignCommitmentService.captureAndFinalize(row.id);
    sum = await campaignCommitmentService.summary(c.id);
    expect(sum.funded).toBe(false);
    expect((await brandCampaignService.getForBrand(brand, c.id)).campaign.status).not.toBe('open');
  });

  it('1.5 an authoritative capture funds the campaign and publishes it', async () => {
    const c = await freshCampaign();
    const row = await campaignCommitmentService.createCheckout(brand, c.id);
    const done = await campaignCommitmentService.captureAndFinalize(row.id);
    expect(done.status).toBe('captured');
    expect(done.captured_amount_minor).toBe(50_000);
    const sum = await campaignCommitmentService.summary(c.id);
    expect(sum.funded).toBe(true);
    expect(sum.paid_commitment_minor).toBe(50_000);
    expect(sum.topup_required_minor).toBe(0);
    const after = await brandCampaignService.getForBrand(brand, c.id);
    expect(after.campaign.status).toBe('open');
    expect((await brandCampaignService.listOpportunities()).some((o) => o.id === c.id)).toBe(true);
  });

  it('1.6 duplicate capture/finalization is idempotent (no double counting)', async () => {
    const c = await freshCampaign();
    const row = await campaignCommitmentService.createCheckout(brand, c.id);
    await campaignCommitmentService.captureAndFinalize(row.id);
    await campaignCommitmentService.captureAndFinalize(row.id);
    await campaignCommitmentService.captureByProviderOrderId(row.provider_order_id as string);
    const sum = await campaignCommitmentService.summary(c.id);
    expect(sum.paid_commitment_minor).toBe(50_000);       // not 100k/150k
    expect((await campaignCommitmentService.listForCampaign(c.id)).filter((r) => r.status === 'captured').length).toBe(1);
  });

  it('1.7 a second checkout cannot be opened while one is in progress / already funded', async () => {
    const c = await freshCampaign();
    const row = await campaignCommitmentService.createCheckout(brand, c.id);
    await expect(campaignCommitmentService.createCheckout(brand, c.id)).rejects.toMatchObject({ status: 409 });
    await campaignCommitmentService.captureAndFinalize(row.id);
    await expect(campaignCommitmentService.createCheckout(brand, c.id)).rejects.toMatchObject({ status: 409 });
  });

  it('1.8 another brand cannot fund or inspect the campaign commitment', async () => {
    const c = await freshCampaign();
    await expect(campaignCommitmentService.createCheckout(stranger, c.id)).rejects.toMatchObject({ status: 403 });
    await expect(brandCampaignService.commitmentSummary(stranger, c.id)).rejects.toMatchObject({ status: 403 });
  });
});

/* ------------------------------------------------------- BUDGET CHANGES */
describe('M19 §2 budget changes recalculate the commitment', () => {
  it('2.1 increase $10k → $20k requires a $500 top-up (existing $500 kept)', async () => {
    const c = await freshCampaign();
    const first = await campaignCommitmentService.createCheckout(brand, c.id);
    await campaignCommitmentService.captureAndFinalize(first.id);
    await brandCampaignService.changeBudget(brand, c.id, { budget_total_usd_minor: 2_000_000, reason: 'scale up' });
    const sum = await campaignCommitmentService.summary(c.id);
    expect(sum.required_commitment_minor).toBe(100_000);
    expect(sum.paid_commitment_minor).toBe(50_000);
    expect(sum.topup_required_minor).toBe(50_000);
    expect(sum.funded).toBe(false);
    // Approvals are capped at the funded campaign limit while underfunded.
    expect(sum.funded_campaign_limit_minor).toBe(1_000_000);
    const topup = await campaignCommitmentService.createCheckout(brand, c.id);
    expect(topup.amount_minor).toBe(50_000);
    await campaignCommitmentService.captureAndFinalize(topup.id);
    const after = await campaignCommitmentService.summary(c.id);
    expect(after.paid_commitment_minor).toBe(100_000);
    expect(after.funded).toBe(true);
    // Versioned history.
    const camp = (await brandCampaignService.getForBrand(brand, c.id)).campaign;
    expect(camp.budget_history.length).toBe(1);
    expect(camp.budget_history[0]).toMatchObject({ previous_budget_usd_minor: 1_000_000, new_budget_usd_minor: 2_000_000, changed_by: brandId, reason: 'scale up' });
    expect(camp.budget_history[0].changed_at).toBeTruthy();
  });

  it('2.2 decrease leaves EXCESS commitment tracked, never revenue', async () => {
    const c = await freshCampaign();
    const first = await campaignCommitmentService.createCheckout(brand, c.id);
    await campaignCommitmentService.captureAndFinalize(first.id);
    await brandCampaignService.changeBudget(brand, c.id, { budget_total_usd_minor: 400_000 });   // $4,000
    const sum = await campaignCommitmentService.summary(c.id);
    expect(sum.required_commitment_minor).toBe(20_000);
    expect(sum.paid_commitment_minor).toBe(50_000);
    expect(sum.excess_commitment_minor).toBe(30_000);
    expect(sum.topup_required_minor).toBe(0);
    // No automatic refund and no revenue recognition in M19.
    const svc = src('lib/services/payments/campaignCommitmentService.ts');
    // No revenue/ledger posting code (comments explaining the rule are fine).
    const code = svc.split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');
    expect(code).not.toMatch(/ledger|revenue_|recogni[sz]e\(/i);
    expect(src('app/dashboard/campaigns/[id]/CampaignDetailClient.tsx')).toContain('data-testid="commitment-excess"');
  });

  it('2.3 budget can never drop below already-booked marketplace obligations', () => {
    const svc = src('lib/services/brandCampaignService.ts');
    expect(svc).toContain('committedBookingValueMinor');
    expect(svc).toContain('Budget cannot be lower than the');
  });
});

/* -------------------------------------------- CREATOR / BRAND MARKETPLACE */
describe('M19 §3 campaign pool: apply, shortlist, approve, hand off', () => {
  async function openCampaign() {
    const c = await freshCampaign();
    const row = await campaignCommitmentService.createCheckout(brand, c.id);
    await campaignCommitmentService.captureAndFinalize(row.id);
    return (await brandCampaignService.getForBrand(brand, c.id)).campaign;
  }

  it('3.1 creator sees only OPEN campaigns, with the brand identity', async () => {
    const open = await openCampaign();
    const opps = await brandCampaignService.listOpportunities();
    const found = opps.find((o) => o.id === open.id)!;
    expect(found).toBeTruthy();
    expect(found.brand_name).toBe('Acme Labs');
    expect(found.objective).toBe('Awareness');
    // No commitment/payment internals are part of the creator-facing payload shape.
    const detail = await brandCampaignService.getOpportunity(open.id);
    expect(JSON.stringify(detail)).not.toMatch(/provider_capture_id|provider_order_id|commitment_percent|required_commitment/);
  });

  it('3.2 owner applies with an owned channel; stranger and duplicates blocked', async () => {
    const open = await openCampaign();
    const app = await brandCampaignService.apply(creator, open.id, {
      channel_id: channelId, proposed_rate_usd_minor: 25_000, pitch: 'My tech audience fits this launch well.',
    });
    expect(app.status).toBe('applied');
    expect(app.creator_user_id).toBe(creatorId);
    await expect(brandCampaignService.apply(stranger, open.id, { channel_id: channelId, proposed_rate_usd_minor: 1000, pitch: 'Please let me into this campaign now' }))
      .rejects.toMatchObject({ status: 403 });
    await expect(brandCampaignService.apply(creator, open.id, { channel_id: channelId, proposed_rate_usd_minor: 25_000, pitch: 'Applying again for this same campaign' }))
      .rejects.toMatchObject({ status: 409 });
    await expect(brandCampaignService.apply(brand, open.id, { channel_id: channelId, proposed_rate_usd_minor: 1, pitch: 'This is my own campaign application' }))
      .rejects.toMatchObject({ status: 409 });
  });

  it('3.3 brand shortlists, approves and rejects; creator sees My Applications', async () => {
    const open = await openCampaign();
    const app = await brandCampaignService.apply(creator, open.id, { channel_id: channelId, proposed_rate_usd_minor: 30_000, pitch: 'Great fit for this brief.' });
    expect((await brandCampaignService.decide(brand, app.id, 'shortlisted')).status).toBe('shortlisted');
    expect((await brandCampaignService.decide(brand, app.id, 'approved')).status).toBe('approved');
    expect((await brandCampaignService.decide(brand, app.id, 'rejected')).status).toBe('rejected');
    await expect(brandCampaignService.decide(stranger, app.id, 'approved')).rejects.toMatchObject({ status: 403 });
    const mine = await brandCampaignService.listMyApplications(creator);
    expect(mine.some((a) => a.id === app.id)).toBe(true);
  });

  it('3.4 approval never charges a booking; handoff reuses the marketplace, no duplicates', async () => {
    const open = await openCampaign();
    const app = await brandCampaignService.apply(creator, open.id, { channel_id: channelId, proposed_rate_usd_minor: 40_000, pitch: 'Ready to deliver this campaign brief.' });
    await brandCampaignService.decide(brand, app.id, 'approved');
    const h1 = await brandCampaignService.continueToBooking(brand, app.id);
    const h2 = await brandCampaignService.continueToBooking(brand, app.id);
    expect(h2).toEqual(h1);                                  // idempotent handoff
    // Association is persisted on the marketplace order (the financial record).
    expect(h1).toMatchObject({ existing_order_id: null, booking_url: expect.any(String) });
    expect(src('lib/repositories/marketplaceRepo.ts')).toContain('findActiveBySourceCampaignApplication');
    expect(src('lib/services/marketplaceService.ts')).toContain('source_brand_campaign_id');
    expect(src('lib/services/marketplaceService.ts')).toContain('source_brand_campaign_application_id');
    const svc = src('lib/services/brandCampaignService.ts');
    expect(svc).toContain('findActiveBySourceCampaignApplication');
    // No order/payment creation inside the campaign domain.
    expect(svc).not.toMatch(/marketplaceService\.(createOrder|checkout|pay)/);
    expect(svc).not.toMatch(/capturePayment|createPayment/);
  });
});

/* ----------------------------------------- ACCOUNTING + PROVIDER ABSTRACTION */
describe('M19 §4 accounting separation and provider abstraction', () => {
  const svc = src('lib/services/payments/campaignCommitmentService.ts');
  const domain = src('lib/services/brandCampaignService.ts');

  it('4.1 dedicated payment purpose, isolated collection, correct public wording', () => {
    expect(CAMPAIGN_COMMITMENT_DEPOSIT).toBe('CAMPAIGN_COMMITMENT_DEPOSIT');
    expect(COLLECTIONS.BRAND_CAMPAIGN_COMMITMENTS).toBe('brand_campaign_commitments');
    expect(COLLECTIONS.BRAND_CAMPAIGN_COMMITMENTS).not.toBe(COLLECTIONS.PAYMENT_FUNDING_ORDERS);
    const ui = src('app/dashboard/campaigns/[id]/CampaignDetailClient.tsx');
    expect(ui).toContain('Campaign Commitment Deposit');
    expect(ui).toContain('Payment Protection');
    expect(ui).not.toMatch(/escrow fee|platform fee|commission/i);
  });

  it('4.2 the 5% is never treated as WaveLead revenue or as the marketplace 10%', () => {
    const code = svc.split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');
    expect(code).not.toMatch(/wavelead_fee|platform_fee_minor|commission/i);
    expect(code).not.toContain('0.10');
    const ui = src('app/dashboard/campaigns/[id]/CampaignDetailClient.tsx');
    expect(ui).toContain('not a WaveLead fee');
    expect(ui).toContain('separate from the');
  });

  it('4.3 no direct PayPal dependency inside the campaign business domain', () => {
    for (const f of ['lib/services/brandCampaignService.ts', 'lib/services/payments/campaignCommitmentService.ts',
      'lib/repositories/brandCampaignRepo.ts', 'lib/services/campaignNotificationService.ts']) {
      // Strip comments: prose may NAME PayPal, executable code must not use it.
      const code = src(f).split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*') && !l.trim().startsWith('/*')).join('\n');
      expect(code).not.toMatch(/paypal/i);
      expect(code).not.toMatch(/COMPLETED|PAYER_ACTION_REQUIRED|CHECKOUT\.ORDER/);
    }
    expect(svc).toContain("import { getPaymentProvider } from '@/lib/services/payments/providerFactory'");
  });

  it('4.4 campaign business states are WaveLead states, not provider states', () => {
    expect(brandCampaignService.CAMPAIGN_STATUSES).toEqual(
      ['draft', 'commitment_required', 'open', 'in_selection', 'active', 'completed', 'cancelled']);
    expect(domain).not.toMatch(/APPROVED'|'CREATED'|'VOIDED'/);
    // promotion_campaigns remains a separate domain.
    expect(domain).not.toContain('promotionCampaignRepo');
  });
});

/* ------------------------------------------------ NOTIFICATIONS + ADMIN/UI */
describe('M19 §5 notifications, admin oversight and UI surfaces', () => {
  it('5.1 three authorized notifications, best-effort only', () => {
    const n = src('lib/services/campaignNotificationService.ts');
    expect(n).toContain('applicationSubmitted');
    expect(n).toContain('applicationApproved');
    expect(n).toContain("await import('./mailer')");
    expect(n).not.toContain('nodemailer');
    const domain = src('lib/services/brandCampaignService.ts');
    expect((domain.match(/notifications are best-effort/g) || []).length).toBe(2);
  });

  it('5.2 brand UI: Launch Campaign, commitment requirement, applicant pool', () => {
    const list = src('app/dashboard/campaigns/CampaignsClient.tsx');
    expect(list).toContain('Launch Campaign');
    expect(list).toContain('Launch a campaign and let interested creators apply.');
    expect(list).toContain("commitment_required: 'warning'");
    const detail = src('app/dashboard/campaigns/[id]/CampaignDetailClient.tsx');
    expect(detail).toContain('testId="commitment-card"');
    expect(detail).toContain('data-testid="fund-commitment"');
    expect(detail).toContain('Top-up required');
    expect(detail).toContain('data-testid="open-campaign"');
    expect(detail).toContain('!!(commitment && !commitment.funded)');   // gate visible in UI too
    expect(detail).toContain('Your campaign is live');
  });

  it('5.3 creator UI: opportunities, brand name, apply, my applications, empty states', () => {
    const opp = src('app/dashboard/opportunities/OpportunitiesClient.tsx');
    expect(opp).toContain('See which brands currently have open campaigns and apply.');
    expect(opp).toContain('{c.brand_name}');
    expect(opp).toContain('Apply to Campaign');
    expect(opp).toContain('No campaigns are open for your channels right now.');
    expect(opp).toContain('data-testid="opportunities-browse-channels"');
    expect(src('app/dashboard/applications/ApplicationsClient.tsx')).toContain('my-applications-table');
    const nav = src('lib/constants/navigation.ts');
    expect(nav).toContain("href: '/dashboard/opportunities'");
    expect(nav).toContain("href: '/dashboard/applications'");
  });

  it('5.4 admin oversight shows the commitment picture and stays oversight-only', () => {
    const admin = src('app/admin/campaigns/page.tsx');
    expect(admin).toContain('CAMPAIGN_COMMITMENT_DEPOSIT');
    expect(admin).toContain('never WaveLead revenue');
    // Publishing does not depend on admin approval once the commitment is captured.
    expect(src('lib/services/payments/campaignCommitmentService.ts')).toContain('publishIfFunded');
    expect(src('lib/services/brandCampaignService.ts')).not.toMatch(/admin_approval_required|requires_admin_review/);
  });
});
