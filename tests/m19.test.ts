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

/* =====================================================================
 * M19 §6 — OPERATOR-APPROVED DEFECT CORRECTIONS (D1, D2, D3, D6)
 * Financial behaviour only, real services + MOCK provider (no real money).
 * ===================================================================== */
const HTTP = 'http://localhost:3000/api';

describe('M19 §6 D1 — committed booking value / budget safety', () => {
  const orderIds: string[] = [];

  async function insertOrder(fields: Record<string, unknown>): Promise<string> {
    const id = uuidv4();
    orderIds.push(id);
    await withDb(async (db) => {
      await db.collection(COLLECTIONS.MARKETPLACE_ORDERS).insertOne({
        id, status: 'paid', economics_status: 'pre_acceptance',
        buyer_user_id: brandId, channel_id: channelId, channel_slug: `${RUN}-ch`, owner_user_id: creatorId,
        quoted_price_minor: 0, currency: 'USD', snapshot: null,
        created_at: new Date(), updated_at: new Date(),
        ...fields,
      } as never);
    });
    return id;
  }

  async function fundAndOpen(campaignId: string) {
    const row = await campaignCommitmentService.createCheckout(brand, campaignId);
    await campaignCommitmentService.captureAndFinalize(row.id);
    return row;
  }

  afterAll(async () => {
    await withDb(async (db) => {
      await db.collection(COLLECTIONS.MARKETPLACE_ORDERS).deleteMany({ id: { $in: orderIds } });
    });
  });

  it('6.1 with no bookings a budget reduction is allowed', async () => {
    const c = await freshCampaign();
    await fundAndOpen(c.id);
    const updated = await brandCampaignService.changeBudget(brand, c.id, { budget_total_usd_minor: 500_000 });
    expect(updated.budget_total_usd_minor).toBe(500_000);
    const committed = await brandCampaignService.committedBookingValueMinor(c.id);
    expect(committed.total_minor).toBe(0);
  });

  it('6.2 a REAL marketplace booking is counted from the order source reference alone', async () => {
    const c = await freshCampaign();
    await fundAndOpen(c.id);
    // Order carries only source_brand_campaign_id — NO application back-link.
    await insertOrder({ source_brand_campaign_id: c.id, snapshot: { gross_price_minor: 400_000 } });
    const committed = await brandCampaignService.committedBookingValueMinor(c.id);
    expect(committed.total_minor).toBe(400_000);
    expect(committed.order_ids.length).toBe(1);

    await expect(brandCampaignService.changeBudget(brand, c.id, { budget_total_usd_minor: 300_000 }))
      .rejects.toMatchObject({ status: 409 });
    const ok = await brandCampaignService.changeBudget(brand, c.id, { budget_total_usd_minor: 500_000 });
    expect(ok.budget_total_usd_minor).toBe(500_000);
  });

  it('6.3 an unrelated campaign booking is never counted against this campaign', async () => {
    const mine = await freshCampaign();
    const other = await freshCampaign();
    await fundAndOpen(mine.id);
    await insertOrder({ source_brand_campaign_id: other.id, snapshot: { gross_price_minor: 900_000 } });
    const committed = await brandCampaignService.committedBookingValueMinor(mine.id);
    expect(committed.total_minor).toBe(0);
    // A budget reduction on MY campaign is therefore still allowed.
    const ok = await brandCampaignService.changeBudget(brand, mine.id, { budget_total_usd_minor: 200_000 });
    expect(ok.budget_total_usd_minor).toBe(200_000);
  });

  it('6.4 non-obligating orders (owner_rejected / cancelled) are excluded; quoted price is the fallback', async () => {
    const c = await freshCampaign();
    await insertOrder({ source_brand_campaign_id: c.id, status: 'owner_rejected', snapshot: { gross_price_minor: 700_000 } });
    await insertOrder({ source_brand_campaign_id: c.id, status: 'cancelled', snapshot: { gross_price_minor: 700_000 } });
    await insertOrder({ source_brand_campaign_id: c.id, status: 'requested', quoted_price_minor: 150_000 });
    const committed = await brandCampaignService.committedBookingValueMinor(c.id);
    expect(committed.total_minor).toBe(150_000);
    expect(committed.order_ids.length).toBe(1);
  });

  it('6.5 the same order is counted once, and the application back-link cannot import a foreign order', async () => {
    const c = await freshCampaign();
    await fundAndOpen(c.id);
    const app = await brandCampaignService.apply(creator, c.id, {
      channel_id: channelId, pitch: 'We reach exactly the audience described in the brief.', proposed_rate_usd_minor: 400_000,
    });
    const oid = await insertOrder({
      source_brand_campaign_id: c.id, source_brand_campaign_application_id: app.id,
      snapshot: { gross_price_minor: 400_000 },
    });
    await brandCampaignService.attachOrder(app.id, oid);          // both paths now point at it
    const foreign = await insertOrder({ source_brand_campaign_id: uuidv4(), snapshot: { gross_price_minor: 999_999 } });
    await withDb(async (db) => {
      await db.collection(COLLECTIONS.BRAND_CAMPAIGN_APPLICATIONS).updateOne(
        { id: app.id }, { $set: { marketplace_order_id: oid } });
    });
    const committed = await brandCampaignService.committedBookingValueMinor(c.id);
    expect(committed.total_minor).toBe(400_000);                  // counted exactly once
    expect(committed.order_ids).not.toContain(foreign);
  });

  it('6.6 duplicate marketplace booking protection is unchanged and the order is linked back', async () => {
    const mp = src('lib/services/marketplaceService.ts');
    expect(mp).toContain('findActiveBySourceCampaignApplication(app.id)');
    expect(mp).toContain('if (existingCampaignOrder) return existingCampaignOrder;');
    expect(mp).toContain('brandCampaignService.attachOrder(sourceCampaignApplicationId, created.id)');
    const repo = src('lib/repositories/marketplaceRepo.ts');
    expect(repo).toContain("status: { $nin: ['owner_rejected', 'cancelled']");
  });

  it('6.7 approval status alone is NEVER treated as a committed obligation', async () => {
    const c = await freshCampaign();
    await fundAndOpen(c.id);
    const app = await brandCampaignService.apply(creator, c.id, {
      channel_id: channelId, pitch: 'Approved but never booked — creates no financial obligation at all.',
    });
    await brandCampaignService.decide(brand, app.id, 'approved');
    const committed = await brandCampaignService.committedBookingValueMinor(c.id);
    expect(committed.total_minor).toBe(0);
    const domain = src('lib/services/brandCampaignService.ts');
    expect(domain).toContain('Application status (applied / shortlisted / approved) is NEVER used');
  });
});

describe('M19 §6 D2/D3 — unfunded discovery + anonymous access', () => {
  async function fundAndOpen(campaignId: string) {
    const row = await campaignCommitmentService.createCheckout(brand, campaignId);
    await campaignCommitmentService.captureAndFinalize(row.id);
    return row;
  }

  it('6.8 an unfunded campaign is absent from Campaign Opportunities', async () => {
    const c = await freshCampaign();
    const list = await brandCampaignService.listOpportunities();
    expect(list.map((x) => x.id)).not.toContain(c.id);
  });

  it('6.9 a direct campaign id cannot bypass the funding gate', async () => {
    const c = await freshCampaign();
    await expect(brandCampaignService.getOpportunity(c.id)).rejects.toMatchObject({ status: 404 });
    // …and a creator therefore cannot apply to it either.
    await expect(brandCampaignService.apply(creator, c.id, {
      channel_id: channelId, pitch: 'Trying to reach an unfunded campaign by direct id.',
    })).rejects.toMatchObject({ status: 404 });
  });

  it('6.10 setStatus cannot push an unfunded campaign into a creator-visible state', async () => {
    const c = await freshCampaign();
    for (const s of ['in_selection', 'active'] as const) {
      await expect(brandCampaignService.setStatus(brand, c.id, s)).rejects.toMatchObject({ status: 402 });
    }
    const after = await brandCampaignService.getForBrand(brand, c.id);
    expect(['draft', 'commitment_required']).toContain(after.campaign.status);
    await expect(brandCampaignService.getOpportunity(c.id)).rejects.toMatchObject({ status: 404 });
  });

  it('6.11 a funded campaign is visible and readable for an eligible signed-in creator', async () => {
    const c = await freshCampaign();
    await fundAndOpen(c.id);
    const list = await brandCampaignService.listOpportunities();
    expect(list.map((x) => x.id)).toContain(c.id);
    const detail = await brandCampaignService.getOpportunity(c.id);
    expect(detail.brand_name).toBe('Acme Labs');
  });

  it('6.12 a cancelled / completed campaign is not returned as an opportunity', async () => {
    const c = await freshCampaign();
    await fundAndOpen(c.id);
    await brandCampaignService.setStatus(brand, c.id, 'cancelled');
    const list = await brandCampaignService.listOpportunities();
    expect(list.map((x) => x.id)).not.toContain(c.id);
    await expect(brandCampaignService.getOpportunity(c.id)).rejects.toMatchObject({ status: 404 });
  });

  it('6.13 the brand keeps full access to its own draft / unfunded campaign', async () => {
    const c = await freshCampaign();
    const own = await brandCampaignService.getForBrand(brand, c.id);
    expect(own.campaign.id).toBe(c.id);
    const mine = await brandCampaignService.listMine(brand);
    expect(mine.map((x) => x.id)).toContain(c.id);
    await expect(brandCampaignService.getForBrand(stranger, c.id)).rejects.toMatchObject({ status: 403 });
  });

  it('6.14 admin oversight still sees unfunded campaigns, with required vs paid commitment', async () => {
    const c = await freshCampaign();
    const rows = await brandCampaignService.adminOverview();
    const row = rows.find((r) => r.id === c.id);
    expect(row).toBeTruthy();
    expect(row!.required_commitment_minor).toBe(50_000);
    expect(row!.paid_commitment_minor).toBe(0);
    expect(row!.commitment_shortfall_minor).toBe(50_000);
    expect(row!.commitment_funded).toBe(false);
  });

  it('6.15 creator discovery endpoints require authentication (public board stays DEFERRED)', async () => {
    const route = src('app/api/[[...path]]/route.ts');
    const block = route.slice(route.indexOf("// Creator-facing campaign opportunities"), route.indexOf("if (route === '/campaign-applications'"));
    expect((block.match(/requireRole\(actor, ROLES\.USER\)/g) || []).length).toBeGreaterThanOrEqual(3);
    // No public anonymous campaign board page was introduced.
    expect(() => src('app/campaigns/page.tsx')).toThrow();
  });

  it('6.16 anonymous HTTP access to opportunities and to a campaign detail is blocked', async () => {
    const list = await fetch(`${HTTP}/campaign-opportunities`);
    expect([401, 403]).toContain(list.status);
    const detail = await fetch(`${HTTP}/campaign-opportunities/${uuidv4()}`);
    expect([401, 403]).toContain(detail.status);
  });
});

describe('M19 §6 D6 — authoritative provider event lifecycle', () => {
  async function checkout(campaignId: string) {
    return campaignCommitmentService.createCheckout(brand, campaignId);
  }

  it('6.17 an authoritative capture event opens the campaign without any browser return', async () => {
    const c = await freshCampaign();
    const row = await checkout(c.id);
    const done = await campaignCommitmentService.finalizeCapturedFromProviderEvent(row.provider_order_id!, 'cap-webhook-1', 50_000, 'USD');
    expect(done?.status).toBe('captured');
    const sum = await campaignCommitmentService.summary(c.id);
    expect(sum.paid_commitment_minor).toBe(50_000);
    expect(sum.funded).toBe(true);
    const detail = await brandCampaignService.getOpportunity(c.id);
    expect(detail.status).toBe('open');
  });

  it('6.18 a browser return alone still cannot open a campaign', async () => {
    const c = await freshCampaign();
    await checkout(c.id);                      // approved by nobody, captured by nobody
    await expect(brandCampaignService.getOpportunity(c.id)).rejects.toMatchObject({ status: 404 });
    const ui = src('app/dashboard/campaigns/[id]/CampaignDetailClient.tsx');
    expect(ui).toContain('commitment/');       // the return handler POSTs to the authoritative capture route
    const route = src('app/api/[[...path]]/route.ts');
    expect(route).toContain('captureAndFinalize');
  });

  it('6.19 duplicate capture webhooks are idempotent', async () => {
    const c = await freshCampaign();
    const row = await checkout(c.id);
    for (let i = 0; i < 3; i++) {
      await campaignCommitmentService.finalizeCapturedFromProviderEvent(row.provider_order_id!, 'cap-webhook-2', 50_000, 'USD');
    }
    const sum = await campaignCommitmentService.summary(c.id);
    expect(sum.paid_commitment_minor).toBe(50_000);
    const rows = await campaignCommitmentService.listForCampaign(c.id);
    expect(rows.filter((r) => r.status === 'captured').length).toBe(1);
  });

  it('6.20 a provider event that does not match the server snapshot never counts as paid', async () => {
    const wrongAmount = await freshCampaign();
    const r1 = await checkout(wrongAmount.id);
    const bad = await campaignCommitmentService.finalizeCapturedFromProviderEvent(r1.provider_order_id!, 'cap-bad-1', 10_000, 'USD');
    expect(bad?.status).not.toBe('captured');
    expect(bad?.finalization_mismatch).toMatch(/amount mismatch/);
    expect((await campaignCommitmentService.summary(wrongAmount.id)).paid_commitment_minor).toBe(0);
    await expect(brandCampaignService.getOpportunity(wrongAmount.id)).rejects.toMatchObject({ status: 404 });

    const wrongCurrency = await freshCampaign();
    const r2 = await checkout(wrongCurrency.id);
    const bad2 = await campaignCommitmentService.finalizeCapturedFromProviderEvent(r2.provider_order_id!, 'cap-bad-2', 50_000, 'EUR');
    expect(bad2?.finalization_mismatch).toMatch(/currency mismatch/);
    expect((await campaignCommitmentService.summary(wrongCurrency.id)).paid_commitment_minor).toBe(0);
  });

  it('6.21 an unrelated provider order is not a commitment and is left to other domains', async () => {
    expect(await campaignCommitmentService.finalizeCapturedFromProviderEvent(`not-a-commitment-${uuidv4()}`, 'cap', 100, 'USD')).toBeNull();
    expect(await campaignCommitmentService.recordRefundOrReversal(`not-a-commitment-${uuidv4()}`, 100, 'rf')).toBeNull();
  });

  it('6.22 a FULL refund before any booking takes the campaign out of Campaign Opportunities', async () => {
    const c = await freshCampaign();
    const row = await checkout(c.id);
    await campaignCommitmentService.finalizeCapturedFromProviderEvent(row.provider_order_id!, 'cap-r1', 50_000, 'USD');
    expect((await brandCampaignService.getOpportunity(c.id)).status).toBe('open');

    await campaignCommitmentService.recordRefundOrReversal(row.provider_order_id!, 50_000, 'refund-1');
    const sum = await campaignCommitmentService.summary(c.id);
    expect(sum.paid_commitment_minor).toBe(0);
    expect(sum.refunded_commitment_minor).toBe(50_000);
    expect(sum.topup_required_minor).toBe(50_000);
    expect(sum.funded).toBe(false);
    const after = await brandCampaignService.getForBrand(brand, c.id);
    expect(after.campaign.status).toBe('commitment_required');
    expect(after.campaign.commitment_issue_state).toBe('refund_shortfall');
    await expect(brandCampaignService.getOpportunity(c.id)).rejects.toMatchObject({ status: 404 });
    expect((await brandCampaignService.listOpportunities()).map((x) => x.id)).not.toContain(c.id);
  });

  it('6.23 a PARTIAL refund recalculates the shortfall and is idempotent per refund reference', async () => {
    const c = await freshCampaign();
    const row = await checkout(c.id);
    await campaignCommitmentService.finalizeCapturedFromProviderEvent(row.provider_order_id!, 'cap-r2', 50_000, 'USD');
    await campaignCommitmentService.recordRefundOrReversal(row.provider_order_id!, 20_000, 'refund-2');
    let sum = await campaignCommitmentService.summary(c.id);
    expect(sum.paid_commitment_minor).toBe(30_000);
    expect(sum.topup_required_minor).toBe(20_000);
    expect(sum.funded).toBe(false);

    // Duplicate delivery of the SAME refund reference changes nothing.
    await campaignCommitmentService.recordRefundOrReversal(row.provider_order_id!, 20_000, 'refund-2');
    sum = await campaignCommitmentService.summary(c.id);
    expect(sum.paid_commitment_minor).toBe(30_000);
    expect(sum.refunded_commitment_minor).toBe(20_000);

    // Restoring the deposit clears the issue and republishes the campaign.
    const topup = await campaignCommitmentService.createCheckout(brand, c.id);
    expect(topup.amount_minor).toBe(20_000);
    await campaignCommitmentService.captureAndFinalize(topup.id);
    const healthy = await campaignCommitmentService.summary(c.id);
    expect(healthy.funded).toBe(true);
    const camp = await brandCampaignService.getForBrand(brand, c.id);
    expect(camp.campaign.commitment_issue_state).toBeFalsy();
    expect((await brandCampaignService.getOpportunity(c.id)).status).toBe('open');
  });

  it('6.24 existing creator bookings SURVIVE a refund; only NEW obligations are blocked', async () => {
    const secondChannel = uuidv4();
    await withDb(async (db) => {
      await db.collection(COLLECTIONS.CHANNELS).insertOne({
        id: secondChannel, slug: `${RUN}-ch2`, name: `${RUN} channel two`, status: 'approved',
        owner_id: creatorId, submitted_by: creatorId, verification_status: 'verified',
        whatsapp_url: 'https://whatsapp.com/channel/0029Vm20', country_code: 'ID',
        public_followers_count: 8000, created_at: new Date(), updated_at: new Date(),
      } as never);
    });
    const c = await freshCampaign();
    const row = await checkout(c.id);
    await campaignCommitmentService.finalizeCapturedFromProviderEvent(row.provider_order_id!, 'cap-r3', 50_000, 'USD');

    const booked = await brandCampaignService.apply(creator, c.id, {
      channel_id: channelId, pitch: 'This applicant will already have a real marketplace booking.', proposed_rate_usd_minor: 400_000,
    });
    const notBooked = await brandCampaignService.apply(creator, c.id, {
      channel_id: secondChannel, pitch: 'This applicant is approved but has no booking yet at all.', proposed_rate_usd_minor: 100_000,
    });
    await brandCampaignService.decide(brand, booked.id, 'approved');
    await brandCampaignService.decide(brand, notBooked.id, 'approved');

    const orderId = uuidv4();
    await withDb(async (db) => {
      await db.collection(COLLECTIONS.MARKETPLACE_ORDERS).insertOne({
        id: orderId, status: 'paid', economics_status: 'finalized',
        source_brand_campaign_id: c.id, source_brand_campaign_application_id: booked.id,
        buyer_user_id: brandId, channel_id: channelId, channel_slug: `${RUN}-ch`, owner_user_id: creatorId,
        quoted_price_minor: 400_000, currency: 'USD', snapshot: { gross_price_minor: 400_000 },
        created_at: new Date(), updated_at: new Date(),
      } as never);
    });

    // FULL refund of the commitment deposit.
    await campaignCommitmentService.recordRefundOrReversal(row.provider_order_id!, 50_000, 'refund-3');

    const after = await brandCampaignService.getForBrand(brand, c.id);
    expect(after.campaign.commitment_issue_state).toBe('refund_shortfall');
    expect(after.campaign.commitment_issue_shortfall_minor).toBe(50_000);
    // Lifecycle preserved — the campaign is NOT reset while obligations exist.
    expect(after.campaign.status).not.toBe('commitment_required');
    expect(after.committed_booking_value_minor).toBe(400_000);

    // The existing booking is untouched and still reachable.
    await withDb(async (db) => {
      const o = await db.collection(COLLECTIONS.MARKETPLACE_ORDERS).findOne({ id: orderId });
      expect(o?.status).toBe('paid');
    });
    const resume = await brandCampaignService.continueToBooking(brand, booked.id);
    expect(resume.existing_order_id).toBe(orderId);
    expect(resume.payment_created).toBe(false);

    // A NEW obligation is blocked while the shortfall is unresolved.
    await expect(brandCampaignService.continueToBooking(brand, notBooked.id)).rejects.toMatchObject({ status: 409 });
    expect(src('lib/services/marketplaceService.ts')).toContain('Restore the deposit before creating new bookings');

    // Hidden from creator discovery, visible to admin with the issue flagged.
    expect((await brandCampaignService.listOpportunities()).map((x) => x.id)).not.toContain(c.id);
    const adminRow = (await brandCampaignService.adminOverview()).find((r) => r.id === c.id);
    expect(adminRow!.commitment_issue_state).toBe('refund_shortfall');
    expect(adminRow!.refunded_commitment_minor).toBe(50_000);
    expect(adminRow!.committed_booking_value_minor).toBe(400_000);

    await withDb(async (db) => {
      await db.collection(COLLECTIONS.MARKETPLACE_ORDERS).deleteMany({ id: orderId });
      await db.collection(COLLECTIONS.CHANNELS).deleteMany({ id: secondChannel });
    });
  });

  it('6.25 the refund/lifecycle code stays provider-agnostic', () => {
    const code = src('lib/services/payments/campaignCommitmentService.ts')
      .split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*') && !l.trim().startsWith('/*')).join('\n');
    expect(code).not.toMatch(/paypal/i);
    expect(code).not.toMatch(/CAPTURE\.REFUNDED|CHECKOUT\.ORDER/);
    expect(code).toContain('getPaymentProvider');
  });
});

describe('M19 §6 — My Applications clarity (display only)', () => {
  it('6.26 every application row carries Brand, Campaign, channel, rate, date and status', async () => {
    const c = await freshCampaign();
    const row = await campaignCommitmentService.createCheckout(brand, c.id);
    await campaignCommitmentService.captureAndFinalize(row.id);
    const app = await brandCampaignService.apply(creator, c.id, {
      channel_id: channelId, pitch: 'A clear pitch so the brand can judge audience fit quickly.', proposed_rate_usd_minor: 50_000,
    });
    await brandCampaignService.decide(brand, app.id, 'shortlisted');

    const mine = await brandCampaignService.listMyApplications(creator);
    const found = mine.find((a) => a.id === app.id)!;
    expect(found.brand_name).toBe('Acme Labs');
    expect(found.campaign_name).toBe(c.name);
    expect(found.channel_name).toBe(`${RUN} channel`);
    expect(found.proposed_rate_usd_minor).toBe(50_000);
    expect(found.status).toBe('shortlisted');
    expect(found.created_at).toBeTruthy();

    // A creator only ever sees their own applications.
    const others = await brandCampaignService.listMyApplications(stranger);
    expect(others.map((a) => a.id)).not.toContain(app.id);

    const ui = src('app/dashboard/applications/ApplicationsClient.tsx');
    expect(ui).toContain('Brand & campaign');
    expect(ui).toContain('application-brand-');
    expect(ui).toContain('application-campaign-');
    expect(ui).toContain('Channel used');
  });

  it('6.27 no notification scope was added (shortlist / reject emails stay deferred)', () => {
    const notif = src('lib/services/campaignNotificationService.ts');
    expect(notif).toContain('applicationSubmitted');
    expect(notif).toContain('applicationApproved');
    expect(notif).not.toMatch(/applicationShortlisted|applicationRejected/);
    const domain = src('lib/services/brandCampaignService.ts');
    expect((domain.match(/campaignNotificationService\./g) || []).length).toBe(2);
  });
});

/* =====================================================================
 * M19 §7 — FINAL CORRECTIONS: D4 payload, D7 funded capacity,
 *          D9 applicant pool, D12 zero budget, LEGACY (no grandfathering)
 * ===================================================================== */

async function fundCampaign(campaignId: string) {
  const row = await campaignCommitmentService.createCheckout(brand, campaignId);
  await campaignCommitmentService.captureAndFinalize(row.id);
  return row;
}

describe('M19 §7 D4 — creator payload projection', () => {
  const FORBIDDEN = ['brand_user_id', '_id', 'budget_history', 'changed_by', 'commitment_', 'provider_', 'payment_'];

  it('7.1 the opportunities list is a safe DTO', async () => {
    const c = await freshCampaign();
    await fundCampaign(c.id);
    const list = await brandCampaignService.listOpportunities();
    const row = list.find((x) => x.id === c.id)!;
    expect(row).toBeTruthy();
    for (const key of Object.keys(row)) {
      expect(FORBIDDEN.some((f) => key.includes(f))).toBe(false);
    }
    const raw = JSON.stringify(row);
    for (const f of FORBIDDEN) expect(raw).not.toContain(f);
    // …but everything a creator needs is present.
    expect(row.brand_name).toBe('Acme Labs');
    expect(row.name).toBeTruthy();
    expect(row.objective).toBeTruthy();
    expect(row.brief).toBeTruthy();
    expect(row.budget_total_usd_minor).toBe(1_000_000);
    expect(row.status).toBe('open');
    expect(Array.isArray(row.target_country_codes)).toBe(true);
    expect('application_deadline' in row).toBe(true);
    expect('creator_requirements' in row).toBe(true);
    expect('deliverables' in row).toBe(true);
    expect('materials_url' in row).toBe(true);
  });

  it('7.2 the opportunity detail is the same safe DTO', async () => {
    const c = await freshCampaign();
    await fundCampaign(c.id);
    const detail = await brandCampaignService.getOpportunity(c.id);
    const raw = JSON.stringify(detail);
    for (const f of FORBIDDEN) expect(raw).not.toContain(f);
    expect(detail.brand_logo_url).toBeDefined();
    const svc = src('lib/services/brandCampaignService.ts');
    expect(svc).toContain('export function toCreatorOpportunity');
    expect(svc).toContain('assertCreatorVisible');
  });

  it('7.3 brand and admin views keep the fields they legitimately need', async () => {
    const c = await freshCampaign();
    const own = await brandCampaignService.getForBrand(brand, c.id);
    expect(own.campaign.brand_user_id).toBe(brandId);
    expect(Array.isArray(own.campaign.budget_history)).toBe(true);
    const adminRow = (await brandCampaignService.adminOverview()).find((r) => r.id === c.id)!;
    expect(adminRow.brand_user_id).toBe(brandId);
    expect(adminRow.required_commitment_minor).toBe(50_000);
  });
});

describe('M19 §7 D7 — funded campaign capacity is enforced', () => {
  const orderIds: string[] = [];
  async function bookingOf(campaignId: string, grossMinor: number, status = 'paid') {
    const id = uuidv4();
    orderIds.push(id);
    await withDb(async (db) => {
      await db.collection(COLLECTIONS.MARKETPLACE_ORDERS).insertOne({
        id, status, economics_status: 'finalized', source_brand_campaign_id: campaignId,
        buyer_user_id: brandId, channel_id: channelId, channel_slug: `${RUN}-ch`, owner_user_id: creatorId,
        quoted_price_minor: grossMinor, currency: 'USD', snapshot: { gross_price_minor: grossMinor },
        created_at: new Date(), updated_at: new Date(),
      } as never);
    });
    return id;
  }
  afterAll(async () => {
    await withDb(async (db) => { await db.collection(COLLECTIONS.MARKETPLACE_ORDERS).deleteMany({ id: { $in: orderIds } }); });
  });

  it('7.4 a fully funded $10,000 campaign allows obligations up to $10,000', async () => {
    const c = await freshCampaign();
    await fundCampaign(c.id);
    const cap = await brandCampaignService.fundedCapacity(c.id);
    expect(cap.paid_commitment_minor).toBe(50_000);
    expect(cap.funded_campaign_limit_minor).toBe(1_000_000);
    expect(cap.funded_campaign_capacity_minor).toBe(1_000_000);
    expect(cap.available_funded_capacity_minor).toBe(1_000_000);
    await expect(brandCampaignService.assertNewObligationAllowed(c.id, 1_000_000)).resolves.toBeTruthy();
    await expect(brandCampaignService.assertNewObligationAllowed(c.id, 1_000_001)).rejects.toMatchObject({ status: 409 });
  });

  it('7.5 $8,000 committed + $2,000 new = allowed; + $3,000 = BLOCKED', async () => {
    const c = await freshCampaign();
    await fundCampaign(c.id);
    await bookingOf(c.id, 800_000);
    const cap = await brandCampaignService.fundedCapacity(c.id);
    expect(cap.committed_booking_value_minor).toBe(800_000);
    expect(cap.available_funded_capacity_minor).toBe(200_000);
    await expect(brandCampaignService.assertNewObligationAllowed(c.id, 200_000)).resolves.toBeTruthy();
    await expect(brandCampaignService.assertNewObligationAllowed(c.id, 300_000))
      .rejects.toMatchObject({ status: 409, message: expect.stringContaining('2000.00 USD available') });
  });

  it('7.6 a budget increase without top-up keeps the funded capacity at the funded amount', async () => {
    const c = await freshCampaign();
    await fundCampaign(c.id);
    await brandCampaignService.changeBudget(brand, c.id, { budget_total_usd_minor: 2_000_000 });
    const cap = await brandCampaignService.fundedCapacity(c.id);
    expect(cap.required_commitment_minor).toBe(100_000);
    expect(cap.paid_commitment_minor).toBe(50_000);
    expect(cap.commitment_shortfall_minor).toBe(50_000);
    expect(cap.funded_campaign_capacity_minor).toBe(1_000_000);      // still $10,000
    // A $12,000 obligation is blocked, a $10,000 one is still allowed.
    await expect(brandCampaignService.assertNewObligationAllowed(c.id, 1_200_000)).rejects.toMatchObject({ status: 409 });
    await expect(brandCampaignService.assertNewObligationAllowed(c.id, 1_000_000)).resolves.toBeTruthy();
    // A pure top-up shortfall is NOT a funding issue: discovery stays intact.
    const camp = await brandCampaignService.getForBrand(brand, c.id);
    expect(camp.campaign.commitment_issue_state).toBeFalsy();
    expect((await brandCampaignService.listOpportunities()).map((x) => x.id)).toContain(c.id);

    // …and the captured top-up raises the capacity to $20,000.
    const topup = await campaignCommitmentService.createCheckout(brand, c.id);
    expect(topup.amount_minor).toBe(50_000);
    await campaignCommitmentService.captureAndFinalize(topup.id);
    const after = await brandCampaignService.fundedCapacity(c.id);
    expect(after.paid_commitment_minor).toBe(100_000);
    expect(after.funded_campaign_capacity_minor).toBe(2_000_000);
    await expect(brandCampaignService.assertNewObligationAllowed(c.id, 1_200_000)).resolves.toBeTruthy();
  });

  it('7.7 approving an applicant never consumes funded capacity', async () => {
    const c = await freshCampaign();
    await fundCampaign(c.id);
    const before = await brandCampaignService.fundedCapacity(c.id);
    const app = await brandCampaignService.apply(creator, c.id, {
      channel_id: channelId, pitch: 'Approval alone must never consume funded campaign capacity.', proposed_rate_usd_minor: 900_000,
    });
    await brandCampaignService.decide(brand, app.id, 'shortlisted');
    await brandCampaignService.decide(brand, app.id, 'approved');
    const after = await brandCampaignService.fundedCapacity(c.id);
    expect(after.committed_booking_value_minor).toBe(before.committed_booking_value_minor);
    expect(after.available_funded_capacity_minor).toBe(before.available_funded_capacity_minor);
  });

  it('7.8 a refund lowers the funded capacity; existing bookings are preserved', async () => {
    const c = await freshCampaign();
    const row = await campaignCommitmentService.createCheckout(brand, c.id);
    await campaignCommitmentService.captureAndFinalize(row.id);
    const oid = await bookingOf(c.id, 400_000);
    expect((await brandCampaignService.fundedCapacity(c.id)).funded_campaign_capacity_minor).toBe(1_000_000);

    await campaignCommitmentService.recordRefundOrReversal(row.provider_order_id!, 30_000, `rf-${uuidv4()}`);
    const cap = await brandCampaignService.fundedCapacity(c.id);
    expect(cap.paid_commitment_minor).toBe(20_000);
    expect(cap.funded_campaign_capacity_minor).toBe(400_000);         // 20,000 ÷ 5%
    expect(cap.committed_booking_value_minor).toBe(400_000);
    expect(cap.available_funded_capacity_minor).toBe(0);
    await expect(brandCampaignService.assertNewObligationAllowed(c.id, 1)).rejects.toMatchObject({ status: 409 });
    await withDb(async (db) => {
      expect((await db.collection(COLLECTIONS.MARKETPLACE_ORDERS).findOne({ id: oid }))?.status).toBe('paid');
    });
  });

  it('7.9 an unrelated campaign booking never consumes this campaign capacity', async () => {
    const mine = await freshCampaign();
    const other = await freshCampaign();
    await fundCampaign(mine.id);
    await bookingOf(other.id, 900_000);
    const cap = await brandCampaignService.fundedCapacity(mine.id);
    expect(cap.committed_booking_value_minor).toBe(0);
    expect(cap.available_funded_capacity_minor).toBe(1_000_000);
  });

  it('7.10 the gate is server-side and runs before the marketplace order is inserted', () => {
    const mp = src('lib/services/marketplaceService.ts');
    const gate = mp.indexOf('assertNewObligationAllowed');
    const insert = mp.indexOf('marketplaceOrderRepo.insert(order)');
    expect(gate).toBeGreaterThan(0);
    expect(gate).toBeLessThan(insert);
    expect(mp).toContain('assertNewObligationAllowed(campaign.id, pkg.price_minor ?? 0)');
    const svc = src('lib/services/brandCampaignService.ts');
    expect(svc).toContain('funded_campaign_capacity_minor');
    // Capacity is derived from captured commitment + real orders, never from the client.
    expect(svc).toContain('Math.min(sum.funded_campaign_limit_minor, sum.campaign_budget_usd_minor)');
    const ui = src('app/dashboard/campaigns/[id]/CampaignDetailClient.tsx');
    expect(ui).toContain('Available funded capacity');
    expect(ui).not.toContain('Approvals stay within your funded campaign limit');
  });
});

describe('M19 §7 D9 — richer applicant pool (public data only)', () => {
  let cardChannel = '';
  let campaignId = '';
  let appId = '';

  beforeAll(async () => {
    cardChannel = uuidv4();
    await withDb(async (db) => {
      const cat = await db.collection(COLLECTIONS.CATEGORIES).findOne({ is_active: true });
      await db.collection(COLLECTIONS.CHANNELS).insertOne({
        id: cardChannel, slug: `${RUN}-rc`, name: `${RUN} rate card channel`, status: 'approved',
        owner_id: creatorId, submitted_by: creatorId, verification_status: 'verified',
        whatsapp_url: 'https://whatsapp.com/channel/0029Vm21', country_code: 'ID',
        logo_url: 'https://cdn.example/logo.png', category_id: (cat as { id?: string } | null)?.id ?? null,
        follower_count: 5000, public_followers_count: 15000,
        created_at: new Date(), updated_at: new Date(),
      } as never);
      await db.collection(COLLECTIONS.CHANNEL_RATE_CARDS).insertOne({
        id: uuidv4(), channel_id: cardChannel, owner_user_id: creatorId,
        packages: [{
          id: uuidv4(), type: 'single_post', name: 'Single post', description: 'One sponsored post',
          price_minor: 150_000, currency: 'USD', deliverables: ['1 post'], estimated_delivery_days: 3,
          is_active: true, created_at: new Date(), updated_at: new Date(),
        }],
        created_at: new Date(), updated_at: new Date(),
      } as never);
      await db.collection(COLLECTIONS.CHANNEL_SAMPLE_WORKS).insertOne({
        id: uuidv4(), channel_id: cardChannel, owner_user_id: creatorId, type: 'sponsored_post',
        title: 'Past campaign', description: 'A previous sponsored post', url: 'https://example.com/work',
        created_at: new Date(), updated_at: new Date(),
      } as never);
    });
    const c = await freshCampaign();
    campaignId = c.id;
    await fundCampaign(campaignId);
    const app = await brandCampaignService.apply(creator, campaignId, {
      channel_id: cardChannel, pitch: 'Our audience matches your brief and we have published sample work.',
      proposed_rate_usd_minor: 150_000, audience_note: 'Mostly Jakarta tech workers',
    });
    appId = app.id;
  });

  afterAll(async () => {
    await withDb(async (db) => {
      await db.collection(COLLECTIONS.CHANNELS).deleteMany({ id: cardChannel });
      await db.collection(COLLECTIONS.CHANNEL_RATE_CARDS).deleteMany({ channel_id: cardChannel });
      await db.collection(COLLECTIONS.CHANNEL_SAMPLE_WORKS).deleteMany({ channel_id: cardChannel });
    });
  });

  it('7.11 the brand sees avatar, category, followers, rate card, sample work and the application date', async () => {
    const view = await brandCampaignService.getForBrand(brand, campaignId);
    const row = view.applications.find((a) => a.id === appId)!;
    expect(row.channel?.logo_url).toBe('https://cdn.example/logo.png');
    expect(row.channel?.public_followers_count).toBe(15000);
    expect(row.channel?.profile_url).toBe(`/channel/${RUN}-rc`);
    expect(row.channel?.has_rate_card).toBe(true);
    expect(row.channel?.rate_card_packages).toBe(1);
    expect(row.channel?.rate_card_url).toContain('#rate-card');
    expect(row.channel?.has_sample_work).toBe(true);
    expect(row.channel?.sample_work_count).toBe(1);
    expect(row.channel?.sample_work_url).toContain('#sample-work');
    expect(row.created_at).toBeTruthy();
    expect(row.status).toBe('applied');
    expect(row.proposed_rate_usd_minor).toBe(150_000);
    // category_name is resolved from the existing category domain when set.
    expect('category_name' in (row.channel || {})).toBe(true);
  });

  it('7.12 no private creator identity, contact or payout data is exposed', async () => {
    const view = await brandCampaignService.getForBrand(brand, campaignId);
    const raw = JSON.stringify(view.applications);
    for (const f of ['email', 'owner_id', 'submitted_by', 'payout', 'phone', 'password', 'whatsapp_url']) {
      expect(raw).not.toContain(f);
    }
  });

  it('7.13 the applicant pool reuses existing rate card / sample work domains (no duplication)', () => {
    const svc = src('lib/services/brandCampaignService.ts');
    expect(svc).toContain('marketplaceService.getPublicRateCard');
    expect(svc).toContain('sampleWorkService.listPublic');
    expect(svc).not.toMatch(/CHANNEL_RATE_CARDS|CHANNEL_SAMPLE_WORKS/);
    const ui = src('app/dashboard/campaigns/[id]/CampaignDetailClient.tsx');
    for (const t of ['applicant-avatar-', 'applicant-meta-', 'applicant-followers-', 'applicant-date-',
      'view-channel-', 'view-rate-card-', 'view-sample-work-']) {
      expect(ui).toContain(t);
    }
    const channelPage = src('app/channel/[slug]/page.tsx');
    expect(channelPage).toContain('id="rate-card"');
    expect(channelPage).toContain('id="sample-work"');
  });
});

describe('M19 §7 D12 — zero / negative budget', () => {
  it('7.14 a zero budget campaign is rejected server-side', async () => {
    await expect(brandCampaignService.createDraft(brand, { ...CAMPAIGN_INPUT, budget_total_usd_minor: 0 }))
      .rejects.toMatchObject({ status: 400, message: expect.stringContaining('greater than $0') });
  });

  it('7.15 a negative budget is rejected', async () => {
    await expect(brandCampaignService.createDraft(brand, { ...CAMPAIGN_INPUT, budget_total_usd_minor: -100 }))
      .rejects.toMatchObject({ status: 400 });
  });

  it('7.16 a valid positive budget is accepted and the 5% is unchanged', async () => {
    const c = await brandCampaignService.createDraft(brand, { ...CAMPAIGN_INPUT, name: `${RUN}-pos`, budget_total_usd_minor: 10_000 });
    expect(c.budget_total_usd_minor).toBe(10_000);
    expect(requiredCommitmentMinor(10_000)).toBe(500);
    expect(requiredCommitmentMinor(100_000)).toBe(5_000);
    expect(requiredCommitmentMinor(1_000_000)).toBe(50_000);
  });

  it('7.17 an existing campaign cannot be edited down to zero', async () => {
    const c = await freshCampaign();
    await expect(brandCampaignService.changeBudget(brand, c.id, { budget_total_usd_minor: 0 }))
      .rejects.toMatchObject({ status: 400, message: expect.stringContaining('greater than $0') });
    await expect(brandCampaignService.changeBudget(brand, c.id, { budget_total_usd_minor: -1 }))
      .rejects.toMatchObject({ status: 400 });
  });
});

describe('M19 §7 LEGACY pre-M19 campaigns — NO GRANDFATHERING', () => {
  const legacyIds: string[] = [];
  const legacyOrderIds: string[] = [];

  /** Writes a campaign exactly as M18 would have left it: open, no deposit. */
  async function legacyOpenCampaign(): Promise<string> {
    const id = uuidv4();
    legacyIds.push(id);
    await withDb(async (db) => {
      await db.collection(COLLECTIONS.BRAND_CAMPAIGNS).insertOne({
        id, brand_user_id: brandId, name: `${RUN} legacy ${id.slice(0, 5)}`, brand_name: 'Legacy Brand',
        objective: 'Awareness', brief: 'A campaign published before M19 existed at all.',
        target_country_codes: ['ID'], target_category_slugs: [],
        start_date: null, end_date: null, application_deadline: null,
        budget_total_usd_minor: 1_000_000, budget_history: [],
        creator_requirements: null, expected_creator_count: null, deliverables: null, materials_url: null,
        status: 'open', opened_at: new Date('2026-01-01'),
        created_at: new Date('2026-01-01'), updated_at: new Date('2026-01-01'),
      } as never);
    });
    return id;
  }

  afterAll(async () => {
    await withDb(async (db) => {
      await db.collection(COLLECTIONS.BRAND_CAMPAIGNS).deleteMany({ id: { $in: legacyIds } });
      await db.collection(COLLECTIONS.MARKETPLACE_ORDERS).deleteMany({ id: { $in: legacyOrderIds } });
    });
  });

  it('7.18 a legacy unfunded campaign is hidden from creator discovery', async () => {
    const id = await legacyOpenCampaign();
    expect((await brandCampaignService.listOpportunities()).map((x) => x.id)).not.toContain(id);
    await expect(brandCampaignService.getOpportunity(id)).rejects.toMatchObject({ status: 404 });
    await expect(brandCampaignService.apply(creator, id, {
      channel_id: channelId, pitch: 'Trying to apply to a legacy campaign that was never funded.',
    })).rejects.toMatchObject({ status: 404 });
  });

  it('7.19 the brand keeps management and sees the exact commitment required', async () => {
    const id = await legacyOpenCampaign();
    const view = await brandCampaignService.getForBrand(brand, id);
    expect(view.campaign.id).toBe(id);
    expect(view.capacity.required_commitment_minor).toBe(50_000);
    expect(view.capacity.paid_commitment_minor).toBe(0);
    expect(view.capacity.commitment_shortfall_minor).toBe(50_000);
    expect(view.capacity.funded_campaign_capacity_minor).toBe(0);
    // Effective funding state is clearly "commitment required" — data intact.
    expect(view.campaign.status).toBe('commitment_required');
    expect(view.campaign.commitment_issue_state).toBe('commitment_shortfall');
    expect(view.campaign.name).toContain('legacy');
    expect(Array.isArray(view.campaign.budget_history)).toBe(true);
    const sum = await brandCampaignService.commitmentSummary(brand, id);
    expect(sum.required_commitment_minor).toBe(50_000);
    expect(sum.funded).toBe(false);
    // Editing still works.
    const edited = await brandCampaignService.changeBudget(brand, id, { budget_total_usd_minor: 600_000 });
    expect(edited.budget_total_usd_minor).toBe(600_000);
  });

  it('7.20 funding a legacy campaign makes it eligible to open again', async () => {
    const id = await legacyOpenCampaign();
    await brandCampaignService.getForBrand(brand, id);        // normalises to commitment_required
    const row = await campaignCommitmentService.createCheckout(brand, id);
    expect(row.amount_minor).toBe(50_000);
    await campaignCommitmentService.captureAndFinalize(row.id);
    const view = await brandCampaignService.getForBrand(brand, id);
    expect(view.campaign.status).toBe('open');
    expect(view.campaign.commitment_issue_state).toBeFalsy();
    expect((await brandCampaignService.listOpportunities()).map((x) => x.id)).toContain(id);
    expect((await brandCampaignService.getOpportunity(id)).status).toBe('open');
  });

  it('7.21 legacy bookings made before M19 are PRESERVED and only new ones are blocked', async () => {
    const id = await legacyOpenCampaign();
    const orderId = uuidv4();
    legacyOrderIds.push(orderId);
    await withDb(async (db) => {
      await db.collection(COLLECTIONS.MARKETPLACE_ORDERS).insertOne({
        id: orderId, status: 'completed', economics_status: 'finalized',
        source_brand_campaign_id: id, buyer_user_id: brandId,
        channel_id: channelId, channel_slug: `${RUN}-ch`, owner_user_id: creatorId,
        quoted_price_minor: 300_000, currency: 'USD', snapshot: { gross_price_minor: 300_000 },
        created_at: new Date('2026-02-01'), updated_at: new Date('2026-02-01'),
      } as never);
    });

    const view = await brandCampaignService.getForBrand(brand, id);
    // Lifecycle preserved (NOT reset) because a real obligation exists…
    expect(view.campaign.status).toBe('open');
    expect(view.campaign.commitment_issue_state).toBe('commitment_shortfall');
    expect(view.committed_booking_value_minor).toBe(300_000);
    // …the order itself is untouched…
    await withDb(async (db) => {
      expect((await db.collection(COLLECTIONS.MARKETPLACE_ORDERS).findOne({ id: orderId }))?.status).toBe('completed');
    });
    // …creators still cannot see it, and NEW obligations are blocked…
    expect((await brandCampaignService.listOpportunities()).map((x) => x.id)).not.toContain(id);
    await expect(brandCampaignService.assertNewObligationAllowed(id, 1)).rejects.toMatchObject({ status: 409 });
    // …and the budget still cannot drop below the legacy obligation.
    await expect(brandCampaignService.changeBudget(brand, id, { budget_total_usd_minor: 200_000 }))
      .rejects.toMatchObject({ status: 409 });

    // Funding it restores everything without touching the legacy booking.
    const row = await campaignCommitmentService.createCheckout(brand, id);
    await campaignCommitmentService.captureAndFinalize(row.id);
    const after = await brandCampaignService.getForBrand(brand, id);
    expect(after.campaign.commitment_issue_state).toBeFalsy();
    expect(after.committed_booking_value_minor).toBe(300_000);
    expect((await brandCampaignService.listOpportunities()).map((x) => x.id)).toContain(id);
    expect((await brandCampaignService.fundedCapacity(id)).available_funded_capacity_minor).toBe(700_000);
  });

  it('7.22 no commitment record is ever fabricated for a legacy campaign', async () => {
    const id = await legacyOpenCampaign();
    await brandCampaignService.getForBrand(brand, id);
    expect(await campaignCommitmentService.listForCampaign(id)).toEqual([]);
    const svc = src('lib/services/payments/campaignCommitmentService.ts');
    expect(svc).toContain('NO GRANDFATHERING');
    expect(svc).not.toMatch(/legacy_(grant|waiver)|skip_commitment|grandfather(ed)?\s*=/i);
  });
});
