// Role-aware post-login redirect + navigation tests.
//
// Scope:
//   §1 Server-computed redirect_to per role
//   §2 Safe `next` acceptance + open-redirect protection
//   §3 must_change_password takes priority over role and next
//   §4 Header + Super Admin dashboard entry (SSR HTML assertions)
//   §5 AdminNav completeness
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MongoClient, type Db } from 'mongodb';

const BASE = 'http://localhost:3000/api';
const PAGE_BASE = 'http://localhost:3000';
const CLIENT_IP = () => `10.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;
const RUN_TAG = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;

async function withDb<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  const client = new MongoClient(process.env.MONGO_URL || 'mongodb://localhost:27017');
  await client.connect();
  try { return await fn(client.db(process.env.DB_NAME || 'wavelead')); } finally { await client.close(); }
}

interface LoginResp { user: { id: string; role: string; email: string; display_name: string; must_change_password?: boolean }; redirect_to?: string }
interface Envelope<T> { ok?: boolean; data?: T; error?: string }

async function signupAndPromote(email: string, role: string): Promise<{ userId: string; cookie: string }> {
  const s = await fetch(`${BASE}/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': CLIENT_IP() },
    body: JSON.stringify({ email, password: 'password123!', display_name: `T-${email}` }),
  });
  const cookie = s.headers.get('set-cookie')?.match(/wl_session=[^;]+/)?.[0] || '';
  const j = await s.json() as { ok?: boolean; error?: string; data?: { user?: { id?: string } } };
  if (!j?.ok || !j?.data?.user?.id) {
    throw new Error(`signupAndPromote failed for ${email}: status=${s.status} body=${JSON.stringify(j)}`);
  }
  const userId = j.data.user.id;
  await withDb(async (db) => { await db.collection('users').updateOne({ id: userId }, { $set: { role } }); });
  return { userId, cookie };
}

async function loginWith(email: string, password: string, extras: Record<string, unknown> = {}): Promise<{ status: number; body: Envelope<LoginResp>; cookie: string }> {
  const r = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': CLIENT_IP() },
    body: JSON.stringify({ email, password, ...extras }),
  });
  const body = await r.json() as Envelope<LoginResp>;
  return { status: r.status, body, cookie: r.headers.get('set-cookie')?.match(/wl_session=[^;]+/)?.[0] || '' };
}

async function purge() {
  await withDb(async (db) => {
    await db.collection('users').deleteMany({ email: new RegExp(`m07rd-${RUN_TAG}`) });
  });
}
beforeAll(async () => { await purge(); });
afterAll(async () => { await purge(); });

// ============================================================================
// §1 — Role landing
// ============================================================================
describe('M07 role-aware redirect §1 — Role landing', () => {
  it('#1 super_admin login → redirect_to = /admin', async () => {
    const email = `m07rd-${RUN_TAG}-sa1@wavelead.test`;
    await signupAndPromote(email, 'super_admin');
    const r = await loginWith(email, 'password123!');
    expect(r.status).toBe(200);
    expect(r.body.data?.redirect_to).toBe('/admin');
    expect(r.body.data?.user.role).toBe('super_admin');
  });

  it('#2 admin login → redirect_to = /admin', async () => {
    const email = `m07rd-${RUN_TAG}-adm@wavelead.test`;
    await signupAndPromote(email, 'admin');
    const r = await loginWith(email, 'password123!');
    expect(r.body.data?.redirect_to).toBe('/admin');
  });

  it('#3 moderator login → redirect_to = /admin/moderation', async () => {
    const email = `m07rd-${RUN_TAG}-mod@wavelead.test`;
    await signupAndPromote(email, 'moderator');
    const r = await loginWith(email, 'password123!');
    expect(r.body.data?.redirect_to).toBe('/admin/moderation');
  });

  it('#4 channel_owner login → redirect_to = /dashboard', async () => {
    const email = `m07rd-${RUN_TAG}-own@wavelead.test`;
    await signupAndPromote(email, 'channel_owner');
    const r = await loginWith(email, 'password123!');
    expect(r.body.data?.redirect_to).toBe('/dashboard');
  });

  it('#5 business login → redirect_to = /dashboard', async () => {
    const email = `m07rd-${RUN_TAG}-biz@wavelead.test`;
    await signupAndPromote(email, 'business');
    const r = await loginWith(email, 'password123!');
    expect(r.body.data?.redirect_to).toBe('/dashboard');
  });

  it('#6 regular user login → redirect_to = /dashboard', async () => {
    const email = `m07rd-${RUN_TAG}-user@wavelead.test`;
    await signupAndPromote(email, 'user');
    const r = await loginWith(email, 'password123!');
    expect(r.body.data?.redirect_to).toBe('/dashboard');
  });
});

// ============================================================================
// §2 — `next` handling
// ============================================================================
describe('M07 role-aware redirect §2 — next handling', () => {
  it('#7 safe internal next honored (regular user, next=/dashboard/channels)', async () => {
    const email = `m07rd-${RUN_TAG}-nxt1@wavelead.test`;
    await signupAndPromote(email, 'user');
    const r = await loginWith(email, 'password123!', { next: '/dashboard/channels' });
    expect(r.body.data?.redirect_to).toBe('/dashboard/channels');
  });

  it('#8 super_admin with next=/admin/users honors the safe next', async () => {
    const email = `m07rd-${RUN_TAG}-nxt2@wavelead.test`;
    await signupAndPromote(email, 'super_admin');
    const r = await loginWith(email, 'password123!', { next: '/admin/users' });
    expect(r.body.data?.redirect_to).toBe('/admin/users');
  });

  it('#9 open-redirect protection: absolute + protocol-relative + backslash + api routes all fall back to role default', async () => {
    const email = `m07rd-${RUN_TAG}-nxt3@wavelead.test`;
    await signupAndPromote(email, 'user');
    const badNexts = [
      'https://evil.example.com/steal',
      'http://evil.example.com',
      '//evil.example.com/steal',
      '/\\evil.example.com',
      '\\\\evil.example.com',
      '/api/admin/users',
      '/api',
      'dashboard',            // no leading slash
      '',
      'javascript:alert(1)',
      '/foo\r\nSet-Cookie:%20evil=1',
    ];
    for (const nx of badNexts) {
      const r = await loginWith(email, 'password123!', { next: nx });
      expect(r.body.data?.redirect_to).toBe('/dashboard');   // role default
    }
  });

  it('#10 non-string next silently falls back to role default', async () => {
    const email = `m07rd-${RUN_TAG}-nxt4@wavelead.test`;
    await signupAndPromote(email, 'super_admin');
    const r = await loginWith(email, 'password123!', { next: 12345 });
    expect(r.body.data?.redirect_to).toBe('/admin');
  });
});

// ============================================================================
// §3 — must_change_password priority
// ============================================================================
describe('M07 role-aware redirect §3 — forced-password-change priority', () => {
  it('#11 must_change_password=true → redirect_to = /dashboard/settings/security regardless of next OR role', async () => {
    // (a) super_admin + must_change + external next → still forced to change-password
    const emailA = `m07rd-${RUN_TAG}-forceA@wavelead.test`;
    const { userId: uidA } = await signupAndPromote(emailA, 'super_admin');
    await withDb(async (db) => { await db.collection('users').updateOne({ id: uidA }, { $set: { must_change_password: true } }); });
    // Verify DB state before the login attempt
    const dbState = await withDb(async (db) => db.collection('users').findOne({ id: uidA }));
    expect(dbState?.email).toBe(emailA.toLowerCase());
    expect(dbState?.role).toBe('super_admin');
    expect(dbState?.must_change_password).toBe(true);
    const a = await loginWith(emailA, 'password123!', { next: '/admin/settings/paypal' });
    expect(a.status).toBe(200);
    expect(a.body.data?.user.must_change_password).toBe(true);
    expect(a.body.data?.redirect_to).toBe('/dashboard/settings/security');

    // (b) user + must_change + no next → same
    const emailB = `m07rd-${RUN_TAG}-forceB@wavelead.test`;
    const { userId: uidB } = await signupAndPromote(emailB, 'user');
    await withDb(async (db) => { await db.collection('users').updateOne({ id: uidB }, { $set: { must_change_password: true } }); });
    const b = await loginWith(emailB, 'password123!');
    expect(b.body.data?.redirect_to).toBe('/dashboard/settings/security');

    // (c) same user AFTER must_change cleared → role landing (user → /dashboard)
    await withDb(async (db) => { await db.collection('users').updateOne({ id: uidB }, { $set: { must_change_password: false } }); });
    const c = await loginWith(emailB, 'password123!');
    expect(c.body.data?.redirect_to).toBe('/dashboard');
  });
});

// ============================================================================
// §4 — Header + Super Admin dashboard entry
// ============================================================================
describe('M07 role-aware redirect §4 — Header + Super Admin dashboard entry', () => {
  it('#12 super_admin /dashboard SSR HTML includes the Super Admin operational entry with all 4 links', async () => {
    const email = `m07rd-${RUN_TAG}-hdr1@wavelead.test`;
    const { cookie } = await signupAndPromote(email, 'super_admin');
    // Login to make sure cookie is fresh (session_version invariants).
    const l = await loginWith(email, 'password123!');
    const authCookie = l.cookie || cookie;
    const r = await fetch(`${PAGE_BASE}/dashboard`, { headers: { Cookie: authCookie }, redirect: 'manual' });
    const html = await r.text();
    // Super Admin entry present
    expect(html).toMatch(/data-testid="super-admin-entry"/);
    expect(html).toContain('Super Admin');
    // Links (order irrelevant; each URL must appear)
    expect(html).toContain('href="/admin"');
    expect(html).toContain('href="/admin/users"');
    expect(html).toContain('href="/admin/settings/paypal"');
    expect(html).toContain('href="/admin/payment-health"');
  });

  it('#13 regular user /dashboard SSR HTML does NOT include the Super Admin entry', async () => {
    const email = `m07rd-${RUN_TAG}-hdr2@wavelead.test`;
    const { cookie } = await signupAndPromote(email, 'user');
    const l = await loginWith(email, 'password123!');
    const authCookie = l.cookie || cookie;
    const r = await fetch(`${PAGE_BASE}/dashboard`, { headers: { Cookie: authCookie }, redirect: 'manual' });
    const html = await r.text();
    expect(html).not.toMatch(/data-testid="super-admin-entry"/);
  });

  it('#14 AdminNav (rendered on /admin) exposes ALL 13 required nav items', async () => {
    const email = `m07rd-${RUN_TAG}-hdr3@wavelead.test`;
    const { cookie } = await signupAndPromote(email, 'super_admin');
    const l = await loginWith(email, 'password123!');
    const authCookie = l.cookie || cookie;
    const r = await fetch(`${PAGE_BASE}/admin`, { headers: { Cookie: authCookie }, redirect: 'manual' });
    const html = await r.text();
    const required = [
      '/admin',
      '/admin/channels?status=pending_review',
      '/admin/claims?status=pending',
      '/admin/channel-changes?status=pending',
      '/admin/promotions',
      '/admin/promotion-rates',
      '/admin/sponsorship-leads',
      '/admin/payments',
      '/admin/ledger',
      '/admin/payment-health',
      '/admin/fx-rates',
      '/admin/users',
      '/admin/settings/paypal',
    ];
    for (const link of required) {
      // href with quoted attribute; entity-encode & → &amp; because Next renders `?` in URLs literally
      const needle = `href="${link.replace(/&/g, '&amp;')}"`;
      expect(html, `AdminNav missing link: ${link}`).toContain(needle);
    }
  });
});

// ============================================================================
// §5 — /admin/moderation redirect
// ============================================================================
describe('M07 role-aware redirect §5 — moderator canonical landing', () => {
  it('#15 authenticated moderator GET /admin/moderation redirects to /admin/channels?status=pending_review', async () => {
    const email = `m07rd-${RUN_TAG}-mod2@wavelead.test`;
    const { cookie } = await signupAndPromote(email, 'moderator');
    const l = await loginWith(email, 'password123!');
    const authCookie = l.cookie || cookie;
    const r = await fetch(`${PAGE_BASE}/admin/moderation`, { headers: { Cookie: authCookie }, redirect: 'manual' });
    // Next server-side redirect() emits a 3xx (307 in App Router).
    expect([301, 302, 303, 307, 308]).toContain(r.status);
    const loc = r.headers.get('location') || '';
    expect(loc).toContain('/admin/channels');
    expect(loc).toContain('status=pending_review');
  });

  it('#16 unauthenticated GET /admin/moderation redirects to /login?next=/admin/moderation', async () => {
    const r = await fetch(`${PAGE_BASE}/admin/moderation`, { redirect: 'manual' });
    expect([301, 302, 303, 307, 308]).toContain(r.status);
    const loc = r.headers.get('location') || '';
    expect(loc).toContain('/login');
    expect(loc).toContain('next=');
  });

  it('#17 regular user GET /admin/moderation is bounced to /dashboard (no admin access)', async () => {
    const email = `m07rd-${RUN_TAG}-mod3@wavelead.test`;
    const { cookie } = await signupAndPromote(email, 'user');
    const l = await loginWith(email, 'password123!');
    const authCookie = l.cookie || cookie;
    const r = await fetch(`${PAGE_BASE}/admin/moderation`, { headers: { Cookie: authCookie }, redirect: 'manual' });
    expect([301, 302, 303, 307, 308]).toContain(r.status);
    const loc = r.headers.get('location') || '';
    expect(loc).toContain('/dashboard');
  });
});
