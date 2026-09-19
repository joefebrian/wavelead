// M17.1 — targeted tests only.
//
// Scope: verification-choice landing, Fast ($1) flow, Manual (free) flow,
// Founding Lifetime + Brand Pro purchase paths (no waitlist, auth → checkout
// handoff, no duplicate orders, no auto-capture) and the searchable country
// combobox. No real-money transaction: nothing here captures a payment.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { MongoClient, type Db } from 'mongodb';
import { v4 as uuidv4 } from 'uuid';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { COLLECTIONS } from '@/lib/db/collections';
import type { Actor, Channel } from '@/lib/types';

vi.mock('nodemailer', () => ({ createTransport: () => ({ sendMail: async () => ({ messageId: 't' }) }) }));

import { ownerVerificationService, ownerIdentitySchema } from '@/lib/services/ownerVerificationService';
import { BRAND_PRO_AMOUNT_MINOR, BRAND_PRO_TERM_DAYS } from '@/lib/services/brandProService';
import { brandFoundingLifetimeService } from '@/lib/services/brandFoundingLifetimeService';
import { ownerPayoutMethodRepo } from '@/lib/repositories/marketplaceRepo';
import { searchCountries, suggestedCountries, SUGGESTED_COUNTRY_CODES, COUNTRY_RESULT_LIMIT } from '@/components/forms/CountryCombobox';
import { MANUAL_EVIDENCE_FIELDS } from '@/app/dashboard/channels/[id]/verify/ManualVerificationForm';
import { COUNTRIES, COUNTRY_COUNT } from '@/lib/constants/countries';
import { consumeIntentResumeOnce, resetIntentResume, INTENT_DESTINATION } from '@/lib/utils/commercialIntent';

const RUN = `m171-${Date.now()}${Math.floor(Math.random() * 1e5)}`;
const REPO = path.resolve(__dirname, '..');
const src = (p: string) => readFileSync(path.join(REPO, p), 'utf8');
const BASE = 'http://localhost:3000/api';

const VERIFY_CLIENT = 'app/dashboard/channels/[id]/verify/VerifyClient.tsx';
const FAST_FORM = 'app/dashboard/channels/[id]/verify/FastVerificationForm.tsx';
const MANUAL_FORM = 'app/dashboard/channels/[id]/verify/ManualVerificationForm.tsx';
const VERIFY_PAGE = 'app/dashboard/channels/[id]/verify/page.tsx';
const PRICING = 'app/pricing/PricingClient.tsx';
const SUBMIT = 'app/submit/SubmitForm.tsx';
const COMBOBOX = 'components/forms/CountryCombobox.tsx';

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
    provider_order_id: `ORD-${RUN}`, provider_capture_id: `CAP-${RUN}`,
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
    await db.collection(COLLECTIONS.CHANNEL_ACTIVATION_PAYMENTS).deleteMany({ provider_order_id: `ORD-${RUN}` });
    await db.collection(COLLECTIONS.OWNER_IDENTITY_PROFILES).deleteMany({ email: rx });
  });
});

// ------------------------- VERIFICATION LANDING ----------------------------
describe('M17.1 verification', () => {
  it('1-4. Submit & verify ownership lands on the CHOICE screen; old three-method selector is not primary', () => {
    // 1 — the post-submit redirect now targets the verification hub.
    const submit = src(SUBMIT);
    expect(submit).toContain('/verify`');
    expect(submit).toContain('OWNERSHIP VERIFICATION choice screen'.toLowerCase().includes('x') ? '' : 'verify');
    // The legacy claim form is no longer the primary destination for an owner.
    expect(submit).toMatch(/dashboard\/channels\/\$\{newId\}\/verify/);

    const page = src(VERIFY_PAGE);
    expect(page).toContain('Ownership verification');
    expect(page).toContain("Choose how you&apos;d like to verify and activate ownership.");
    expect(page).toContain('index: false');            // private surface stays noindex

    const client = src(VERIFY_CLIENT);
    expect(client).toContain('data-testid="verification-choice"');
    // 2 — Fast card present with the required copy + CTA.
    expect(client).toContain('data-testid="fast-verification-card"');
    expect(client).toContain('$1 one-time');
    expect(client).toContain('Complete your owner details, payout setup and one-time $1 verification');
    expect(client).toContain('deter impersonation, spam and scam attempts');
    expect(client).toContain('Start Fast Verification — $1');
    // 3 — Manual card present, free, and NOT disabled/second-class.
    expect(client).toContain('data-testid="manual-verification-card"');
    expect(client).toContain('Manual Verification — Free');
    expect(client).toContain('Reviewed manually by WaveLead');
    expect(client).not.toMatch(/data-testid="choose-manual-verification"[^>]*disabled/);
    // 4 — the legacy Website/Domain · Official Social · Manual proof selector
    // is not rendered by the new primary surface.
    for (const legacy of ['Website / Domain', 'Official Social', 'Manual proof']) {
      expect(client).not.toContain(legacy);
      expect(src(FAST_FORM)).not.toContain(legacy);
      expect(src(MANUAL_FORM)).not.toContain(legacy);
    }
    // The legacy claim form still EXISTS for disputes / reclaims.
    expect(src('app/claim/[slug]/ClaimForm.tsx').length).toBeGreaterThan(0);
    expect(client).toContain('/claim/${channelSlug}');   // dispute path, secondary
  });

  it('5-7. fast identity fields, payout and declaration are all required', () => {
    const fast = src(FAST_FORM);
    for (const id of ['identity-name', 'identity-city', 'identity-email', 'identity-mobile', 'identity-role', 'identity-company']) {
      expect(fast, id).toContain(`data-testid="${id}"`);
    }
    expect(fast).toContain('testId="identity-country"');      // searchable combobox
    expect(fast).toContain('Authorized Representative');
    expect(fast).toContain('data-testid="payout-email"');
    expect(fast).toContain('data-testid="owner-declaration"');
    expect(fast).toContain('Continue to $1 Payment');
    // The paid path does NOT ask for social/website evidence.
    for (const leak of ['instagram', 'facebook', 'tiktok', 'threads', 'Website URL']) {
      expect(fast.toLowerCase()).not.toContain(leak.toLowerCase());
    }
    // 5 — server-side field requirements.
    expect(ownerIdentitySchema.safeParse({ ...identityInput, full_legal_name: '' }).success).toBe(false);
    expect(ownerIdentitySchema.safeParse({ ...identityInput, city: '' }).success).toBe(false);
    expect(ownerIdentitySchema.safeParse({ ...identityInput, mobile_number: '' }).success).toBe(false);
    expect(ownerIdentitySchema.safeParse({ ...identityInput, email: 'nope' }).success).toBe(false);
    // 7 — declaration is mandatory.
    expect(ownerIdentitySchema.safeParse({ ...identityInput, declaration_accepted: false }).success).toBe(false);
    expect(ownerIdentitySchema.safeParse(identityInput).success).toBe(true);
    // 6 — client blocks "Continue to $1 Payment" until payout is provided.
    expect(fast).toContain('Add the PayPal email where WaveLead should send your earnings.');
  });

  it('8-10. $1 capture + complete data → automatic Owner Verified, no second admin approval; payment alone never verifies', async () => {
    await withDb(async (db) => {
      const uid = await seedUser(db);
      const ch = await seedChannel(db, uid, 'approved');
      await finalizedActivation(db, ch.id, uid);

      // 10 — finalized payment, missing identity → NOT verified.
      let r = await ownerVerificationService.finalizeIfComplete(uid, ch.id);
      expect(r.verified).toBe(false);
      expect(r.blocked_by).toContain('identity');
      let fresh = await db.collection(COLLECTIONS.CHANNELS).findOne({ id: ch.id });
      expect(fresh!.verification_status).toBe('unclaimed');

      await ownerVerificationService.submitIdentity(actorFor(uid), ch.id, identityInput);
      // 6 — payout still missing → still NOT verified.
      r = await ownerVerificationService.finalizeIfComplete(uid, ch.id);
      expect(r.verified).toBe(false);
      expect(r.blocked_by).toContain('payout');

      await ownerPayoutMethodRepo.insert({
        id: uuidv4(), owner_user_id: uid, method: 'paypal',
        paypal_email_normalized: `${RUN}-payout@t.local`, paypal_email_display: `${RUN}-payout@t.local`,
        is_active: true, verified_at: null, verification_code_hash: null, verification_sent_at: null,
        verification_attempts: 0, created_at: new Date(), updated_at: new Date(),
      } as never);

      // 8 — everything complete → automatic Owner Verified.
      r = await ownerVerificationService.finalizeIfComplete(uid, ch.id);
      expect(r.verified).toBe(true);
      fresh = await db.collection(COLLECTIONS.CHANNELS).findOne({ id: ch.id });
      expect(fresh!.verification_status).toBe('verified');
      expect(fresh!.activation_status).toBe('active');
      expect(fresh!.owner_id).toBe(uid);
      // 9 — explicitly recorded: no second human ownership approval.
      const audit = await db.collection(COLLECTIONS.AUDIT_LOGS).findOne({ entity_id: ch.id, action: 'owner_fast_verification_completed' });
      expect((audit as unknown as { after_data: { second_admin_approval_required: boolean } }).after_data.second_admin_approval_required).toBe(false);
    });
  });

  it('11 & 12. manual form shows identity + evidence fields directly, needs human review, takes no payment', () => {
    const manual = src(MANUAL_FORM);
    for (const id of ['manual-name', 'manual-city', 'manual-email', 'manual-mobile', 'manual-role', 'manual-company']) {
      expect(manual, id).toContain(`data-testid="${id}"`);
    }
    expect(manual).toContain('testId="manual-country"');      // searchable combobox
    const evidenceKeys = MANUAL_EVIDENCE_FIELDS.map((f) => f.key);
    for (const ev of ['website', 'instagram', 'facebook', 'tiktok', 'threads', 'other']) {
      expect(evidenceKeys, ev).toContain(ev);
    }
    expect(manual).toContain('data-testid={`manual-evidence-${f.key}`}');
    expect(manual).toContain('Other Public Proof URL');
    expect(manual).toContain('data-testid="manual-note"');
    expect(manual).toContain('Tell us how you own, manage or are authorized to represent this channel.');
    expect(manual).toContain('Submit Manual Verification');
    // Human review preserved through the EXISTING claim service; no payment.
    expect(manual).toContain("verification_method: 'manual'");
    expect(manual).toContain('/api/claims/');
    expect(manual).toContain('reviewer checks your evidence');
    expect(manual).not.toContain('start-fast');
    expect(manual).not.toContain('payout');
    expect(manual).not.toMatch(/\$1/);
    // Moderator review still enforced server-side.
    expect(src('lib/services/claimModerationService.ts')).toContain('ROLES.MODERATOR');
  });
});

// ------------------------- PURCHASE PATHS ----------------------------------
describe('M17.1 Founding Lifetime & Brand Pro purchase paths', () => {
  it('13-15. lifetime: real checkout CTA, auth → checkout resume, no waitlist/reservation form', () => {
    const p = src(PRICING);
    // 15 — waitlist / reservation form is gone from the purchase path.
    expect(p).not.toContain('WaitlistDialog');
    expect(p).not.toContain('pro-waitlist');
    expect(p).not.toContain('Reserve Founding Lifetime');
    expect(p).not.toContain("You&apos;re on the list.");
    expect(p).not.toContain('openWaitlist');
    // 14 — logged-in click goes straight to the server-authoritative checkout.
    expect(p).toContain("fetch('/api/brand/founding-lifetime/checkout'");
    expect(p).toContain('data-testid="cta-brand-founding-lifetime-checkout"');
    expect(p).toContain('Get Founding Lifetime');
    // 13 — logged-out click remembers the intent, then the checkout resumes.
    expect(p).toContain("rememberCommercialIntent('founding_lifetime')");
    expect(p).toContain("rememberCommercialIntent('brand_pro')");
    expect(p).toContain('consumeIntentResumeOnce');
    expect(p).toContain('void startFoundingLifetimeCheckout()');
    expect(p).toContain('void startBrandProCheckout()');
    expect(p).toContain('if (!meLoaded || !me) return;');          // never for logged-out
    // No auto-capture anywhere in the resume path.
    expect(p).not.toContain('/capture\', { method: \'POST\', credentials: \'include\', body');
    expect(INTENT_DESTINATION.founding_lifetime).toContain('/pricing?intent=founding-lifetime');
    expect(INTENT_DESTINATION.brand_pro).toContain('/pricing?intent=brand-pro');
  });

  it('16. auth handoff resumes at most once per session (no duplicate orders)', () => {
    const store = new Map<string, string>();
    const fake = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v); },
      removeItem: (k: string) => { store.delete(k); },
    };
    (globalThis as unknown as { window?: unknown }).window = { sessionStorage: fake, localStorage: fake };
    try {
      expect(consumeIntentResumeOnce('founding_lifetime')).toBe(true);
      expect(consumeIntentResumeOnce('founding_lifetime')).toBe(false);   // replay/refresh
      expect(consumeIntentResumeOnce('brand_pro')).toBe(true);            // independent product
      resetIntentResume('founding_lifetime');
      expect(consumeIntentResumeOnce('founding_lifetime')).toBe(true);
    } finally {
      delete (globalThis as unknown as { window?: unknown }).window;
    }
    // Server-side open-order reuse is the authoritative duplicate guard.
    expect(src('lib/services/brandFoundingLifetimeService.ts')).toContain('if (openOne) return toBuyerView(openOne)');
    expect(src('lib/services/brandProService.ts')).toContain('if (open) return this.toCheckoutView(open)');
  });

  it('17. no entitlement until the authoritative capture; redirects grant nothing', async () => {
    const fl = src('lib/services/brandFoundingLifetimeService.ts');
    // startCheckout never grants an entitlement — only the capture path does.
    const startIdx = fl.indexOf('async startCheckout(');
    const grantIdx = fl.indexOf('brandEntitlementService.grant');
    expect(startIdx).toBeGreaterThan(-1);
    expect(grantIdx).toBeLessThan(startIdx);            // grant lives in the capture helper above
    expect(fl).toContain("transition(orderId, ['captured_pending_fee'], 'captured_finalized'");
    expect(src('app/api/[[...path]]/route.ts')).toContain('Grants access ONLY via the authoritative');
    // Unauthenticated checkout is refused outright.
    const r = await fetch(`${BASE}/brand/founding-lifetime/checkout`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    expect([401, 403]).toContain(r.status);
    const r2 = await fetch(`${BASE}/brand-pro/checkout`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    expect([401, 403]).toContain(r2.status);
  });

  it('14b. founding lifetime logged-in checkout is a REAL server-authoritative $100 PayPal order (no entitlement on create)', async () => {
    const prev = process.env.BRAND_FOUNDING_LIFETIME_CHECKOUT_ENABLED;
    process.env.BRAND_FOUNDING_LIFETIME_CHECKOUT_ENABLED = '1';   // capability flag, not a price
    try {
      await withDb(async (db) => {
        const uid = await seedUser(db);
        const actor = actorFor(uid);
        const order = await brandFoundingLifetimeService.startCheckout(actor, 'http://localhost:3000');
        expect(order.price_minor).toBe(10000);                    // server-authoritative $100
        expect(order.currency).toBe('USD');
        expect(order.status).toBe('checkout_created');
        expect(String(order.approve_url)).toMatch(/paypal\.com/);  // user approves on PayPal
        // 17 — creating the order grants NOTHING until the authoritative capture.
        const state = await brandFoundingLifetimeService.getBuyerState(actor);
        expect(state.already_active).toBe(false);
        // Replay reuses the SAME open order — no duplicate PayPal order.
        const again = await brandFoundingLifetimeService.startCheckout(actor, 'http://localhost:3000');
        expect(again.id).toBe(order.id);
        await db.collection('brand_founding_lifetime_orders').deleteMany({ buyer_user_id: uid });
      });
    } finally {
      if (prev === undefined) delete process.env.BRAND_FOUNDING_LIFETIME_CHECKOUT_ENABLED;
      else process.env.BRAND_FOUNDING_LIFETIME_CHECKOUT_ENABLED = prev;
    }
  }, 30000);

  it('18-22. brand pro: logged-in checkout reaches PayPal, replay reuses the order, $15 / 30 days preserved', async () => {
    // 22 — server-authoritative commercial contract.
    expect(BRAND_PRO_AMOUNT_MINOR).toBe(1500);
    expect(BRAND_PRO_TERM_DAYS).toBe(30);

    const ip = `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.7`;
    const email = `${RUN}-bp@wavelead.test`;
    const s = await fetch(`${BASE}/auth/signup`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip },
      body: JSON.stringify({ email, password: 'password123', display_name: 'M171 BP' }),
    });
    const cookie = (s.headers.get('set-cookie') || '').match(/wl_session=[^;]+/)?.[0] || '';
    expect(cookie).toBeTruthy();

    // 19 — logged-in checkout starts and returns a PayPal approval URL.
    const r = await fetch(`${BASE}/brand-pro/checkout`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: '{}',
    });
    const j = await r.json() as { data?: { order?: { id: string; approve_url: string; gross_amount_minor: number; term_days: number; auto_recurring: boolean } } };
    expect(r.status).toBe(201);
    expect(j.data?.order?.approve_url).toMatch(/^https:\/\/www\.(sandbox\.)?paypal\.com\//);
    expect(j.data?.order?.gross_amount_minor).toBe(1500);
    expect(j.data?.order?.term_days).toBe(30);
    expect(j.data?.order?.auto_recurring).toBe(false);

    // 21 — replay does NOT create a second PayPal order.
    const r2 = await fetch(`${BASE}/brand-pro/checkout`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: '{}',
    });
    const j2 = await r2.json() as { data?: { order?: { id: string } } };
    expect(j2.data?.order?.id).toBe(j.data?.order?.id);

    // Membership is NOT granted by creating the order (no auto-capture).
    const st = await fetch(`${BASE}/brand-pro/state`, { headers: { Cookie: cookie } });
    const sj = await st.json() as { data?: { membership?: { plan: string }; renewal?: string; auto_recurring?: boolean } };
    expect(sj.data?.membership?.plan).toBe('brand_free');
    expect(sj.data?.renewal).toBe('manual');
    expect(sj.data?.auto_recurring).toBe(false);

    // 18/20 — logged-out CTA path: intent + resume, never a waitlist.
    const p = src(PRICING);
    expect(p).toContain('data-testid="cta-brand-pro"');
    expect(p).toContain("fetch('/api/brand-pro/checkout'");
    expect(p).not.toContain('Join Founding Beta');
    // 22 — the PayPal browser return is now handled and stays non-authoritative.
    const ret = src('components/commerce/BrandProReturn.tsx');
    expect(ret).toContain("'/api/brand-pro/capture'");
    expect(ret).toContain('BROWSER RETURN GRANTS');
    expect(src('app/dashboard/billing/page.tsx')).toContain('<BrandProReturn />');
  }, 30000);
});

// --------------------------- COUNTRY COMBOBOX ------------------------------
describe('M17.1 country selector', () => {
  it('23-27. searchable combobox, no full-list dump, Saudi Arabia + ISO search, canonical value', () => {
    const cb = src(COMBOBOX);
    // 23 — a real combobox with search input and keyboard navigation.
    expect(cb).toContain('Search country');
    expect(cb).toContain('role="listbox"');
    expect(cb).toContain("e.key === 'ArrowDown'");
    expect(cb).toContain("e.key === 'ArrowUp'");
    expect(cb).toContain("e.key === 'Enter'");
    expect(cb).toContain("e.key === 'Escape'");
    // 27 — canonical dataset only; the selected value is the ISO code.
    expect(cb).toContain("from '@/lib/constants/countries'");
    expect(cb).toContain('onChange(c.code)');

    // 24 — before typing we show a SMALL suggested set, never the 200+ list.
    expect(COUNTRY_COUNT).toBeGreaterThan(200);
    const idle = searchCountries('');
    expect(idle.length).toBe(SUGGESTED_COUNTRY_CODES.length);
    expect(idle.length).toBeLessThan(20);
    expect(suggestedCountries().some((c) => c.code === 'SA')).toBe(true);
    expect(searchCountries('a').length).toBeLessThanOrEqual(COUNTRY_RESULT_LIMIT);

    // 25 — Saudi Arabia is searchable by partial name.
    expect(searchCountries('Saudi')[0]?.code).toBe('SA');
    expect(searchCountries('saudi ar')[0]?.name).toBe('Saudi Arabia');
    // "United" surfaces the united* countries.
    const united = searchCountries('United').map((c) => c.code);
    expect(united).toContain('AE');
    expect(united).toContain('GB');
    expect(united).toContain('US');

    // 26 — ISO code search.
    expect(searchCountries('SA').some((c) => c.code === 'SA')).toBe(true);
    expect(searchCountries('ae')[0]?.code).toBe('AE');
    expect(searchCountries('id').some((c) => c.code === 'ID')).toBe(true);
    // Unknown input yields an empty, non-throwing result.
    expect(searchCountries('zzzzzz')).toEqual([]);
    // Every returned entry is a canonical dataset row.
    for (const c of searchCountries('united')) {
      expect(COUNTRIES.some((x) => x.code === c.code && x.name === c.name)).toBe(true);
    }

    // 24b — the big <select> dumps are gone from the owner-facing surfaces.
    expect(src(SUBMIT)).toContain('CountryCombobox');
    expect(src(SUBMIT)).not.toContain('{countries.map((c) => <option');
    expect(src(FAST_FORM)).toContain('CountryCombobox');
    expect(src(MANUAL_FORM)).toContain('CountryCombobox');
    expect(src(FAST_FORM)).not.toContain('COUNTRY_OPTIONS');
    expect(src(MANUAL_FORM)).not.toContain('COUNTRY_OPTIONS');
  });
});
