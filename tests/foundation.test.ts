// Foundation tests \u2014 hit the live Next.js API on :3000 to exercise the
// full stack. To avoid tripping the auth rate limiter, EVERY request from
// this suite carries a unique X-Forwarded-For per test.
import { describe, it, expect, beforeAll } from 'vitest';
import { MongoClient } from 'mongodb';
import { runSeed } from '@/lib/seed/seedData';

const BASE = 'http://localhost:3000/api';

function uniqueEmail(prefix: string): string {
  return `${prefix}+${Date.now()}${Math.floor(Math.random() * 1e6)}@wavelead.test`;
}

function fakeIp(): string {
  return `10.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;
}

interface JsonResp<T = unknown> { ok: boolean; data?: T; error?: string; }

async function api<T = unknown>(
  path: string,
  init: RequestInit = {},
  ip: string = fakeIp()
): Promise<{ status: number; body: JsonResp<T>; setCookie: string | null }> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'X-Forwarded-For': ip,
      ...(init.headers || {}),
    },
  });
  const body = (await res.json()) as JsonResp<T>;
  return { status: res.status, body, setCookie: res.headers.get('set-cookie') };
}

function extractSessionCookie(setCookie: string | null): string | null {
  if (!setCookie) return null;
  const m = setCookie.match(/wl_session=([^;]+)/);
  return m ? `wl_session=${m[1]}` : null;
}

async function withDb<T>(fn: (db: import('mongodb').Db) => Promise<T>): Promise<T> {
  const client = new MongoClient(process.env.MONGO_URL!);
  await client.connect();
  try { return await fn(client.db(process.env.DB_NAME!)); }
  finally { await client.close(); }
}

beforeAll(async () => {
  // Only touch the users collection so seed data is preserved. Reseed
  // (idempotent) to guarantee categories + channels exist.
  await withDb(async (db) => { await db.collection('users').deleteMany({}); });
  await runSeed({});
});

describe('WaveLead foundation', () => {
  it('health endpoint returns wavelead service', async () => {
    const { status, body } = await api<{ status: string; service: string }>('/health');
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data?.service).toBe('wavelead');
  });

  it('categories endpoint returns seeded categories', async () => {
    const { status, body } = await api<{ categories: unknown[] }>('/categories');
    expect(status).toBe(200);
    expect(body.data?.categories?.length ?? 0).toBeGreaterThanOrEqual(20);
  });

  it('approved channels endpoint returns seeded channels and no owner_id leak', async () => {
    const { status, body } = await api<{ items: Array<Record<string, unknown>>; total: number }>('/channels?limit=5');
    expect(status).toBe(200);
    expect(body.data?.total).toBeGreaterThanOrEqual(20);
    const first = body.data?.items?.[0] || {};
    expect(first).not.toHaveProperty('owner_id');
    expect(first).not.toHaveProperty('verification_status');
    expect(first).not.toHaveProperty('_id');
  });

  it('seed is idempotent (no duplicate rows)', async () => {
    const before = (await api<{ totalApproved: number }>('/stats')).body.data?.totalApproved || 0;
    await runSeed({});
    await runSeed({});
    const after = (await api<{ totalApproved: number }>('/stats')).body.data?.totalApproved || 0;
    expect(after).toBe(before);
  });

  it('signup succeeds and returns no password_hash or _id', async () => {
    const email = uniqueEmail('signup');
    const { status, body } = await api<{ user: Record<string, unknown> }>('/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ email, password: 'password123', display_name: 'Signup Test' }),
    });
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    const u = body.data!.user as Record<string, unknown>;
    expect(u.password_hash).toBeUndefined();
    expect((u as { _id?: unknown })._id).toBeUndefined();
    expect(u.role).toBe('user');
  });

  it('duplicate signup is rejected with 409', async () => {
    const email = uniqueEmail('dup');
    const ip = fakeIp(); // same IP so both requests are same client
    await api('/auth/signup', { method: 'POST', body: JSON.stringify({ email, password: 'password123', display_name: 'Dup1' }) }, ip);
    const { status, body } = await api('/auth/signup', { method: 'POST', body: JSON.stringify({ email, password: 'password123', display_name: 'Dup2' }) }, ip);
    expect(status).toBe(409);
    expect(body.ok).toBe(false);
  });

  it('login with correct password returns a session cookie', async () => {
    const email = uniqueEmail('loginok');
    await api('/auth/signup', { method: 'POST', body: JSON.stringify({ email, password: 'password123', display_name: 'Login OK' }) });
    const { status, setCookie } = await api('/auth/login', { method: 'POST', body: JSON.stringify({ email, password: 'password123' }) });
    expect(status).toBe(200);
    expect(extractSessionCookie(setCookie)).toBeTruthy();
  });

  it('login with wrong password returns 401 and no cookie', async () => {
    const email = uniqueEmail('loginbad');
    await api('/auth/signup', { method: 'POST', body: JSON.stringify({ email, password: 'password123', display_name: 'Login Bad' }) });
    const { status, body, setCookie } = await api('/auth/login', { method: 'POST', body: JSON.stringify({ email, password: 'WRONG' }) });
    expect(status).toBe(401);
    expect(body.ok).toBe(false);
    expect(extractSessionCookie(setCookie)).toBeFalsy();
  });

  it('logout clears the session cookie', async () => {
    const { setCookie } = await api('/auth/logout', { method: 'POST' });
    expect(setCookie || '').toMatch(/wl_session=;/);
  });

  it('unauthenticated /admin page redirects to /login', async () => {
    const res = await fetch('http://localhost:3000/admin', { redirect: 'manual' });
    expect([302, 307, 308]).toContain(res.status);
    expect(res.headers.get('location') || '').toContain('/login');
  });

  it('normal user is FORBIDDEN from admin API', async () => {
    const email = uniqueEmail('user');
    const signup = await api('/auth/signup', { method: 'POST', body: JSON.stringify({ email, password: 'password123', display_name: 'Normal User' }) });
    const cookie = extractSessionCookie(signup.setCookie)!;
    const { status, body } = await api('/admin/ping', { headers: { Cookie: cookie } });
    expect(status).toBe(403);
    expect(body.ok).toBe(false);
  });

  it('bootstrap super_admin flow AND live role downgrade takes IMMEDIATE effect', async () => {
    const bootEmail = process.env.SUPER_ADMIN_EMAIL!;
    // Wipe users so bootstrap can occur.
    await withDb(async (db) => { await db.collection('users').deleteMany({}); });

    const signup = await api<{ user: { id: string; role: string } }>('/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ email: bootEmail, password: 'password123', display_name: 'Bootstrap Admin' }),
    });
    expect(signup.body.data!.user.role).toBe('super_admin');
    const cookie = extractSessionCookie(signup.setCookie)!;

    const okResp = await api<{ pong: boolean; role: string }>('/admin/ping', { headers: { Cookie: cookie } });
    expect(okResp.status).toBe(200);
    expect(okResp.body.data?.role).toBe('super_admin');

    // Live downgrade via direct DB update \u2014 JWT untouched.
    await withDb(async (db) => {
      await db.collection('users').updateOne(
        { id: signup.body.data!.user.id },
        { $set: { role: 'user' } }
      );
    });

    const denied = await api('/admin/ping', { headers: { Cookie: cookie } });
    expect(denied.status).toBe(403);
  });

  it('non-bootstrap email never gets super_admin, even if it signs up first', async () => {
    await withDb(async (db) => { await db.collection('users').deleteMany({}); });
    const attacker = await api<{ user: { role: string } }>('/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ email: uniqueEmail('attacker'), password: 'password123', display_name: 'Attacker' }),
    });
    expect(attacker.body.data!.user.role).toBe('user');
  });
});
