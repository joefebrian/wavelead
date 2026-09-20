// M18.1 — post-launch review: Phases B–I targeted tests.
//   B homepage country compaction      C redundant quick-link removal
//   D fast verification before moderation
//   E weekly follower refresh          F/I approval email + idempotency
//   G rate-card CTA / onboarding       H sample work
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { MongoClient, type Db } from 'mongodb';
import { v4 as uuidv4 } from 'uuid';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { COLLECTIONS } from '@/lib/db/collections';
import type { Actor, Channel } from '@/lib/types';

vi.mock('nodemailer', () => ({ createTransport: () => ({ sendMail: async () => ({ messageId: 'm181' }) }) }));

import { sampleWorkService, SAMPLE_WORK_TEMPLATES, MAX_SAMPLE_WORKS } from '@/lib/services/sampleWorkService';
import { buildChannelLiveEmail } from '@/lib/services/channelLiveNotification';
import { WEEKLY_STALE_DAYS } from '@/lib/services/whatsappRefreshService';
import { ownerVerificationService, assertFastVerificationEligible } from '@/lib/services/ownerVerificationService';

const REPO = path.resolve(__dirname, '..');
const src = (p: string) => readFileSync(path.join(REPO, p), 'utf8');
const RUN = `m181b-${Date.now()}`;

async function withDb<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  const client = new MongoClient(process.env.MONGO_URL || 'mongodb://localhost:27017');
  await client.connect();
  try { return await fn(client.db(process.env.DB_NAME || 'wavelead')); } finally { await client.close(); }
}

const userId = uuidv4();
const actor = { user: { id: userId, email: `${RUN}@t.test`, role: 'user', display_name: 'T' } } as unknown as Actor;
const channelId = uuidv4();

function channelDoc(over: Partial<Channel> = {}): Channel {
  const now = new Date();
  return {
    id: channelId, slug: `${RUN}-ch`, name: `${RUN} channel`,
    whatsapp_url: 'https://whatsapp.com/channel/0029Vtest', status: 'pending_review',
    description: `${RUN} desc`, short_description: 'd', category_id: uuidv4(), country_code: 'ID',
    primary_language: 'id', owner_id: null, submitted_by: userId, verification_status: 'unverified',
    created_at: now, updated_at: now, ...over,
  } as unknown as Channel;
}

beforeAll(async () => {
  await withDb(async (db) => {
    await db.collection(COLLECTIONS.USERS).insertOne({ id: userId, email: `${RUN}@t.test`, role: 'user', created_at: new Date() } as never);
    await db.collection(COLLECTIONS.CHANNELS).insertOne(channelDoc() as never);
  });
});
afterAll(async () => {
  await withDb(async (db) => {
    await db.collection(COLLECTIONS.USERS).deleteMany({ email: `${RUN}@t.test` });
    await db.collection(COLLECTIONS.CHANNELS).deleteMany({ id: channelId });
    await db.collection(COLLECTIONS.CHANNEL_SAMPLE_WORKS).deleteMany({ channel_id: channelId });
  });
});

/* ------------------------------------------------- B — HOMEPAGE COUNTRIES */
describe('M18.1 Phase B homepage country compaction', () => {
  const home = src('app/page.tsx');
  it('B1 capped at 12, ranked by approved channel count, active countries only', () => {
    expect(home).toContain('const HOMEPAGE_COUNTRY_LIMIT = 12');
    expect(home).toContain('bundle.countries.filter((c) => c.channel_count > 0)');
    expect(home).toContain('.sort((a, b) => b.channel_count - a.channel_count');
    expect(home).toContain('.slice(0, HOMEPAGE_COUNTRY_LIMIT)');
    expect(home).not.toContain("'Coming soon'");          // no empty-country filler on home
  });
  it('B2 "View all countries" links to the untouched full directory', () => {
    expect(home).toContain('data-testid="home-view-all-countries"');
    expect(home).toContain('href="/countries"');
    const dir = src('app/countries/page.tsx');
    expect(dir).toContain('discoveryService.getCountryCounts()');
    expect(dir).toContain('withoutChannels');            // canonical dataset still listed in full
    expect(src('app/country/[slug]/page.tsx')).toContain('countryBySlug'); // URLs/SEO untouched
  });
});

/* ------------------------------------------- C — REDUNDANT QUICK LINKS */
describe('M18.1 Phase C redundant authenticated quick links', () => {
  const dash = src('app/dashboard/page.tsx');
  it('C1 the bottom quick-link pill row is gone', () => {
    for (const label of ['>My channels<', '>Active Sponsorships<', '>Sent Requests<', '>Billing<', '>My claims<', '>Submit a channel<']) {
      expect(dash).not.toContain(label);
    }
    expect(dash).not.toContain('data-testid="nav-pipeline-button"');
  });
  it('C2 the sidebar still owns navigation for every removed destination', () => {
    const nav = src('lib/constants/navigation.ts');
    for (const href of ['/dashboard/channels', '/dashboard/promotions', '/dashboard/sponsorships',
      '/dashboard/sponsorship-requests', '/dashboard/sent-requests', '/dashboard/sponsorships/pipeline',
      '/dashboard/earnings', '/dashboard/billing', '/dashboard/claims', '/submit']) {
      expect(nav).toContain(`href: '${href}'`);
    }
    expect(src('app/dashboard/layout.tsx')).toContain('USER_NAV_GROUPS');
  });
  it('C3 the PUBLIC footer and Cookie Preferences are untouched', () => {
    const footer = src('components/layout/Footer.tsx');
    expect(footer).toContain('<CookiePreferencesTrigger />');
    for (const l of ["label: 'Privacy'", "label: 'Terms'", "label: 'Cookie Policy'"]) expect(footer).toContain(l);
    expect(footer).toContain('/contact');
    // The footer is NOT rendered inside the authenticated shells.
    expect(src('app/dashboard/layout.tsx')).not.toContain('<Footer');
    expect(src('app/admin/layout.tsx')).not.toContain('<Footer');
  });
});

/* --------------------------------------- D — FAST VERIFICATION POLICY */
describe('M18.1 Phase D fast verification before moderation approval', () => {
  it('D1 a pending_review listing is eligible; the submitter can start', async () => {
    const ch = channelDoc({ status: 'pending_review' });
    await expect(assertFastVerificationEligible(actor, ch)).resolves.toBeUndefined();
  });
  it('D2 terminal/blocked listings stay closed', async () => {
    for (const status of ['rejected', 'suspended', 'archived']) {
      await expect(assertFastVerificationEligible(actor, channelDoc({ status } as Partial<Channel>))).rejects.toThrow(/not eligible/i);
    }
  });
  it('D3 a channel with no submitted WhatsApp link is rejected', async () => {
    await expect(assertFastVerificationEligible(actor, channelDoc({ whatsapp_url: null } as unknown as Partial<Channel>))).rejects.toThrow(/WhatsApp Channel link/i);
  });
  it('D4 a stranger can never pay against someone else\'s channel', async () => {
    const stranger = { user: { id: uuidv4(), email: 's@t.test', role: 'user' } } as unknown as Actor;
    await expect(assertFastVerificationEligible(stranger, channelDoc())).rejects.toThrow(/submitter|claimant/i);
  });
  it('D5 a conflicting verified owner blocks the fast path', async () => {
    await expect(assertFastVerificationEligible(actor, channelDoc({ verification_status: 'verified', owner_id: uuidv4() } as Partial<Channel>)))
      .rejects.toThrow(/already belongs to a verified owner|Only the original submitter/i);
  });
  it('D6 payment alone does NOT activate — identity/payout/declaration still gate', async () => {
    const r = await ownerVerificationService.finalizeIfComplete(userId, channelId);
    expect(r.verified).toBe(false);
    expect(r.blocked_by).toContain('payment');
    expect(r.blocked_by).not.toContain('listing_approval');   // no longer a precondition
  });
  it('D7 listing approval is an OUTCOME of the gate (single explicit transition)', () => {
    const svc = src('lib/services/ownerVerificationService.ts');
    expect(svc).toContain("if (FAST_BLOCKED_STATUSES.has(String(channel.status))) blocked.push('listing_blocked')");
    expect(svc).toContain("status: 'approved',");
    expect(svc).toContain('listing_approved_by_fast_path');
    expect(svc).toContain('second_admin_approval_required: false');
    // Idempotent: no new listing/activation row is created here.
    expect(svc).not.toContain('insertOne({ ...channel');
  });
  it('D8 manual verification stays free and evidence-based', () => {
    const client = src('app/dashboard/channels/[id]/verify/VerifyClient.tsx');
    expect(client).toContain('data-testid="manual-verification-card"');
    expect(client).toContain('Always free — no payment required');
    expect(src('app/dashboard/channels/[id]/verify/ManualVerificationForm.tsx')).toMatch(/evidence/i);
    expect(client).toContain('data-testid="choose-fast-verification"');
    expect(client).toContain('fastEligible');                  // fast no longer keyed on approval
  });
  it('D9 the UI no longer tells submitters to wait for approval', () => {
    expect(src('app/dashboard/channels/[id]/verify/page.tsx')).toContain('you do <strong>not</strong> have to wait');
    expect(src('app/dashboard/channels/[id]/verify/FastVerificationForm.tsx')).not.toContain('opens as soon as the listing is approved');
  });
});

/* ------------------------------------------ E — WEEKLY FOLLOWER REFRESH */
describe('M18.1 Phase E weekly follower refresh', () => {
  const svc = src('lib/services/whatsappRefreshService.ts');
  it('E1 reuses the existing refresh service — no second enrichment system', () => {
    expect(WEEKLY_STALE_DAYS).toBe(7);
    expect(svc).toContain('refreshChannelFromPublicMetadata');
    expect(svc).toContain('fetchPublicChannelMetadata');       // existing SSRF-safe fetcher
    expect(svc).toContain("filter: { status: 'approved' as const }");
  });
  it('E2 weekly cadence + idempotency: fresh observations are skipped', () => {
    expect(svc).toContain('staleAfterDays');
    expect(svc).toContain('observed > staleBefore');
    expect(svc).toContain('freshSkipped');
  });
  it('E3 failure isolation per channel and bounded batching', () => {
    expect(svc).toContain("reason: 'refresh_threw'");
    expect(svc).toContain('Math.min(500');
    expect(svc).toContain('delayMs');
  });
  it('E4 no invented follower value; only concrete observations are written', () => {
    expect(svc).toContain('nextCount !== null && nextCount !== (channel.public_followers_count ?? null)');
    expect(svc).toContain("public_followers_source = 'whatsapp_public_metadata'");
    expect(svc).toContain('public_followers_observed_at');
    expect(svc).toMatch(/Never blanks existing|keep the\n\s*\/\/ stored value intact/);
  });
  it('E5 the cron endpoint stays guarded and exposes the cadence', () => {
    const route = src('app/api/[[...path]]/route.ts');
    expect(route).toContain("route === '/cron/whatsapp-refresh'");
    expect(route).toContain('process.env.CRON_SECRET');
    expect(route).toContain("request.headers.get('x-cron-secret')");
    expect(route).toContain('cadence_days: WEEKLY_STALE_DAYS');
  });
});

/* ------------------------------------- F/I — APPROVAL EMAIL + IDEMPOTENCY */
describe('M18.1 Phase F/I channel-live email', () => {
  it('F1 subject + Rate Card primary CTA + onboarding guidance', () => {
    const m = buildChannelLiveEmail('Demo Channel', 'ch-1', 'https://wavelead.org');
    expect(m.subject).toBe('Your WaveLead channel is live');
    expect(m.text).toContain('NEXT STEP — Set Your Rate Card');
    expect(m.text).toContain('https://wavelead.org/dashboard/channels/ch-1/monetization');
    expect(m.text).toMatch(/Add sample work/i);
    expect(m.text).toMatch(/Complete your channel profile/i);
    expect(m.text).toMatch(/sponsorship opportunities/i);
  });
  it('F2 one shared notifier used by BOTH approval paths, never a second mailer', () => {
    const notif = src('lib/services/channelLiveNotification.ts');
    expect(notif).toContain("await import('./mailer')");
    expect(notif).not.toContain('nodemailer');                 // reuses existing transport
    expect(src('lib/services/moderationService.ts')).toContain("notifyChannelLive({ ...channel, ...patch, id: channelId } as Channel, 'moderation_approval')");
    expect(src('lib/services/ownerVerificationService.ts')).toContain("'fast_verification')");
  });
  it('F3 email failure never rolls back approval', () => {
    const notif = src('lib/services/channelLiveNotification.ts');
    expect(notif).toContain('} catch {');
    expect(notif).toContain("return { sent: false, reason: 'error' };");
    expect(src('lib/services/moderationService.ts')).toContain('/* email is best-effort */');
  });
  it('I1 idempotent: marker set only after a successful send, cleared on real re-approval', () => {
    const notif = src('lib/services/channelLiveNotification.ts');
    expect(notif).toContain("if (marker) return { sent: false, reason: 'already_sent' };");
    expect(notif).toContain('live_email_sent_at: new Date()');
    expect(notif).toContain('resetChannelLiveEmailMarker');
    expect(src('lib/services/moderationService.ts')).toContain('resetChannelLiveEmailMarker(channelId)');
  });
});

/* ------------------------------- G/H — ONBOARDING, RATE CARD, SAMPLE WORK */
describe('M18.1 Phase G/H onboarding + sample work', () => {
  it('G1 checklist derives from existing domains and leads with the rate card', async () => {
    const r = await sampleWorkService.onboardingChecklist(actor, channelId);
    expect(r.items.map((i) => i.key)).toEqual(['approved', 'rate_card', 'sample_work', 'profile']);
    expect(r.items[1].label).toBe('Set rate card');
    expect(r.items[1].href).toBe(`/dashboard/channels/${channelId}/monetization`);
    expect(r.items[1].done).toBe(false);
    expect(r.complete).toBe(false);
    const panel = src('components/owner/OwnerOnboardingPanel.tsx');
    expect(panel).toContain('data-testid="onboarding-rate-card-cta"');
    expect(panel).toContain('Set Your Rate Card');
    expect(panel).toContain('Your listing stays public either way');   // not a new gate
  });
  it('G2 no competing pricing model — the existing rate-card domain is reused', () => {
    expect(src('lib/services/sampleWorkService.ts')).toContain('COLLECTIONS.CHANNEL_RATE_CARDS');
    expect(src('components/owner/OwnerOnboardingPanel.tsx')).not.toMatch(/price_minor|amount_minor/);
  });
  it('H1 owner can add public https sample work; brands can read it', async () => {
    const created = await sampleWorkService.create(actor, channelId, {
      title: 'Sponsored launch post', work_type: 'sponsored_post',
      description: 'Intro post for a local brand.', content_url: 'https://example.com/post/1',
      brand_name: 'Acme', published_on: '2026-05-01',
    });
    expect(created.id).toBeTruthy();
    const mine = await sampleWorkService.listForOwner(actor, channelId);
    expect(mine.length).toBe(1);
    const pub = await sampleWorkService.listPublic(channelId);
    expect(pub[0].content_url).toBe('https://example.com/post/1');
  });
  it('H2 non-public / non-https / private targets are rejected (no file hosting)', async () => {
    for (const url of ['http://example.com/a', 'https://localhost/a', 'https://127.0.0.1/a', 'https://10.0.0.5/a', 'not-a-url']) {
      await expect(sampleWorkService.create(actor, channelId, { title: 'x y z', work_type: 'other', content_url: url })).rejects.toThrow();
    }
    expect(src('lib/services/sampleWorkService.ts')).not.toMatch(/uploadthing|multipart|file_url/i);
  });
  it('H3 a stranger cannot read or write another channel\'s sample work', async () => {
    const stranger = { user: { id: uuidv4(), email: 'x@t.test', role: 'user' } } as unknown as Actor;
    await expect(sampleWorkService.listForOwner(stranger, channelId)).rejects.toThrow(/Not authorized/i);
    await expect(sampleWorkService.create(stranger, channelId, { title: 'abc', work_type: 'other', content_url: 'https://example.com/z' })).rejects.toThrow(/Not authorized/i);
  });
  it('H4 templates are examples only and never stored as the creator\'s work', async () => {
    expect(SAMPLE_WORK_TEMPLATES.length).toBe(4);
    for (const t of SAMPLE_WORK_TEMPLATES) expect(t.title).toMatch(/example/i);
    const stored = await sampleWorkService.listPublic(channelId);
    for (const s of stored) expect(s.title).not.toMatch(/example/i);
    const panel = src('components/owner/OwnerOnboardingPanel.tsx');
    expect(panel).toContain('EXAMPLES ONLY');
    expect(panel).toContain('nothing is saved until you add your own link');
  });
  it('H5 delete is idempotent and the entry cap holds', async () => {
    const mine = await sampleWorkService.listForOwner(actor, channelId);
    const first = mine[0];
    expect((await sampleWorkService.remove(actor, first.id)).deleted).toBe(true);
    expect((await sampleWorkService.remove(actor, first.id)).deleted).toBe(false);
    expect(MAX_SAMPLE_WORKS).toBe(12);
    expect(src('lib/services/sampleWorkService.ts')).toContain('existing >= MAX_SAMPLE_WORKS');
  });
  it('H6 sample work is surfaced on the public channel profile for brands', () => {
    const page = src('app/channel/[slug]/page.tsx');
    expect(page).toContain('data-testid="public-sample-work"');
    expect(page).toContain('sampleWorkService.listPublic(channel.id, 6)');
    expect(page).toContain('rel="noopener noreferrer nofollow"');
  });
});
