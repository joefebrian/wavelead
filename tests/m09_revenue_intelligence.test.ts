// Phase 3 — First Pro Feature: Revenue Intelligence gate.
//
// Coverage:
//   §1 Server gate — Free user cannot access /api/owner/revenue-intelligence
//   §2 Pro user can access; Enterprise can access; Admin bypass
//   §3 Metric aggregation over EXISTING marketplace_orders is correct
//   §4 UI (SSR) — Free sees upgrade state; Pro sees the panel
//   §5 "Join Pro Waitlist" creates a pro_waitlist commercial lead
//   §6 Free earnings endpoint / marketplace participation unchanged
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MongoClient, type Db } from 'mongodb';
import { v4 as uuidv4 } from 'uuid';
import { COLLECTIONS } from '@/lib/db/collections';

const BASE = 'http://localhost:3000/api';
const PAGE_BASE = 'http://localhost:3000';
const CLIENT_IP = () => `10.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;
const RUN_TAG = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;

async function withDb<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  const client = new MongoClient(process.env.MONGO_URL || 'mongodb://localhost:27017');
  await client.connect();
  try { return await fn(client.db(process.env.DB_NAME || 'wavelead')); } finally { await client.close(); }
}

interface Envelope<T> { ok?: boolean; data?: T; error?: string }
async function api<T = unknown>(path: string, init: RequestInit = {}): Promise<{ status: number; body: Envelope<T> }> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': CLIENT_IP(), ...(init.headers || {}) },
  });
  let body: Envelope<T> = {};
  try { body = await res.json(); } catch { /* ignore */ }
  return { status: res.status, body };
}

async function signup(email: string, opts: { role?: string; plan?: 'free' | 'pro' | 'enterprise' } = {}): Promise<{ userId: string; cookie: string }> {
  const r = await fetch(`${BASE}/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': CLIENT_IP() },
    body: JSON.stringify({ email, password: 'password123!', display_name: `T-${email.split('@')[0]}` }),
  });
  const cookie = r.headers.get('set-cookie')?.match(/wl_session=[^;]+/)?.[0] || '';
  const j = await r.json() as { data?: { user?: { id: string } } };
  const userId = j?.data?.user?.id as string;
  if (opts.role || opts.plan) {
    await withDb(async (db) => {
      const patch: Record<string, unknown> = {};
      if (opts.role) patch.role = opts.role;
      if (opts.plan) patch.plan = opts.plan;
      await db.collection('users').updateOne({ id: userId }, { $set: patch });
    });
  }
  return { userId, cookie };
}

// Insert a fully-typed marketplace_orders row (bypasses the marketplace
// service so we can fabricate a variety of lifecycle states quickly).
// Only fields that Revenue Intelligence reads are populated — every other
// field defaults to a safe null/zero.
async function insertOrder(ownerUserId: string, patch: Partial<{
  status: string;
  amount_received_minor: number | null;
  gateway_fee_minor: number | null;
  net_transaction_value_minor: number | null;
  owner_earnings_minor: number | null;
  wavelead_commission_minor: number | null;
  payment_received_at: Date | null;
  created_at: Date;
  completed_at: Date | null;
  buyer_company: string;
}> = {}) {
  const now = new Date();
  const doc = {
    id: uuidv4(),
    status: patch.status ?? 'requested',
    economics_status: 'pre_acceptance',
    buyer_user_id: null,
    brief: {
      company_name: patch.buyer_company ?? `m09ri-${RUN_TAG} buyer`,
      contact_name: 'X', contact_email: `m09ri-${RUN_TAG}-buyer@t.test`,
      campaign_objective: '-', brief: '-', target_start_date: null, target_end_date: null,
      product_url: null, notes: null,
    },
    channel_id: `m09ri-${RUN_TAG}-ch`,
    channel_slug: `m09ri-${RUN_TAG}-slug`,
    owner_user_id: ownerUserId,
    package_id: `m09ri-${RUN_TAG}-pkg`,
    package_type: 'shoutout',
    quoted_price_minor: patch.amount_received_minor ?? null,
    currency: 'USD',
    snapshot: null,
    payment_method: null,
    payment_reference_normalized: null,
    payment_reference_display: null,
    payment_received_at: patch.payment_received_at ?? null,
    amount_received_minor: patch.amount_received_minor ?? null,
    gateway_fee_minor: patch.gateway_fee_minor ?? null,
    net_transaction_value_minor: patch.net_transaction_value_minor ?? null,
    owner_earnings_minor: patch.owner_earnings_minor ?? null,
    wavelead_commission_minor: patch.wavelead_commission_minor ?? null,
    owner_payable_status: 'not_applicable',
    payout_available_at: null,
    payout_requested_at: null,
    completed_at: patch.completed_at ?? null,
    created_at: patch.created_at ?? now,
    updated_at: now,
    // Provide a run-tagged marker so purge can find fabricated rows.
    _m09ri_tag: RUN_TAG,
  };
  await withDb(async (db) => { await db.collection(COLLECTIONS.MARKETPLACE_ORDERS).insertOne(doc); });
  return doc.id;
}

async function purge() {
  await withDb(async (db) => {
    await db.collection('users').deleteMany({ email: new RegExp(`m09ri-${RUN_TAG}`) });
    await db.collection(COLLECTIONS.COMMERCIAL_LEADS).deleteMany({ email: new RegExp(`m09ri-${RUN_TAG}`) });
    await db.collection(COLLECTIONS.MARKETPLACE_ORDERS).deleteMany({ _m09ri_tag: RUN_TAG });
  });
}
beforeAll(async () => { await purge(); });
afterAll(async () => { await purge(); });

// ============================================================================
// §1 — Server gate on the Pro data endpoint
// ============================================================================
describe('Phase 3 RI §1 — Server gate', () => {
  it('#1 anonymous → 401 unauthorized', async () => {
    const r = await api(`/owner/revenue-intelligence`);
    expect(r.status).toBe(401);
  });

  it('#2 Free user → 403 PLAN_REQUIRED: revenue_intelligence', async () => {
    const { cookie } = await signup(`m09ri-${RUN_TAG}-free@wavelead.test`);
    const r = await api<{ plan: string }>(`/owner/revenue-intelligence`, { headers: { Cookie: cookie } });
    expect(r.status).toBe(403);
    expect(r.body.ok).toBe(false);
    expect(r.body.error || '').toContain('PLAN_REQUIRED');
    expect(r.body.error || '').toContain('revenue_intelligence');
  });
});

// ============================================================================
// §2 — Pro / Enterprise / Admin access
// ============================================================================
describe('Phase 3 RI §2 — Pro / Enterprise / Admin access', () => {
  it('#3 Pro user → 200 and plan=pro in payload', async () => {
    const { cookie } = await signup(`m09ri-${RUN_TAG}-pro@wavelead.test`, { plan: 'pro' });
    const r = await api<{ plan: string }>(`/owner/revenue-intelligence`, { headers: { Cookie: cookie } });
    expect(r.status).toBe(200);
    expect(r.body.data?.plan).toBe('pro');
  });

  it('#4 Enterprise user → 200 and plan=enterprise', async () => {
    const { cookie } = await signup(`m09ri-${RUN_TAG}-ent@wavelead.test`, { plan: 'enterprise' });
    const r = await api<{ plan: string }>(`/owner/revenue-intelligence`, { headers: { Cookie: cookie } });
    expect(r.status).toBe(200);
    expect(r.body.data?.plan).toBe('enterprise');
  });

  it('#5 Admin on Free plan bypasses the gate → plan=admin_bypass', async () => {
    const { cookie } = await signup(`m09ri-${RUN_TAG}-adm@wavelead.test`, { role: 'admin' });
    const r = await api<{ plan: string }>(`/owner/revenue-intelligence`, { headers: { Cookie: cookie } });
    expect(r.status).toBe(200);
    expect(r.body.data?.plan).toBe('admin_bypass');
  });
});

// ============================================================================
// §3 — Metric aggregation over existing marketplace_orders
// ============================================================================
describe('Phase 3 RI §3 — Metric aggregation', () => {
  it('#6 sums totals + funnel + pipeline counts + honors null gateway_fee (unknown ≠ zero)', async () => {
    const { userId, cookie } = await signup(`m09ri-${RUN_TAG}-agg@wavelead.test`, { plan: 'pro' });
    // 4 requests, 3 accepted, 2 paid, 1 completed.
    await insertOrder(userId, { status: 'requested' });
    await insertOrder(userId, { status: 'owner_accepted' });
    // Paid but fee NOT reconciled — should count into gross but NOT fees.
    await insertOrder(userId, {
      status: 'in_progress',
      amount_received_minor: 10000, // $100
      payment_received_at: new Date(),
      gateway_fee_minor: null,       // unknown fee — must NOT be treated as 0
      net_transaction_value_minor: null,
      owner_earnings_minor: null,
      wavelead_commission_minor: null,
    });
    // Paid + fee reconciled + completed.
    await insertOrder(userId, {
      status: 'completed',
      amount_received_minor: 20000, // $200
      gateway_fee_minor: 500,       // $5 fee
      net_transaction_value_minor: 19500,
      owner_earnings_minor: 17550,  // 90%
      wavelead_commission_minor: 1950, // 10%
      payment_received_at: new Date(),
      completed_at: new Date(),
    });

    const r = await api<{
      totals: {
        gross_revenue_minor: number; gateway_fees_minor: number; net_transaction_value_minor: number;
        owner_earnings_minor: number; platform_commission_minor: number;
        orders_with_payment_count: number; fee_reconciled_orders_count: number;
        average_sponsorship_value_minor: number;
      };
      conversion: { requests_count: number; accepted_count: number; paid_count: number; completed_count: number };
      pipeline: { completed_count: number; in_progress_count: number };
      trend: Array<{ month: string; gross_revenue_minor: number }>;
    }>(`/owner/revenue-intelligence`, { headers: { Cookie: cookie } });
    expect(r.status).toBe(200);
    const t = r.body.data!.totals;
    expect(t.gross_revenue_minor).toBe(30000);            // $100 + $200
    expect(t.gateway_fees_minor).toBe(500);               // only reconciled counted
    expect(t.net_transaction_value_minor).toBe(19500);
    expect(t.owner_earnings_minor).toBe(17550);
    expect(t.platform_commission_minor).toBe(1950);
    expect(t.orders_with_payment_count).toBe(2);
    expect(t.fee_reconciled_orders_count).toBe(1);
    expect(t.average_sponsorship_value_minor).toBe(15000); // 30000 / 2

    const c = r.body.data!.conversion;
    expect(c.requests_count).toBe(4);
    expect(c.accepted_count).toBe(3);
    expect(c.paid_count).toBe(2);
    expect(c.completed_count).toBe(1);

    const p = r.body.data!.pipeline;
    expect(p.completed_count).toBe(1);
    expect(p.in_progress_count).toBe(1); // the in_progress order

    // Trend is a 12-bucket array.
    expect(r.body.data!.trend.length).toBe(12);
    // Current month bucket should contain the paid orders' gross.
    const currentMonth = r.body.data!.trend[r.body.data!.trend.length - 1];
    expect(currentMonth.gross_revenue_minor).toBe(30000);
  });
});

// ============================================================================
// §4 — SSR: Free upgrade state + Pro metrics view
// ============================================================================
describe('Phase 3 RI §4 — SSR UI states', () => {
  it('#7 Free user on /dashboard/earnings sees the upgrade state (Pro badge + waitlist button)', async () => {
    const { cookie } = await signup(`m09ri-${RUN_TAG}-ssr-free@wavelead.test`);
    const r = await fetch(`${PAGE_BASE}/dashboard/earnings`, { headers: { Cookie: cookie, 'X-Forwarded-For': CLIENT_IP() } });
    expect(r.status).toBe(200);
    const html = await r.text();
    expect(html).toContain('data-testid="revenue-intelligence-upgrade"');
    expect(html).toContain('data-testid="ri-join-waitlist"');
    expect(html).toContain('Revenue Intelligence');
    expect(html).toContain('Join Pro Waitlist');
    // Must NOT render the unlocked panel.
    expect(html).not.toContain('data-testid="revenue-intelligence-panel"');
  });

  it('#8 Pro user on /dashboard/earnings sees the unlocked metrics panel', async () => {
    const { cookie } = await signup(`m09ri-${RUN_TAG}-ssr-pro@wavelead.test`, { plan: 'pro' });
    const r = await fetch(`${PAGE_BASE}/dashboard/earnings`, { headers: { Cookie: cookie, 'X-Forwarded-For': CLIENT_IP() } });
    expect(r.status).toBe(200);
    const html = await r.text();
    expect(html).toContain('data-testid="revenue-intelligence-panel"');
    expect(html).toContain('Sponsorship Conversion');
    expect(html).not.toContain('data-testid="revenue-intelligence-upgrade"');
  });
});

// ============================================================================
// §5 — Pro waitlist CTA creates a pro_waitlist commercial lead
// ============================================================================
describe('Phase 3 RI §5 — Waitlist CTA', () => {
  it('#9 POST /commercial-leads/pro-waitlist from the RI panel path creates a lead', async () => {
    const email = `m09ri-${RUN_TAG}-wait@wavelead.test`;
    const r = await api<{ lead: { type: string; email: string } }>(`/commercial-leads/pro-waitlist`, {
      method: 'POST', body: JSON.stringify({ email }),
    });
    expect(r.status).toBe(201);
    expect(r.body.data?.lead.type).toBe('pro_waitlist');
    expect(r.body.data?.lead.email).toBe(email.toLowerCase());
  });
});

// ============================================================================
// §6 — Free marketplace participation NOT gated by this change
// ============================================================================
describe('Phase 3 RI §6 — Free marketplace unchanged', () => {
  it('#10 Free user can still call /owner/earnings (marketplace baseline)', async () => {
    const { cookie } = await signup(`m09ri-${RUN_TAG}-freemp@wavelead.test`);
    const r = await api<{ totals: { pending_earnings_minor: number } }>(`/owner/earnings`, { headers: { Cookie: cookie } });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.data?.totals).toBeDefined();
  });

  it('#11 Free user entitlements introspection still shows marketplace baseline true', async () => {
    const { cookie } = await signup(`m09ri-${RUN_TAG}-freeint@wavelead.test`);
    const r = await api<{ plan: string; entitlements: Record<string, unknown> }>(`/entitlements/me`, { headers: { Cookie: cookie } });
    expect(r.status).toBe(200);
    expect(r.body.data?.plan).toBe('free');
    expect(r.body.data?.entitlements.marketplace_participation).toBe(true);
    expect(r.body.data?.entitlements.earnings_and_payouts).toBe(true);
    expect(r.body.data?.entitlements.promote_pay_per_campaign).toBe(true);
    // But the Pro flag remains off.
    expect(r.body.data?.entitlements.revenue_intelligence).toBe(false);
  });
});
