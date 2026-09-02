// Phase 3 — Pro Sponsorship Pipeline.
//
// Coverage:
//   §1 Server entitlement gate — Free = 403, Pro/Ent/admin pass
//   §2 Status → stage mapping is correct across the full lifecycle
//   §3 Needs Attention derived from existing timestamps
//   §4 Owner data isolation — never see another owner's rows
//   §5 SSR — Free upgrade state; Pro renders kanban
//   §6 Filters (channel, stage, attention)
//   §7 Pro waitlist CTA still creates a pro_waitlist commercial lead
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MongoClient, type Db } from 'mongodb';
import { v4 as uuidv4 } from 'uuid';
import { COLLECTIONS } from '@/lib/db/collections';
import { statusToPipelineStage, PIPELINE_STAGES } from '@/lib/services/marketplaceService';

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

interface OrderPatch {
  status?: string;
  channel_slug?: string;
  channel_name?: string;
  buyer_company?: string;
  gross_price_minor?: number;
  owner_earnings_minor?: number | null;
  created_at?: Date;
  accepted_at?: Date | null;
  paid_at?: Date | null;
  submitted_for_review_at?: Date | null;
  estimated_delivery_days?: number | null;
}
async function insertOrder(ownerUserId: string, patch: OrderPatch = {}) {
  const now = new Date();
  const slug = patch.channel_slug ?? `m09pipe-${RUN_TAG}-ch`;
  const name = patch.channel_name ?? 'M09 Channel';
  const snapshot = (patch.status && patch.status !== 'requested') ? {
    channel_id: `${slug}-id`, channel_name: name, channel_slug: slug,
    owner_user_id: ownerUserId,
    package_id: 'pkg', package_type: 'shoutout',
    package_name: 'Shoutout Package', package_description: '-',
    deliverables: ['single_post'],
    estimated_delivery_days: patch.estimated_delivery_days ?? 7,
    gross_price_minor: patch.gross_price_minor ?? 10000,
    currency: 'USD', owner_share_bps: 9000, platform_share_bps: 1000,
    accepted_at: patch.accepted_at ?? now, accepted_by: ownerUserId,
  } : null;
  const doc = {
    id: uuidv4(),
    status: patch.status ?? 'requested',
    economics_status: 'pre_acceptance',
    buyer_user_id: null,
    brief: {
      company_name: patch.buyer_company ?? `m09pipe buyer ${uuidv4().slice(0, 6)}`,
      contact_name: 'X', contact_email: `m09pipe-${RUN_TAG}-b@t.test`,
      campaign_objective: '-', brief: '-', target_start_date: null, target_end_date: null,
      product_url: null, notes: null,
    },
    channel_id: `${slug}-id`, channel_slug: slug, owner_user_id: ownerUserId,
    package_id: 'pkg', package_type: 'shoutout',
    quoted_price_minor: patch.gross_price_minor ?? 10000,
    currency: 'USD',
    snapshot,
    payment_method: null, payment_reference_normalized: null, payment_reference_display: null,
    payment_received_at: patch.paid_at ?? null,
    amount_received_minor: patch.paid_at ? (patch.gross_price_minor ?? 10000) : null,
    gateway_fee_minor: null,
    net_transaction_value_minor: null,
    owner_earnings_minor: patch.owner_earnings_minor ?? null,
    wavelead_commission_minor: null,
    owner_payable_status: 'not_applicable',
    rejection_reason: null, cancelled_reason: null,
    created_at: patch.created_at ?? now,
    updated_at: now,
    accepted_at: patch.accepted_at ?? null,
    rejected_at: null,
    paid_at: patch.paid_at ?? null,
    cancelled_at: null,
    started_at: null, started_by: null,
    delivery_notes: null, delivery_urls: [],
    submitted_at: null, submitted_by: null, proof_description: null,
    completed_at: null, completed_by: null, completion_source: null, completion_note: null,
    paid_out_at: null, payout_id: null,
    submitted_for_review_at: patch.submitted_for_review_at ?? null,
    _m09pipe_tag: RUN_TAG,
  };
  await withDb(async (db) => { await db.collection(COLLECTIONS.MARKETPLACE_ORDERS).insertOne(doc); });
  return doc.id;
}
async function purge() {
  await withDb(async (db) => {
    await db.collection('users').deleteMany({ email: new RegExp(`m09pipe-${RUN_TAG}`) });
    await db.collection(COLLECTIONS.COMMERCIAL_LEADS).deleteMany({ email: new RegExp(`m09pipe-${RUN_TAG}`) });
    await db.collection(COLLECTIONS.MARKETPLACE_ORDERS).deleteMany({ _m09pipe_tag: RUN_TAG });
  });
}
beforeAll(async () => { await purge(); });
afterAll(async () => { await purge(); });

// ============================================================================
// §1 — Server entitlement gate
// ============================================================================
describe('Phase 3 Pipeline §1 — Server gate', () => {
  it('#1 anonymous → 401', async () => {
    const r = await api('/owner/sponsorship-pipeline');
    expect(r.status).toBe(401);
  });
  it('#2 Free user → 403 PLAN_REQUIRED: sponsorship_pipeline_intelligence', async () => {
    const { cookie } = await signup(`m09pipe-${RUN_TAG}-free@wavelead.test`);
    const r = await api(`/owner/sponsorship-pipeline`, { headers: { Cookie: cookie } });
    expect(r.status).toBe(403);
    expect(r.body.error || '').toContain('PLAN_REQUIRED');
    expect(r.body.error || '').toContain('sponsorship_pipeline_intelligence');
  });
  it('#3 Pro user → 200 with plan=pro', async () => {
    const { cookie } = await signup(`m09pipe-${RUN_TAG}-pro@wavelead.test`, { plan: 'pro' });
    const r = await api<{ plan: string }>(`/owner/sponsorship-pipeline`, { headers: { Cookie: cookie } });
    expect(r.status).toBe(200);
    expect(r.body.data?.plan).toBe('pro');
  });
  it('#4 Enterprise user → 200 with plan=enterprise', async () => {
    const { cookie } = await signup(`m09pipe-${RUN_TAG}-ent@wavelead.test`, { plan: 'enterprise' });
    const r = await api<{ plan: string }>(`/owner/sponsorship-pipeline`, { headers: { Cookie: cookie } });
    expect(r.status).toBe(200);
    expect(r.body.data?.plan).toBe('enterprise');
  });
  it('#5 Admin on Free plan → 200 with plan=admin_bypass', async () => {
    const { cookie } = await signup(`m09pipe-${RUN_TAG}-adm@wavelead.test`, { role: 'admin' });
    const r = await api<{ plan: string }>(`/owner/sponsorship-pipeline`, { headers: { Cookie: cookie } });
    expect(r.status).toBe(200);
    expect(r.body.data?.plan).toBe('admin_bypass');
  });
});

// ============================================================================
// §2 — Status → stage mapping is complete and correct (pure unit)
// ============================================================================
describe('Phase 3 Pipeline §2 — Status mapping', () => {
  it('#6 canonical statuses map to expected stages; cancelled/rejected are excluded', () => {
    expect(statusToPipelineStage('requested')).toBe('NEW');
    expect(statusToPipelineStage('owner_accepted')).toBe('ACCEPTED');
    expect(statusToPipelineStage('awaiting_payment')).toBe('ACCEPTED');
    expect(statusToPipelineStage('paid')).toBe('READY_TO_WORK');
    expect(statusToPipelineStage('in_progress')).toBe('IN_PROGRESS');
    expect(statusToPipelineStage('revision_requested')).toBe('IN_PROGRESS');
    expect(statusToPipelineStage('submitted_for_review')).toBe('IN_REVIEW');
    expect(statusToPipelineStage('completed')).toBe('COMPLETED');
    expect(statusToPipelineStage('cancelled')).toBeNull();
    expect(statusToPipelineStage('owner_rejected')).toBeNull();
    expect(PIPELINE_STAGES).toEqual(['NEW', 'ACCEPTED', 'READY_TO_WORK', 'IN_PROGRESS', 'IN_REVIEW', 'COMPLETED']);
  });
});

// ============================================================================
// §3 — Needs Attention derived from timestamps
// ============================================================================
describe('Phase 3 Pipeline §3 — Needs Attention', () => {
  it('#7 stale NEW request (>24h old) is flagged Needs Attention', async () => {
    const { userId, cookie } = await signup(`m09pipe-${RUN_TAG}-att@wavelead.test`, { plan: 'pro' });
    const oldReq = new Date(Date.now() - 30 * 60 * 60 * 1000);
    const freshReq = new Date();
    await insertOrder(userId, { status: 'requested', created_at: oldReq, buyer_company: `stale-${RUN_TAG}` });
    await insertOrder(userId, { status: 'requested', created_at: freshReq, buyer_company: `fresh-${RUN_TAG}` });
    const r = await api<{ cards: Array<{ brand_company: string; needs_attention: boolean; needs_attention_reason: string | null }> }>(`/owner/sponsorship-pipeline`, { headers: { Cookie: cookie } });
    expect(r.status).toBe(200);
    const stale = r.body.data!.cards.find((c) => c.brand_company === `stale-${RUN_TAG}`);
    const fresh = r.body.data!.cards.find((c) => c.brand_company === `fresh-${RUN_TAG}`);
    expect(stale?.needs_attention).toBe(true);
    expect(stale?.needs_attention_reason).toContain('New request');
    expect(fresh?.needs_attention).toBe(false);
  });

  it('#8 revision_requested is always Needs Attention', async () => {
    const { userId, cookie } = await signup(`m09pipe-${RUN_TAG}-rev@wavelead.test`, { plan: 'pro' });
    await insertOrder(userId, {
      status: 'revision_requested', accepted_at: new Date(), paid_at: new Date(),
      buyer_company: `rev-${RUN_TAG}`,
    });
    const r = await api<{ cards: Array<{ brand_company: string; needs_attention: boolean; needs_attention_reason: string | null; stage: string }> }>(`/owner/sponsorship-pipeline`, { headers: { Cookie: cookie } });
    const c = r.body.data!.cards.find((x) => x.brand_company === `rev-${RUN_TAG}`);
    expect(c?.stage).toBe('IN_PROGRESS');
    expect(c?.needs_attention).toBe(true);
    expect(c?.needs_attention_reason).toContain('Revision');
  });

  it('#9 IN_PROGRESS with paid_at + estimated_delivery_days elapsed → Delivery overdue', async () => {
    const { userId, cookie } = await signup(`m09pipe-${RUN_TAG}-due@wavelead.test`, { plan: 'pro' });
    const paidLongAgo = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000);
    await insertOrder(userId, {
      status: 'in_progress', accepted_at: paidLongAgo, paid_at: paidLongAgo,
      estimated_delivery_days: 5, buyer_company: `overdue-${RUN_TAG}`,
    });
    const r = await api<{ cards: Array<{ brand_company: string; needs_attention: boolean; needs_attention_reason: string | null }> }>(`/owner/sponsorship-pipeline`, { headers: { Cookie: cookie } });
    const c = r.body.data!.cards.find((x) => x.brand_company === `overdue-${RUN_TAG}`);
    expect(c?.needs_attention).toBe(true);
    expect((c?.needs_attention_reason || '')).toContain('overdue');
  });
});

// ============================================================================
// §4 — Owner data isolation
// ============================================================================
describe('Phase 3 Pipeline §4 — Owner data isolation', () => {
  it('#10 Pro owner A never sees Pro owner B\'s orders', async () => {
    const a = await signup(`m09pipe-${RUN_TAG}-iso-a@wavelead.test`, { plan: 'pro' });
    const b = await signup(`m09pipe-${RUN_TAG}-iso-b@wavelead.test`, { plan: 'pro' });
    await insertOrder(a.userId, { status: 'requested', buyer_company: `A-only-${RUN_TAG}` });
    await insertOrder(b.userId, { status: 'requested', buyer_company: `B-only-${RUN_TAG}` });
    const ra = await api<{ cards: Array<{ brand_company: string }> }>(`/owner/sponsorship-pipeline`, { headers: { Cookie: a.cookie } });
    const rb = await api<{ cards: Array<{ brand_company: string }> }>(`/owner/sponsorship-pipeline`, { headers: { Cookie: b.cookie } });
    expect(ra.body.data!.cards.some((c) => c.brand_company === `A-only-${RUN_TAG}`)).toBe(true);
    expect(ra.body.data!.cards.some((c) => c.brand_company === `B-only-${RUN_TAG}`)).toBe(false);
    expect(rb.body.data!.cards.some((c) => c.brand_company === `B-only-${RUN_TAG}`)).toBe(true);
    expect(rb.body.data!.cards.some((c) => c.brand_company === `A-only-${RUN_TAG}`)).toBe(false);
  });
});

// ============================================================================
// §5 — SSR states
// ============================================================================
describe('Phase 3 Pipeline §5 — SSR', () => {
  it('#11 Free user → upgrade state SSR (no kanban)', async () => {
    const { cookie } = await signup(`m09pipe-${RUN_TAG}-ssr-free@wavelead.test`);
    const r = await fetch(`${PAGE_BASE}/dashboard/sponsorships/pipeline`, { headers: { Cookie: cookie, 'X-Forwarded-For': CLIENT_IP() } });
    expect(r.status).toBe(200);
    const html = await r.text();
    expect(html).toContain('data-testid="pipeline-upgrade"');
    expect(html).toContain('Join Pro Waitlist');
    expect(html).not.toContain('data-testid="pipeline-kanban"');
  });

  it('#12 Pro user → kanban SSR', async () => {
    const { cookie } = await signup(`m09pipe-${RUN_TAG}-ssr-pro@wavelead.test`, { plan: 'pro' });
    const r = await fetch(`${PAGE_BASE}/dashboard/sponsorships/pipeline`, { headers: { Cookie: cookie, 'X-Forwarded-For': CLIENT_IP() } });
    expect(r.status).toBe(200);
    const html = await r.text();
    expect(html).toContain('data-testid="pipeline-kanban"');
    expect(html).toContain('data-testid="pipeline-col-NEW"');
    expect(html).toContain('data-testid="pipeline-col-COMPLETED"');
    expect(html).not.toContain('data-testid="pipeline-upgrade"');
  });
});

// ============================================================================
// §6 — Filters
// ============================================================================
describe('Phase 3 Pipeline §6 — Filters', () => {
  it('#13 stage filter narrows cards; attention=1 keeps only flagged; channel filter isolates channel', async () => {
    const { userId, cookie } = await signup(`m09pipe-${RUN_TAG}-flt@wavelead.test`, { plan: 'pro' });
    await insertOrder(userId, { status: 'requested', channel_slug: `${RUN_TAG}-c1`, channel_name: 'C1', buyer_company: `A-${RUN_TAG}` });
    await insertOrder(userId, { status: 'in_progress', accepted_at: new Date(), paid_at: new Date(), channel_slug: `${RUN_TAG}-c2`, channel_name: 'C2', buyer_company: `B-${RUN_TAG}` });
    await insertOrder(userId, { status: 'completed', accepted_at: new Date(), paid_at: new Date(), channel_slug: `${RUN_TAG}-c1`, channel_name: 'C1', buyer_company: `C-${RUN_TAG}` });

    const all = await api<{ cards: Array<{ brand_company: string; stage: string }> }>(`/owner/sponsorship-pipeline`, { headers: { Cookie: cookie } });
    expect(all.body.data!.cards.length).toBeGreaterThanOrEqual(3);

    const only = await api<{ cards: Array<{ stage: string }> }>(`/owner/sponsorship-pipeline?stage=COMPLETED`, { headers: { Cookie: cookie } });
    expect(only.body.data!.cards.every((c) => c.stage === 'COMPLETED')).toBe(true);
    expect(only.body.data!.cards.length).toBeGreaterThanOrEqual(1);

    const byChan = await api<{ cards: Array<{ channel_slug: string }> }>(`/owner/sponsorship-pipeline?channel=${RUN_TAG}-c1`, { headers: { Cookie: cookie } });
    expect(byChan.body.data!.cards.every((c) => c.channel_slug === `${RUN_TAG}-c1`)).toBe(true);

    // Attention filter drops non-flagged (our 3 inserted are all fresh → no attention flags expected).
    const att = await api<{ cards: Array<{ needs_attention: boolean }> }>(`/owner/sponsorship-pipeline?attention=1`, { headers: { Cookie: cookie } });
    expect(att.body.data!.cards.every((c) => c.needs_attention === true)).toBe(true);
  });
});

// ============================================================================
// §7 — Waitlist CTA + Free marketplace unchanged
// ============================================================================
describe('Phase 3 Pipeline §7 — Waitlist + Free marketplace', () => {
  it('#14 Pro waitlist POST still creates a pro_waitlist commercial lead', async () => {
    const email = `m09pipe-${RUN_TAG}-wait@wavelead.test`;
    const r = await api<{ lead: { type: string } }>(`/commercial-leads/pro-waitlist`, {
      method: 'POST', body: JSON.stringify({ email }),
    });
    expect(r.status).toBe(201);
    expect(r.body.data?.lead.type).toBe('pro_waitlist');
  });

  it('#15 Free marketplace endpoints remain fully usable', async () => {
    const { cookie } = await signup(`m09pipe-${RUN_TAG}-fmk@wavelead.test`);
    const earnings = await api<{ totals: unknown }>(`/owner/earnings`, { headers: { Cookie: cookie } });
    expect(earnings.status).toBe(200);
    expect(earnings.body.ok).toBe(true);
    const ent = await api<{ plan: string; entitlements: Record<string, unknown> }>(`/entitlements/me`, { headers: { Cookie: cookie } });
    expect(ent.body.data?.plan).toBe('free');
    expect(ent.body.data?.entitlements.marketplace_participation).toBe(true);
    expect(ent.body.data?.entitlements.earnings_and_payouts).toBe(true);
    expect(ent.body.data?.entitlements.sponsorship_pipeline_intelligence).toBe(false);
  });
});
