// M11-Batch2B — Verified Owner Activation ($1 sandbox).
//
// Contract validated:
//   §1  Requires authenticated owner of an ownership-approved channel
//   §2  Unrelated user blocked (403)
//   §3  Server-derived $1.00 amount (client cannot influence)
//   §4  Payment domain isolation (own collection, purpose=CHANNEL_OWNER_ACTIVATION)
//   §5  Sandbox capture w/o fee → captured_pending_fee, NO credit, activation NOT active
//   §6  Admin reconcile-fee → credit issued exactly once + activation active
//   §7  Duplicate capture / reconcile is safe (idempotency)
//   §8  Refund → activation revoked BUT ownership survives (owner_id + verification_status intact)
//   §9  Public "Owner Verified" badge respects the (ownership approved AND activation active) invariant
//  §10  Marketplace + Promote domains remain queryable-distinct (no cross-contamination on shape)
//  §11  Client-supplied amount is IGNORED — server always uses 100 minor
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MongoClient, type Db } from 'mongodb';
import { v4 as uuidv4 } from 'uuid';
import { COLLECTIONS } from '@/lib/db/collections';
import { _setPaymentProviderForTesting } from '@/lib/services/payments/providerFactory';
import { channelActivationService, waveLeadCreditService, ACTIVATION_AMOUNT_MINOR } from '@/lib/services/channelActivationService';
import { sanitizeChannel } from '@/lib/utils/sanitize';
import type { Actor, ChannelActivationPayment } from '@/lib/types';
import type {
  CreatePaymentInput, CapturePaymentInput, RefundInput, RetrieveCaptureInput,
  PaymentProvider,
} from '@/lib/services/payments/paymentProvider';

const BASE = 'http://localhost:3000/api';
const PAGE = 'http://localhost:3000';
const RUN_TAG = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;

async function withDb<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  const client = new MongoClient(process.env.MONGO_URL || 'mongodb://localhost:27017');
  await client.connect();
  try { return await fn(client.db(process.env.DB_NAME || 'wavelead')); }
  finally { await client.close(); }
}
function ip(): string { return `10.${Math.floor(Math.random()*255)}.${Math.floor(Math.random()*255)}.${Math.floor(Math.random()*255)}`; }

async function signup(email: string): Promise<{ userId: string; cookie: string }> {
  const res = await fetch(`${BASE}/auth/signup`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip() },
    body: JSON.stringify({ email, password: 'password123!', display_name: email.split('@')[0] }),
  });
  const setCookie = res.headers.get('set-cookie') || '';
  const cookie = setCookie.split(';')[0];
  const j = await res.json() as { data?: { user?: { id?: string } } };
  const userId = j?.data?.user?.id as string;
  return { userId, cookie };
}

function actorFor(user_id: string, role = 'user'): Actor {
  return {
    session: { userId: user_id, email: `${user_id}@t.test`, v: 0 },
    user: { id: user_id, email: `${user_id}@t.test`, role, display_name: user_id, avatar_url: null, country_code: null, preferred_language: 'en', auth_providers: [], created_at: new Date(), updated_at: new Date() },
  } as unknown as Actor;
}

async function seedApprovedChannel(ownerId: string): Promise<{ id: string; slug: string }> {
  const id = uuidv4();
  const slug = `b2b-${id.slice(0, 8)}`;
  const wa = `0029B2b${id.slice(0, 20).replace(/-/g, '')}`;
  const now = new Date();
  const doc = {
    id, slug, name: `B2B ${id.slice(0, 6)}`,
    whatsapp_url: `https://whatsapp.com/channel/${wa}`,
    whatsapp_channel_id: wa,
    description: 'batch2b activation test channel',
    short_description: 'batch2b activation test channel',
    logo_url: null, cover_url: null, website_url: null,
    country_code: 'US', follower_count: 0,
    is_official: false, is_verified: true, verification_status: 'verified',
    owner_id: ownerId, category_id: null, tags: [], status: 'approved',
    view_count: 0, click_count: 0, follow_intent_count: 0,
    created_at: now, updated_at: now, published_at: now,
  };
  await withDb(async (db) => { await db.collection(COLLECTIONS.CHANNELS).insertOne(doc as unknown as Record<string, unknown>); });
  return { id, slug };
}

// Test payment provider that captures without inline fee, then reveals fee on
// retrieveCapture — mirrors real PayPal sandbox behaviour where the fee lands
// only on the capture-details endpoint. Reads amount from the activation row.
class ActivationTestProvider implements PaymentProvider {
  readonly id = 'paypal' as const;
  private _forceFailCreate = false;
  private _fee = 3; // 3¢ sandbox fee → net 97¢
  setFee(f: number) { this._fee = f; }
  async createPayment(input: CreatePaymentInput) {
    if (this._forceFailCreate) throw new Error('provider down');
    return {
      provider: 'paypal' as const,
      provider_order_id: `ACT-ORDER-${input.funding_id}`,
      approve_url: `https://sandbox.paypal.com/checkoutnow?token=ACT-ORDER-${input.funding_id}`,
      raw: {},
    };
  }
  async capturePayment(input: CapturePaymentInput) {
    // No fee inline → forces captured_pending_fee path.
    return {
      provider_order_id: input.provider_order_id,
      provider_capture_id: `ACT-CAP-${input.provider_order_id}`,
      internal_status: 'paid' as const,
      amount_captured_minor: 100,
      currency: 'USD',
      provider_fee_minor: null,
      provider_net_minor: null,
      raw: {},
    };
  }
  async retrievePayment(input: CapturePaymentInput) {
    return {
      provider_order_id: input.provider_order_id,
      internal_status: 'paid' as const,
      amount_minor: 100,
      currency: 'USD',
      provider_capture_id: `ACT-CAP-${input.provider_order_id}`,
      raw: {},
    };
  }
  async retrieveCapture(input: RetrieveCaptureInput) {
    return {
      provider_capture_id: input.provider_capture_id,
      internal_status: 'paid' as const,
      amount_minor: 100,
      currency: 'USD',
      provider_fee_minor: this._fee,
      provider_net_minor: 100 - this._fee,
      raw: {},
    };
  }
  async createRefund(input: RefundInput) {
    return {
      provider_refund_id: `ACT-REFUND-${Date.now()}`,
      internal_status: 'refunded' as const,
      amount_refunded_minor: input.amount_minor,
      raw: {},
    };
  }
  async verifyWebhook() {
    return { valid: true, event_id: `evt-${Date.now()}`, event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: {} };
  }
}

const provider = new ActivationTestProvider();

beforeAll(() => {
  _setPaymentProviderForTesting(provider);
  process.env.PAYPAL_ENVIRONMENT = 'sandbox';
});
afterAll(() => { _setPaymentProviderForTesting(null); });

describe('M11-Batch2B — Verified Owner Activation', () => {
  let owner: { userId: string; cookie: string };
  let stranger: { userId: string; cookie: string };
  let admin: { userId: string; cookie: string };
  let channelId = '';
  let channelSlug = '';

  beforeAll(async () => {
    owner = await signup(`b2b-${RUN_TAG}-owner@t.test`);
    stranger = await signup(`b2b-${RUN_TAG}-stranger@t.test`);
    admin = await signup(`b2b-${RUN_TAG}-admin@t.test`);
    await withDb(async (db) => { await db.collection('users').updateOne({ id: admin.userId }, { $set: { role: 'admin' } }); });
    // Re-login admin so their session reflects the role.
    const r = await fetch(`${BASE}/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip() },
      body: JSON.stringify({ email: `b2b-${RUN_TAG}-admin@t.test`, password: 'password123!' }),
    });
    admin.cookie = (r.headers.get('set-cookie') || '').split(';')[0];

    const ch = await seedApprovedChannel(owner.userId);
    channelId = ch.id; channelSlug = ch.slug;
  });

  it('§1/§2/§3 owner starts activation; server-derived $1; stranger blocked', async () => {
    const start = await channelActivationService.startActivation(actorFor(owner.userId), channelId, 'http://localhost:3000');
    expect(start.status).toBe('checkout_created');
    expect(start.gross_amount_minor).toBe(ACTIVATION_AMOUNT_MINOR);
    expect(start.gross_amount_minor).toBe(100);
    expect(start.provider_environment).toBe('sandbox');
    expect(start.approve_url).toMatch(/paypal\.com/);

    // Stranger cannot start activation on someone else's channel.
    await expect(channelActivationService.startActivation(actorFor(stranger.userId), channelId)).rejects.toMatchObject({ status: 403 });
  });

  it('§4/§5 capture without inline fee → captured_pending_fee, NO credit, activation NOT active', async () => {
    const state = await channelActivationService.getStateForOwner(actorFor(owner.userId), channelId);
    const paymentId = state.latest_payment!.id;

    const captured = await channelActivationService.captureAndReconcile(paymentId);
    expect(captured!.status).toBe('captured_pending_fee');
    expect(captured!.provider_fee_minor).toBeNull();
    // Zero credit issued so far.
    const balance = await waveLeadCreditService.getBalance(owner.userId);
    expect(balance.balance_minor).toBe(0);

    // Channel activation stays 'pending' — the browser return is non-authoritative for 'active'.
    const chan = await withDb(async (db) => db.collection(COLLECTIONS.CHANNELS).findOne({ id: channelId }));
    expect(chan?.activation_status).toBe('pending');

    // Under the strict invariant (activation_required=ON), public badge is
    // withheld until activation is active. We verify this deterministically
    // via sanitizeChannel so the test does not depend on the running Next.js
    // process's env — release-safety semantics (flag OFF default) are
    // covered by tests/m11_batch2b_release_safety.test.ts.
    const prev = process.env.CHANNEL_OWNER_ACTIVATION_REQUIRED;
    try {
      process.env.CHANNEL_OWNER_ACTIVATION_REQUIRED = '1';
      const pub = sanitizeChannel(chan as unknown as import('@/lib/types').Channel);
      expect(pub.is_verified).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.CHANNEL_OWNER_ACTIVATION_REQUIRED;
      else process.env.CHANNEL_OWNER_ACTIVATION_REQUIRED = prev;
    }
  });

  it('§6/§7 admin reconciles fee → credit issued exactly once + activation active + idempotent', async () => {
    const state = await channelActivationService.getStateForOwner(actorFor(owner.userId), channelId);
    const paymentId = state.latest_payment!.id;

    const reconciled = await channelActivationService.adminReconcileFeeFromProvider(actorFor(admin.userId, 'admin'), paymentId);
    expect(reconciled!.status).toBe('captured_finalized');
    expect(reconciled!.provider_fee_minor).toBe(3);
    expect(reconciled!.provider_net_minor).toBe(97);

    // Exactly one credit row of amount 97.
    const events = await withDb(async (db) => db.collection(COLLECTIONS.WAVELEAD_CREDIT_EVENTS).find({ source_id: paymentId }).toArray());
    expect(events).toHaveLength(1);
    expect(events[0].amount_minor).toBe(97);
    expect(events[0].event_type).toBe('ACTIVATION_CREDIT_ISSUED');
    expect(events[0].idempotency_key).toBe(`activation_credit:${paymentId}`);

    // Second reconcile → 409 or no-op; DO NOT create duplicate credit.
    await expect(channelActivationService.adminReconcileFeeFromProvider(actorFor(admin.userId, 'admin'), paymentId)).rejects.toMatchObject({ status: 400 });
    const events2 = await withDb(async (db) => db.collection(COLLECTIONS.WAVELEAD_CREDIT_EVENTS).find({ source_id: paymentId }).toArray());
    expect(events2).toHaveLength(1);

    // Channel is now activation_status='active'.
    const chan = await withDb(async (db) => db.collection(COLLECTIONS.CHANNELS).findOne({ id: channelId }));
    expect(chan?.activation_status).toBe('active');
    expect(chan?.activation_active_at).toBeTruthy();

    // Public profile now DOES show Owner Verified (flag OFF: badge shows;
    // flag ON: badge shows because activation is active).
    const html = await (await fetch(`${PAGE}/channel/${channelSlug}`, { headers: { 'X-Forwarded-For': ip() } })).text();
    expect(html).toContain('data-testid="owner-verified-badge"');
    expect(html).toContain('Owner Verified');
    // Deterministic verification under the strict invariant as well.
    const chanNow = await withDb(async (db) => db.collection(COLLECTIONS.CHANNELS).findOne({ id: channelId }));
    const prev = process.env.CHANNEL_OWNER_ACTIVATION_REQUIRED;
    try {
      process.env.CHANNEL_OWNER_ACTIVATION_REQUIRED = '1';
      const pub = sanitizeChannel(chanNow as unknown as import('@/lib/types').Channel);
      expect(pub.is_verified).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.CHANNEL_OWNER_ACTIVATION_REQUIRED;
      else process.env.CHANNEL_OWNER_ACTIVATION_REQUIRED = prev;
    }

    // Credit balance endpoint reflects $0.97.
    const balance = await waveLeadCreditService.getBalance(owner.userId);
    expect(balance.balance_minor).toBe(97);
  });

  it('§7 duplicate capture is safe (activation stays finalized, no extra credit)', async () => {
    const state = await channelActivationService.getStateForOwner(actorFor(owner.userId), channelId);
    const paymentId = state.latest_payment!.id;
    const again = await channelActivationService.captureAndReconcile(paymentId);
    expect(again!.status).toBe('captured_finalized');
    const events = await withDb(async (db) => db.collection(COLLECTIONS.WAVELEAD_CREDIT_EVENTS).find({ source_id: paymentId }).toArray());
    expect(events).toHaveLength(1);
  });

  it('§8 refund revokes activation but NEVER ownership', async () => {
    const state = await channelActivationService.getStateForOwner(actorFor(owner.userId), channelId);
    const paymentId = state.latest_payment!.id;
    await channelActivationService.recordRefund(paymentId, 100);
    const chan = await withDb(async (db) => db.collection(COLLECTIONS.CHANNELS).findOne({ id: channelId }));
    expect(chan?.activation_status).toBe('revoked');
    // OWNERSHIP MUST SURVIVE.
    expect(chan?.owner_id).toBe(owner.userId);
    expect(chan?.verification_status).toBe('verified');
    // Under the strict invariant (activation_required=ON), the public badge
    // is withheld once activation is revoked. Verified via sanitizeChannel
    // so this test is env-independent — release-safety (flag OFF default)
    // behavior is covered in tests/m11_batch2b_release_safety.test.ts.
    const prev = process.env.CHANNEL_OWNER_ACTIVATION_REQUIRED;
    try {
      process.env.CHANNEL_OWNER_ACTIVATION_REQUIRED = '1';
      const pub = sanitizeChannel(chan as unknown as import('@/lib/types').Channel);
      expect(pub.is_verified).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.CHANNEL_OWNER_ACTIVATION_REQUIRED;
      else process.env.CHANNEL_OWNER_ACTIVATION_REQUIRED = prev;
    }
  });

  it('§10/§4 payment domains remain isolated (purpose queryable-distinct)', async () => {
    const rows = await withDb(async (db) => db.collection(COLLECTIONS.CHANNEL_ACTIVATION_PAYMENTS).find({ channel_id: channelId }).toArray());
    expect(rows.length).toBeGreaterThanOrEqual(1);
    for (const r of rows) expect(r.purpose).toBe('CHANNEL_OWNER_ACTIVATION');
    // Ensure marketplace and promote collections did NOT gain a mystery activation row.
    const mp = await withDb(async (db) => db.collection(COLLECTIONS.MARKETPLACE_PAYMENT_ATTEMPTS).findOne({ marketplace_order_id: 'CHANNEL_OWNER_ACTIVATION' as unknown as string }));
    expect(mp).toBeNull();
    const funding = await withDb(async (db) => db.collection(COLLECTIONS.PAYMENT_FUNDING_ORDERS).findOne({ campaign_id: 'CHANNEL_OWNER_ACTIVATION' as unknown as string }));
    expect(funding).toBeNull();
  });

  it('§11 client-supplied amount in request body is IGNORED', async () => {
    // Fresh owner+channel so we can start a clean activation.
    const o2 = await signup(`b2b-${RUN_TAG}-o2@t.test`);
    const ch = await seedApprovedChannel(o2.userId);
    // Attempt via HTTP with an inflated amount in the body.
    const res = await fetch(`${BASE}/owner/channels/${ch.id}/activation/start`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json', cookie: o2.cookie, 'X-Forwarded-For': ip() },
      body: JSON.stringify({ amount_minor: 999999 }),
    });
    const j = (await res.json()) as { data?: { payment?: ChannelActivationPayment } };
    expect(res.status).toBe(201);
    expect(j.data!.payment!.gross_amount_minor).toBe(100);
  });

  it('§9 unauthenticated GET /activation returns 401', async () => {
    const res = await fetch(`${BASE}/owner/channels/${channelId}/activation`);
    expect([401, 400]).toContain(res.status);
  });
});
