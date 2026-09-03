// M11-Batch2B RELEASE SAFETY — activation feature flag + refund credit reversal.
//
// Verifies:
//   §1  activation_required = false (default): verified ownership → is_verified stays TRUE
//        without any activation record → NO regression for existing verified owners
//   §2  activation_required = true: verified ownership + inactive activation → is_verified FALSE
//   §3  activation_required = true: verified ownership + active activation → is_verified TRUE
//   §4  Production visibility: /activation payload advertises activation_required so the
//        client renders NO broken $1 CTA in production while the flag is OFF
//   §5  Full happy path: activation → credit +97 issued (baseline balance = 97)
//   §6  Refund appends exactly ONE ACTIVATION_CREDIT_REVERSED at -97
//   §7  Resulting derived balance = 0 (net contribution zero)
//   §8  Duplicate refund / replay is idempotent (still exactly ONE reversal, balance still 0)
//   §9  Ownership survives refund (owner_id + verification_status intact)
//  §10  Marketplace owner earnings suite still passes (regression, tested separately)
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MongoClient, type Db } from 'mongodb';
import { v4 as uuidv4 } from 'uuid';
import { COLLECTIONS } from '@/lib/db/collections';
import { _setPaymentProviderForTesting } from '@/lib/services/payments/providerFactory';
import { channelActivationService, waveLeadCreditService } from '@/lib/services/channelActivationService';
import { sanitizeChannel } from '@/lib/utils/sanitize';
import type { Actor, Channel } from '@/lib/types';
import type { CreatePaymentInput, CapturePaymentInput, RefundInput, RetrieveCaptureInput, PaymentProvider } from '@/lib/services/payments/paymentProvider';

const BASE = 'http://localhost:3000/api';
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
  const cookie = (res.headers.get('set-cookie') || '').split(';')[0];
  const j = await res.json() as { data?: { user?: { id?: string } } };
  return { userId: j?.data?.user?.id as string, cookie };
}
function actorFor(user_id: string, role = 'user'): Actor {
  return {
    session: { userId: user_id, email: `${user_id}@t.test`, v: 0 },
    user: { id: user_id, email: `${user_id}@t.test`, role, display_name: user_id, avatar_url: null, country_code: null, preferred_language: 'en', auth_providers: [], created_at: new Date(), updated_at: new Date() },
  } as unknown as Actor;
}

async function seedApprovedChannel(ownerId: string, opts: Partial<Channel> = {}): Promise<Channel> {
  const id = uuidv4();
  const slug = `b2brs-${id.slice(0, 8)}`;
  const wa = `0029B2rs${id.slice(0, 20).replace(/-/g, '')}`;
  const now = new Date();
  const doc: Channel = {
    id, slug, name: `B2BRS ${id.slice(0, 6)}`,
    whatsapp_url: `https://whatsapp.com/channel/${wa}`,
    whatsapp_channel_id: wa,
    description: 'release safety test channel',
    short_description: 'release safety test channel',
    logo_url: null, cover_url: null, website_url: null,
    country_code: 'US', follower_count: 0,
    is_official: false, is_verified: true, verification_status: 'verified',
    owner_id: ownerId, category_id: null, tags: [], status: 'approved',
    view_count: 0, click_count: 0, follow_intent_count: 0,
    created_at: now, updated_at: now, published_at: now,
    ...opts,
  } as unknown as Channel;
  await withDb(async (db) => { await db.collection(COLLECTIONS.CHANNELS).insertOne(doc as unknown as Record<string, unknown>); });
  return doc;
}

class TP implements PaymentProvider {
  readonly id = 'paypal' as const;
  async createPayment(i: CreatePaymentInput) { return { provider: 'paypal' as const, provider_order_id: `RS-${i.funding_id}`, approve_url: `https://sandbox.paypal.com/checkoutnow?token=RS-${i.funding_id}`, raw: {} }; }
  async capturePayment(i: CapturePaymentInput) { return { provider_order_id: i.provider_order_id, provider_capture_id: `RS-CAP-${i.provider_order_id}`, internal_status: 'paid' as const, amount_captured_minor: 100, currency: 'USD', provider_fee_minor: null, provider_net_minor: null, raw: {} }; }
  async retrievePayment(i: CapturePaymentInput) { return { provider_order_id: i.provider_order_id, internal_status: 'paid' as const, amount_minor: 100, currency: 'USD', provider_capture_id: `RS-CAP-${i.provider_order_id}`, raw: {} }; }
  async retrieveCapture(i: RetrieveCaptureInput) { return { provider_capture_id: i.provider_capture_id, internal_status: 'paid' as const, amount_minor: 100, currency: 'USD', provider_fee_minor: 3, provider_net_minor: 97, raw: {} }; }
  async createRefund(i: RefundInput) { return { provider_refund_id: `RS-REF-${Date.now()}`, internal_status: 'refunded' as const, amount_refunded_minor: i.amount_minor, raw: {} }; }
  async verifyWebhook() { return { valid: true, event_id: 'evt', event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: {} }; }
}

beforeAll(() => {
  _setPaymentProviderForTesting(new TP());
  process.env.PAYPAL_ENVIRONMENT = 'sandbox';
});
afterAll(() => {
  _setPaymentProviderForTesting(null);
  delete process.env.CHANNEL_OWNER_ACTIVATION_REQUIRED;
});

describe('M11-Batch2B RELEASE SAFETY — Activation feature flag', () => {
  it('§1 flag OFF (default): verified ownership without activation → is_verified stays TRUE', async () => {
    delete process.env.CHANNEL_OWNER_ACTIVATION_REQUIRED;
    const owner = await signup(`rs1-${RUN_TAG}@t.test`);
    const ch = await seedApprovedChannel(owner.userId /* no activation_status seeded */);
    const pub = sanitizeChannel(ch);
    expect(pub.is_verified).toBe(true);        // existing verified owner preserved
    expect(pub.has_owner).toBe(true);
    // Extra: also verify through the HTTP public endpoint.
    const res = await fetch(`${BASE}/channels/${ch.slug}`);
    const j = (await res.json()) as { data?: { channel?: { is_verified?: boolean } } };
    expect(j.data?.channel?.is_verified).toBe(true);
  });

  it('§2 flag ON: verified ownership + inactive activation → is_verified FALSE', async () => {
    process.env.CHANNEL_OWNER_ACTIVATION_REQUIRED = '1';
    const owner = await signup(`rs2-${RUN_TAG}@t.test`);
    const ch = await seedApprovedChannel(owner.userId /* activation not active */);
    const pub = sanitizeChannel(ch);
    expect(pub.is_verified).toBe(false);
    expect(pub.has_owner).toBe(true);        // ownership relationship still surfaced
  });

  it('§3 flag ON: verified ownership + active activation → is_verified TRUE', async () => {
    process.env.CHANNEL_OWNER_ACTIVATION_REQUIRED = 'true';
    const owner = await signup(`rs3-${RUN_TAG}@t.test`);
    const ch = await seedApprovedChannel(owner.userId, { activation_status: 'active', activation_active_at: new Date(), activation_revoked_at: null } as Partial<Channel>);
    const pub = sanitizeChannel(ch);
    expect(pub.is_verified).toBe(true);
  });

  it('§4 owner activation state advertises activation_required so client hides broken CTA when OFF', async () => {
    delete process.env.CHANNEL_OWNER_ACTIVATION_REQUIRED;
    const owner = await signup(`rs4-${RUN_TAG}@t.test`);
    const ch = await seedApprovedChannel(owner.userId);
    const state = await channelActivationService.getStateForOwner(actorFor(owner.userId), ch.id);
    expect(state.activation_required).toBe(false);
    // Flip on and re-read.
    process.env.CHANNEL_OWNER_ACTIVATION_REQUIRED = '1';
    const state2 = await channelActivationService.getStateForOwner(actorFor(owner.userId), ch.id);
    expect(state2.activation_required).toBe(true);
    delete process.env.CHANNEL_OWNER_ACTIVATION_REQUIRED;
  });
});

describe('M11-Batch2B RELEASE SAFETY — Refund credit reversal', () => {
  it('§5/§6/§7/§8/§9 full activation → refund → net-zero credit, ownership preserved, idempotent', async () => {
    delete process.env.CHANNEL_OWNER_ACTIVATION_REQUIRED;
    const owner = await signup(`rs5-${RUN_TAG}@t.test`);
    const admin = await signup(`rs5adm-${RUN_TAG}@t.test`);
    await withDb(async (db) => { await db.collection('users').updateOne({ id: admin.userId }, { $set: { role: 'admin' } }); });
    const ch = await seedApprovedChannel(owner.userId);

    // §5 Activate → capture → reconcile fee → +97 credit.
    const start = await channelActivationService.startActivation(actorFor(owner.userId), ch.id, 'http://localhost:3000');
    const paymentId = start.id;
    await channelActivationService.captureAndReconcile(paymentId);
    await channelActivationService.adminReconcileFeeFromProvider(actorFor(admin.userId, 'admin'), paymentId);
    const afterIssue = await waveLeadCreditService.getBalance(owner.userId);
    expect(afterIssue.balance_minor).toBe(97);

    // §6 Refund the full activation.
    await channelActivationService.recordRefund(paymentId, 100);

    // §6 Exactly one ACTIVATION_CREDIT_REVERSED @ -97 exists for this payment.
    const rows = await withDb(async (db) => db.collection(COLLECTIONS.WAVELEAD_CREDIT_EVENTS).find({ source_id: paymentId }).sort({ created_at: 1 }).toArray());
    expect(rows.map((r) => r.event_type)).toEqual(['ACTIVATION_CREDIT_ISSUED', 'ACTIVATION_CREDIT_REVERSED']);
    const issued = rows.find((r) => r.event_type === 'ACTIVATION_CREDIT_ISSUED');
    const reversed = rows.find((r) => r.event_type === 'ACTIVATION_CREDIT_REVERSED');
    expect(issued!.amount_minor).toBe(97);
    expect(reversed!.amount_minor).toBe(-97);
    expect(reversed!.idempotency_key).toBe(`activation_credit_reversal:${paymentId}`);
    // Original issuance row must NOT be mutated.
    expect(issued!.event_type).toBe('ACTIVATION_CREDIT_ISSUED');
    expect(issued!.amount_minor).toBe(97);

    // §7 Derived balance = 0.
    const afterRefund = await waveLeadCreditService.getBalance(owner.userId);
    expect(afterRefund.balance_minor).toBe(0);
    expect(afterRefund.events_count).toBe(2);

    // §8 Duplicate refund / replay is idempotent — still exactly ONE reversal.
    await channelActivationService.recordRefund(paymentId, 100);
    await channelActivationService.recordRefund(paymentId, 100);
    const rows2 = await withDb(async (db) => db.collection(COLLECTIONS.WAVELEAD_CREDIT_EVENTS).find({ source_id: paymentId, event_type: 'ACTIVATION_CREDIT_REVERSED' }).toArray());
    expect(rows2).toHaveLength(1);
    const bal2 = await waveLeadCreditService.getBalance(owner.userId);
    expect(bal2.balance_minor).toBe(0);

    // §9 Ownership survives refund — owner_id + verification_status intact.
    const chAfter = await withDb(async (db) => db.collection(COLLECTIONS.CHANNELS).findOne({ id: ch.id }));
    expect(chAfter?.owner_id).toBe(owner.userId);
    expect(chAfter?.verification_status).toBe('verified');
    expect(chAfter?.activation_status).toBe('revoked');
  });

  it('refund BEFORE fee reconciliation → NO issuance to reverse → NO reversal row', async () => {
    delete process.env.CHANNEL_OWNER_ACTIVATION_REQUIRED;
    const owner = await signup(`rs6-${RUN_TAG}@t.test`);
    const ch = await seedApprovedChannel(owner.userId);
    const start = await channelActivationService.startActivation(actorFor(owner.userId), ch.id, 'http://localhost:3000');
    // Capture but do NOT reconcile fee → no credit issued.
    await channelActivationService.captureAndReconcile(start.id);
    const preBal = await waveLeadCreditService.getBalance(owner.userId);
    expect(preBal.balance_minor).toBe(0);

    await channelActivationService.recordRefund(start.id, 100);
    const rows = await withDb(async (db) => db.collection(COLLECTIONS.WAVELEAD_CREDIT_EVENTS).find({ source_id: start.id }).toArray());
    expect(rows).toHaveLength(0);   // nothing to reverse
    const postBal = await waveLeadCreditService.getBalance(owner.userId);
    expect(postBal.balance_minor).toBe(0);
  });
});
