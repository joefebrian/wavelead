// M17 — targeted tests: countries, Fast Owner Verification, Manual path,
// Brand Pro Founding Beta, Founding-Lifetime intent, GA4 consent gating,
// SEO/AEO/GEO and affiliate categories.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { MongoClient, type Db } from 'mongodb';
import { v4 as uuidv4 } from 'uuid';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { COLLECTIONS } from '@/lib/db/collections';
import type { Actor, Channel } from '@/lib/types';

vi.mock('nodemailer', () => ({ createTransport: () => ({ sendMail: async () => ({ messageId: 't' }) }) }));

import { COUNTRIES, COUNTRY_COUNT, COUNTRY_OPTIONS, countryByCode, countryBySlug, normalizeCountryCode } from '@/lib/constants/countries';
import { ownerVerificationService, ownerIdentitySchema } from '@/lib/services/ownerVerificationService';
import { brandProService, BRAND_PRO_AMOUNT_MINOR, BRAND_PRO_TERM_DAYS, BRAND_PRO_PURPOSE } from '@/lib/services/brandProService';
import { affiliateCategoryService } from '@/lib/services/affiliateCategoryService';
import { AFFILIATE_CATEGORIES } from '@/lib/constants/affiliateCategories';
import { faqSchema, organizationSchema, webSiteSchema, breadcrumbSchema, itemListSchema, WAVELEAD_CORE_QA, WAVELEAD_INDEPENDENCE_DISCLAIMER } from '@/lib/seo/structuredData';
import { evidenceItemSchema } from '@/lib/validation/claimSchemas';
import { ownerPayoutMethodRepo } from '@/lib/repositories/marketplaceRepo';

const RUN = `m17-${Date.now()}${Math.floor(Math.random() * 1e5)}`;
const REPO = path.resolve(__dirname, '..');
const src = (p: string) => readFileSync(path.join(REPO, p), 'utf8');
const DAY = 24 * 3600 * 1000;

async function withDb<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  const client = new MongoClient(process.env.MONGO_URL || 'mongodb://localhost:27017');
  await client.connect();
  try { return await fn(client.db(process.env.DB_NAME || 'wavelead')); } finally { await client.close(); }
}
function actorFor(id: string, role: 'user' | 'admin' = 'user'): Actor {
  return { user: { id, email: `${id}@t.local`, display_name: 'T', role, is_active: true }, session: { user_id: id, jti: 't', role, iat: 0, exp: 0 }, role } as unknown as Actor;
}
async function seedUser(db: Db, role: 'user' | 'admin' = 'user'): Promise<string> {
  const id = uuidv4();
  await db.collection(COLLECTIONS.USERS).insertOne({ id, email: `${RUN}-${id.slice(0, 8)}@t.local`, display_name: `${RUN}`, role, is_active: true, is_email_verified: true, password_hash: 'x', created_at: new Date(), updated_at: new Date() } as never);
  return id;
}
async function seedChannel(db: Db, submitterId: string, status = 'approved'): Promise<Channel> {
  const id = uuidv4(); const now = new Date();
  const doc = {
    id, slug: `${RUN}-${id.slice(0, 8)}`, name: `Ch ${RUN}`,
    whatsapp_url: `https://whatsapp.com/channel/${id.replace(/-/g, '').slice(0, 22)}`,
    whatsapp_channel_id: id.replace(/-/g, '').slice(0, 22),
    short_description: 'x', country_code: 'SA', primary_language: 'ar', category_id: null,
    owner_id: null, submitted_by: submitterId, status,
    verification_status: 'unclaimed', activation_status: 'not_required',
    follower_count: 10, created_at: now, updated_at: now, published_at: now, is_test_fixture: true,
  };
  await db.collection(COLLECTIONS.CHANNELS).insertOne(doc as never);
  return doc as unknown as Channel;
}
async function finalizedActivation(db: Db, channelId: string, userId: string) {
  const now = new Date();
  await db.collection(COLLECTIONS.CHANNEL_ACTIVATION_PAYMENTS).insertOne({
    id: uuidv4(), channel_id: channelId, owner_user_id: userId, purpose: 'CHANNEL_OWNER_ACTIVATION',
    verification_flow: 'fast', provider: 'paypal', provider_environment: 'sandbox', currency: 'USD',
    gross_amount_minor: 100, amount_captured_minor: 100, amount_refunded_minor: 0,
    provider_fee_minor: 5, provider_net_minor: 95, status: 'captured_finalized',
    provider_order_id: 'ORD-TEST-1', provider_capture_id: 'CAP-TEST-1',
    captured_at: now, finalized_at: now, created_at: now, updated_at: now,
  } as never);
}
const identityInput = {
  full_legal_name: 'Test Owner', country_code: 'SA', city: 'Riyadh',
  email: `${RUN}-owner@t.local`, mobile_number: '+966500000000',
  role_in_channel: 'owner', company_name: '', declaration_accepted: true,
};

beforeAll(() => { process.env.SMTP_HOST = 'smtp.test.local'; });
afterAll(async () => {
  await withDb(async (db) => {
    const rx = new RegExp(RUN);
    await db.collection(COLLECTIONS.USERS).deleteMany({ email: rx });
    await db.collection(COLLECTIONS.CHANNELS).deleteMany({ slug: rx });
    await db.collection(COLLECTIONS.CHANNEL_ACTIVATION_PAYMENTS).deleteMany({ provider_order_id: 'ORD-TEST-1' });
    await db.collection(COLLECTIONS.OWNER_IDENTITY_PROFILES).deleteMany({ email: rx });
    await db.collection(COLLECTIONS.BRAND_PRO_MEMBERSHIPS).deleteMany({ user_id: { $exists: true }, provider_environment: 'test-m17' });
  });
});

// ------------------------------- COUNTRIES ---------------------------------
describe('M17 §1 countries', () => {
  it('1-5. canonical global dataset with Saudi Arabia, code SA, stable slug, selector coverage', () => {
    expect(COUNTRY_COUNT).toBeGreaterThan(200);
    const sa = COUNTRIES.find((c) => c.name === 'Saudi Arabia');
    expect(sa).toBeTruthy();
    expect(sa!.code).toBe('SA');
    expect(sa!.slug).toBe('saudi-arabia');
    expect(countryByCode('SA')?.name).toBe('Saudi Arabia');
    expect(countryBySlug('saudi-arabia')?.code).toBe('SA');
    expect(COUNTRY_OPTIONS.some((o) => o.value === 'SA')).toBe(true);
    // Other requested examples resolve too.
    expect(countryBySlug('united-arab-emirates')?.code).toBe('AE');
    expect(countryBySlug('indonesia')?.code).toBe('ID');
    expect(countryBySlug('united-states')?.code).toBe('US');
    expect(countryBySlug('united-kingdom')?.code).toBe('GB');
  });

  it('6. legacy values remain readable (names, codes, old slugs, aliases)', () => {
    expect(normalizeCountryCode('ID')).toBe('ID');
    expect(normalizeCountryCode('Indonesia')).toBe('ID');
    expect(normalizeCountryCode('united-kingdom')).toBe('GB');
    expect(normalizeCountryCode('UK')).toBe('GB');
    expect(normalizeCountryCode('KSA')).toBe('SA');
    expect(normalizeCountryCode('Czech Republic')).toBe('CZ');
    expect(normalizeCountryCode('nonsense-xyz')).toBeNull();
  });

  it('3b & 7-8. ONE shared source — no duplicated hard-coded lists on country surfaces', () => {
    // M17.1 — the owner-facing country control moved into the shared
    // searchable combobox, which itself resolves the canonical dataset.
    for (const f of ['app/submit/page.tsx', 'app/country/[slug]/page.tsx', 'components/forms/CountryCombobox.tsx']) {
      expect(src(f)).toContain('@/lib/constants/countries');
    }
    expect(src('app/countries/page.tsx')).toContain('getCountryCounts');
    // Unique slugs/codes — no ambiguity in routing.
    expect(new Set(COUNTRIES.map((c) => c.slug)).size).toBe(COUNTRIES.length);
    expect(new Set(COUNTRIES.map((c) => c.code)).size).toBe(COUNTRIES.length);
  });
});

// --------------------- FAST OWNER VERIFICATION ($1) ------------------------
describe('M17 §2 fast owner verification', () => {
  it('1 & 2. listing must be approved; unrelated user blocked', async () => {
    await withDb(async (db) => {
      const submitter = await seedUser(db);
      const stranger = await seedUser(db);
      const pending = await seedChannel(db, submitter, 'pending');
      await expect(ownerVerificationService.startFastVerification(actorFor(submitter), pending.id))
        .rejects.toMatchObject({ status: 409 });
      const approved = await seedChannel(db, submitter, 'approved');
      await expect(ownerVerificationService.startFastVerification(actorFor(stranger), approved.id))
        .rejects.toMatchObject({ status: 403 });
    });
  });

  it('3-9. payment alone never verifies; identity + declaration + payout finalize it', async () => {
    await withDb(async (db) => {
      const submitter = await seedUser(db);
      const ch = await seedChannel(db, submitter, 'approved');
      // 3 — reuses the EXISTING $1 activation payment domain.
      expect(ownerVerificationService.FAST_AMOUNT_MINOR).toBe(100);
      expect(ownerVerificationService.FAST_CURRENCY).toBe('USD');
      await finalizedActivation(db, ch.id, submitter);

      // 4 & 5 — finalized payment + incomplete identity → NOT verified.
      let r = await ownerVerificationService.finalizeIfComplete(submitter, ch.id);
      expect(r.verified).toBe(false);
      expect(r.blocked_by).toContain('identity');
      let st = await ownerVerificationService.getState(actorFor(submitter), ch.id);
      expect(st.step).toBe('identity_required');
      let fresh = await db.collection(COLLECTIONS.CHANNELS).findOne({ id: ch.id });
      expect(fresh!.verification_status).toBe('unclaimed');
      expect(fresh!.activation_status).not.toBe('active');

      // 6 & 7 — identity fields + declaration enforced.
      expect(ownerIdentitySchema.safeParse({ ...identityInput, full_legal_name: '' }).success).toBe(false);
      expect(ownerIdentitySchema.safeParse({ ...identityInput, city: '' }).success).toBe(false);
      expect(ownerIdentitySchema.safeParse({ ...identityInput, mobile_number: '' }).success).toBe(false);
      expect(ownerIdentitySchema.safeParse({ ...identityInput, declaration_accepted: false }).success).toBe(false);
      expect(ownerIdentitySchema.safeParse(identityInput).success).toBe(true);

      await ownerVerificationService.submitIdentity(actorFor(submitter), ch.id, identityInput);
      // 8 — payout still missing → still not verified.
      r = await ownerVerificationService.finalizeIfComplete(submitter, ch.id);
      expect(r.verified).toBe(false);
      expect(r.blocked_by).toContain('payout');
      st = await ownerVerificationService.getState(actorFor(submitter), ch.id);
      expect(st.step).toBe('payout_required');

      // Configure payout destination (existing external payout architecture).
      await ownerPayoutMethodRepo.insert({
        id: uuidv4(), owner_user_id: submitter, method: 'paypal',
        paypal_email_normalized: `${RUN}-payout@t.local`, paypal_email_display: `${RUN}-payout@t.local`,
        is_active: true, verified_at: null, verification_code_hash: null, verification_sent_at: null,
        verification_attempts: 0, created_at: new Date(), updated_at: new Date(),
      } as never);

      // 9 & 10 — everything complete → verified, active, owner assigned, no
      // second admin ownership approval anywhere in the path.
      r = await ownerVerificationService.finalizeIfComplete(submitter, ch.id);
      expect(r.verified).toBe(true);
      fresh = await db.collection(COLLECTIONS.CHANNELS).findOne({ id: ch.id });
      expect(fresh!.verification_status).toBe('verified');
      expect(fresh!.activation_status).toBe('active');
      expect(fresh!.owner_id).toBe(submitter);
      const audit = await db.collection(COLLECTIONS.AUDIT_LOGS).findOne({ entity_id: ch.id, action: 'owner_fast_verification_completed' });
      expect(audit).toBeTruthy();
      expect((audit as unknown as { after_data: { second_admin_approval_required: boolean } }).after_data.second_admin_approval_required).toBe(false);
    });
  });

  it('11 & 12. browser return alone grants nothing; capture finalization cannot auto-activate a fast row', () => {
    const svc = src('lib/services/channelActivationService.ts');
    // The shared capture pipeline explicitly refuses to activate fast rows.
    expect(svc).toContain("verification_flow?: string }).verification_flow === 'fast'");
    const route = src('app/api/[[...path]]/route.ts');
    expect(route).toContain('NON-AUTHORITATIVE for Owner Verified');
    // Duplicate activation payment protection.
    expect(src('lib/services/ownerVerificationService.ts')).toContain("status: 'captured_finalized' } as never)");
  });

  it('13. owner identity is private — never rendered on public surfaces', () => {
    const pub = src('app/channel/[slug]/page.tsx');
    for (const leak of ['full_legal_name', 'mobile_number', 'paypal_email', 'owner_identity']) {
      expect(pub).not.toContain(leak);
    }
    expect(src('app/dashboard/channels/[id]/verify/page.tsx')).toContain('index: false');
  });
});

// ------------------------- MANUAL VERIFICATION -----------------------------
describe('M17 §3 manual verification (free)', () => {
  it('1-9. social evidence accepted, free, admin review preserved', () => {
    const social = ['instagram', 'facebook', 'tiktok', 'threads'];
    for (const t of social) {
      const parsed = evidenceItemSchema.safeParse({ evidence_type: t, evidence_url: `https://${t}.com/mybrand` });
      expect(parsed.success, `${t} evidence must be accepted`).toBe(true);
    }
    // Website evidence preserved; non-https junk rejected.
    expect(evidenceItemSchema.safeParse({ evidence_type: 'website', evidence_url: 'https://brand.com/wavelead' }).success).toBe(true);
    expect(evidenceItemSchema.safeParse({ evidence_type: 'instagram', evidence_url: 'not-a-url' }).success).toBe(false);
    // No payment anywhere in the claim path; admin review still required.
    const claimSvc = src('lib/services/claimService.ts');
    expect(claimSvc).not.toContain('ACTIVATION_AMOUNT_MINOR');
    expect(claimSvc).not.toContain('startFastVerification');
    expect(src('lib/services/claimModerationService.ts')).toContain('ROLES.MODERATOR');
    expect(src('app/dashboard/channels/[id]/verify/VerifyClient.tsx')).toContain('Manual Verification');
  });
});

// ------------------------------ BRAND PRO ----------------------------------
describe('M17 §4 Brand Pro Founding Beta', () => {
  it('1 & 2. server price 1500 USD minor, 30-day term, isolated purpose', () => {
    expect(BRAND_PRO_AMOUNT_MINOR).toBe(1500);
    expect(BRAND_PRO_TERM_DAYS).toBe(30);
    expect(BRAND_PRO_PURPOSE).toBe('BRAND_PRO_FOUNDING_BETA_TERM');
    const svc = src('lib/services/brandProService.ts');
    expect(svc).not.toContain('CHANNEL_OWNER_ACTIVATION');
    expect(svc).not.toContain('BRAND_FOUNDING_LIFETIME');
    expect(svc).not.toContain('MARKETPLACE_ORDERS');
  });

  it('3 & 4. browser return grants nothing; only the finalized capture grants a term', () => {
    const route = src('app/api/[[...path]]/route.ts');
    expect(route).toContain('Grants access ONLY via the authoritative');
    const svc = src('lib/services/brandProService.ts');
    expect(svc).toContain("if (cap.internal_status !== 'paid')");
    expect(svc).toContain('claim.modifiedCount !== 1');
  });

  it('5-10. term arithmetic: renewal extends from period_end_at, expired starts at capture, expiry is access-only', async () => {
    await withDb(async (db) => {
      const uid = await seedUser(db);
      const g1 = await brandProService.grantTerm(uid, { order_id: `o1-${RUN}`, provider_order_id: 'O1', provider_capture_id: 'C1', provider_environment: 'test-m17', gross_amount_minor: 1500 });
      const end1 = new Date(g1.membership.period_end_at).getTime();
      expect(Math.round((end1 - Date.now()) / DAY)).toBe(30);
      expect(g1.extended).toBe(false);

      // 6 — renewal while still active extends from period_end_at (no lost days).
      const g2 = await brandProService.grantTerm(uid, { order_id: `o2-${RUN}`, provider_order_id: 'O2', provider_capture_id: 'C2', provider_environment: 'test-m17', gross_amount_minor: 1500 });
      expect(g2.extended).toBe(true);
      expect(Math.round((new Date(g2.membership.period_end_at).getTime() - end1) / DAY)).toBe(30);
      expect(g2.membership.terms_paid).toBe(2);

      // 8 & 9 — expire: premium access only, membership/payment history retained.
      await db.collection(COLLECTIONS.BRAND_PRO_MEMBERSHIPS).updateOne({ id: g2.membership.id }, { $set: { period_end_at: new Date(Date.now() - DAY) } });
      await brandProService.expireOverdue();
      const state = await brandProService.getStateForActor(actorFor(uid));
      expect(state.membership.plan).toBe('brand_free');
      expect(state.membership.status).toBe('expired');
      expect(state.auto_recurring).toBe(false);
      expect(state.renewal).toBe('manual');

      // 7 — renewal after expiry starts at capture time.
      const g3 = await brandProService.grantTerm(uid, { order_id: `o3-${RUN}`, provider_order_id: 'O3', provider_capture_id: 'C3', provider_environment: 'test-m17', gross_amount_minor: 1500 });
      expect(g3.extended).toBe(false);
      expect(Math.round((new Date(g3.membership.period_end_at).getTime() - Date.now()) / DAY)).toBe(30);
      expect(g3.membership.terms_paid).toBe(3);
      // 10 — nothing deleted.
      expect(await db.collection(COLLECTIONS.BRAND_PRO_MEMBERSHIPS).countDocuments({ user_id: uid })).toBe(1);
    });
  });

  it('11 & 12. H-7 reminder fires once per period with manual-renewal wording', async () => {
    await withDb(async (db) => {
      const uid = await seedUser(db);
      const g = await brandProService.grantTerm(uid, { order_id: `r1-${RUN}`, provider_order_id: 'R1', provider_capture_id: 'RC1', provider_environment: 'test-m17', gross_amount_minor: 1500 });
      await db.collection(COLLECTIONS.BRAND_PRO_MEMBERSHIPS).updateOne({ id: g.membership.id }, { $set: { period_end_at: new Date(Date.now() + 5 * DAY) } });
      const first = await brandProService.sendExpiryReminders();
      expect(first.sent).toBeGreaterThanOrEqual(1);
      const second = await brandProService.sendExpiryReminders();
      expect(second.sent).toBe(0);           // idempotent — never repeats
      const svc = src('lib/services/brandProService.ts');
      expect(svc).toContain('Your WaveLead Brand Pro access ends soon');
      expect(svc).toContain('renewal is manual');
      expect(svc).not.toContain('automatically renew');
    });
  });

  it('13-16. admin report totals; other payment domains untouched', async () => {
    await withDb(async (db) => {
      const admin = await seedUser(db, 'admin');
      const rep = await brandProService.adminReport(actorFor(admin, 'admin'));
      expect(rep.domain).toBe('brand_pro_founding_beta');
      expect(rep.summary).toHaveProperty('active_brand_pro');
      expect(rep.summary).toHaveProperty('expiring_within_7_days');
      expect(rep.summary).toHaveProperty('gross_collected_minor');
      expect(rep.price_minor).toBe(1500);
      // Masked references only.
      for (const row of rep.rows) {
        const m = row.provider_order_id_masked as string | null;
        if (m) expect(m).toContain('****');
      }
      await expect(brandProService.adminReport(actorFor(await seedUser(db)))).rejects.toMatchObject({ status: 403 });
    });
    // Domain isolation: Owner Activation / Founding Lifetime / Marketplace untouched.
    expect(src('lib/services/channelActivationService.ts')).toContain('ACTIVATION_AMOUNT_MINOR = 100');
    expect(src('lib/services/brandFoundingLifetimeService.ts')).not.toContain('BRAND_PRO_FOUNDING_BETA_TERM');
    expect(src('lib/services/marketplaceService.ts')).not.toContain('BRAND_PRO');
  });

  it('pricing page shows $15 / 30 days manual renewal and no waitlist CTA for Brand Pro', () => {
    const p = src('app/pricing/PricingClient.tsx');
    expect(p).toContain('$15 / 30 days');
    expect(p).toContain('Start Brand Pro — $15');
    expect(p).toContain('Manual renewal during Founding Beta');
    expect(p).not.toContain("openWaitlist('brand_pro')");
  });
});

// ------------------- FOUNDING LIFETIME INTENT / GA4 / SEO -------------------
describe('M17 §5 founding lifetime intent, GA4, SEO/AEO/GEO, categories', () => {
  it('FL 1-7. intent preserved through auth, dashboard fallback, no auto order', () => {
    const intent = src('lib/utils/commercialIntent.ts');
    expect(intent).toContain("founding_lifetime: '/pricing?intent=founding-lifetime#founding-lifetime'");
    expect(intent).toContain('TTL_MS');                       // stale intents expire
    const pricing = src('app/pricing/PricingClient.tsx');
    expect(pricing).toContain("rememberCommercialIntent('founding_lifetime')");
    expect(pricing).toContain('/signup?next=');
    expect(pricing).toContain('clearCommercialIntent()');     // consumed on purchase
    expect(intent).toContain('Continue to Payment');
    const card = src('components/commerce/PendingIntentCard.tsx');
    expect(card).toContain('INTENT_DESTINATION[intent]');
    expect(card).toContain('pending-intent-dismiss');
    expect(card).not.toContain('checkout');                   // never creates a payment
    expect(src('app/dashboard/page.tsx')).toContain('<PendingIntentCard />');
    // Same-origin protection preserved (M15 sanitizer untouched).
    expect(src('lib/utils/returnTo.ts')).toContain('sanitizeReturnTo');
  });

  it('GA4 1-5. consent-gated, single pageview, no sensitive payloads', () => {
    const ga = src('components/analytics/GoogleAnalytics.tsx');
    expect(ga).toContain('G-MYGZLGH4SR');
    expect(ga).toContain("analytics_storage:'denied'");
    expect(ga).toContain('if (!granted) return null');        // nothing before consent
    expect(ga).toContain("'/api/consent'");                   // existing consent system
    expect(ga).toContain('send_page_view:false');
    expect(ga).toContain('last.current === url');             // de-dupe
    expect(ga).toContain('BLOCKED_KEYS');
    expect(src('app/layout.tsx')).toContain('<GoogleAnalytics />');
    expect(src('components/consent/ConsentBanner.tsx')).toContain('wl-consent-changed');
  });

  it('SEO/AEO/GEO 1-10. sitemap, robots, noindex, canonical, JSON-LD, disclaimer', () => {
    const sm = src('app/sitemap.ts');
    expect(sm).toContain("status: 'approved'");
    expect(sm).not.toContain("'/dashboard'");
    expect(sm).not.toContain("'/admin'");
    expect(src('app/robots.txt/route.ts')).toMatch(/Sitemap|Disallow/);
    // Private surfaces are noindex.
    for (const f of ['app/dashboard/sponsorship-requests/[id]/page.tsx', 'app/dashboard/channels/[id]/verify/page.tsx', 'app/dashboard/sponsorships/page.tsx']) {
      expect(src(f)).toContain('index: false');
    }
    // Structured data serializes and is valid-shaped.
    const org = organizationSchema(); const site = webSiteSchema();
    expect(org['@type']).toBe('Organization');
    expect(site['@type']).toBe('WebSite');
    expect(JSON.parse(JSON.stringify(faqSchema(WAVELEAD_CORE_QA)))['@type']).toBe('FAQPage');
    expect(breadcrumbSchema([{ name: 'Home', path: '/' }])['@type']).toBe('BreadcrumbList');
    expect(itemListSchema('Countries', [{ name: 'Saudi Arabia', path: '/country/saudi-arabia' }])['@type']).toBe('ItemList');
    expect(WAVELEAD_CORE_QA.length).toBeGreaterThanOrEqual(9);
    expect(String(org.disambiguatingDescription)).toBe(WAVELEAD_INDEPENDENCE_DISCLAIMER);
    // Country/category landing metadata is unique per page.
    expect(src('app/country/[slug]/page.tsx')).toContain('generateMetadata');
    expect(src('app/category/[slug]/page.tsx')).toContain('generateMetadata');
  });

  it('affiliate categories 1-7. canonical set, idempotent, no duplicate taxonomy', async () => {
    const slugs = AFFILIATE_CATEGORIES.map((c) => c.slug);
    expect(slugs).toContain('affiliate-shopping');
    expect(slugs).toContain('deals-discounts');
    expect(slugs).toContain('product-recommendations');
    expect(new Set(slugs).size).toBe(slugs.length);
    const first = await affiliateCategoryService.ensure({ dryRun: true });
    const second = await affiliateCategoryService.ensure({ dryRun: true });
    expect(second.created.length).toBe(first.created.length);   // pure/no side effects
    // Overlap detection prevents near-duplicates.
    const keys = new Set(AFFILIATE_CATEGORIES.flatMap((c) => [c.slug, ...c.aliases]));
    expect(keys.has('affiliate')).toBe(true);
    expect(src('app/categories/page.tsx').length).toBeGreaterThan(100);
  });
});
