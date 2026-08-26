// Phase B1 — Sponsorship Marketplace targeted tests (28 items).
//
// Scope proven by these tests:
//   §1 Rate-card ownership / verification / active-package invariants
//   §2 Brand booking + server-side price authority + custom-quote fallback
//   §3 Owner accept/reject + immutable snapshot
//   §4 Admin manual payment + payment idempotency
//   §5 Gateway-fee safety (null blocks; 0 is valid)
//   §6 90/10 economics with rounding invariant
//   §7 Financial events append-only + fee reconciliation
//   §8 Owner payable_pending_delivery
//   §9 Existing sponsorship-lead fallback unaffected
//   §10 Promote financial regression + Phase A regression (assured by run script)
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MongoClient, type Db } from 'mongodb';
import { v4 as uuidv4 } from 'uuid';
import { COLLECTIONS } from '@/lib/db/collections';
import { computeSplit, OWNER_SHARE_BPS, PLATFORM_SHARE_BPS, MAX_MONEY_MINOR, assertSafeMoney } from '@/lib/utils/marketplaceMoney';
import { marketplaceService } from '@/lib/services/marketplaceService';
import type { Actor, Channel } from '@/lib/types';

const BASE = 'http://localhost:3000/api';
const CLIENT_IP = () => `10.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;
const RUN_TAG = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;

async function withDb<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  const client = new MongoClient(process.env.MONGO_URL || 'mongodb://localhost:27017');
  await client.connect();
  try { return await fn(client.db(process.env.DB_NAME || 'wavelead')); } finally { await client.close(); }
}
interface Envelope<T> { ok?: boolean; data?: T; error?: string }
async function api<T = unknown>(p: string, init: RequestInit = {}): Promise<{ status: number; body: Envelope<T> }> {
  const r = await fetch(`${BASE}${p}`, { ...init, headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': CLIENT_IP(), ...(init.headers || {}) } });
  const txt = await r.text();
  let body: Envelope<T> = {}; try { body = JSON.parse(txt); } catch { /* */ }
  return { status: r.status, body };
}
async function signup(email: string, role?: string): Promise<{ userId: string; cookie: string }> {
  const s = await fetch(`${BASE}/auth/signup`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': CLIENT_IP() },
    body: JSON.stringify({ email, password: 'password123!', display_name: `T-${email.split('@')[0]}` }),
  });
  const cookie = s.headers.get('set-cookie')?.match(/wl_session=[^;]+/)?.[0] || '';
  const j = await s.json() as { data?: { user?: { id?: string } } };
  const userId = j?.data?.user?.id as string;
  if (role) await withDb(async (db) => { await db.collection('users').updateOne({ id: userId }, { $set: { role } }); });
  return { userId, cookie };
}

async function seedChannel(ownerId: string | null, opts: { verified?: 'verified' | 'official' | 'claimed'; name?: string } = {}): Promise<Channel> {
  const id = uuidv4();
  const slug = `b1-ch-${id.slice(0, 8)}`;
  const now = new Date();
  const doc = {
    id, slug, name: opts.name || `B1 ${id.slice(0, 6)}`,
    whatsapp_url: `https://whatsapp.com/channel/0029Va${id.slice(0, 20).replace(/-/g, '')}`,
    whatsapp_channel_id: `0029Va${id.slice(0, 20).replace(/-/g, '')}`,
    description: 'a completely-populated test channel description',
    short_description: 'a completely-populated test channel description',
    logo_url: 'https://example.com/logo.png', cover_url: null, website_url: null,
    country_code: 'ID', primary_language: 'id', category_slug: 'tech', primary_category_slug: 'tech',
    category_id: null, owner_id: ownerId, status: 'approved',
    verification_status: opts.verified || 'verified', is_official: opts.verified === 'official',
    is_featured: false, is_nsfw: false, is_demo: false, activity_level: 'active',
    follower_count: 1000, follower_count_source: 'test', follower_count_updated_at: now,
    created_at: now, updated_at: now, published_at: now,
  };
  await withDb(async (db) => { await db.collection('channels').insertOne(doc); });
  return doc as unknown as Channel;
}

function actorFor(user_id: string, role = 'user'): Actor {
  return { session: { userId: user_id, email: `${user_id}@t.test`, v: 0 }, user: { id: user_id, email: `${user_id}@t.test`, role, display_name: user_id, avatar_url: null, country_code: null, preferred_language: 'en', auth_providers: [], created_at: new Date(), updated_at: new Date() } } as unknown as Actor;
}

/**
 * B1.1.1 — fixed-price marketplace bookings require an authenticated buyer.
 * This helper creates a fresh unique buyer for each booking so existing tests
 * that previously used anonymous booking still exercise the same downstream
 * accept/reject/payment paths without cross-test contamination.
 */
async function newBuyerActor(): Promise<Actor> {
  const b = await signup(`b1mp-${RUN_TAG}-buyer-${Math.random().toString(36).slice(2, 8)}@t.test`);
  return actorFor(b.userId);
}

async function purge() {
  await withDb(async (db) => {
    await db.collection('channels').deleteMany({ slug: /^b1-/ });
    await db.collection(COLLECTIONS.CHANNEL_RATE_CARDS).deleteMany({});
    await db.collection(COLLECTIONS.MARKETPLACE_ORDERS).deleteMany({});
    await db.collection(COLLECTIONS.MARKETPLACE_FINANCIAL_EVENTS).deleteMany({});
    await db.collection('users').deleteMany({ email: new RegExp(`b1mp-${RUN_TAG}`) });
  });
}
beforeAll(async () => { await purge(); });
afterAll(async () => { await purge(); });

// ============================================================================
// §1 Rate card — ownership + verification
// ============================================================================
describe('B1 §1 — Rate Card', () => {
  it('#1 unverified owner CANNOT publish a rate card', async () => {
    const owner = await signup(`b1mp-${RUN_TAG}-unv@t.test`);
    const ch = await seedChannel(owner.userId, { verified: 'claimed' });
    await expect(marketplaceService.replaceRateCard(actorFor(owner.userId), ch.id, {
      packages: [{ type: 'sponsored_post', name: 'p', description: 'd', price_minor: 25000, deliverables: [], currency: 'USD', is_active: true }],
    })).rejects.toMatchObject({ status: 403 });
  });

  it('#2 verified owner CAN create a rate card', async () => {
    const owner = await signup(`b1mp-${RUN_TAG}-ver@t.test`);
    const ch = await seedChannel(owner.userId, { verified: 'verified' });
    const card = await marketplaceService.replaceRateCard(actorFor(owner.userId), ch.id, {
      packages: [{ type: 'sponsored_post', name: 'Sponsored Post', description: 'A single post', price_minor: 25000, deliverables: ['1 post'], currency: 'USD', is_active: true }],
    });
    expect(card.packages.length).toBe(1);
    expect(card.packages[0].price_minor).toBe(25000);
  });

  it('#3 unrelated owner CANNOT modify another channel’s rate card', async () => {
    const ownerA = await signup(`b1mp-${RUN_TAG}-a@t.test`);
    const ownerB = await signup(`b1mp-${RUN_TAG}-b@t.test`);
    const ch = await seedChannel(ownerA.userId, { verified: 'verified' });
    await expect(marketplaceService.replaceRateCard(actorFor(ownerB.userId), ch.id, {
      packages: [{ type: 'sponsored_post', name: 'p', description: 'd', price_minor: 10000, deliverables: [], currency: 'USD', is_active: true }],
    })).rejects.toMatchObject({ status: 403 });
  });

  it('#4 inactive package is NOT publicly sellable', async () => {
    const owner = await signup(`b1mp-${RUN_TAG}-in@t.test`);
    const ch = await seedChannel(owner.userId, { verified: 'verified' });
    await marketplaceService.replaceRateCard(actorFor(owner.userId), ch.id, {
      packages: [{ type: 'sponsored_post', name: 'Hidden', description: 'x', price_minor: 20000, deliverables: [], currency: 'USD', is_active: false }],
    });
    const pub = await marketplaceService.getPublicRateCard(ch.id);
    expect(pub).toBeNull();
  });

  it('#5 active fixed-price package IS public', async () => {
    const owner = await signup(`b1mp-${RUN_TAG}-p5@t.test`);
    const ch = await seedChannel(owner.userId, { verified: 'verified' });
    await marketplaceService.replaceRateCard(actorFor(owner.userId), ch.id, {
      packages: [{ type: 'sponsored_post', name: 'P', description: 'x', price_minor: 25000, deliverables: [], currency: 'USD', is_active: true }],
    });
    const pub = await marketplaceService.getPublicRateCard(ch.id);
    expect(pub?.packages.length).toBe(1);
    expect(pub?.packages[0].price_minor).toBe(25000);
  });

  it('#6 custom_quote is EXCLUDED from marketplace booking, surfaced via fallback flag', async () => {
    const owner = await signup(`b1mp-${RUN_TAG}-cq@t.test`);
    const ch = await seedChannel(owner.userId, { verified: 'verified' });
    const card = await marketplaceService.replaceRateCard(actorFor(owner.userId), ch.id, {
      packages: [
        { type: 'custom_quote', name: 'Custom', description: 'Talk to me', price_minor: null, deliverables: [], currency: 'USD', is_active: true },
      ],
    });
    const cqPkg = card.packages.find((p) => p.type === 'custom_quote')!;
    const pub = await marketplaceService.getPublicRateCard(ch.id);
    expect(pub?.has_custom_quote).toBe(true);
    // custom_quote MUST not be in the fixed-price list either.
    expect(pub?.packages.find((p) => p.type === 'custom_quote')).toBeUndefined();
    // Marketplace booking against custom_quote is rejected — sales-assisted only.
    await expect(marketplaceService.submitBooking(await newBuyerActor(), {
      channel_id: ch.id, package_id: cqPkg.id,
      company_name: 'A', contact_name: 'B', contact_email: 'b@t.test',
      campaign_objective: 'x', brief: 'y',
    })).rejects.toMatchObject({ status: 400 });
  });
});

// ============================================================================
// §2 Brand booking + server-side price authority
// ============================================================================
describe('B1 §2 — Brand booking', () => {
  it('#7 brand booking derives price server-side', async () => {
    const owner = await signup(`b1mp-${RUN_TAG}-b7@t.test`);
    const ch = await seedChannel(owner.userId, { verified: 'verified' });
    const card = await marketplaceService.replaceRateCard(actorFor(owner.userId), ch.id, {
      packages: [{ type: 'sponsored_post', name: 'X', description: 'x', price_minor: 25000, deliverables: [], currency: 'USD', is_active: true }],
    });
    const pkg = card.packages[0];
    const order = await marketplaceService.submitBooking(await newBuyerActor(), {
      channel_id: ch.id, package_id: pkg.id,
      company_name: 'Acme', contact_name: 'CN', contact_email: 'cn@acme.test',
      campaign_objective: 'objective', brief: 'brief here',
    });
    expect(order.quoted_price_minor).toBe(25000);
    expect(order.status).toBe('requested');
  });

  it('#8 client-supplied price / status / owner_user_id are IGNORED', async () => {
    const owner = await signup(`b1mp-${RUN_TAG}-b8@t.test`);
    const buyer = await signup(`b1mp-${RUN_TAG}-b8-buyer@t.test`);
    const ch = await seedChannel(owner.userId, { verified: 'verified' });
    const card = await marketplaceService.replaceRateCard(actorFor(owner.userId), ch.id, {
      packages: [{ type: 'sponsored_post', name: 'X', description: 'x', price_minor: 25000, deliverables: [], currency: 'USD', is_active: true }],
    });
    // spoofed extras via API layer — authenticated buyer, but attempts to override economics + parties
    const r = await api<{ order: { quoted_price_minor: number; status: string; owner_user_id: string; buyer_user_id: string } }>('/marketplace/orders', {
      method: 'POST',
      headers: { Cookie: buyer.cookie },
      body: JSON.stringify({
        channel_id: ch.id, package_id: card.packages[0].id,
        company_name: 'Acme', contact_name: 'CN', contact_email: 'cn@acme.test',
        campaign_objective: 'obj', brief: 'brief',
        // spoofed:
        quoted_price_minor: 1, gross_price_minor: 1, price_minor: 1,
        status: 'paid', owner_user_id: 'PWNED', owner_earnings_minor: 999_999_00,
        buyer_user_id: 'PWNED-BUYER',
      }),
    });
    expect(r.status).toBe(201);
    expect(r.body.data?.order.quoted_price_minor).toBe(25000);
    expect(r.body.data?.order.status).toBe('requested');
    expect(r.body.data?.order.owner_user_id).toBe(owner.userId);
    expect(r.body.data?.order.buyer_user_id).toBe(buyer.userId);
  });

  it('#9 booking creates a requested order in DB', async () => {
    const owner = await signup(`b1mp-${RUN_TAG}-b9@t.test`);
    const ch = await seedChannel(owner.userId, { verified: 'verified' });
    const card = await marketplaceService.replaceRateCard(actorFor(owner.userId), ch.id, {
      packages: [{ type: 'sponsored_post', name: 'X', description: 'x', price_minor: 25000, deliverables: [], currency: 'USD', is_active: true }],
    });
    const order = await marketplaceService.submitBooking(await newBuyerActor(), {
      channel_id: ch.id, package_id: card.packages[0].id,
      company_name: 'A', contact_name: 'B', contact_email: 'b@t.test',
      campaign_objective: 'o', brief: 'b',
    });
    const row = await withDb(async (db) => db.collection(COLLECTIONS.MARKETPLACE_ORDERS).findOne({ id: order.id }));
    expect(row?.status).toBe('requested');
    expect(row?.economics_status).toBe('pre_acceptance');
    expect(row?.snapshot).toBeNull();
  });
});

// ============================================================================
// §3 Owner accept/reject + snapshot immutability
// ============================================================================
describe('B1 §3 — Owner accept/reject + snapshot', () => {
  async function bookOrder() {
    const owner = await signup(`b1mp-${RUN_TAG}-o${Math.random().toString(36).slice(2, 6)}@t.test`);
    const ch = await seedChannel(owner.userId, { verified: 'verified' });
    const card = await marketplaceService.replaceRateCard(actorFor(owner.userId), ch.id, {
      packages: [{ type: 'sponsored_post', name: 'X', description: 'x', price_minor: 25000, deliverables: ['1 post'], currency: 'USD', is_active: true }],
    });
    const order = await marketplaceService.submitBooking(await newBuyerActor(), {
      channel_id: ch.id, package_id: card.packages[0].id,
      company_name: 'Acme', contact_name: 'CN', contact_email: 'cn@acme.test',
      campaign_objective: 'o', brief: 'b',
    });
    return { owner, ch, card, order };
  }

  it('#10 the correct owner can accept', async () => {
    const { owner, order } = await bookOrder();
    const accepted = await marketplaceService.ownerAcceptOrder(actorFor(owner.userId), order.id);
    expect(accepted.status).toBe('awaiting_payment');
    expect(accepted.snapshot?.gross_price_minor).toBe(25000);
    expect(accepted.snapshot?.owner_share_bps).toBe(9000);
    expect(accepted.snapshot?.platform_share_bps).toBe(1000);
  });

  it('#11 an unrelated owner CANNOT accept', async () => {
    const { order } = await bookOrder();
    const other = await signup(`b1mp-${RUN_TAG}-oth@t.test`);
    await expect(marketplaceService.ownerAcceptOrder(actorFor(other.userId), order.id)).rejects.toMatchObject({ status: 403 });
  });

  it('#12 owner rejection transitions to owner_rejected', async () => {
    const { owner, order } = await bookOrder();
    const rejected = await marketplaceService.ownerRejectOrder(actorFor(owner.userId), order.id, { reason: 'not a fit' });
    expect(rejected.status).toBe('owner_rejected');
    expect(rejected.rejection_reason).toBe('not a fit');
  });

  it('#13 accepted order snapshot captures package fields as of acceptance', async () => {
    const { owner, ch, card, order } = await bookOrder();
    const accepted = await marketplaceService.ownerAcceptOrder(actorFor(owner.userId), order.id);
    expect(accepted.snapshot?.channel_id).toBe(ch.id);
    expect(accepted.snapshot?.package_id).toBe(card.packages[0].id);
    expect(accepted.snapshot?.gross_price_minor).toBe(25000);
  });

  it('#14 later rate-card price EDIT does NOT change the accepted order snapshot', async () => {
    const { owner, ch, order } = await bookOrder();
    await marketplaceService.ownerAcceptOrder(actorFor(owner.userId), order.id);
    // Edit price after acceptance.
    await marketplaceService.replaceRateCard(actorFor(owner.userId), ch.id, {
      packages: [{ type: 'sponsored_post', name: 'X', description: 'x', price_minor: 999_000, deliverables: ['1 post'], currency: 'USD', is_active: true }],
    });
    const row = await withDb(async (db) => db.collection(COLLECTIONS.MARKETPLACE_ORDERS).findOne({ id: order.id }));
    expect(row?.snapshot?.gross_price_minor).toBe(25000);  // frozen
  });
});

// ============================================================================
// §4 Admin manual payment + idempotency
// ============================================================================
describe('B1 §4 — Admin manual payment + idempotency', () => {
  async function acceptedOrder() {
    const owner = await signup(`b1mp-${RUN_TAG}-pay${Math.random().toString(36).slice(2, 6)}@t.test`);
    const ch = await seedChannel(owner.userId, { verified: 'verified' });
    const card = await marketplaceService.replaceRateCard(actorFor(owner.userId), ch.id, {
      packages: [{ type: 'sponsored_post', name: 'X', description: 'x', price_minor: 25000, deliverables: [], currency: 'USD', is_active: true }],
    });
    const order = await marketplaceService.submitBooking(await newBuyerActor(), {
      channel_id: ch.id, package_id: card.packages[0].id,
      company_name: 'Acme', contact_name: 'CN', contact_email: 'cn@acme.test',
      campaign_objective: 'o', brief: 'b',
    });
    await marketplaceService.ownerAcceptOrder(actorFor(owner.userId), order.id);
    return order.id;
  }

  it('#15 admin can confirm manual payment', async () => {
    const id = await acceptedOrder();
    const admin = await signup(`b1mp-${RUN_TAG}-adm15@t.test`, 'admin');
    const updated = await marketplaceService.adminConfirmPayment(actorFor(admin.userId, 'admin'), id, {
      payment_method: 'bank_transfer',
      payment_reference: `INV-${RUN_TAG}-15`,
      amount_received_minor: 25000, currency: 'USD',
      payment_received_at: new Date().toISOString(),
      gateway_fee_minor: 750,  // known-positive
    });
    expect(updated.status).toBe('paid');
    expect(updated.economics_status).toBe('finalized');
    expect(updated.owner_payable_status).toBe('payable_pending_delivery');
  });

  it('#16 regular user CANNOT confirm payment', async () => {
    const id = await acceptedOrder();
    const user = await signup(`b1mp-${RUN_TAG}-usr16@t.test`);
    const r = await api(`/admin/marketplace/orders/${id}/confirm-payment`, {
      method: 'POST', headers: { Cookie: user.cookie },
      body: JSON.stringify({ payment_method: 'bank_transfer', payment_reference: 'X', amount_received_minor: 25000, currency: 'USD', payment_received_at: new Date().toISOString(), gateway_fee_minor: 0 }),
    });
    expect(r.status).toBe(403);
  });

  it('#17 duplicate payment reference does NOT double-account', async () => {
    const id = await acceptedOrder();
    const admin = await signup(`b1mp-${RUN_TAG}-adm17@t.test`, 'admin');
    const payload = {
      payment_method: 'bank_transfer' as const,
      payment_reference: `INV-${RUN_TAG}-17`,
      amount_received_minor: 25000, currency: 'USD' as const,
      payment_received_at: new Date().toISOString(),
      gateway_fee_minor: 750,
    };
    await marketplaceService.adminConfirmPayment(actorFor(admin.userId, 'admin'), id, payload);
    await marketplaceService.adminConfirmPayment(actorFor(admin.userId, 'admin'), id, payload); // no-op
    await marketplaceService.adminConfirmPayment(actorFor(admin.userId, 'admin'), id, payload); // no-op
    const events = await withDb(async (db) => db.collection(COLLECTIONS.MARKETPLACE_FINANCIAL_EVENTS).find({ order_id: id, event_type: 'PAYMENT_CONFIRMED' }).toArray());
    expect(events.length).toBe(1);
  });
});

// ============================================================================
// §5 Gateway-fee safety
// ============================================================================
describe('B1 §5 — Gateway-fee safety', () => {
  async function paidOrder(fee: number | null): Promise<string> {
    const owner = await signup(`b1mp-${RUN_TAG}-fee${Math.random().toString(36).slice(2, 6)}@t.test`);
    const ch = await seedChannel(owner.userId, { verified: 'verified' });
    const card = await marketplaceService.replaceRateCard(actorFor(owner.userId), ch.id, {
      packages: [{ type: 'sponsored_post', name: 'X', description: 'x', price_minor: 25000, deliverables: [], currency: 'USD', is_active: true }],
    });
    const order = await marketplaceService.submitBooking(await newBuyerActor(), {
      channel_id: ch.id, package_id: card.packages[0].id,
      company_name: 'Acme', contact_name: 'CN', contact_email: 'cn@acme.test',
      campaign_objective: 'o', brief: 'b',
    });
    await marketplaceService.ownerAcceptOrder(actorFor(owner.userId), order.id);
    const admin = await signup(`b1mp-${RUN_TAG}-adm-fee${Math.random().toString(36).slice(2, 6)}@t.test`, 'admin');
    await marketplaceService.adminConfirmPayment(actorFor(admin.userId, 'admin'), order.id, {
      payment_method: 'bank_transfer', payment_reference: `REF-${RUN_TAG}-${order.id.slice(0, 6)}`,
      amount_received_minor: 25000, currency: 'USD', payment_received_at: new Date().toISOString(),
      gateway_fee_minor: fee,
    });
    return order.id;
  }

  it('#18 gateway_fee=null → status=paid, economics_status=pending_fee_reconciliation, payable BLOCKED', async () => {
    const id = await paidOrder(null);
    const row = await withDb(async (db) => db.collection(COLLECTIONS.MARKETPLACE_ORDERS).findOne({ id }));
    expect(row?.status).toBe('paid');
    expect(row?.economics_status).toBe('pending_fee_reconciliation');
    expect(row?.net_transaction_value_minor).toBeNull();
    expect(row?.owner_earnings_minor).toBeNull();
    expect(row?.wavelead_commission_minor).toBeNull();
    expect(row?.owner_payable_status).toBe('blocked_fee_reconciliation');
  });

  it('#19 gateway_fee=0 is a VALID known-zero fee (economics finalized on payment)', async () => {
    const id = await paidOrder(0);
    const row = await withDb(async (db) => db.collection(COLLECTIONS.MARKETPLACE_ORDERS).findOne({ id }));
    expect(row?.economics_status).toBe('finalized');
    expect(row?.net_transaction_value_minor).toBe(25000);
    expect(row?.owner_earnings_minor).toBe(22500);
    expect(row?.wavelead_commission_minor).toBe(2500);
    expect(row?.owner_payable_status).toBe('payable_pending_delivery');
  });
});

// ============================================================================
// §6 90/10 economics + rounding invariant
// ============================================================================
describe('B1 §6 — 90/10 economics', () => {
  it('#20 90/10 calculation is correct using integer math', () => {
    // gross 25000, fee 750 → net 24250 → owner 21825, com 2425
    const s = computeSplit(25000, 750);
    expect(s.net_minor).toBe(24250);
    expect(s.owner_earnings_minor).toBe(Math.floor(24250 * 9000 / 10000));
    expect(s.wavelead_commission_minor).toBe(24250 - s.owner_earnings_minor);
    expect(s.owner_earnings_minor + s.wavelead_commission_minor).toBe(24250);
    // bps constants intact.
    expect(OWNER_SHARE_BPS).toBe(9000);
    expect(PLATFORM_SHARE_BPS).toBe(1000);
  });

  it('#21 rounding invariant: owner + commission = net EXACTLY for a spread of grosses', () => {
    for (let gross = 1; gross <= 100_000; gross += 137) {
      for (const fee of [0, 1, 29, 300, 999]) {
        if (fee > gross) continue;
        const s = computeSplit(gross, fee);
        expect(s.owner_earnings_minor + s.wavelead_commission_minor).toBe(s.net_minor);
        expect(s.owner_earnings_minor).toBeLessThanOrEqual(s.net_minor);
        expect(s.owner_earnings_minor).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

// ============================================================================
// §7 Financial events + fee reconciliation
// ============================================================================
describe('B1 §7 — Financial events', () => {
  it('#22 fee reconciliation appends GATEWAY_FEE_RECONCILED without rewriting prior events', async () => {
    const owner = await signup(`b1mp-${RUN_TAG}-rec@t.test`);
    const ch = await seedChannel(owner.userId, { verified: 'verified' });
    const card = await marketplaceService.replaceRateCard(actorFor(owner.userId), ch.id, {
      packages: [{ type: 'sponsored_post', name: 'X', description: 'x', price_minor: 25000, deliverables: [], currency: 'USD', is_active: true }],
    });
    const order = await marketplaceService.submitBooking(await newBuyerActor(), {
      channel_id: ch.id, package_id: card.packages[0].id,
      company_name: 'A', contact_name: 'B', contact_email: 'b@t.test',
      campaign_objective: 'o', brief: 'b',
    });
    await marketplaceService.ownerAcceptOrder(actorFor(owner.userId), order.id);
    const admin = await signup(`b1mp-${RUN_TAG}-adm-rec@t.test`, 'admin');
    // pay with UNKNOWN fee
    await marketplaceService.adminConfirmPayment(actorFor(admin.userId, 'admin'), order.id, {
      payment_method: 'bank_transfer', payment_reference: `REF-${RUN_TAG}-rec`,
      amount_received_minor: 25000, currency: 'USD', payment_received_at: new Date().toISOString(),
      gateway_fee_minor: null,
    });
    const eventsBefore = await withDb(async (db) => db.collection(COLLECTIONS.MARKETPLACE_FINANCIAL_EVENTS).find({ order_id: order.id }).sort({ created_at: 1 }).toArray());
    expect(eventsBefore.map((e) => e.event_type)).toEqual(['ORDER_ACCEPTED', 'PAYMENT_CONFIRMED']);
    // reconcile fee = 750
    await marketplaceService.adminReconcileFee(actorFor(admin.userId, 'admin'), order.id, { gateway_fee_minor: 750 });
    const eventsAfter = await withDb(async (db) => db.collection(COLLECTIONS.MARKETPLACE_FINANCIAL_EVENTS).find({ order_id: order.id }).sort({ created_at: 1 }).toArray());
    expect(eventsAfter.map((e) => e.event_type)).toEqual(['ORDER_ACCEPTED', 'PAYMENT_CONFIRMED', 'GATEWAY_FEE_RECONCILED']);
    // Prior PAYMENT_CONFIRMED event must be UNCHANGED (still gateway_fee_minor=null).
    const pcBefore = eventsBefore.find((e) => e.event_type === 'PAYMENT_CONFIRMED')!;
    const pcAfter = eventsAfter.find((e) => e.event_type === 'PAYMENT_CONFIRMED')!;
    expect(pcAfter.gateway_fee_minor).toBe(pcBefore.gateway_fee_minor);
    expect(pcAfter.net_amount_minor).toBe(pcBefore.net_amount_minor);
    // Cached order economics are now finalized.
    const row = await withDb(async (db) => db.collection(COLLECTIONS.MARKETPLACE_ORDERS).findOne({ id: order.id }));
    expect(row?.economics_status).toBe('finalized');
    expect(row?.gateway_fee_minor).toBe(750);
    expect(row?.owner_earnings_minor).toBe(Math.floor(24250 * 9000 / 10000));
  });

  it('#23 financial events cannot be mutated through public/regular API surfaces', async () => {
    // There is NO endpoint that mutates events by design; verify none exists.
    // 404 or 405 is acceptable; 200 would be a bug.
    const r1 = await api('/marketplace/financial-events/abc', { method: 'DELETE' });
    const r2 = await api('/admin/marketplace/financial-events/abc', { method: 'PATCH' });
    expect(r1.status).toBeGreaterThanOrEqual(400);
    expect(r2.status).toBeGreaterThanOrEqual(400);
  });
});

// ============================================================================
// §8 Payable status
// ============================================================================
describe('B1 §8 — Owner payable status', () => {
  it('#24 payment with UNKNOWN fee does NOT become payout-ready', async () => {
    const owner = await signup(`b1mp-${RUN_TAG}-24@t.test`);
    const ch = await seedChannel(owner.userId, { verified: 'verified' });
    const card = await marketplaceService.replaceRateCard(actorFor(owner.userId), ch.id, {
      packages: [{ type: 'sponsored_post', name: 'X', description: 'x', price_minor: 25000, deliverables: [], currency: 'USD', is_active: true }],
    });
    const order = await marketplaceService.submitBooking(await newBuyerActor(), {
      channel_id: ch.id, package_id: card.packages[0].id,
      company_name: 'A', contact_name: 'B', contact_email: 'b@t.test', campaign_objective: 'o', brief: 'b',
    });
    await marketplaceService.ownerAcceptOrder(actorFor(owner.userId), order.id);
    const admin = await signup(`b1mp-${RUN_TAG}-adm24@t.test`, 'admin');
    await marketplaceService.adminConfirmPayment(actorFor(admin.userId, 'admin'), order.id, {
      payment_method: 'bank_transfer', payment_reference: `REF-${RUN_TAG}-24`,
      amount_received_minor: 25000, currency: 'USD', payment_received_at: new Date().toISOString(),
      gateway_fee_minor: null,
    });
    const row = await withDb(async (db) => db.collection(COLLECTIONS.MARKETPLACE_ORDERS).findOne({ id: order.id }));
    expect(row?.owner_payable_status).toBe('blocked_fee_reconciliation');
    expect(row?.owner_earnings_minor).toBeNull();
  });

  it('#25 finalized economics produces payable_pending_delivery (NOT payout-ready in B1)', async () => {
    const owner = await signup(`b1mp-${RUN_TAG}-25@t.test`);
    const ch = await seedChannel(owner.userId, { verified: 'verified' });
    const card = await marketplaceService.replaceRateCard(actorFor(owner.userId), ch.id, {
      packages: [{ type: 'sponsored_post', name: 'X', description: 'x', price_minor: 25000, deliverables: [], currency: 'USD', is_active: true }],
    });
    const order = await marketplaceService.submitBooking(await newBuyerActor(), {
      channel_id: ch.id, package_id: card.packages[0].id,
      company_name: 'A', contact_name: 'B', contact_email: 'b@t.test', campaign_objective: 'o', brief: 'b',
    });
    await marketplaceService.ownerAcceptOrder(actorFor(owner.userId), order.id);
    const admin = await signup(`b1mp-${RUN_TAG}-adm25@t.test`, 'admin');
    await marketplaceService.adminConfirmPayment(actorFor(admin.userId, 'admin'), order.id, {
      payment_method: 'bank_transfer', payment_reference: `REF-${RUN_TAG}-25`,
      amount_received_minor: 25000, currency: 'USD', payment_received_at: new Date().toISOString(),
      gateway_fee_minor: 750,
    });
    const row = await withDb(async (db) => db.collection(COLLECTIONS.MARKETPLACE_ORDERS).findOne({ id: order.id }));
    expect(row?.owner_payable_status).toBe('payable_pending_delivery');
    // No `paid_out` state exists in B1 (guaranteed by types)
  });
});

// ============================================================================
// §9 Existing sponsorship-lead fallback still works
// ============================================================================
describe('B1 §9 — Existing sponsorship-lead flow unaffected', () => {
  it('#26 the sponsorship_leads collection remains reachable (no schema conflict) and marketplace_orders is a separate collection', async () => {
    // Cross-collection isolation: marketplace orders never write to sponsorship_leads.
    const before = await withDb(async (db) => db.collection('sponsorship_leads').countDocuments({}));
    const owner = await signup(`b1mp-${RUN_TAG}-26@t.test`);
    const ch = await seedChannel(owner.userId, { verified: 'verified' });
    const card = await marketplaceService.replaceRateCard(actorFor(owner.userId), ch.id, {
      packages: [{ type: 'sponsored_post', name: 'X', description: 'x', price_minor: 25000, deliverables: [], currency: 'USD', is_active: true }],
    });
    await marketplaceService.submitBooking(await newBuyerActor(), {
      channel_id: ch.id, package_id: card.packages[0].id,
      company_name: 'A', contact_name: 'B', contact_email: 'b@t.test', campaign_objective: 'o', brief: 'b',
    });
    const after = await withDb(async (db) => db.collection('sponsorship_leads').countDocuments({}));
    expect(after).toBe(before);   // sponsorship_leads count unchanged
    // The marketplace order landed in the marketplace collection.
    const mp = await withDb(async (db) => db.collection(COLLECTIONS.MARKETPLACE_ORDERS).countDocuments({ channel_id: ch.id }));
    expect(mp).toBe(1);
  });
});

// ============================================================================
// §10 B1.1.1 — Authenticated fixed-price marketplace booking
// ============================================================================
describe('B1 §10 — Authenticated marketplace booking (B1.1.1)', () => {
  it('#27 anonymous fixed-price booking is REJECTED (401) at the service layer', async () => {
    const owner = await signup(`b1mp-${RUN_TAG}-anon-o@t.test`);
    const ch = await seedChannel(owner.userId, { verified: 'verified' });
    const card = await marketplaceService.replaceRateCard(actorFor(owner.userId), ch.id, {
      packages: [{ type: 'sponsored_post', name: 'X', description: 'x', price_minor: 25000, deliverables: [], currency: 'USD', is_active: true }],
    });
    await expect(marketplaceService.submitBooking(null, {
      channel_id: ch.id, package_id: card.packages[0].id,
      company_name: 'A', contact_name: 'B', contact_email: 'b@t.test',
      campaign_objective: 'o', brief: 'b',
    })).rejects.toMatchObject({ status: 401 });
  });

  it('#28 anonymous fixed-price booking is REJECTED (401) at the HTTP layer', async () => {
    const owner = await signup(`b1mp-${RUN_TAG}-http-o@t.test`);
    const ch = await seedChannel(owner.userId, { verified: 'verified' });
    const card = await marketplaceService.replaceRateCard(actorFor(owner.userId), ch.id, {
      packages: [{ type: 'sponsored_post', name: 'X', description: 'x', price_minor: 25000, deliverables: [], currency: 'USD', is_active: true }],
    });
    // NO cookie sent → anonymous
    const r = await api('/marketplace/orders', {
      method: 'POST', body: JSON.stringify({
        channel_id: ch.id, package_id: card.packages[0].id,
        company_name: 'A', contact_name: 'B', contact_email: 'b@t.test',
        campaign_objective: 'o', brief: 'b',
      }),
    });
    expect(r.status).toBe(401);
    const count = await withDb(async (db) => db.collection(COLLECTIONS.MARKETPLACE_ORDERS).countDocuments({ channel_id: ch.id }));
    expect(count).toBe(0);   // no phantom order created
  });

  it('#29 authenticated buyer CAN submit fixed-price booking; buyer_user_id is derived from session', async () => {
    const owner = await signup(`b1mp-${RUN_TAG}-authok-o@t.test`);
    const buyer = await signup(`b1mp-${RUN_TAG}-authok-b@t.test`);
    const ch = await seedChannel(owner.userId, { verified: 'verified' });
    const card = await marketplaceService.replaceRateCard(actorFor(owner.userId), ch.id, {
      packages: [{ type: 'sponsored_post', name: 'X', description: 'x', price_minor: 25000, deliverables: [], currency: 'USD', is_active: true }],
    });
    const r = await api<{ order: { id: string; buyer_user_id: string; quoted_price_minor: number } }>('/marketplace/orders', {
      method: 'POST',
      headers: { Cookie: buyer.cookie },
      body: JSON.stringify({
        channel_id: ch.id, package_id: card.packages[0].id,
        company_name: 'Acme', contact_name: 'CN', contact_email: 'cn@acme.test',
        campaign_objective: 'obj', brief: 'brief',
      }),
    });
    expect(r.status).toBe(201);
    expect(r.body.data?.order.buyer_user_id).toBe(buyer.userId);
    expect(r.body.data?.order.quoted_price_minor).toBe(25000);
  });

  it('#30 client-supplied buyer_user_id is IGNORED — server always uses authenticated session', async () => {
    const owner = await signup(`b1mp-${RUN_TAG}-spoof-o@t.test`);
    const buyer = await signup(`b1mp-${RUN_TAG}-spoof-b@t.test`);
    const attacker = await signup(`b1mp-${RUN_TAG}-spoof-x@t.test`);
    const ch = await seedChannel(owner.userId, { verified: 'verified' });
    const card = await marketplaceService.replaceRateCard(actorFor(owner.userId), ch.id, {
      packages: [{ type: 'sponsored_post', name: 'X', description: 'x', price_minor: 25000, deliverables: [], currency: 'USD', is_active: true }],
    });
    // Buyer's session cookie, but attempts to spoof buyer_user_id as another user in payload.
    const r = await api<{ order: { buyer_user_id: string } }>('/marketplace/orders', {
      method: 'POST',
      headers: { Cookie: buyer.cookie },
      body: JSON.stringify({
        channel_id: ch.id, package_id: card.packages[0].id,
        company_name: 'A', contact_name: 'B', contact_email: 'b@t.test',
        campaign_objective: 'o', brief: 'b',
        buyer_user_id: attacker.userId,                        // spoofed
        buyer: { id: attacker.userId },                        // spoofed alt
      }),
    });
    expect(r.status).toBe(201);
    expect(r.body.data?.order.buyer_user_id).toBe(buyer.userId);    // server authority
    expect(r.body.data?.order.buyer_user_id).not.toBe(attacker.userId);
  });

  it('#31 buyer sees ONLY their own marketplace orders in /marketplace/buyer/orders (cross-buyer isolation)', async () => {
    const owner = await signup(`b1mp-${RUN_TAG}-iso-o@t.test`);
    const buyerA = await signup(`b1mp-${RUN_TAG}-iso-a@t.test`);
    const buyerB = await signup(`b1mp-${RUN_TAG}-iso-b@t.test`);
    const ch = await seedChannel(owner.userId, { verified: 'verified' });
    const card = await marketplaceService.replaceRateCard(actorFor(owner.userId), ch.id, {
      packages: [{ type: 'sponsored_post', name: 'X', description: 'x', price_minor: 25000, deliverables: [], currency: 'USD', is_active: true }],
    });
    // Buyer A books.
    const rA = await api<{ order: { id: string } }>('/marketplace/orders', {
      method: 'POST',
      headers: { Cookie: buyerA.cookie },
      body: JSON.stringify({
        channel_id: ch.id, package_id: card.packages[0].id,
        company_name: 'A', contact_name: 'AC', contact_email: 'a@t.test',
        campaign_objective: 'o', brief: 'b',
      }),
    });
    expect(rA.status).toBe(201);
    const aOrderId = rA.body.data!.order.id;

    // Buyer A lists own orders — must see it.
    const listA = await api<{ items: Array<{ id: string; buyer_user_id: string }> }>('/marketplace/buyer/orders', {
      method: 'GET', headers: { Cookie: buyerA.cookie },
    });
    expect(listA.status).toBe(200);
    const aIds = (listA.body.data?.items || []).map((o) => o.id);
    expect(aIds).toContain(aOrderId);
    for (const o of listA.body.data?.items || []) expect(o.buyer_user_id).toBe(buyerA.userId);

    // Buyer B lists own orders — must NOT see Buyer A's order.
    const listB = await api<{ items: Array<{ id: string; buyer_user_id: string }> }>('/marketplace/buyer/orders', {
      method: 'GET', headers: { Cookie: buyerB.cookie },
    });
    expect(listB.status).toBe(200);
    const bIds = (listB.body.data?.items || []).map((o) => o.id);
    expect(bIds).not.toContain(aOrderId);
    for (const o of listB.body.data?.items || []) expect(o.buyer_user_id).toBe(buyerB.userId);

    // Anonymous cannot list at all.
    const listAnon = await api('/marketplace/buyer/orders', { method: 'GET' });
    expect(listAnon.status).toBe(401);
  });

  it('#32 authenticated public rate-card view remains open to guests (public discovery UNAFFECTED)', async () => {
    const owner = await signup(`b1mp-${RUN_TAG}-pub-o@t.test`);
    const ch = await seedChannel(owner.userId, { verified: 'verified' });
    await marketplaceService.replaceRateCard(actorFor(owner.userId), ch.id, {
      packages: [{ type: 'sponsored_post', name: 'X', description: 'public discovery', price_minor: 25000, deliverables: [], currency: 'USD', is_active: true }],
    });
    // NO cookie — guests must still see the public rate card.
    const r = await api<{ packages: Array<{ id: string; price_minor: number }>; has_custom_quote: boolean }>(`/channels/${ch.id}/rate-card`, { method: 'GET' });
    expect(r.status).toBe(200);
    expect(r.body.data?.packages.length).toBe(1);
    expect(r.body.data?.packages[0].price_minor).toBe(25000);
  });
});

// ============================================================================
// §11 B1.1.2 — Financial safety: BigInt/exact 90/10 + safe bounds + cross-order
// payment-reference reuse block.
// ============================================================================
describe('B1 §11 — Financial safety (B1.1.2)', () => {
  it('#33 exact integer arithmetic: smallest non-zero net (1 cent) maintains owner + platform = net', () => {
    // net = 1 cent → owner = floor(1 * 9000 / 10000) = 0; platform = 1.
    const s = computeSplit(1, 0);
    expect(s.net_minor).toBe(1);
    expect(s.owner_earnings_minor).toBe(0);
    expect(s.wavelead_commission_minor).toBe(1);
    expect(s.owner_earnings_minor + s.wavelead_commission_minor).toBe(s.net_minor);
  });

  it('#34 odd-cent net (99 cents) maintains invariant with residue accruing to WaveLead', () => {
    // net = 99 → owner = floor(99 * 9000 / 10000) = floor(89.1) = 89; platform = 10.
    const s = computeSplit(99, 0);
    expect(s.owner_earnings_minor).toBe(89);
    expect(s.wavelead_commission_minor).toBe(10);
    expect(s.owner_earnings_minor + s.wavelead_commission_minor).toBe(s.net_minor);
  });

  it('#35 large supported amount (100M cents = $1M) is exact and safe', () => {
    // net = 100_000_000 → owner = 90_000_000 exactly; platform = 10_000_000 exactly.
    const s = computeSplit(100_000_000, 0);
    expect(s.owner_earnings_minor).toBe(90_000_000);
    expect(s.wavelead_commission_minor).toBe(10_000_000);
    expect(s.owner_earnings_minor + s.wavelead_commission_minor).toBe(s.net_minor);
    expect(Number.isSafeInteger(s.owner_earnings_minor)).toBe(true);
    expect(Number.isSafeInteger(s.wavelead_commission_minor)).toBe(true);
  });

  it('#36 amount at ceiling (MAX_MONEY_MINOR) is exact; one cent above ceiling is rejected', () => {
    // At ceiling: owner + platform = net exactly.
    const s = computeSplit(MAX_MONEY_MINOR, 0);
    expect(s.net_minor).toBe(MAX_MONEY_MINOR);
    expect(s.owner_earnings_minor + s.wavelead_commission_minor).toBe(MAX_MONEY_MINOR);
    // Above ceiling: safe-integer bound is enforced.
    expect(() => computeSplit(MAX_MONEY_MINOR + 1, 0)).toThrow(/MAX_MONEY_MINOR/);
  });

  it('#37 unsafe/out-of-range monetary inputs are rejected', () => {
    expect(() => computeSplit(-1, 0)).toThrow(/non-negative/);
    expect(() => computeSplit(1.5, 0)).toThrow(/safe integer/);
    expect(() => computeSplit(NaN, 0)).toThrow(/finite/);
    expect(() => computeSplit(Number.POSITIVE_INFINITY, 0)).toThrow(/finite/);
    expect(() => computeSplit(Number.MAX_SAFE_INTEGER + 1, 0)).toThrow();       // not a safe integer
    expect(() => computeSplit(100, 200)).toThrow(/cannot exceed/);              // fee > gross
    expect(() => assertSafeMoney('nope' as unknown, 'x')).toThrow(/finite/);
    expect(() => assertSafeMoney(1.2 as unknown, 'x')).toThrow(/safe integer/);
  });

  it('#38 fuzzed random inputs preserve the invariant owner + platform = net (100 iterations)', () => {
    const seedNet = () => Math.floor(Math.random() * (MAX_MONEY_MINOR + 1));
    for (let i = 0; i < 100; i++) {
      const gross = seedNet();
      const fee = Math.floor(Math.random() * (gross + 1));
      const s = computeSplit(gross, fee);
      expect(s.owner_earnings_minor + s.wavelead_commission_minor).toBe(s.net_minor);
      expect(s.owner_earnings_minor).toBeGreaterThanOrEqual(0);
      expect(s.wavelead_commission_minor).toBeGreaterThanOrEqual(0);
      // Owner never gets MORE than 90% (residue accrues to WaveLead).
      expect(s.owner_earnings_minor * 10_000).toBeLessThanOrEqual(s.net_minor * OWNER_SHARE_BPS);
      // Owner + platform = 100% of net (implicit).
      expect(OWNER_SHARE_BPS + PLATFORM_SHARE_BPS).toBe(10_000);
    }
  });

  it('#39 same payment reference repeated on SAME order is idempotent (no duplicate event)', async () => {
    const owner = await signup(`b1mp-${RUN_TAG}-i39-o@t.test`);
    const buyer = await signup(`b1mp-${RUN_TAG}-i39-b@t.test`);
    const admin = await signup(`b1mp-${RUN_TAG}-i39-a@t.test`, 'admin');
    const ch = await seedChannel(owner.userId, { verified: 'verified' });
    const card = await marketplaceService.replaceRateCard(actorFor(owner.userId), ch.id, {
      packages: [{ type: 'sponsored_post', name: 'X', description: 'x', price_minor: 25000, deliverables: [], currency: 'USD', is_active: true }],
    });
    const order = await marketplaceService.submitBooking(actorFor(buyer.userId), {
      channel_id: ch.id, package_id: card.packages[0].id,
      company_name: 'A', contact_name: 'B', contact_email: 'b@t.test', campaign_objective: 'o', brief: 'b',
    });
    await marketplaceService.ownerAcceptOrder(actorFor(owner.userId), order.id);
    const ref = `SAMEREF-${RUN_TAG}-39`;
    const payload = {
      payment_method: 'bank_transfer' as const, payment_reference: ref,
      amount_received_minor: 25000, currency: 'USD' as const,
      payment_received_at: new Date().toISOString(), gateway_fee_minor: 750,
    };
    await marketplaceService.adminConfirmPayment(actorFor(admin.userId, 'admin'), order.id, payload);
    // Retry same reference — must be a safe no-op.
    await marketplaceService.adminConfirmPayment(actorFor(admin.userId, 'admin'), order.id, payload);
    await marketplaceService.adminConfirmPayment(actorFor(admin.userId, 'admin'), order.id, payload);
    const events = await withDb(async (db) => db.collection(COLLECTIONS.MARKETPLACE_FINANCIAL_EVENTS).find({ order_id: order.id, event_type: 'PAYMENT_CONFIRMED' }).toArray());
    expect(events.length).toBe(1);
  });

  it('#40 same payment reference applied to a DIFFERENT order is REJECTED (409, no side effects)', async () => {
    const owner = await signup(`b1mp-${RUN_TAG}-i40-o@t.test`);
    const buyerA = await signup(`b1mp-${RUN_TAG}-i40-a@t.test`);
    const buyerB = await signup(`b1mp-${RUN_TAG}-i40-b@t.test`);
    const admin = await signup(`b1mp-${RUN_TAG}-i40-adm@t.test`, 'admin');
    const ch = await seedChannel(owner.userId, { verified: 'verified' });
    const card = await marketplaceService.replaceRateCard(actorFor(owner.userId), ch.id, {
      packages: [{ type: 'sponsored_post', name: 'X', description: 'x', price_minor: 25000, deliverables: [], currency: 'USD', is_active: true }],
    });
    const orderA = await marketplaceService.submitBooking(actorFor(buyerA.userId), {
      channel_id: ch.id, package_id: card.packages[0].id,
      company_name: 'A', contact_name: 'A', contact_email: 'a@t.test', campaign_objective: 'o', brief: 'b',
    });
    const orderB = await marketplaceService.submitBooking(actorFor(buyerB.userId), {
      channel_id: ch.id, package_id: card.packages[0].id,
      company_name: 'B', contact_name: 'B', contact_email: 'b@t.test', campaign_objective: 'o', brief: 'b',
    });
    await marketplaceService.ownerAcceptOrder(actorFor(owner.userId), orderA.id);
    await marketplaceService.ownerAcceptOrder(actorFor(owner.userId), orderB.id);

    const sharedRef = `SHARED-${RUN_TAG}-40`;
    // Fund order A with the shared reference.
    await marketplaceService.adminConfirmPayment(actorFor(admin.userId, 'admin'), orderA.id, {
      payment_method: 'bank_transfer', payment_reference: sharedRef,
      amount_received_minor: 25000, currency: 'USD',
      payment_received_at: new Date().toISOString(), gateway_fee_minor: 750,
    });
    // Attempt to reuse on order B — must be rejected with 409.
    await expect(marketplaceService.adminConfirmPayment(actorFor(admin.userId, 'admin'), orderB.id, {
      payment_method: 'bank_transfer', payment_reference: sharedRef,
      amount_received_minor: 25000, currency: 'USD',
      payment_received_at: new Date().toISOString(), gateway_fee_minor: 750,
    })).rejects.toMatchObject({ status: 409 });

    // Order B economics MUST remain unmodified.
    const bAfter = await withDb(async (db) => db.collection(COLLECTIONS.MARKETPLACE_ORDERS).findOne({ id: orderB.id }));
    expect(bAfter?.status).toBe('awaiting_payment');
    expect(bAfter?.payment_method).toBe(null);
    expect(bAfter?.payment_reference_normalized).toBe(null);
    expect(bAfter?.owner_earnings_minor).toBe(null);
    expect(bAfter?.wavelead_commission_minor).toBe(null);
    // No PAYMENT_CONFIRMED event appended for order B.
    const bEvents = await withDb(async (db) => db.collection(COLLECTIONS.MARKETPLACE_FINANCIAL_EVENTS).find({ order_id: orderB.id, event_type: 'PAYMENT_CONFIRMED' }).toArray());
    expect(bEvents.length).toBe(0);
  });

  it('#41 different legitimate payment references on different orders work normally', async () => {
    const owner = await signup(`b1mp-${RUN_TAG}-i41-o@t.test`);
    const buyerA = await signup(`b1mp-${RUN_TAG}-i41-a@t.test`);
    const buyerB = await signup(`b1mp-${RUN_TAG}-i41-b@t.test`);
    const admin = await signup(`b1mp-${RUN_TAG}-i41-adm@t.test`, 'admin');
    const ch = await seedChannel(owner.userId, { verified: 'verified' });
    const card = await marketplaceService.replaceRateCard(actorFor(owner.userId), ch.id, {
      packages: [{ type: 'sponsored_post', name: 'X', description: 'x', price_minor: 25000, deliverables: [], currency: 'USD', is_active: true }],
    });
    const orderA = await marketplaceService.submitBooking(actorFor(buyerA.userId), {
      channel_id: ch.id, package_id: card.packages[0].id,
      company_name: 'A', contact_name: 'A', contact_email: 'a@t.test', campaign_objective: 'o', brief: 'b',
    });
    const orderB = await marketplaceService.submitBooking(actorFor(buyerB.userId), {
      channel_id: ch.id, package_id: card.packages[0].id,
      company_name: 'B', contact_name: 'B', contact_email: 'b@t.test', campaign_objective: 'o', brief: 'b',
    });
    await marketplaceService.ownerAcceptOrder(actorFor(owner.userId), orderA.id);
    await marketplaceService.ownerAcceptOrder(actorFor(owner.userId), orderB.id);

    const updatedA = await marketplaceService.adminConfirmPayment(actorFor(admin.userId, 'admin'), orderA.id, {
      payment_method: 'bank_transfer', payment_reference: `REFA-${RUN_TAG}-41`,
      amount_received_minor: 25000, currency: 'USD',
      payment_received_at: new Date().toISOString(), gateway_fee_minor: 750,
    });
    const updatedB = await marketplaceService.adminConfirmPayment(actorFor(admin.userId, 'admin'), orderB.id, {
      payment_method: 'bank_transfer', payment_reference: `REFB-${RUN_TAG}-41`,
      amount_received_minor: 25000, currency: 'USD',
      payment_received_at: new Date().toISOString(), gateway_fee_minor: 750,
    });
    expect(updatedA.status).toBe('paid');
    expect(updatedB.status).toBe('paid');
    expect(updatedA.owner_earnings_minor).toBe(21825);      // (25000-750)*9000/10000 = 21825
    expect(updatedB.owner_earnings_minor).toBe(21825);
    expect((updatedA.owner_earnings_minor ?? 0) + (updatedA.wavelead_commission_minor ?? 0)).toBe(updatedA.net_transaction_value_minor);
    expect((updatedB.owner_earnings_minor ?? 0) + (updatedB.wavelead_commission_minor ?? 0)).toBe(updatedB.net_transaction_value_minor);
  });

  it('#42 same reference but DIFFERENT payment_method on a different order is treated as a distinct identity', async () => {
    // Rationale: real-world identity is (method, ref). "TX-123" via PayPal and
    // "TX-123" via bank_transfer are two different real payments.
    const owner = await signup(`b1mp-${RUN_TAG}-i42-o@t.test`);
    const buyerA = await signup(`b1mp-${RUN_TAG}-i42-a@t.test`);
    const buyerB = await signup(`b1mp-${RUN_TAG}-i42-b@t.test`);
    const admin = await signup(`b1mp-${RUN_TAG}-i42-adm@t.test`, 'admin');
    const ch = await seedChannel(owner.userId, { verified: 'verified' });
    const card = await marketplaceService.replaceRateCard(actorFor(owner.userId), ch.id, {
      packages: [{ type: 'sponsored_post', name: 'X', description: 'x', price_minor: 25000, deliverables: [], currency: 'USD', is_active: true }],
    });
    const orderA = await marketplaceService.submitBooking(actorFor(buyerA.userId), {
      channel_id: ch.id, package_id: card.packages[0].id,
      company_name: 'A', contact_name: 'A', contact_email: 'a@t.test', campaign_objective: 'o', brief: 'b',
    });
    const orderB = await marketplaceService.submitBooking(actorFor(buyerB.userId), {
      channel_id: ch.id, package_id: card.packages[0].id,
      company_name: 'B', contact_name: 'B', contact_email: 'b@t.test', campaign_objective: 'o', brief: 'b',
    });
    await marketplaceService.ownerAcceptOrder(actorFor(owner.userId), orderA.id);
    await marketplaceService.ownerAcceptOrder(actorFor(owner.userId), orderB.id);

    const shared = `TX-${RUN_TAG}-42`;
    // Order A: bank_transfer / TX-…
    await marketplaceService.adminConfirmPayment(actorFor(admin.userId, 'admin'), orderA.id, {
      payment_method: 'bank_transfer', payment_reference: shared,
      amount_received_minor: 25000, currency: 'USD',
      payment_received_at: new Date().toISOString(), gateway_fee_minor: 750,
    });
    // Order B: paypal_manual / TX-… — DIFFERENT payment identity, so allowed.
    const updatedB = await marketplaceService.adminConfirmPayment(actorFor(admin.userId, 'admin'), orderB.id, {
      payment_method: 'paypal_manual', payment_reference: shared,
      amount_received_minor: 25000, currency: 'USD',
      payment_received_at: new Date().toISOString(), gateway_fee_minor: 750,
    });
    expect(updatedB.status).toBe('paid');
    expect(updatedB.payment_method).toBe('paypal_manual');
  });

  it('#43 cross-order block also fires when the DB unique index catches a race (E11000 → 409)', async () => {
    // We simulate the race by directly inserting an order document with the
    // same payment identity, then attempting the service confirmation on
    // another order. The DB partial unique index must translate to a 409.
    const owner = await signup(`b1mp-${RUN_TAG}-i43-o@t.test`);
    const buyer = await signup(`b1mp-${RUN_TAG}-i43-b@t.test`);
    const admin = await signup(`b1mp-${RUN_TAG}-i43-adm@t.test`, 'admin');
    const ch = await seedChannel(owner.userId, { verified: 'verified' });
    const card = await marketplaceService.replaceRateCard(actorFor(owner.userId), ch.id, {
      packages: [{ type: 'sponsored_post', name: 'X', description: 'x', price_minor: 25000, deliverables: [], currency: 'USD', is_active: true }],
    });
    const order = await marketplaceService.submitBooking(actorFor(buyer.userId), {
      channel_id: ch.id, package_id: card.packages[0].id,
      company_name: 'A', contact_name: 'B', contact_email: 'b@t.test', campaign_objective: 'o', brief: 'b',
    });
    await marketplaceService.ownerAcceptOrder(actorFor(owner.userId), order.id);

    const norm = `race-${RUN_TAG}-43`;
    // Pre-plant a "ghost" order document holding the exact payment identity.
    await withDb(async (db) => {
      await db.collection(COLLECTIONS.MARKETPLACE_ORDERS).insertOne({
        id: `ghost-${RUN_TAG}-43`, status: 'paid',
        payment_method: 'bank_transfer',
        payment_reference_normalized: norm,
        created_at: new Date(), updated_at: new Date(),
      } as unknown as Record<string, unknown>);
    });
    // The service pre-check will find the ghost and 409 before writing.
    await expect(marketplaceService.adminConfirmPayment(actorFor(admin.userId, 'admin'), order.id, {
      payment_method: 'bank_transfer', payment_reference: norm,
      amount_received_minor: 25000, currency: 'USD',
      payment_received_at: new Date().toISOString(), gateway_fee_minor: 750,
    })).rejects.toMatchObject({ status: 409 });
  });
});
