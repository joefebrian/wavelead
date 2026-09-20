// M18 — targeted tests: category polish, unified app shell + admin nav,
// provider FX transparency, Brand Launch Campaigns, logo replacement.
//
// No real-money transaction, no provider call that moves funds, no browser
// automation: service-level and route/component-level assertions only.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { MongoClient, type Db } from 'mongodb';
import { v4 as uuidv4 } from 'uuid';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { COLLECTIONS } from '@/lib/db/collections';
import type { Actor } from '@/lib/types';

vi.mock('nodemailer', () => ({ createTransport: () => ({ sendMail: async () => ({ messageId: 't' }) }) }));

import { categoryVisual, CATEGORY_VISUALS } from '@/lib/constants/categoryIcons';
import { USER_NAV_GROUPS, ADMIN_NAV_GROUPS, isNavItemActive, navPathOf } from '@/lib/constants/navigation';
import { WAVELEAD_LOGO_SRC, WAVELEAD_LOGO_ASPECT } from '@/components/brand/BrandLogo';
import {
  parseCaptureResponseFx, parseCaptureLookupFx, parseRefundFx, parsePayoutItemFx, parseWebhookFx, parseQuoteResponseFx,
} from '@/lib/services/payments/paypalFx';
import { providerFxService, FX_SOURCE_LABELS, fxSourceLabel } from '@/lib/services/fx/providerFxService';
import { brandCampaignService, CAMPAIGN_STATUSES, APPLICATION_STATUSES } from '@/lib/services/brandCampaignService';
import { brandCampaignRepo } from '@/lib/repositories/brandCampaignRepo';
import { BRAND_PRO_AMOUNT_MINOR, BRAND_PRO_TERM_DAYS } from '@/lib/services/brandProService';

const RUN = `m18-${Date.now()}${Math.floor(Math.random() * 1e5)}`;
const REPO = path.resolve(__dirname, '..');
const src = (p: string) => readFileSync(path.join(REPO, p), 'utf8');

async function withDb<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  const client = new MongoClient(process.env.MONGO_URL || 'mongodb://localhost:27017');
  await client.connect();
  try { return await fn(client.db(process.env.DB_NAME || 'wavelead')); } finally { await client.close(); }
}
function actorFor(id: string): Actor {
  return { user: { id, email: `${id}@t.local`, display_name: 'T', role: 'user', is_active: true }, session: { user_id: id, jti: 't', role: 'user', iat: 0, exp: 0 }, role: 'user' } as unknown as Actor;
}
async function seedUser(db: Db): Promise<string> {
  const id = uuidv4();
  await db.collection(COLLECTIONS.USERS).insertOne({ id, email: `${RUN}-${id.slice(0, 8)}@t.local`, display_name: RUN, role: 'user', is_active: true, is_email_verified: true, password_hash: 'x', created_at: new Date(), updated_at: new Date() } as never);
  return id;
}
async function seedChannel(db: Db, ownerId: string, status = 'approved'): Promise<string> {
  const id = uuidv4();
  await db.collection(COLLECTIONS.CHANNELS).insertOne({
    id, slug: `${RUN}-${id.slice(0, 8)}`, name: `Ch ${RUN}`,
    whatsapp_url: `https://whatsapp.com/channel/${id.replace(/-/g, '').slice(0, 22)}`,
    whatsapp_channel_id: id.replace(/-/g, '').slice(0, 22),
    short_description: 'x', country_code: 'SA', primary_language: 'ar', category_id: null,
    owner_id: ownerId, submitted_by: ownerId, status, verification_status: 'verified',
    activation_status: 'active', follower_count: 1200, created_at: new Date(), updated_at: new Date(),
  } as never);
  return id;
}
const campaignInput = {
  name: `Ramadan Launch ${RUN}`, brand_name: 'Acme MENA', objective: 'Drive app installs',
  brief: 'We want WhatsApp channel owners in the Gulf to promote our shopping app during Ramadan.',
  target_country_codes: ['Saudi Arabia', 'AE', 'zz-unknown'], target_category_slugs: ['affiliate-shopping'],
  budget_total_usd_minor: 500_000, materials_url: 'https://drive.google.com/file/abc',
};

afterAll(async () => {
  await withDb(async (db) => {
    const rx = new RegExp(RUN);
    const camps = await db.collection(COLLECTIONS.BRAND_CAMPAIGNS).find({ name: rx }).project({ id: 1 }).toArray();
    const ids = camps.map((c) => (c as unknown as { id: string }).id);
    await db.collection(COLLECTIONS.BRAND_CAMPAIGN_APPLICATIONS).deleteMany({ campaign_id: { $in: ids } });
    await db.collection(COLLECTIONS.BRAND_CAMPAIGNS).deleteMany({ name: rx });
    await db.collection(COLLECTIONS.CHANNELS).deleteMany({ slug: rx });
    await db.collection(COLLECTIONS.USERS).deleteMany({ email: rx });
    await db.collection(COLLECTIONS.PROVIDER_FX_SNAPSHOTS).deleteMany({ provider_object_id: rx });
  });
});

/* ------------------------------------------------------------------ UI --- */
describe('M18 UI system', () => {
  it('1. category icon mapping exists, is total, and slugs/SEO are preserved', () => {
    expect(Object.keys(CATEGORY_VISUALS).length).toBeGreaterThan(20);
    for (const slug of ['affiliate-shopping', 'deals-discounts', 'product-recommendations', 'music', 'sports', 'news', 'entertainment']) {
      expect(CATEGORY_VISUALS[slug], slug).toBeTruthy();
    }
    // Unmapped / future categories still resolve (never throws, never undefined).
    expect(categoryVisual('brand-new-category', 'Travel Bargains').icon).toBeTruthy();
    expect(categoryVisual(null, null).icon).toBeTruthy();
    expect(categoryVisual('', 'Coupons & Vouchers').icon).toBeTruthy();

    const page = src('app/categories/page.tsx');
    expect(page).toContain('categoryVisual');
    expect(page).toContain('data-testid="category-grid"');
    expect(page).toContain('/category/${cat.slug}');           // URLs unchanged
    expect(page).toContain("alternates: { canonical: '/categories' }");  // SEO unchanged
    expect(page).toContain('aria-label');                       // accessible labels
    expect(page).toMatch(/channel_count/);                      // count still shown
    // No heavy per-category imagery was introduced.
    expect(page).not.toMatch(/<img|next\/image/);
  });

  it('2. unified AppShell for user AND admin, with correct active state', () => {
    const shell = src('components/layout/AppShell.tsx');
    expect(shell).toContain('data-testid="app-sidebar"');
    expect(shell).toContain('data-testid="app-topbar"');
    expect(shell).toContain('data-testid="app-main"');
    expect(shell).toContain('data-testid="app-nav-toggle"');    // mobile drawer
    expect(shell).toContain('max-w-6xl');                       // one content width
    expect(shell).toContain("aria-current={active ? 'page' : undefined}");

    // Both trees mount the SAME shell.
    expect(src('app/dashboard/layout.tsx')).toContain('AppShell');
    expect(src('app/dashboard/layout.tsx')).toContain('USER_NAV_GROUPS');
    expect(src('app/admin/layout.tsx')).toContain('AppShell');
    expect(src('app/admin/layout.tsx')).toContain('ADMIN_NAV_GROUPS');

    // Active-state resolution.
    expect(isNavItemActive({ href: '/dashboard', label: 'x', icon: 'i', prefix: false }, '/dashboard')).toBe(true);
    expect(isNavItemActive({ href: '/dashboard', label: 'x', icon: 'i', prefix: false }, '/dashboard/billing')).toBe(false);
    expect(isNavItemActive({ href: '/dashboard/channels', label: 'x', icon: 'i' }, '/dashboard/channels/abc')).toBe(true);
    expect(isNavItemActive({ href: '/admin/channels?status=pending_review', label: 'x', icon: 'i' }, '/admin/channels')).toBe(true);
    expect(navPathOf('/admin/claims?status=pending')).toBe('/admin/claims');
  });

  it('3. admin sidebar replaces the multi-row menu, keeps RBAC, and only uses real routes', () => {
    // Grouped sidebar per the requested information architecture.
    expect(ADMIN_NAV_GROUPS.map((g) => g.label)).toEqual(['Overview', 'Channels', 'Marketplace', 'Finance', 'Commercial', 'System']);
    // Every admin item declares a minimum role, and the layout filters by it.
    for (const g of ADMIN_NAV_GROUPS) for (const i of g.items) expect(i.min_role, i.href).toBeTruthy();
    expect(src('app/admin/layout.tsx')).toContain('hasAtLeastRole(actor.user');
    expect(ADMIN_NAV_GROUPS.flatMap((g) => g.items).find((i) => i.href === '/admin/settings/paypal')?.min_role).toBe('super_admin');

    // Every href resolves to a real route file.
    for (const g of [...ADMIN_NAV_GROUPS, ...USER_NAV_GROUPS]) {
      for (const i of g.items) {
        const p = navPathOf(i.href).replace(/^\//, '');
        const exists = existsSync(path.join(REPO, 'app', p, 'page.tsx'));
        expect(exists, `${i.href} must exist`).toBe(true);
      }
    }
    // The old horizontal nav is no longer rendered anywhere.
    const adminPages = ['app/admin/page.tsx', 'app/admin/users/page.tsx', 'app/admin/payments/page.tsx', 'app/admin/fx-rates/page.tsx'];
    for (const f of adminPages) {
      expect(src(f)).not.toContain('<AdminNav');
      expect(src(f)).not.toContain('<Header />');
    }
  });

  it('4. user/brand/owner navigation uses the established, non-colliding terminology', () => {
    const labels = USER_NAV_GROUPS.flatMap((g) => g.items.map((i) => i.label));
    expect(labels).toContain('Incoming Requests');
    expect(labels).toContain('Sent Requests');
    expect(labels).toContain('Active Sponsorships');
    expect(labels).toContain('Campaign Opportunities');
    expect(labels).toContain('Campaign Applications');
    // Ambiguous legacy naming is gone.
    expect(labels).not.toContain('My Sponsorships');
    expect(labels).not.toContain('My Sponsorship Requests');
    expect(labels).not.toContain('Sponsorship Requests');
    // Campaigns are a separate group from direct sponsorship requests.
    const groups = USER_NAV_GROUPS.map((g) => g.label);
    expect(groups).toContain('Sponsorships');
    expect(groups).toContain('Campaigns');
  });

  it('5. shared primitives exist and are actually reused', () => {
    const kit = src('components/appkit/index.tsx');
    for (const c of ['PageHeader', 'SectionCard', 'StatCard', 'DataTable', 'TableToolbar', 'EmptyState', 'StatusBadge', 'InfoBanner', 'WarningBanner', 'FormSection', 'SectionTabs', 'fieldClass']) {
      expect(kit, c).toContain(`export function ${c}`.replace('export function fieldClass', 'export const fieldClass'));
    }
    for (const f of ['app/admin/campaigns/page.tsx', 'app/dashboard/campaigns/CampaignsClient.tsx', 'app/admin/fx-rates/FxProviderPanel.tsx']) {
      expect(src(f), f).toContain("@/components/appkit");
    }
  });
});

/* ------------------------------------------------------------------ FX --- */
describe('M18 provider FX transparency', () => {
  const capture = {
    purchase_units: [{ payments: { captures: [{ id: 'CAP1', seller_receivable_breakdown: { exchange_rate: { source_currency: 'USD', target_currency: 'IDR', value: '15850.123456' } } }] } }],
  };

  it('6. PayPal parsers read the correct paths for capture, refund and payout', () => {
    const cap = parseCaptureResponseFx(capture, 'sandbox');
    expect(cap).toHaveLength(1);
    expect(cap[0].rate_value).toBe('15850.123456');          // decimal string preserved
    expect(cap[0].source).toBe('provider_settlement');
    expect(cap[0].provider_payload_path).toBe('purchase_units[0].payments.captures[0].seller_receivable_breakdown.exchange_rate');

    expect(parseCaptureLookupFx({ id: 'C2', seller_receivable_breakdown: { exchange_rate: { source_currency: 'USD', target_currency: 'IDR', value: '16000' } } })[0].provider_payload_path)
      .toBe('seller_receivable_breakdown.exchange_rate');

    // Refunds use a DIFFERENT path than captures.
    const ref = parseRefundFx({ id: 'R1', seller_payable_breakdown: { net_amount_breakdown: [{ exchange_rate: { source_currency: 'USD', target_currency: 'IDR', value: '15900' } }] } });
    expect(ref[0].provider_payload_path).toBe('seller_payable_breakdown.net_amount_breakdown[0].exchange_rate');

    // Payout items use yet another shape.
    const po = parsePayoutItemFx({ payout_item_id: 'PI1', currency_conversion: { exchange_rate: '15750.5', from_amount: { currency: 'USD' }, to_amount: { currency: 'IDR' } } });
    expect(po?.source_currency).toBe('USD');
    expect(po?.target_currency).toBe('IDR');
    expect(po?.rate_value).toBe('15750.5');

    // Webhook dispatcher picks the right family.
    expect(parseWebhookFx({ event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: { id: 'C3', seller_receivable_breakdown: { exchange_rate: { source_currency: 'USD', target_currency: 'IDR', value: '1' } } } })).toHaveLength(1);
    expect(parseWebhookFx({ event_type: 'PAYMENT.CAPTURE.PENDING', resource: { id: 'C4' } })).toHaveLength(0);
  });

  it('7. nothing is invented: same-currency / missing / malformed FX yields no snapshot', () => {
    expect(parseCaptureResponseFx({ purchase_units: [{ payments: { captures: [{ id: 'x', seller_receivable_breakdown: {} }] } }] })).toEqual([]);
    expect(parseCaptureResponseFx({})).toEqual([]);
    expect(parseCaptureResponseFx(null)).toEqual([]);
    expect(parseRefundFx({ id: 'r', seller_payable_breakdown: { net_amount_breakdown: [] } })).toEqual([]);
    expect(parsePayoutItemFx({ payout_item_id: 'p', currency_conversion: { exchange_rate: 'not-a-number', from_amount: { currency: 'USD' }, to_amount: { currency: 'IDR' } } })).toBeNull();
    expect(parseCaptureLookupFx({ id: 'c', seller_receivable_breakdown: { exchange_rate: { source_currency: 'USD', target_currency: 'IDR' } } })).toEqual([]);
  });

  it('8. source labelling never mislabels a manual rate as PayPal; quote expiry is modelled', () => {
    expect(FX_SOURCE_LABELS.manual_reference).toBe('Manual Admin Reference Rate');
    expect(FX_SOURCE_LABELS.provider_settlement).toBe('PayPal Settlement Rate (Actual)');
    expect(FX_SOURCE_LABELS.provider_quote).toBe('PayPal Quote');
    expect(FX_SOURCE_LABELS.manual_reference).not.toMatch(/paypal/i);
    expect(fxSourceLabel('nonsense')).toBe('Unknown source');

    const quote = parseQuoteResponseFx({ quote_id: 'Q1', quote_items: [{ base_currency: 'USD', quote_currency: 'IDR', rate: '15800', expiry_time: '2030-01-01T00:00:00Z', rate_refresh_time: '2029-12-31T21:00:00Z' }] });
    expect(quote[0].source).toBe('provider_quote');
    expect(quote[0].expiry_time).toBeInstanceOf(Date);

    const panel = src('app/admin/fx-rates/FxProviderPanel.tsx');
    expect(panel).toContain('data-testid="fx-source-label"');
    expect(panel).toContain('testId="fx-status"');
    expect(panel).toContain('testId="fx-capability-status"');
    expect(panel).toContain('PROVIDER LIMITATION');
    expect(src('app/admin/fx-rates/page.tsx')).toContain('<FxProviderPanel />');
  });

  it('9. snapshots are append-only, idempotent and immutable; manual fallback is explicit', async () => {
    const obs = parseCaptureResponseFx({
      purchase_units: [{ payments: { captures: [{ id: `${RUN}-CAP`, seller_receivable_breakdown: { exchange_rate: { source_currency: 'USD', target_currency: 'IDR', value: '15999.5' } } }] } }],
    }, 'sandbox');
    const first = await providerFxService.recordObservations(obs, { purpose: 'test' });
    const replay = await providerFxService.recordObservations(obs, { purpose: 'test' });
    expect(first).toBe(1);
    expect(replay).toBe(0);                         // webhook replay writes nothing new

    const ref = await providerFxService.currentReference('USD', 'IDR');
    expect(['provider_settlement', 'provider_quote', 'manual_reference']).toContain(ref.source);
    expect(ref.source_label).toBe(FX_SOURCE_LABELS[ref.source]);
    if (ref.source === 'manual_reference') expect(ref.note).toMatch(/NOT a PayPal rate|planning/);

    // There is no update/delete path on the audit repo — history cannot be rewritten.
    const repoSrc = src('lib/repositories/providerFxSnapshotRepo.ts');
    expect(repoSrc).not.toMatch(/updateOne|updateMany|deleteOne|deleteMany|findOneAndUpdate/);
  });
});

/* ------------------------------------------------------------ CAMPAIGNS --- */
describe('M18 Brand Launch Campaigns', () => {
  it('10. brand creates a draft, opens it, and a creator sees + applies with an owned channel', async () => {
    await withDb(async (db) => {
      const brand = await seedUser(db);
      const creator = await seedUser(db);
      const stranger = await seedUser(db);
      const channel = await seedChannel(db, creator);

      const draft = await brandCampaignService.createDraft(actorFor(brand), campaignInput);
      expect(draft.status).toBe('draft');
      expect(draft.brand_user_id).toBe(brand);
      expect(draft.target_country_codes).toEqual(['SA', 'AE']);    // canonical ISO, junk dropped
      expect(draft.budget_history).toEqual([]);

      // Not visible while it is a draft.
      expect((await brandCampaignService.listOpportunities()).some((c) => c.id === draft.id)).toBe(false);
      const open = await brandCampaignService.open(actorFor(brand), draft.id);
      expect(open.status).toBe('open');
      expect((await brandCampaignService.listOpportunities()).some((c) => c.id === draft.id)).toBe(true);

      const app = await brandCampaignService.apply(actorFor(creator), draft.id, {
        channel_id: channel, proposed_rate_usd_minor: 25_000, pitch: 'My channel is a strong fit for Gulf shopping offers.',
      });
      expect(app.status).toBe('applied');
      expect(app.marketplace_order_id).toBeNull();

      // Unrelated user cannot apply with someone else's channel.
      await expect(brandCampaignService.apply(actorFor(stranger), draft.id, {
        channel_id: channel, pitch: 'Let me use a channel that is not mine at all.',
      })).rejects.toMatchObject({ status: 403 });

      // Duplicate application by the same channel is blocked.
      await expect(brandCampaignService.apply(actorFor(creator), draft.id, {
        channel_id: channel, pitch: 'Trying to apply a second time with the same channel.',
      })).rejects.toMatchObject({ status: 409 });

      // Brand cannot apply to its own campaign; only the owner can manage it.
      await expect(brandCampaignService.getForBrand(actorFor(stranger), draft.id)).rejects.toMatchObject({ status: 403 });
    });
  });

  it('11. shortlist / reject / approve are brand-only, create NO payment, and expose Continue to Booking', async () => {
    await withDb(async (db) => {
      const brand = await seedUser(db);
      const creator = await seedUser(db);
      const stranger = await seedUser(db);
      const channel = await seedChannel(db, creator);
      const c = await brandCampaignService.createDraft(actorFor(brand), campaignInput);
      await brandCampaignService.open(actorFor(brand), c.id);
      const app = await brandCampaignService.apply(actorFor(creator), c.id, { channel_id: channel, pitch: 'Strong audience match for this campaign brief.' });

      await expect(brandCampaignService.decide(actorFor(stranger), app.id, 'approved')).rejects.toMatchObject({ status: 403 });

      const short = await brandCampaignService.decide(actorFor(brand), app.id, 'shortlisted');
      expect(short.status).toBe('shortlisted');
      const approved = await brandCampaignService.decide(actorFor(brand), app.id, 'approved');
      expect(approved.status).toBe('approved');

      // Approval created no order and no payment of any kind.
      const stored = await brandCampaignRepo.findApplication(app.id);
      expect(stored!.marketplace_order_id).toBeNull();
      const paymentsForUser = await db.collection(COLLECTIONS.MARKETPLACE_ORDERS).countDocuments({ buyer_user_id: brand });
      expect(paymentsForUser).toBe(0);

      const handoff = await brandCampaignService.continueToBooking(actorFor(brand), app.id);
      expect(handoff.payment_created).toBe(false);
      expect(handoff.existing_order_id).toBeFalsy();
      expect(handoff.booking_url).toContain('/book?campaign=');
      // Repeated continuation is stable (still no duplicate booking).
      const again = await brandCampaignService.continueToBooking(actorFor(brand), app.id);
      expect(again.booking_url).toBe(handoff.booking_url);

      // The campaign domain never imports a payment provider.
      const svc = src('lib/services/brandCampaignService.ts');
      // No provider dependency of any kind leaks into the campaign domain.
      expect(svc).not.toMatch(/paypalProvider|paypalConfigService|api-m\.paypal|providerFactory|paymentProvider/i);
      expect(svc).not.toMatch(/createPayment|capturePayment|approve_url/i);
      // Strip comments: the header documents what is deliberately ABSENT, the
      // assertion is about executable code only.
      const code = svc.split('\n').filter((l) => !/^\s*(\/\/|\/\*\*|\*|\/\*)/.test(l)).join('\n');
      expect(code).not.toMatch(/deposit|wallet|escrow|funding_balance|top_?up/i);
    });
  });

  it('12. budget is planning-only, versioned, and can never drop below committed bookings', async () => {
    await withDb(async (db) => {
      const brand = await seedUser(db);
      const creator = await seedUser(db);
      const channel = await seedChannel(db, creator);
      const c = await brandCampaignService.createDraft(actorFor(brand), campaignInput);
      await brandCampaignService.open(actorFor(brand), c.id);
      const app = await brandCampaignService.apply(actorFor(creator), c.id, { channel_id: channel, pitch: 'Ready to deliver this campaign for your brand.' });
      await brandCampaignService.decide(actorFor(brand), app.id, 'approved');

      const up = await brandCampaignService.changeBudget(actorFor(brand), c.id, { budget_total_usd_minor: 700_000, reason: 'more inventory' });
      expect(up.budget_total_usd_minor).toBe(700_000);
      expect(up.budget_history).toHaveLength(1);
      expect(up.budget_history[0]).toMatchObject({ previous_budget_usd_minor: 500_000, new_budget_usd_minor: 700_000, changed_by: brand, reason: 'more inventory' });

      // Simulate a REAL marketplace booking created from this application.
      const orderId = uuidv4();
      await db.collection(COLLECTIONS.MARKETPLACE_ORDERS).insertOne({
        id: orderId, status: 'owner_accepted', economics_status: 'pre_payment',
        source_brand_campaign_id: c.id, source_brand_campaign_application_id: app.id,
        buyer_user_id: brand, channel_id: channel, owner_user_id: creator,
        quoted_price_minor: 300_000, currency: 'USD', snapshot: { gross_price_minor: 300_000 },
        created_at: new Date(), updated_at: new Date(),
      } as never);
      await brandCampaignRepo.updateApplication(app.id, { marketplace_order_id: orderId });

      const committed = await brandCampaignService.committedBookingValueMinor(c.id);
      expect(committed.total_minor).toBe(300_000);

      await expect(brandCampaignService.changeBudget(actorFor(brand), c.id, { budget_total_usd_minor: 100_000 }))
        .rejects.toMatchObject({ status: 409 });
      const ok = await brandCampaignService.changeBudget(actorFor(brand), c.id, { budget_total_usd_minor: 300_000 });
      expect(ok.budget_total_usd_minor).toBe(300_000);

      // Handoff now resolves the EXISTING booking — no duplicate.
      const handoff = await brandCampaignService.continueToBooking(actorFor(brand), app.id);
      expect(handoff.existing_order_id).toBe(orderId);
      expect(handoff.payment_created).toBe(false);

      await db.collection(COLLECTIONS.MARKETPLACE_ORDERS).deleteOne({ id: orderId });
    });
  });

  it('13. no deposit / wallet / funding collection is created anywhere by campaigns', async () => {
    await withDb(async (db) => {
      const names = (await db.listCollections().toArray()).map((c) => c.name);
      for (const banned of ['campaign_deposits', 'campaign_wallets', 'campaign_funding_balances', 'brand_campaign_deposits', 'campaign_deposit_ledger']) {
        expect(names, banned).not.toContain(banned);
      }
      // The isolated campaign collections are the only new ones.
      expect(COLLECTIONS.BRAND_CAMPAIGNS).toBe('brand_campaigns');
      expect(COLLECTIONS.BRAND_CAMPAIGN_APPLICATIONS).toBe('brand_campaign_applications');
      // promotion_campaigns (a different, owner-side domain) is untouched.
      expect(COLLECTIONS.PROMOTION_CAMPAIGNS).toBe('promotion_campaigns');
      expect(src('lib/services/brandCampaignService.ts')).not.toContain('PROMOTION_CAMPAIGNS');
    });
  });

  it('14. lifecycle + application statuses stay minimal and consistent', () => {
    expect([...CAMPAIGN_STATUSES]).toEqual(['draft', 'open', 'in_selection', 'active', 'completed', 'cancelled']);
    expect([...APPLICATION_STATUSES]).toEqual(['applied', 'shortlisted', 'approved', 'rejected', 'withdrawn']);
  });

  it('15. marketplace economics, Payment Protection and Brand Pro are untouched', () => {
    const mp = src('lib/services/marketplaceService.ts');
    // Campaign refs are association-only and cannot influence pricing.
    expect(mp).toContain('source_brand_campaign_application_id');
    expect(mp).toContain('Association only');
    expect(mp).toContain('findActiveBySourceCampaignApplication');   // duplicate protection
    // 90/10 economics and Payment Protection language remain.
    expect(mp).toMatch(/commission|owner_net|90/i);
    // Brand Pro contract preserved; no subscription/recurring work was added.
    expect(BRAND_PRO_AMOUNT_MINOR).toBe(1500);
    expect(BRAND_PRO_TERM_DAYS).toBe(30);
    const bp = src('lib/services/brandProService.ts');
    expect(bp).not.toMatch(/billing_plan|billing plans|\/v1\/billing\/subscriptions|subscription_id/i);
    expect(bp).toMatch(/manual/i);
  });
});

/* ---------------------------------------------------------------- LOGO --- */
describe('M18 logo replacement', () => {
  it('16. logo is the local supplied asset, correct ratio, never hotlinked', () => {
    expect(WAVELEAD_LOGO_SRC).toBe('/brand/wavelead-logo.png');
    expect(existsSync(path.join(REPO, 'public/brand/wavelead-logo.png'))).toBe(true);
    const bytes = readFileSync(path.join(REPO, 'public/brand/wavelead-logo.png'));
    expect(bytes.length).toBeGreaterThan(10_000);
    expect(bytes.subarray(0, 4).toString('hex')).toBe('89504e47');       // real PNG
    expect(Math.round(WAVELEAD_LOGO_ASPECT * 100) / 100).toBe(3);         // 2172x724
    const cmp = src('components/brand/BrandLogo.tsx');
    expect(cmp).toContain("width: 'auto'");                               // never stretched
    expect(cmp).toContain('alt="WaveLead"');
  });

  it('17. every branded surface uses it, and no temporary external asset URL is referenced', () => {
    for (const f of ['components/layout/Header.tsx', 'components/layout/Footer.tsx', 'components/layout/AppShell.tsx', 'app/login/page.tsx', 'app/signup/page.tsx']) {
      expect(src(f), f).toContain('BrandLogo');
    }
    const layout = src('app/layout.tsx');
    expect(layout).toContain("images: [{ url: '/brand/wavelead-logo.png'");
    expect(layout).toContain("icons: { icon: '/brand/wavelead-logo.png'");
    // No ChatGPT/temporary signed asset hotlink anywhere in the app source.
    for (const f of ['components/brand/BrandLogo.tsx', 'components/layout/Header.tsx', 'components/layout/Footer.tsx', 'components/layout/AppShell.tsx', 'app/layout.tsx']) {
      expect(src(f), f).not.toMatch(/chatgpt\.com|backend-api|oaiusercontent|drive\.google\.com/i);
    }
  });
});
