// M19.2 — Post-M19 polish targeted tests (corrected pre-deploy).
//
// This suite reflects the M19.2 pre-deploy corrections:
//   §1 Smoke fixture uses the canonical requiredCommitmentMinor helper (5%).
//   §2 Refund policy has NO escrow / "funds held" wording.
//   §3 Refund policy makes NO promise of a transaction-detail breakdown UI.
//   §4 Support guest auth is an HttpOnly cookie (no localStorage token, no
//      ?token= query, no PII in URLs).
//   §5 Support widget sends NO event to GA4.
//   §6 Refund policy uses "applicable / documented / non-recoverable" wording.
//
// The M19 financial core is verified as UNCHANGED by tests/m19.test.ts.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { MongoClient, type Db } from 'mongodb';
import { v4 as uuidv4 } from 'uuid';
import { COLLECTIONS } from '@/lib/db/collections';
import { COMMITMENT_PERCENT, requiredCommitmentMinor } from '@/lib/services/payments/campaignCommitmentService';
import type { Actor } from '@/lib/types';

vi.mock('nodemailer', () => ({ createTransport: () => ({ sendMail: async () => ({ messageId: 'm19_2' }) }) }));

import { supportService } from '@/lib/services/supportService';

const REPO = path.resolve(__dirname, '..');
const src = (p: string) => readFileSync(path.join(REPO, p), 'utf8');
const RUN = `m19_2-${Date.now()}`;

async function withDb<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  const client = new MongoClient(process.env.MONGO_URL || 'mongodb://localhost:27017');
  await client.connect();
  try { return await fn(client.db(process.env.DB_NAME || 'wavelead')); } finally { await client.close(); }
}

const adminId = uuidv4();
const admin = { user: { id: adminId, email: `${RUN}-admin@t.test`, role: 'admin', display_name: 'Admin QA' } } as unknown as Actor;
const anon: Actor | null = null;

beforeAll(async () => {
  await withDb(async (db) => {
    await db.collection(COLLECTIONS.SUPPORT_TICKETS).deleteMany({ requester_email: { $regex: `^${RUN}-` } });
    await db.collection(COLLECTIONS.SUPPORT_MESSAGES).deleteMany({ body: { $regex: `^${RUN}-` } });
  });
});
afterAll(async () => {
  await withDb(async (db) => {
    await db.collection(COLLECTIONS.SUPPORT_TICKETS).deleteMany({ requester_email: { $regex: `^${RUN}-` } });
    await db.collection(COLLECTIONS.SUPPORT_MESSAGES).deleteMany({ body: { $regex: `^${RUN}-` } });
  });
});

describe('M19.2 §1 — Category icons', () => {
  it('1.1 homepage uses the shared categoryVisual() icon (no letter fallback)', () => {
    const home = src('app/page.tsx');
    expect(home).not.toMatch(/cat\.name\.charAt\(0\)/);
    expect(home).toContain("from '@/lib/constants/categoryIcons'");
    expect(home).toContain('categoryVisual(cat.slug, cat.name)');
    expect(home).toContain('<Icon');
  });
  it('1.2 /categories still uses categoryVisual and canonical metadata is intact', () => {
    const cats = src('app/categories/page.tsx');
    expect(cats).toContain('categoryVisual(cat.slug, cat.name)');
    // SEO remediation: canonical now routes through buildMetadata(path:'/categories').
    expect(cats).toMatch(/buildMetadata\(\{[\s\S]*path: '\/categories'/);
  });
});

describe('M19.2 §2 — Pricing CTA polish + button alignment', () => {
  const p = () => src('app/pricing/PricingClient.tsx');
  it('2.1 every CTA button uses the same h-11 class', () => {
    const s = p();
    const btnMatches = s.match(/className="w-full h-11 text-base font-semibold"/g) || [];
    expect(btnMatches.length).toBeGreaterThanOrEqual(5);
  });
  it('2.2 reserved-height footnote row anchors buttons on the same baseline', () => {
    const s = p();
    expect(s).toContain('<div className="min-h-[64px] text-[11px] text-muted-foreground"');
    expect(s).toContain("data-testid={`pricing-footnote-${tier.kind}`}");
  });
  it('2.3 target CTA copies remain exact', () => {
    const s = p();
    expect(s).toContain("cta: 'Start Brand Pro — $15'");
    expect(s).toContain("cta: `Get Founding Lifetime — ${formatMinorUSD(p.brand_lifetime.price_minor)}`");
  });
  it('2.4 no auth→checkout regression', () => {
    const s = p();
    expect(s).toContain('onClick={startBrandProCheckout}');
    expect(s).toContain('onClick={startFoundingLifetimeCheckout}');
  });
  it('2.5 no recurring / waitlist regression', () => {
    const s = p();
    expect(s).not.toMatch(/subscription\s*:\s*true|billing_agreement|recurring_agreement/);
    expect(s).not.toMatch(/showWaitlist|waitlistOpen|waitlist\s*=\s*true|WaitlistForm/);
    expect(s).toContain('Manual renewal during Founding Beta');
  });
});

describe('M19.2 §3 — Refund policy (corrected wording)', () => {
  const R = () => src('app/refund-policy/page.tsx');
  it('3.1 page exists, canonical is /refund-policy', () => {
    // SEO remediation: canonical now routes through buildMetadata(path:'/refund-policy').
    expect(R()).toMatch(/buildMetadata\(\{[\s\S]*path: '\/refund-policy'/);
    expect(R()).toContain('Refund Policy');
  });
  it('3.2 uses "applicable / documented / non-recoverable" consistently', () => {
    const s = R();
    expect(s).toContain('applicable, documented, non-recoverable');
    expect(s).toContain('are never used to make arbitrary');
    expect(s).toContain('WaveLead does not guarantee an automatic full refund in every case');
  });
  it('3.3 the enumerated deduction categories are present', () => {
    const s = R();
    for (const marker of [
      'payment processing / payment provider fees',
      'currency conversion costs where a conversion occurred',
      'chargeback or reversal costs where applicable',
      'taxes where legally applicable and non-recoverable',
      'other documented, non-recoverable third-party transaction costs',
    ]) expect(s).toContain(marker);
  });
  it('3.4 NO escrow / custodial / "funds held" wording', () => {
    const s = R();
    expect(s).not.toMatch(/\bescrow\b/i);
    expect(s).not.toMatch(/\bcustodial\b/i);
    expect(s).not.toMatch(/\btrust account\b/i);
    // Explicitly forbid the withdrawn phrase.
    expect(s).not.toContain('funds are held until delivery is submitted');
    expect(s).not.toContain('funds are held by WaveLead');
    // Uses lifecycle wording instead.
    const flat = s.replace(/\s+/g, ' ');
    expect(flat).toContain("Payment Protection");
    expect(flat).toMatch(/Payment Protection<\/strong>\s*workflow/);
    expect(flat).toContain("recorded marketplace lifecycle");
  });
  it('3.5 NO unsupported "transaction detail page" promise; uses hedge wording', () => {
    const s = R();
    expect(s).not.toContain('displays them on the transaction detail page');
    expect(s).not.toContain('displayed on the transaction detail page');
    expect(s).toContain('Available transaction details may be shown in the product or provided through Support');
  });
  it('3.6 consumer-law carve-out remains', () => {
    const s = R();
    expect(s).toContain('Nothing in this policy limits');
    expect(s).toContain('non-waivable rights');
  });
  it('3.7 refund policy does NOT contradict M08 / M19 financial semantics', () => {
    const s = R();
    // Whitespace-normalised comparison (JSX line-wraps the text).
    const flat = s.replace(/\s+/g, ' ');
    expect(flat).toContain('90% Channel Owner / 10% WaveLead split');
    expect(flat).toContain('campaign-linked funding, not WaveLead revenue');
  });
  it('3.8 footer legal exposes /refund-policy', () => {
    const footer = src('components/layout/Footer.tsx');
    expect(footer).toContain("{ href: '/refund-policy', label: 'Refunds' }");
  });
});

describe('M19.2 §4 — Support inbox: service lifecycle + HttpOnly cookie auth', () => {
  it('4.1 creates a ticket and returns an access_token internally', async () => {
    const r = await supportService.createTicket(anon, { email: `${RUN}-1@test.dev`, body: `${RUN}-hello` });
    expect(r.access_token).toMatch(/[0-9a-f-]+/);
    expect(r.ticket.status).toBe('awaiting_admin');
    expect(r.ticket.unread_by_admin).toBe(1);
  });
  it('4.2 requester read requires cookie/token or ownership; strangers are rejected', async () => {
    const c = await supportService.createTicket(anon, { email: `${RUN}-2@test.dev`, body: `${RUN}-hi` });
    const good = await supportService.getForRequester(c.ticket.id, null, c.access_token);
    expect(good.messages).toHaveLength(1);
    await expect(supportService.getForRequester(c.ticket.id, null, 'not-the-token')).rejects.toMatchObject({ status: 403 });
    await expect(supportService.getForRequester(c.ticket.id, null, null)).rejects.toMatchObject({ status: 403 });
  });
  it('4.3 admin reply flips status to awaiting_user and increments user-unread', async () => {
    const c = await supportService.createTicket(anon, { email: `${RUN}-3@test.dev`, body: `${RUN}-q` });
    await supportService.adminReply(admin, c.ticket.id, `${RUN}-answer`);
    const { ticket } = await supportService.adminGetTicket(c.ticket.id);
    expect(ticket.status).toBe('awaiting_user');
    expect(ticket.unread_by_user).toBeGreaterThanOrEqual(1);
  });
  it('4.4 requester follow-up flips it back to awaiting_admin', async () => {
    const c = await supportService.createTicket(anon, { email: `${RUN}-4@test.dev`, body: `${RUN}-q2` });
    await supportService.adminReply(admin, c.ticket.id, `${RUN}-answer2`);
    await supportService.addRequesterMessage(c.ticket.id, null, c.access_token, `${RUN}-followup`);
    const { ticket } = await supportService.adminGetTicket(c.ticket.id);
    expect(ticket.status).toBe('awaiting_admin');
  });
  it('4.5 closing rejects further requester writes with 409', async () => {
    const c = await supportService.createTicket(anon, { email: `${RUN}-5@test.dev`, body: `${RUN}-q3` });
    await supportService.adminSetStatus(admin, c.ticket.id, 'closed');
    await expect(supportService.addRequesterMessage(c.ticket.id, null, c.access_token, `${RUN}-late`))
      .rejects.toMatchObject({ status: 409 });
  });
  it('4.6 empty / bad input is rejected 400', async () => {
    await expect(supportService.createTicket(anon, { email: `${RUN}-e@test.dev`, body: '   ' })).rejects.toMatchObject({ status: 400 });
    await expect(supportService.createTicket(anon, { body: 'ok' })).rejects.toMatchObject({ status: 400 });
    await expect(supportService.createTicket(anon, { email: 'not-an-email', body: 'ok' })).rejects.toMatchObject({ status: 400 });
  });
  it('4.7 widget uses HttpOnly cookie flow — no token in JS/URLs/localStorage', () => {
    const w = src('components/support/SupportWidget.tsx');
    // localStorage / sessionStorage may NOT hold the access token or a ticket-token pair.
    expect(w).not.toMatch(/localStorage/);
    expect(w).not.toMatch(/sessionStorage/);
    // The client never learns the token — no ?token= query, no access_token in JSON body.
    expect(w).not.toMatch(/access_token/);
    expect(w).not.toMatch(/[?&]token=/);
    // The panel talks to the server via credentials-included fetch, and the
    // server-side probe returns only the (non-sensitive) ticket_id.
    expect(w).toContain("fetch('/api/support/session'");
    expect(w).toContain("credentials: 'include'");
    // Bodies are plain text; no dangerouslySetInnerHTML.
    expect(w).toContain('whitespace-pre-wrap');
    expect(w).not.toMatch(/dangerouslySetInnerHTML/);
  });
  it('4.8 API layer sets/reads/clears the HttpOnly guest cookie', () => {
    const routes = src('app/api/[[...path]]/route.ts');
    // Cookie helpers are used.
    expect(routes).toContain("await import('@/lib/auth/supportCookie')");
    expect(routes).toContain('setSupportGuestCookie(okResp, r.ticket.id, r.access_token)');
    expect(routes).toContain('readSupportGuestCookie(request)');
    expect(routes).toContain("route === '/support/session' && method === 'DELETE'");
    // No ?token= support anywhere on the /support/... surface.
    const section = routes.substring(routes.indexOf("// ---------- M19.2 SUPPORT INBOX"), routes.indexOf("// Admin surfaces"));
    expect(section).not.toMatch(/searchParams\.get\(['"]token['"]\)/);
    // Create response no longer echoes the token.
    expect(section).not.toMatch(/access_token:\s*r\.access_token/);
  });
  it('4.9 cookie helper enforces HttpOnly + SameSite=Lax + Secure-in-prod', () => {
    const cookie = src('lib/auth/supportCookie.ts');
    expect(cookie).toContain('httpOnly: true');
    expect(cookie).toContain("sameSite: 'lax'");
    expect(cookie).toContain("secure: process.env.NODE_ENV === 'production'");
    expect(cookie).toContain("path: '/'");
    // 30-day cap
    expect(cookie).toContain('60 * 60 * 24 * 30');
  });
  it('4.10 cross-ticket cookie use is rejected at the route level', () => {
    const routes = src('app/api/[[...path]]/route.ts');
    // Only accept the cookie if it matches THIS ticket id — no cross-ticket reads/writes.
    expect(routes).toContain('c && c.ticketId === path[2] ? c.token : null');
  });
  it('4.11 admin surfaces are guarded and never leak the access_token', () => {
    const routes = src('app/api/[[...path]]/route.ts');
    for (const marker of [
      "route === '/admin/support/tickets'",
      "path[0] === 'admin' && path[1] === 'support' && path[2] === 'tickets'",
    ]) expect(routes).toContain(marker);
    expect(routes).toContain('stripInternal(ticket)');
    expect(src('app/admin/support/[id]/page.tsx')).toContain('stripInternal(ticket)');
  });
});

describe('M19.2 §5 — No support content is sent to GA4', () => {
  it('5.1 widget contains no gtag call at all', () => {
    const w = src('components/support/SupportWidget.tsx');
    expect(w).not.toMatch(/gtag\s*\(/);
    expect(w).not.toMatch(/dataLayer/);
    expect(w).not.toMatch(/trackEvent/);
  });
  it('5.2 widget never places support content in a URL or query', () => {
    const w = src('components/support/SupportWidget.tsx');
    // No ticket id, email or token pushed into the URL bar.
    expect(w).not.toMatch(/history\.(push|replace)State/);
    expect(w).not.toMatch(/router\.(push|replace)/);
    // No email/body concatenation into a URL.
    expect(w).not.toMatch(/\?email=|\?body=/);
  });
});

describe('M19.2 §6 — Smoke fixture uses the canonical 5% helper', () => {
  it('6.1 the canonical helper still produces the expected values', () => {
    expect(COMMITMENT_PERCENT).toBe(5);
    // $5,000 = 500_000 minor  →  $250 = 25_000 minor.
    expect(requiredCommitmentMinor(500_000)).toBe(25_000);
    // Integer-safe (Math.ceil) — never under-collect.
    expect(requiredCommitmentMinor(201)).toBe(11);   // 201 × 5 / 100 = 10.05
    expect(requiredCommitmentMinor(0)).toBe(0);
    expect(requiredCommitmentMinor(-1)).toBe(0);
    expect(requiredCommitmentMinor(20)).toBe(1);      // 20 × 5 / 100 = 1
    expect(requiredCommitmentMinor(21)).toBe(2);      // 21 × 5 / 100 = 1.05 → 2
  });
  it('6.2 the smoke script imports/mirrors the canonical helper (no manual 5% math)', () => {
    const s = src('scripts/seed_smoke_campaign.mjs');
    // No inline "* 5 / 100" arithmetic writing into required_commitment_amount_minor.
    expect(s).not.toMatch(/Math\.round\([^)]*\*\s*5\s*\/\s*100\)/);
    // Fixture defines the helper (mirrored from campaignCommitmentService.ts).
    expect(s).toContain('function requiredCommitmentMinor(budgetMinor)');
    expect(s).toContain('Math.ceil((b * COMMITMENT_PERCENT) / 100)');
    // Fixture uses the helper — not inline math — for every commitment field.
    expect(s).toContain('const requiredMinor = requiredCommitmentMinor(campaign.budget_total_usd_minor)');
    expect(s).toContain('required_commitment_amount_minor: requiredMinor');
    expect(s).toContain('amount_minor: requiredMinor');
    expect(s).toContain('captured_amount_minor: requiredMinor');
    // Uses the exported constant, not a literal 5.
    expect(s).toContain('commitment_percent: COMMITMENT_PERCENT');
    // Still preview-only and qa-fixture marker.
    expect(s).toContain('NODE_ENV');
    expect(s).toContain("provider: 'qa-fixture'");
    expect(s).toContain('paypal_called: false');
    expect(s).toContain('real_money_captured: false');
  });
});

describe('M19.2 §7 — Public campaign board still DEFERRED', () => {
  it('7.1 no anonymous /campaigns discovery route exists', () => {
    expect(() => src('app/campaigns/page.tsx')).toThrow();
  });
});

describe('M19.2 §8 — M19 financial logic FROZEN', () => {
  it('8.1 5% Campaign Commitment constant unchanged', () => {
    const c = src('lib/services/payments/campaignCommitmentService.ts');
    expect(c).toMatch(/COMMITMENT_PERCENT\s*=\s*5\b/);
  });
  it('8.2 payment provider abstraction still lives in providerFactory', () => {
    const f = src('lib/services/payments/providerFactory.ts');
    expect(f).toContain('getPaymentProvider');
  });
  it('8.3 marketplace service was not edited by this polish', () => {
    const m = src('lib/services/marketplaceService.ts');
    expect(m).not.toMatch(/wavelead_fee_percent\s*[:=]\s*(?!10\b)\d+/i);
  });
});
