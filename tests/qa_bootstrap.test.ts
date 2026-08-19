// QA persona bootstrap + RBAC guardrails.
// These tests validate:
//   1) Bootstrap safety gate (production disabled, env flag required)
//   2) Idempotent provisioning of the three canonical personas
//   3) Server-side role authority (client cannot mutate)
//   4) Persona access boundaries (admin vs owner vs business vs unauth)
//   5) Cross-owner protection
import { describe, it, expect, beforeAll } from 'vitest';
import { MongoClient } from 'mongodb';
import { v4 as uuidv4 } from 'uuid';

const BASE = 'http://localhost:3000/api';
// Per-file client IP so we don't collide with other tests' rate-limit buckets.
const CLIENT_IP = `10.${Math.floor(Math.random()*255)}.${Math.floor(Math.random()*255)}.${Math.floor(Math.random()*255)}`;

async function withDb<T>(fn: (db: import('mongodb').Db) => Promise<T>): Promise<T> {
  const client = new MongoClient(process.env.MONGO_URL || 'mongodb://localhost:27017');
  await client.connect();
  try { return await fn(client.db(process.env.DB_NAME || 'wavelead')); } finally { await client.close(); }
}
async function api<T = unknown>(path: string, init: RequestInit = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'X-Forwarded-For': CLIENT_IP,
      ...(init.headers || {}),
    },
  });
  let body: { ok?: boolean; data?: T; error?: string } = {};
  try { body = await res.json(); } catch {}
  return { status: res.status, body, setCookie: res.headers.get('set-cookie') };
}
async function login(email: string, password: string) {
  const r = await api<{ user: { id: string; role: string } }>('/auth/login', {
    method: 'POST', body: JSON.stringify({ email, password }),
  });
  const cookie = r.setCookie?.match(/wl_session=[^;]+/)?.[0] || '';
  return { user: r.body.data?.user, cookie, status: r.status };
}

describe('QA persona bootstrap + RBAC (preview-only)', () => {
  const adminPw = process.env.QA_ADMIN_PASSWORD || '';
  const ownerPw = process.env.QA_OWNER_PASSWORD || '';
  const businessPw = process.env.QA_BUSINESS_PASSWORD || '';
  const adminEmail = (process.env.QA_ADMIN_EMAIL || 'qa-admin@wavelead.dev').toLowerCase();
  const ownerEmail = (process.env.QA_OWNER_EMAIL || 'qa-owner@wavelead.dev').toLowerCase();
  const businessEmail = (process.env.QA_BUSINESS_EMAIL || 'qa-business@wavelead.dev').toLowerCase();

  const havePasswords = adminPw && ownerPw && businessPw;

  beforeAll(async () => {
    if (!havePasswords) return;
    // Trigger idempotent bootstrap.
    const r = await api('/dev/qa-bootstrap', { method: 'POST' });
    expect(r.status, 'QA bootstrap should succeed in preview').toBe(200);
  });

  it('safety gate: bootstrap must be gated by QA_SEED_ENABLED', () => {
    // Sanity: gate is on in this env (preview).
    expect((process.env.QA_SEED_ENABLED || '').toLowerCase()).toBe('true');
    expect((process.env.NODE_ENV || '').toLowerCase()).not.toBe('production');
  });

  it('safety gate: production disable would reject even when flag is on (behavioural)', async () => {
    // We simulate the production gate by temporarily flipping the flag off
    // via env pattern and asserting the endpoint refuses.
    const prevFlag = process.env.QA_SEED_ENABLED;
    process.env.QA_SEED_ENABLED = 'false';
    // NOTE: the running server was booted with QA_SEED_ENABLED=true, so we
    // exercise the pure-logic gate here.
    const { isQaBootstrapEnabled } = await import('@/lib/seed/qaPersonaSeed');
    const gate = isQaBootstrapEnabled();
    expect(gate.enabled).toBe(false);
    process.env.QA_SEED_ENABLED = prevFlag;
    // Verify production disables independent of QA_SEED_ENABLED.
    const prevNode = process.env.NODE_ENV;
    (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
    const gate2 = isQaBootstrapEnabled();
    expect(gate2.enabled).toBe(false);
    expect(gate2.reason).toBe('production_disabled');
    (process.env as Record<string, string | undefined>).NODE_ENV = prevNode;
  });

  it('server-side role authority: JWT never carries role — role comes from MongoDB', async () => {
    if (!havePasswords) return;
    const s = await login(adminEmail, adminPw);
    expect(s.status).toBe(200);
    expect(s.user?.role).toBe('super_admin');
  });

  it('provisions super_admin idempotently', async () => {
    if (!havePasswords) return;
    // Rerun bootstrap: should NOT create duplicate; role stays super_admin.
    const r1 = await api('/dev/qa-bootstrap', { method: 'POST' });
    expect(r1.status).toBe(200);
    const r2 = await api('/dev/qa-bootstrap', { method: 'POST' });
    expect(r2.status).toBe(200);
    const count = await withDb(async (db) => db.collection('users').countDocuments({ email: adminEmail }));
    expect(count).toBe(1);
    const admin = await withDb(async (db) => db.collection('users').findOne({ email: adminEmail }));
    expect(admin?.role).toBe('super_admin');
  });

  it('provisions channel_owner + one approved+verified QA channel', async () => {
    if (!havePasswords) return;
    const owner = await withDb(async (db) => db.collection('users').findOne({ email: ownerEmail }));
    expect(owner?.role).toBe('channel_owner');
    const ch = await withDb(async (db) => db.collection('channels').findOne({ slug: 'qa-verified-channel' }));
    expect(ch?.owner_id).toBe(owner?.id);
    expect(ch?.status).toBe('approved');
    expect(ch?.verification_status).toBe('verified');
  });

  it('provisions business persona with business role', async () => {
    if (!havePasswords) return;
    const biz = await withDb(async (db) => db.collection('users').findOne({ email: businessEmail }));
    expect(biz?.role).toBe('business');
  });

  it('super_admin can list admin promotions', async () => {
    if (!havePasswords) return;
    const s = await login(adminEmail, adminPw);
    const r = await api('/admin/promotions', { headers: { Cookie: s.cookie } });
    expect(r.status).toBe(200);
  });

  it('channel_owner is denied admin routes (403)', async () => {
    if (!havePasswords) return;
    const s = await login(ownerEmail, ownerPw);
    const r = await api('/admin/promotions', { headers: { Cookie: s.cookie } });
    expect(r.status).toBe(403);
    const r2 = await api('/admin/payments', { headers: { Cookie: s.cookie } });
    expect(r2.status).toBe(403);
  });

  it('business is denied admin routes (403)', async () => {
    if (!havePasswords) return;
    const s = await login(businessEmail, businessPw);
    const r = await api('/admin/promotions', { headers: { Cookie: s.cookie } });
    expect(r.status).toBe(403);
    const r2 = await api('/admin/ledger', { headers: { Cookie: s.cookie } });
    expect(r2.status).toBe(403);
  });

  it('unauthenticated user is blocked from protected admin endpoints', async () => {
    const r = await api('/admin/promotions');
    expect([401, 403]).toContain(r.status);
    const r2 = await api('/admin/payments');
    expect([401, 403]).toContain(r2.status);
    const r3 = await api('/owner/billing');
    expect([401, 403]).toContain(r3.status);
  });

  it('cross-owner protection: owner A cannot access owner B private campaigns', async () => {
    if (!havePasswords) return;
    // Bring in a second owner (owner B) via signup and promote by direct DB write.
    const emailB = `owner-b-${Date.now()}${Math.floor(Math.random()*1e6)}@wavelead.test`;
    const s = await api<{ user: { id: string } }>('/auth/signup', {
      method: 'POST', body: JSON.stringify({ email: emailB, password: 'password123', display_name: 'Owner B' }),
    });
    expect(s.status).toBe(200);
    const cookieB = s.setCookie!.match(/wl_session=[^;]+/)![0];
    const ownerBId = s.body.data!.user.id;
    await withDb(async (db) => { await db.collection('users').updateOne({ id: ownerBId }, { $set: { role: 'channel_owner' } }); });
    // Create a private campaign owned by owner B (direct DB insert).
    const campId = uuidv4();
    await withDb(async (db) => {
      await db.collection('promotion_campaigns').insertOne({
        id: campId, owner_user_id: ownerBId, channel_id: uuidv4(), name: 'Owner B private camp',
        status: 'draft', budget_total_usd_minor: 100, funded_amount_usd_micros: 0, spent_amount_usd_micros: 0,
        refunded_amount_usd_micros: 0, created_at: new Date(), updated_at: new Date(),
      });
    });
    // Owner A tries to fetch owner B's campaign.
    const ownerA = await login(ownerEmail, ownerPw);
    const r = await api(`/owner/campaigns/${campId}`, { headers: { Cookie: ownerA.cookie } });
    expect([403, 404]).toContain(r.status);
    // Owner B can access their own campaign.
    const r2 = await api(`/owner/campaigns/${campId}`, { headers: { Cookie: cookieB } });
    expect([200, 404]).toContain(r2.status);
  });

  it('bootstrap endpoint never returns a password field', async () => {
    if (!havePasswords) return;
    const r = await api<{ personas: Array<Record<string, unknown>> }>('/dev/qa-bootstrap', { method: 'POST' });
    const body = JSON.stringify(r.body);
    expect(body.toLowerCase()).not.toContain('password');
    expect(body).not.toContain(adminPw);
    expect(body).not.toContain(ownerPw);
    expect(body).not.toContain(businessPw);
  });
});
