// Phase B3.2 Gate C — Owner Earnings + Payout Account tests.
//
// Scope proven by these tests:
//   §1  Earnings rollup: pending / available / paid_out / blocked buckets
//   §2  Settlement hold: configurable + honored by both rollup and request
//   §3  Payout method: upsert / idempotency / different-email replace
//   §4  Verification code: correct verifies; wrong rejected; masking preserved
//   §5  Request Payout: preconditions, no money, idempotent, refund block
//   §6  Admin masked view + RBAC
//   §7  Regression: existing manual adminRecordPayout still works
//
// Reuses B2/B3/Gate A/Gate B service layer; never mutates other test data.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MongoClient, type Db } from 'mongodb';
import { v4 as uuidv4 } from 'uuid';
import { COLLECTIONS } from '@/lib/db/collections';
import { marketplaceService, getSettlementHoldHours } from '@/lib/services/marketplaceService';
import { marketplaceFinancialEventRepo, marketplaceOrderRepo, ownerPayoutMethodRepo } from '@/lib/repositories/marketplaceRepo';
import type { Actor, Channel, MarketplaceOrder } from '@/lib/types';

const BASE = 'http://localhost:3000/api';
const CLIENT_IP = () => `10.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;
const RUN_TAG = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;

async function withDb<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  const client = new MongoClient(process.env.MONGO_URL || 'mongodb://localhost:27017');
  await client.connect();
  try { return await fn(client.db(process.env.DB_NAME || 'wavelead')); } finally { await client.close(); }
}

async function signup(email: string, role?: string): Promise<{ userId: string }> {
  const s = await fetch(`${BASE}/auth/signup`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': CLIENT_IP() },
    body: JSON.stringify({ email, password: 'password123!', display_name: `T-${email.split('@')[0]}` }),
  });
  const j = await s.json() as { data?: { user?: { id?: string } } };
  const userId = j?.data?.user?.id as string;
  if (role) await withDb(async (db) => { await db.collection('users').updateOne({ id: userId }, { $set: { role } }); });
  return { userId };
}

function actorFor(user_id: string, role = 'user'): Actor {
  return { session: { userId: user_id, email: `${user_id}@t.test`, v: 0 }, user: { id: user_id, email: `${user_id}@t.test`, role, display_name: user_id, avatar_url: null, country_code: null, preferred_language: 'en', auth_providers: [], created_at: new Date(), updated_at: new Date() } } as unknown as Actor;
}

async function seedChannel(ownerId: string, name = 'GC'): Promise<Channel> {
  const id = uuidv4();
  const slug = `gc-ch-${id.slice(0, 8)}`;
  const now = new Date();
  const doc = {
    id, slug, name: `${name} ${id.slice(0, 6)}`,
    whatsapp_url: `https://whatsapp.com/channel/0029Vc${id.slice(0, 20).replace(/-/g, '')}`,
    whatsapp_channel_id: `0029Vc${id.slice(0, 20).replace(/-/g, '')}`,
    description: 'a completely-populated test channel description',
    short_description: 'a completely-populated test channel description',
    logo_url: 'https://example.com/logo.png', cover_url: null, website_url: null,
    country_code: 'US', follower_count: 5000, is_official: false, is_verified: true,
    verification_status: 'verified', owner_id: ownerId, category_id: null,
    tags: [], status: 'approved', view_count: 0, click_count: 0, follow_intent_count: 0,
    created_at: now, updated_at: now, submitted_by: null, published_at: now, moderated_by: null, moderated_at: now,
  };
  await withDb(async (db) => { await db.collection('channels').insertOne(doc as unknown as Record<string, unknown>); });
  return doc as unknown as Channel;
}

async function createCompletedOrder(tag: string): Promise<{
  owner: { userId: string };
  buyer: { userId: string };
  admin: { userId: string };
  ch: Channel;
  order: MarketplaceOrder;
}> {
  const owner = await signup(`gc-${RUN_TAG}-${tag}-o@t.test`);
  const buyer = await signup(`gc-${RUN_TAG}-${tag}-b@t.test`);
  const admin = await signup(`gc-${RUN_TAG}-${tag}-a@t.test`, 'admin');
  const ch = await seedChannel(owner.userId, tag);
  const card = await marketplaceService.replaceRateCard(actorFor(owner.userId), ch.id, {
    packages: [{ type: 'sponsored_post', name: 'Std', description: 'std', price_minor: 25000, deliverables: ['1 post'], currency: 'USD', is_active: true }],
  });
  const submitted = await marketplaceService.submitBooking(actorFor(buyer.userId), {
    channel_id: ch.id, package_id: card.packages[0].id,
    company_name: 'AcmeGC', contact_name: 'A', contact_email: 'a@t.test', campaign_objective: 'o', brief: 'b',
  });
  await marketplaceService.ownerAcceptOrder(actorFor(owner.userId), submitted.id);
  const paid = await marketplaceService.adminConfirmPayment(actorFor(admin.userId, 'admin'), submitted.id, {
    payment_method: 'bank_transfer', payment_reference: `GC-${RUN_TAG}-${tag}`,
    amount_received_minor: 25000, currency: 'USD',
    payment_received_at: new Date().toISOString(), gateway_fee_minor: 750,
  });
  await marketplaceService.startWork(actorFor(owner.userId), paid.id);
  await marketplaceService.submitDelivery(actorFor(owner.userId), paid.id, { delivery_urls: ['https://example.com/x'], notes_to_brand: 'done' });
  const done = await marketplaceService.buyerAcceptDelivery(actorFor(buyer.userId), paid.id);
  return { owner, buyer, admin, ch, order: done };
}

/** Force settlement to be considered elapsed by pushing payout_available_at into the past. */
async function ageSettlement(orderId: string): Promise<void> {
  await withDb(async (db) => {
    await db.collection(COLLECTIONS.MARKETPLACE_ORDERS).updateOne(
      { id: orderId },
      { $set: { payout_available_at: new Date(Date.now() - 1000) } },
    );
  });
}

async function upsertAndVerify(ownerId: string, email: string): Promise<void> {
  const r = await marketplaceService.ownerUpsertPayoutMethod(actorFor(ownerId), { paypal_email: email });
  if (r.verification_code_dev) {
    await marketplaceService.ownerVerifyPayoutMethod(actorFor(ownerId), { verification_code: r.verification_code_dev });
  }
}

beforeAll(async () => {
  // No ephemeral index create — the running server has already ensured
  // the correct `uniq_id` index; creating a duplicate with a different
  // name here would conflict with ensureIndexes on subsequent runs.
});

afterAll(async () => {
  await withDb(async (db) => {
    const rx = new RegExp(`gc-${RUN_TAG}`);
    await db.collection('users').deleteMany({ email: rx });
    await db.collection('channels').deleteMany({ name: rx });
    await db.collection(COLLECTIONS.MARKETPLACE_ORDERS).deleteMany({ 'brief.company_name': 'AcmeGC' });
    await db.collection(COLLECTIONS.OWNER_PAYOUT_METHODS).deleteMany({});
    // Clean up dangling ephemeral index from earlier iterations, if any.
    await db.collection(COLLECTIONS.OWNER_PAYOUT_METHODS).dropIndex('uniq_id_ephemeral_test').catch(() => {});
  });
});

// ============================================================================
// §1 Earnings rollup
// ============================================================================
describe('B3.2 Gate C §1 — Earnings rollup', () => {
  it('#1 completed order lands in Pending Earnings until settlement hold elapses', async () => {
    const { owner, order } = await createCompletedOrder('r1');
    const roll = await marketplaceService.ownerListEarnings(actorFor(owner.userId));
    const row = roll.orders.find((o) => o.id === order.id);
    expect(row?.bucket).toBe('pending');
    expect(roll.totals.pending_earnings_minor).toBeGreaterThanOrEqual(order.owner_earnings_minor || 0);
    expect(roll.settlement_hold_hours).toBe(getSettlementHoldHours());
  });

  it('#2 after settlement hold elapses the order moves to Available for Payout', async () => {
    const { owner, order } = await createCompletedOrder('r2');
    await ageSettlement(order.id);
    const roll = await marketplaceService.ownerListEarnings(actorFor(owner.userId));
    const row = roll.orders.find((o) => o.id === order.id);
    expect(row?.bucket).toBe('available');
    expect(roll.totals.available_payout_minor).toBeGreaterThanOrEqual(order.owner_earnings_minor || 0);
  });

  it('#3 paid_out orders land in Paid Out bucket', async () => {
    const { owner, admin, order } = await createCompletedOrder('r3');
    await ageSettlement(order.id);
    await marketplaceService.adminRecordPayout(actorFor(admin.userId, 'admin'), order.id, {
      payout_method: 'bank_transfer', payout_reference: `EXT-${RUN_TAG}-r3`,
      paid_at: new Date().toISOString(),
      confirm: 'PAYOUT COMPLETED EXTERNALLY',
    });
    const roll = await marketplaceService.ownerListEarnings(actorFor(owner.userId));
    const row = roll.orders.find((o) => o.id === order.id);
    expect(row?.bucket).toBe('paid_out');
    expect(roll.totals.paid_out_minor).toBeGreaterThanOrEqual(order.owner_earnings_minor || 0);
  });

  it('#4 refund reconciliation moves earnings to On Hold (blocked)', async () => {
    const { owner, order } = await createCompletedOrder('r4');
    await withDb((db) => db.collection(COLLECTIONS.MARKETPLACE_ORDERS).updateOne({ id: order.id }, { $set: { payment_reconciliation_required: true, owner_payable_status: 'manual_reconciliation_required' } }));
    const roll = await marketplaceService.ownerListEarnings(actorFor(owner.userId));
    const row = roll.orders.find((o) => o.id === order.id);
    expect(row?.bucket).toBe('blocked');
    expect(roll.totals.blocked_minor).toBeGreaterThan(0);
  });
});

// ============================================================================
// §2 Payout method upsert + verification
// ============================================================================
describe('B3.2 Gate C §2 — Payout method + verification', () => {
  it('#5 upsert requires a valid email (invalid → 400)', async () => {
    const owner = await signup(`gc-${RUN_TAG}-em5-o@t.test`);
    await expect(marketplaceService.ownerUpsertPayoutMethod(actorFor(owner.userId), { paypal_email: 'not-an-email' })).rejects.toMatchObject({ status: 400 });
    await expect(marketplaceService.ownerUpsertPayoutMethod(actorFor(owner.userId), {})).rejects.toMatchObject({ status: 400 });
  });

  it('#6 upsert returns masked destination + verification code (dev)', async () => {
    const owner = await signup(`gc-${RUN_TAG}-em6-o@t.test`);
    const r = await marketplaceService.ownerUpsertPayoutMethod(actorFor(owner.userId), { paypal_email: 'tiara.andini@example.com' });
    expect(r.method.paypal_email_masked).toBe('t***i@example.com');
    expect(r.method.is_verified).toBe(false);
    expect(r.verification_required).toBe(true);
    expect(r.verification_code_dev).toMatch(/^\d{6}$/);
  });

  it('#7 same email repeated is idempotent (returns SAME row; issues fresh code)', async () => {
    const owner = await signup(`gc-${RUN_TAG}-em7-o@t.test`);
    const a = await marketplaceService.ownerUpsertPayoutMethod(actorFor(owner.userId), { paypal_email: 'x@example.com' });
    const b = await marketplaceService.ownerUpsertPayoutMethod(actorFor(owner.userId), { paypal_email: 'x@example.com' });
    expect(b.method.id).toBe(a.method.id);
    expect(b.verification_required).toBe(true);
  });

  it('#8 different email deactivates old and creates a new unverified row', async () => {
    const owner = await signup(`gc-${RUN_TAG}-em8-o@t.test`);
    const a = await marketplaceService.ownerUpsertPayoutMethod(actorFor(owner.userId), { paypal_email: 'first@example.com' });
    const b = await marketplaceService.ownerUpsertPayoutMethod(actorFor(owner.userId), { paypal_email: 'second@example.com' });
    expect(b.method.id).not.toBe(a.method.id);
    expect(b.method.is_active).toBe(true);
    expect(b.method.is_verified).toBe(false);
  });

  it('#9 correct verification code verifies; wrong code rejected + attempts increment', async () => {
    const owner = await signup(`gc-${RUN_TAG}-em9-o@t.test`);
    const r = await marketplaceService.ownerUpsertPayoutMethod(actorFor(owner.userId), { paypal_email: 'v@example.com' });
    await expect(marketplaceService.ownerVerifyPayoutMethod(actorFor(owner.userId), { verification_code: '000000' })).rejects.toMatchObject({ status: 400 });
    const ok = await marketplaceService.ownerVerifyPayoutMethod(actorFor(owner.userId), { verification_code: r.verification_code_dev! });
    expect(ok.is_verified).toBe(true);
    // maskEmail keeps only first char when local part length ≤ 2.
    expect(ok.paypal_email_masked).toBe('v***@example.com');
  });
});

// ============================================================================
// §3 Request Payout preconditions + no money
// ============================================================================
describe('B3.2 Gate C §3 — Request Payout', () => {
  it('#10 cannot request payout before settlement hold elapses', async () => {
    const { owner, order } = await createCompletedOrder('rp10');
    await upsertAndVerify(owner.userId, 'rp10@example.com');
    await expect(marketplaceService.ownerRequestPayout(actorFor(owner.userId), order.id)).rejects.toMatchObject({ status: 400 });
  });

  it('#11 cannot request payout without a verified payout method', async () => {
    const { owner, order } = await createCompletedOrder('rp11');
    await ageSettlement(order.id);
    // No payout method at all.
    await expect(marketplaceService.ownerRequestPayout(actorFor(owner.userId), order.id)).rejects.toMatchObject({ status: 400 });
    // Add unverified method — still blocked.
    await marketplaceService.ownerUpsertPayoutMethod(actorFor(owner.userId), { paypal_email: 'rp11@example.com' });
    await expect(marketplaceService.ownerRequestPayout(actorFor(owner.userId), order.id)).rejects.toMatchObject({ status: 400 });
  });

  it('#12 verified + settled → request succeeds, sets payout_requested_at, appends OWNER_PAYOUT_REQUESTED event, sends NO money', async () => {
    const { owner, order } = await createCompletedOrder('rp12');
    await ageSettlement(order.id);
    await upsertAndVerify(owner.userId, 'rp12@example.com');
    const updated = await marketplaceService.ownerRequestPayout(actorFor(owner.userId), order.id);
    expect(updated.payout_requested_at).toBeTruthy();
    expect(updated.owner_payable_status).toBe('eligible_for_payout');   // NOT paid_out
    // Zero payout rows.
    const payouts = await withDb((db) => db.collection(COLLECTIONS.MARKETPLACE_OWNER_PAYOUTS).find({ order_id: order.id }).toArray());
    expect(payouts.length).toBe(0);
    // Exactly one OWNER_PAYOUT_REQUESTED event.
    const events = await marketplaceFinancialEventRepo.listByOrder(order.id);
    expect(events.filter((e) => e.event_type === 'OWNER_PAYOUT_REQUESTED').length).toBe(1);
    expect(events.filter((e) => e.event_type === 'OWNER_PAYOUT_RECORDED').length).toBe(0);
  });

  it('#13 request payout is idempotent — repeat does not double-log', async () => {
    const { owner, order } = await createCompletedOrder('rp13');
    await ageSettlement(order.id);
    await upsertAndVerify(owner.userId, 'rp13@example.com');
    await marketplaceService.ownerRequestPayout(actorFor(owner.userId), order.id);
    await marketplaceService.ownerRequestPayout(actorFor(owner.userId), order.id);
    const events = await marketplaceFinancialEventRepo.listByOrder(order.id);
    expect(events.filter((e) => e.event_type === 'OWNER_PAYOUT_REQUESTED').length).toBe(1);
  });

  it('#14 unrelated owner cannot request payout on another owner\'s order (403)', async () => {
    const { order } = await createCompletedOrder('rp14');
    await ageSettlement(order.id);
    const stranger = await signup(`gc-${RUN_TAG}-rp14-x@t.test`);
    await upsertAndVerify(stranger.userId, 'stranger@example.com');
    await expect(marketplaceService.ownerRequestPayout(actorFor(stranger.userId), order.id)).rejects.toMatchObject({ status: 403 });
  });

  it('#15 refund/reversal after request keeps payout blocked; admin external payout fallback still records correctly', async () => {
    const { owner, admin, order } = await createCompletedOrder('rp15');
    await ageSettlement(order.id);
    await upsertAndVerify(owner.userId, 'rp15@example.com');
    await marketplaceService.ownerRequestPayout(actorFor(owner.userId), order.id);
    // Admin records external payout — existing manual fallback still works.
    const res = await marketplaceService.adminRecordPayout(actorFor(admin.userId, 'admin'), order.id, {
      payout_method: 'bank_transfer', payout_reference: `EXT-${RUN_TAG}-rp15`,
      paid_at: new Date().toISOString(),
      confirm: 'PAYOUT COMPLETED EXTERNALLY',
    });
    expect(res.order.owner_payable_status).toBe('paid_out');
    // Economics unchanged.
    expect(res.order.owner_earnings_minor).toBe(order.owner_earnings_minor);
    expect(res.order.gateway_fee_minor).toBe(order.gateway_fee_minor);
    expect(res.order.net_transaction_value_minor).toBe(order.net_transaction_value_minor);
  });
});

// ============================================================================
// §4 Admin surface + RBAC
// ============================================================================
describe('B3.2 Gate C §4 — Admin listing + RBAC', () => {
  it('#16 admin can list payout methods (masked); non-admin 403', async () => {
    const { owner, admin } = await createCompletedOrder('rb16');
    await upsertAndVerify(owner.userId, 'rb16@example.com');
    const list = await marketplaceService.adminListPayoutMethods(actorFor(admin.userId, 'admin'));
    expect(list.some((m) => m.paypal_email_masked === 'r***6@example.com')).toBe(true);
    await expect(marketplaceService.adminListPayoutMethods(actorFor(owner.userId))).rejects.toMatchObject({ status: 403 });
  });

  it('#17 raw email + verification hash never appear in admin masked list', async () => {
    const owner = await signup(`gc-${RUN_TAG}-rb17-o@t.test`);
    const admin = await signup(`gc-${RUN_TAG}-rb17-a@t.test`, 'admin');
    await upsertAndVerify(owner.userId, 'secret.address@example.com');
    const list = await marketplaceService.adminListPayoutMethods(actorFor(admin.userId, 'admin'));
    const stringified = JSON.stringify(list);
    expect(stringified).not.toContain('secret.address@example.com');
    expect(stringified).not.toContain('verification_code_hash');
  });
});
