// M19.2 — Post-M19 polish targeted tests.
//
// Guardrails covered here:
//   1. Category icons — the homepage "Browse by category" section now uses
//      the shared categoryVisual() Lucide icon, not a letter placeholder.
//   2. Pricing CTA polish + button alignment — both "Start Brand Pro — $15"
//      and "Get Founding Lifetime — $100" render with the same h-11 button
//      class and share a common CTA container placement so they line up.
//   3. Refund policy — page exists, uses the exact "net of applicable
//      processing fees" wording, and never contradicts the M08 marketplace /
//      Payment Protection or the M19 Campaign Commitment Deposit semantics.
//   4. Support inbox service — thread lifecycle, access-token gating, admin
//      reply and status transitions, all with plain-text bodies.
//   5. Public campaign board — still deferred (no anonymous /campaigns list).
//   6. M19 financial constants — unchanged (5%, provider abstraction).
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { MongoClient, type Db } from 'mongodb';
import { v4 as uuidv4 } from 'uuid';
import { COLLECTIONS } from '@/lib/db/collections';
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

const brandLikeId = uuidv4();
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

describe('M19.2 §1 — Category icons (letter placeholders replaced)', () => {
  it('1.1 homepage no longer renders {cat.name.charAt(0)}', () => {
    const home = src('app/page.tsx');
    expect(home).not.toMatch(/cat\.name\.charAt\(0\)/);
    // Uses the shared visual system.
    expect(home).toContain("from '@/lib/constants/categoryIcons'");
    expect(home).toContain('categoryVisual(cat.slug, cat.name)');
    expect(home).toContain('<Icon');
  });
  it('1.2 /categories still uses categoryVisual', () => {
    const cats = src('app/categories/page.tsx');
    expect(cats).toContain('categoryVisual(cat.slug, cat.name)');
  });
  it('1.3 category slugs / URLs / SEO metadata untouched', () => {
    const cats = src('app/categories/page.tsx');
    expect(cats).toContain('/category/${cat.slug}');
    expect(cats).toContain("alternates: { canonical: '/categories' }");
    const home = src('app/page.tsx');
    expect(home).toContain('/category/${cat.slug}');
  });
});

describe('M19.2 §2 — Pricing CTA polish + button alignment', () => {
  const p = () => src('app/pricing/PricingClient.tsx');
  it('2.1 both target CTAs use the same h-11 button class and same size treatment', () => {
    const s = p();
    // Every CTA button inside the pricing grid uses the same height/weight.
    const btnMatches = s.match(/className="w-full h-11 text-base font-semibold"/g) || [];
    expect(btnMatches.length).toBeGreaterThanOrEqual(5); // one per tier + the "active" variant
  });
  it('2.2 CTA container puts the button FIRST and any per-card footnote below', () => {
    const s = p();
    // Structural marker for the redesigned CTA area.
    expect(s).toContain('<div className="mt-6 flex flex-col gap-2">');
    // The brand-pro renewal note now lives BELOW the button, not before it.
    const startCTA = s.indexOf("data-testid=\"cta-brand-pro\"");
    const renewalNote = s.indexOf("data-testid=\"brand-pro-renewal-note\"");
    expect(startCTA).toBeGreaterThan(0);
    expect(renewalNote).toBeGreaterThan(startCTA);
  });
  it('2.3 CTA copy for Brand Pro and Founding Lifetime is unchanged', () => {
    const s = p();
    expect(s).toContain("cta: 'Start Brand Pro — $15'");
    expect(s).toContain("cta: `Get Founding Lifetime — ${formatMinorUSD(p.brand_lifetime.price_minor)}`");
  });
  it('2.4 no auth→checkout regression: CTAs still call the existing handlers', () => {
    const s = p();
    expect(s).toContain('onClick={startBrandProCheckout}');
    expect(s).toContain('onClick={startFoundingLifetimeCheckout}');
  });
  it('2.5 no recurring / waitlist regression', () => {
    const s = p();
    // Reject the re-introduction of automated recurring behaviour or a waitlist state.
    expect(s).not.toMatch(/subscription\s*:\s*true|billing_agreement|recurring_agreement/);
    expect(s).not.toMatch(/showWaitlist|waitlistOpen|waitlist\s*=\s*true|WaitlistForm/);
    expect(s).toContain('Manual renewal during Founding Beta');
    // The anti-waitlist comment stays as documentation.
    expect(s).toMatch(/no reservation form/);
    expect(s).toMatch(/no waitlist/);
  });
});

describe('M19.2 §3 — Refund policy', () => {
  const REF = () => src('app/refund-policy/page.tsx');
  it('3.1 page exists and is canonical at /refund-policy', () => {
    expect(REF()).toContain("alternates: { canonical: '/refund-policy' }");
    expect(REF()).toContain('Refund Policy');
  });
  it('3.2 net-of-costs wording is present and precise', () => {
    const s = REF();
    expect(s).toContain('net of applicable processing fees');
    // Guardrail: must NOT promise automatic full refund in every case.
    expect(s).toContain('WaveLead does not guarantee an automatic full refund in every case');
  });
  it('3.3 refund policy does not contradict Payment Protection / 90-10 / commitment semantics', () => {
    const s = REF();
    expect(s).toContain('Payment Protection');
    expect(s).toContain('90% Channel Owner / 10% WaveLead split');
    expect(s).toContain('campaign-linked funding, not WaveLead revenue');
  });
  it('3.4 footer legal exposes the new page', () => {
    const footer = src('components/layout/Footer.tsx');
    expect(footer).toContain("{ href: '/refund-policy', label: 'Refunds' }");
  });
});

describe('M19.2 §4 — Support inbox service (thread lifecycle)', () => {
  it('4.1 creates a ticket, returns an access_token, and appends the first message', async () => {
    const r = await supportService.createTicket(anon, { email: `${RUN}-1@test.dev`, name: `${RUN}-name`, body: `${RUN}-hello` });
    expect(r.ticket.id).toBeTruthy();
    expect(r.access_token).toMatch(/[0-9a-f-]+/);
    expect(r.ticket.status).toBe('awaiting_admin');
    expect(r.ticket.unread_by_admin).toBe(1);
    expect(r.message.body).toBe(`${RUN}-hello`);
    // Preview is the truncated one-line body.
    expect(r.ticket.last_message_preview).toContain(`${RUN}-hello`);
  });

  it('4.2 requester read requires token or ownership; strangers are rejected', async () => {
    const created = await supportService.createTicket(anon, { email: `${RUN}-2@test.dev`, body: `${RUN}-hi` });
    // Correct token → allowed
    const good = await supportService.getForRequester(created.ticket.id, null, created.access_token);
    expect(good.messages).toHaveLength(1);
    // Wrong token → 403
    await expect(supportService.getForRequester(created.ticket.id, null, 'not-the-token'))
      .rejects.toMatchObject({ status: 403 });
    // No token, no ownership → 403
    await expect(supportService.getForRequester(created.ticket.id, null, null))
      .rejects.toMatchObject({ status: 403 });
    // Reading resets requester-unread counter.
    expect(good.ticket.unread_by_user).toBe(0);
  });

  it('4.3 admin can reply; ticket flips to awaiting_user; user-unread increments', async () => {
    const c = await supportService.createTicket(anon, { email: `${RUN}-3@test.dev`, body: `${RUN}-q` });
    const reply = await supportService.adminReply(admin, c.ticket.id, `${RUN}-answer`);
    expect(reply.sender).toBe('admin');
    const { ticket } = await supportService.adminGetTicket(c.ticket.id);
    expect(ticket.status).toBe('awaiting_user');
    // adminGetTicket resets admin-unread. adminReply increments user-unread.
    expect(ticket.unread_by_user).toBeGreaterThanOrEqual(1);
    expect(ticket.unread_by_admin).toBe(0);
  });

  it('4.4 requester reply after admin flips status back to awaiting_admin', async () => {
    const c = await supportService.createTicket(anon, { email: `${RUN}-4@test.dev`, body: `${RUN}-q2` });
    await supportService.adminReply(admin, c.ticket.id, `${RUN}-answer2`);
    await supportService.addRequesterMessage(c.ticket.id, null, c.access_token, `${RUN}-followup`);
    const { ticket, messages } = await supportService.adminGetTicket(c.ticket.id);
    expect(ticket.status).toBe('awaiting_admin');
    expect(messages.at(-1)?.body).toBe(`${RUN}-followup`);
  });

  it('4.5 admin can close a ticket and requester replies are refused with 409', async () => {
    const c = await supportService.createTicket(anon, { email: `${RUN}-5@test.dev`, body: `${RUN}-q3` });
    const closed = await supportService.adminSetStatus(admin, c.ticket.id, 'closed');
    expect(closed.status).toBe('closed');
    expect(closed.closed_by_user_id).toBe(adminId);
    await expect(supportService.addRequesterMessage(c.ticket.id, null, c.access_token, `${RUN}-late`))
      .rejects.toMatchObject({ status: 409 });
  });

  it('4.6 empty / whitespace bodies are rejected 400', async () => {
    await expect(supportService.createTicket(anon, { email: `${RUN}-e@test.dev`, body: '   ' }))
      .rejects.toMatchObject({ status: 400 });
    await expect(supportService.createTicket(anon, { body: 'ok' }))
      .rejects.toMatchObject({ status: 400 });
    await expect(supportService.createTicket(anon, { email: 'not-an-email', body: 'ok' }))
      .rejects.toMatchObject({ status: 400 });
  });

  it('4.7 the widget is a client component, mounted globally, and never renders on /admin', () => {
    const layout = src('app/layout.tsx');
    expect(layout).toContain("import SupportWidget from '@/components/support/SupportWidget'");
    expect(layout).toContain('<SupportWidget />');
    const w = src('components/support/SupportWidget.tsx');
    expect(w).toContain("'use client'");
    expect(w).toContain("pathname.startsWith('/admin')");
    // Bodies are stored/rendered as plain text (whitespace-pre-wrap), not HTML.
    expect(w).toContain('whitespace-pre-wrap');
    expect(w).not.toMatch(/dangerouslySetInnerHTML/);
  });

  it('4.8 admin surfaces are guarded and never leak the access_token', () => {
    const routes = src('app/api/[[...path]]/route.ts');
    // Admin list + get + reply + status routes all require ADMIN.
    for (const marker of [
      "route === '/admin/support/tickets'",
      "path[0] === 'admin' && path[1] === 'support' && path[2] === 'tickets'",
    ]) expect(routes).toContain(marker);
    // Every admin support handler role-checks BEFORE hitting the service.
    const adminBlock = routes.substring(routes.indexOf("route === '/admin/support/tickets'"));
    expect(adminBlock.match(/Admin privileges required/g)?.length ?? 0).toBeGreaterThanOrEqual(4);
    // Public + admin paths always strip the token when serialising the ticket.
    expect(routes).toContain('stripInternal(ticket)');
    // Admin page passes stripInternal-ed data to the client thread.
    expect(src('app/admin/support/[id]/page.tsx')).toContain('stripInternal(ticket)');
  });
});

describe('M19.2 §5 — Public campaign board still DEFERRED', () => {
  it('5.1 no anonymous /campaigns discovery route exists', () => {
    // The only public campaigns surfaces are the authenticated dashboards.
    const pages = [
      'app/dashboard/campaigns/page.tsx',                    // brand (authed)
      'app/dashboard/opportunities/page.tsx',                // creator (authed)
      'app/dashboard/applications/page.tsx',                 // creator (authed)
      'app/admin/campaigns/page.tsx',                        // admin (authed)
    ];
    for (const p of pages) expect(src(p)).toBeTruthy();
    // No `app/campaigns/page.tsx` (public list) shipped in this milestone.
    expect(() => src('app/campaigns/page.tsx')).toThrow();
  });
});

describe('M19.2 §6 — M19 financial logic FROZEN', () => {
  it('6.1 5% Campaign Commitment constant unchanged', () => {
    const c = src('lib/services/payments/campaignCommitmentService.ts');
    expect(c).toMatch(/COMMITMENT_PERCENT\s*=\s*5\b/);
  });
  it('6.2 payment provider abstraction still lives in providerFactory', () => {
    const f = src('lib/services/payments/providerFactory.ts');
    expect(f).toContain('getPaymentProvider');
  });
  it('6.3 marketplace service was not edited by this polish (Owner 90 / WaveLead 10 unchanged)', () => {
    const m = src('lib/services/marketplaceService.ts');
    // No accidental fee-percent redefinitions on this pass.
    expect(m).not.toMatch(/wavelead_fee_percent\s*[:=]\s*(?!10\b)\d+/i);
  });
});

describe('M19.2 §7 — Smoke campaign fixture is preview-only + labelled', () => {
  it('7.1 script refuses production and labels the campaign as internal', () => {
    const s = src('scripts/seed_smoke_campaign.mjs');
    expect(s).toContain('NODE_ENV');
    expect(s).toContain('production');
    expect(s).toContain('[SMOKE-TEST');
    expect(s).toContain('INTERNAL');
    expect(s).toContain('DO NOT USE');
    // Provider marker is qa-fixture, not a real PayPal id.
    expect(s).toContain("provider: 'qa-fixture'");
    expect(s).toContain('paypal_called: false');
    expect(s).toContain('real_money_captured: false');
  });
});
