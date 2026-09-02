// Pricing conversion patch — commercial_leads (Pro waitlist + Enterprise sales).
//
// 15 targeted tests covering:
//   §1 Pricing page CTAs (SSR)
//   §2 Pro waitlist submission + dedupe
//   §3 Enterprise submission + validation
//   §4 Server-derived fields cannot be injected (status / user_id / created_at / admin_notes)
//   §5 Admin surface RBAC + status transitions + double-submit guard
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MongoClient, type Db } from 'mongodb';
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

interface Envelope<T> { ok?: boolean; data?: T; error?: string; code?: string }
async function api<T = unknown>(path: string, init: RequestInit = {}): Promise<{ status: number; body: Envelope<T>; rawText: string; setCookie: string | null }> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': CLIENT_IP(), ...(init.headers || {}) },
  });
  const rawText = await res.text();
  let body: Envelope<T> = {};
  try { body = JSON.parse(rawText); } catch { /* leave */ }
  return { status: res.status, body, rawText, setCookie: res.headers.get('set-cookie') };
}

async function signup(email: string, role?: string): Promise<{ userId: string; cookie: string }> {
  const s = await fetch(`${BASE}/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': CLIENT_IP() },
    body: JSON.stringify({ email, password: 'password123!', display_name: `T-${email.split('@')[0]}` }),
  });
  const cookie = s.headers.get('set-cookie')?.match(/wl_session=[^;]+/)?.[0] || '';
  const j = await s.json() as { data?: { user?: { id?: string } } };
  const userId = j?.data?.user?.id as string;
  if (role) {
    await withDb(async (db) => { await db.collection('users').updateOne({ id: userId }, { $set: { role } }); });
  }
  return { userId, cookie };
}

async function purge() {
  await withDb(async (db) => {
    await db.collection(COLLECTIONS.COMMERCIAL_LEADS).deleteMany({ email: new RegExp(`m07pri-${RUN_TAG}`) });
    await db.collection('users').deleteMany({ email: new RegExp(`m07pri-${RUN_TAG}`) });
  });
}
beforeAll(async () => { await purge(); });
afterAll(async () => { await purge(); });

// ============================================================================
// §1 — Pricing page CTAs (SSR)
// ============================================================================
describe('Pricing conversion §1 — Pricing CTAs', () => {
  it('#1 /pricing renders three CTAs with testids (Free, Pro, Enterprise)', async () => {
    const r = await fetch(`${PAGE_BASE}/pricing`, { redirect: 'manual' });
    const html = await r.text();
    expect(r.status).toBe(200);
    expect(html).toContain('data-testid="cta-free"');
    expect(html).toContain('data-testid="cta-pro"');
    expect(html).toContain('data-testid="cta-enterprise"');
    // Pro CTA copy check
    expect(html).toContain('Join Pro Waitlist');
    expect(html).toContain('Get Started');
    expect(html).toContain('Contact Sales');
    // Phase 3 status pills present
    expect(html).toContain('data-testid="pricing-status-free"');
    expect(html).toContain('data-testid="pricing-status-pro"');
    expect(html).toContain('data-testid="pricing-status-enterprise"');
  });

  it('#2 authenticated user sees the Free CTA the same (client-side routes to /dashboard on click) — SSR carries the button', async () => {
    const { cookie } = await signup(`m07pri-${RUN_TAG}-authed@wavelead.test`);
    const r = await fetch(`${PAGE_BASE}/pricing`, { headers: { Cookie: cookie } });
    expect(r.status).toBe(200);
    const html = await r.text();
    expect(html).toContain('data-testid="cta-free"');
    // We do not gate the CTA server-side. The client hooks `useEffect(() => fetch('/api/auth/me'))`
    // and routes to /dashboard when authenticated. This test verifies the SSR shell exists;
    // the routing semantics are unit-covered in the client (redirect to /dashboard on click when me).
  });
});

// ============================================================================
// §2 — Pro waitlist submission + duplicate protection
// ============================================================================
describe('Pricing conversion §2 — Pro waitlist', () => {
  it('#3 anonymous submission creates a pro_waitlist lead', async () => {
    const email = `m07pri-${RUN_TAG}-pro1@wavelead.test`;
    const r = await api<{ lead: { id: string; type: string; status: string; user_id: string | null } }>(
      '/commercial-leads/pro-waitlist',
      { method: 'POST', body: JSON.stringify({ email, name: 'Anon Pro' }) },
    );
    expect(r.status).toBe(201);
    expect(r.body.data?.lead.type).toBe('pro_waitlist');
    expect(r.body.data?.lead.status).toBe('new');
    expect(r.body.data?.lead.user_id).toBeNull();
    // Server-side admin_notes must NOT be returned to public
    expect(JSON.stringify(r.body)).not.toContain('admin_notes');
  });

  it('#4 authenticated submission attributes user_id from the session', async () => {
    const email = `m07pri-${RUN_TAG}-authpro@wavelead.test`;
    const { userId, cookie } = await signup(email);
    const r = await api<{ lead: { user_id: string | null; email: string } }>(
      '/commercial-leads/pro-waitlist',
      { method: 'POST', headers: { Cookie: cookie }, body: JSON.stringify({ email }) },
    );
    expect(r.status).toBe(201);
    expect(r.body.data?.lead.user_id).toBe(userId);
    expect(r.body.data?.lead.email).toBe(email.toLowerCase());
  });

  it('#5 duplicate email is handled safely (idempotent — no error, single DB row)', async () => {
    const email = `m07pri-${RUN_TAG}-dup@wavelead.test`;
    const first = await api('/commercial-leads/pro-waitlist', { method: 'POST', body: JSON.stringify({ email }) });
    const second = await api('/commercial-leads/pro-waitlist', { method: 'POST', body: JSON.stringify({ email }) });
    const third = await api('/commercial-leads/pro-waitlist', { method: 'POST', body: JSON.stringify({ email }) });
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(third.status).toBe(201);
    // Exactly one row in DB.
    const rows = await withDb(async (db) => db.collection(COLLECTIONS.COMMERCIAL_LEADS).find({ type: 'pro_waitlist', email: email.toLowerCase() }).toArray());
    expect(rows.length).toBe(1);
  });

  it('#6 concurrent double-submit resolves to a single canonical row (unique index)', async () => {
    const email = `m07pri-${RUN_TAG}-race@wavelead.test`;
    const jobs = Array.from({ length: 8 }, () =>
      api('/commercial-leads/pro-waitlist', { method: 'POST', body: JSON.stringify({ email }) }),
    );
    const results = await Promise.all(jobs);
    for (const r of results) expect([200, 201]).toContain(r.status);
    const rows = await withDb(async (db) => db.collection(COLLECTIONS.COMMERCIAL_LEADS).find({ type: 'pro_waitlist', email: email.toLowerCase() }).toArray());
    expect(rows.length).toBe(1);
  });

  it('#7 invalid email is rejected with 400', async () => {
    const r = await api('/commercial-leads/pro-waitlist', { method: 'POST', body: JSON.stringify({ email: 'not-an-email' }) });
    expect(r.status).toBe(400);
    // Rate-limit / other 5xx must NOT accept invalid emails silently.
    const rows = await withDb(async (db) => db.collection(COLLECTIONS.COMMERCIAL_LEADS).find({ email: 'not-an-email' }).toArray());
    expect(rows.length).toBe(0);
  });
});

// ============================================================================
// §3 — Enterprise submission + validation
// ============================================================================
describe('Pricing conversion §3 — Enterprise inquiry', () => {
  const validPayload = (email: string) => ({
    company_name: 'Acme Media',
    contact_name: 'Wile E.',
    email,
    company_type: 'agency',
    channel_count: 42,
    country: 'us',
    interest: ['channel_discovery', 'promotion'],
    message: 'We want to promote our roster.',
  });

  it('#8 valid enterprise submission is stored with all fields', async () => {
    const email = `m07pri-${RUN_TAG}-ent1@wavelead.test`;
    const r = await api<{ lead: { id: string; type: string; company_name: string; company_type: string; channel_count: number | null; country: string | null; interest: string[]; message: string; user_id: string | null } }>(
      '/commercial-leads/enterprise',
      { method: 'POST', body: JSON.stringify(validPayload(email)) },
    );
    expect(r.status).toBe(201);
    const lead = r.body.data?.lead;
    expect(lead?.type).toBe('enterprise_sales');
    expect(lead?.company_name).toBe('Acme Media');
    expect(lead?.company_type).toBe('agency');
    expect(lead?.channel_count).toBe(42);
    expect(lead?.country).toBe('US');            // auto-uppercased
    expect(lead?.interest).toEqual(['channel_discovery', 'promotion']);
    expect(lead?.message).toContain('roster');
    expect(lead?.user_id).toBeNull();
  });

  it('#9 invalid company_type / empty interest rejected with 400', async () => {
    const email = `m07pri-${RUN_TAG}-ent2@wavelead.test`;
    const r1 = await api('/commercial-leads/enterprise', { method: 'POST', body: JSON.stringify({ ...validPayload(email), company_type: 'not_a_type' }) });
    expect(r1.status).toBe(400);
    const r2 = await api('/commercial-leads/enterprise', { method: 'POST', body: JSON.stringify({ ...validPayload(email + '.x'), interest: [] }) });
    expect(r2.status).toBe(400);
  });

  it('#10 invalid email rejected with 400', async () => {
    const r = await api('/commercial-leads/enterprise', { method: 'POST', body: JSON.stringify({ ...validPayload('not-an-email') }) });
    expect(r.status).toBe(400);
  });

  it('#11 status / user_id / created_at / admin_notes injection from client is IGNORED', async () => {
    const email = `m07pri-${RUN_TAG}-inject@wavelead.test`;
    const spoofedUserId = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
    const past = new Date('1999-01-01T00:00:00.000Z').toISOString();
    const r = await api<{ lead: { id: string; status: string; user_id: string | null; created_at: string } }>(
      '/commercial-leads/enterprise',
      { method: 'POST', body: JSON.stringify({
        ...validPayload(email),
        // Attempted client-side spoofs — server MUST strip these:
        status: 'won',
        user_id: spoofedUserId,
        created_at: past,
        admin_notes: 'PWNED',
      }) },
    );
    expect(r.status).toBe(201);
    const lead = r.body.data?.lead;
    expect(lead?.status).toBe('new');
    expect(lead?.user_id).toBeNull();
    // created_at should be Now-ish, not 1999.
    expect(new Date(lead?.created_at || 0).getFullYear()).toBeGreaterThanOrEqual(2020);
    // admin_notes must never appear in public response.
    expect(JSON.stringify(r.body)).not.toContain('admin_notes');
    expect(JSON.stringify(r.body)).not.toContain('PWNED');
    // And the DB row must reflect server-derived values.
    const row = await withDb(async (db) => db.collection(COLLECTIONS.COMMERCIAL_LEADS).findOne({ id: lead?.id }));
    expect(row?.status).toBe('new');
    expect(row?.user_id).toBeNull();
    expect(row?.admin_notes).toBeNull();
  });
});

// ============================================================================
// §4 — Admin surface RBAC + status transitions
// ============================================================================
describe('Pricing conversion §4 — Admin surface', () => {
  it('#12 admin can list all commercial leads and see KPI counts', async () => {
    // Seed one of each first.
    await api('/commercial-leads/pro-waitlist', { method: 'POST', body: JSON.stringify({ email: `m07pri-${RUN_TAG}-adm-p@wavelead.test` }) });
    await api('/commercial-leads/enterprise', { method: 'POST', body: JSON.stringify({
      company_name: 'Test', contact_name: 'T', email: `m07pri-${RUN_TAG}-adm-e@wavelead.test`,
      company_type: 'brand', interest: ['analytics'], message: 'x',
    }) });
    const { cookie } = await signup(`m07pri-${RUN_TAG}-adm@wavelead.test`, 'admin');
    const r = await api<{ items: unknown[]; counts: { kpi: { new: number; qualified: number; won: number } } }>(
      '/admin/commercial-leads',
      { headers: { Cookie: cookie } },
    );
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.data?.items)).toBe(true);
    expect((r.body.data?.items || []).length).toBeGreaterThan(0);
    expect(r.body.data?.counts.kpi.new).toBeGreaterThan(0);
  });

  it('#13 regular user CANNOT access /admin/commercial-leads (403)', async () => {
    const { cookie } = await signup(`m07pri-${RUN_TAG}-user@wavelead.test`);
    const r = await api('/admin/commercial-leads', { headers: { Cookie: cookie } });
    expect(r.status).toBe(403);
  });

  it('#14 admin can PATCH status; unauthorized users cannot', async () => {
    // Create a lead via public endpoint.
    const email = `m07pri-${RUN_TAG}-adm-patch@wavelead.test`;
    const create = await api<{ lead: { id: string } }>('/commercial-leads/pro-waitlist', {
      method: 'POST', body: JSON.stringify({ email }),
    });
    const id = create.body.data?.lead.id as string;
    expect(id).toBeTruthy();

    // Regular user PATCH → 403
    const { cookie: userCookie } = await signup(`m07pri-${RUN_TAG}-patch-user@wavelead.test`);
    const forbid = await api(`/admin/commercial-leads/${id}`, { method: 'PATCH', headers: { Cookie: userCookie }, body: JSON.stringify({ status: 'won' }) });
    expect(forbid.status).toBe(403);

    // Admin PATCH → 200 and status transitions.
    const { cookie: adminCookie } = await signup(`m07pri-${RUN_TAG}-patch-adm@wavelead.test`, 'admin');
    for (const status of ['contacted', 'qualified', 'won'] as const) {
      const p = await api<{ lead: { id: string; status: string; admin_notes: string | null } }>(`/admin/commercial-leads/${id}`, {
        method: 'PATCH', headers: { Cookie: adminCookie },
        body: JSON.stringify({ status, admin_notes: `moved to ${status}` }),
      });
      expect(p.status).toBe(200);
      expect(p.body.data?.lead.status).toBe(status);
      expect(p.body.data?.lead.admin_notes).toBe(`moved to ${status}`);
    }

    // Invalid status rejected.
    const bad = await api(`/admin/commercial-leads/${id}`, { method: 'PATCH', headers: { Cookie: adminCookie }, body: JSON.stringify({ status: 'not_a_status' }) });
    expect(bad.status).toBe(400);
  });

  it('#15 duplicate double-submit from same user does NOT create a second lead row', async () => {
    const email = `m07pri-${RUN_TAG}-double@wavelead.test`;
    const { cookie } = await signup(email);
    // Simulate a rapid double-click: two concurrent requests with the same session.
    const [r1, r2] = await Promise.all([
      api('/commercial-leads/pro-waitlist', { method: 'POST', headers: { Cookie: cookie }, body: JSON.stringify({ email }) }),
      api('/commercial-leads/pro-waitlist', { method: 'POST', headers: { Cookie: cookie }, body: JSON.stringify({ email }) }),
    ]);
    expect([200, 201]).toContain(r1.status);
    expect([200, 201]).toContain(r2.status);
    const rows = await withDb(async (db) => db.collection(COLLECTIONS.COMMERCIAL_LEADS).find({ type: 'pro_waitlist', email: email.toLowerCase() }).toArray());
    expect(rows.length).toBe(1);
  });
});
