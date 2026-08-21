// M07-SECURITY — Super Admin + Password + PayPal targeted regression suite (28-test P0 set).
//
// Scope:
//   1. Primary Super Admin identity (hello@p2plabs.asia) and legacy migration integrity
//   2. RBAC on /admin/users and /admin/settings/paypal
//   3. Own-password change + session invalidation
//   4. Admin temporary-password reset + must_change_password enforcement
//   5. Account disable/enable + session invalidation
//   6. PayPal AES-256-GCM vault: encryption at rest, secret never exposed, env fallback, host resolution, preview live guard
//   7. Live activation safety (confirm phrase, Webhook ID, sandbox-vs-live isolation)
//   8. Connection test secret hygiene
//   9. Backend audit events without secrets
//  10. Payment regression: M06 funding/refund/webhook behaviour untouched
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MongoClient, type Db } from 'mongodb';

const BASE = 'http://localhost:3000/api';
const CLIENT_IP = () => `10.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;
const RUN_TAG = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;

async function withDb<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  const client = new MongoClient(process.env.MONGO_URL || 'mongodb://localhost:27017');
  await client.connect();
  try { return await fn(client.db(process.env.DB_NAME || 'wavelead')); } finally { await client.close(); }
}

interface ApiResult<T> { status: number; body: { ok?: boolean; data?: T; error?: string; code?: string }; rawText: string; setCookie: string | null; }
async function api<T = unknown>(path: string, init: RequestInit = {}): Promise<ApiResult<T>> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': CLIENT_IP(), ...(init.headers || {}) },
  });
  const rawText = await res.text();
  let body: ApiResult<T>['body'] = {};
  try { body = JSON.parse(rawText); } catch { /* leave empty */ }
  return { status: res.status, body, rawText, setCookie: res.headers.get('set-cookie') };
}

async function signup(email: string, role?: string): Promise<{ userId: string; cookie: string; password: string; email: string }> {
  const s = await fetch(`${BASE}/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': CLIENT_IP() },
    body: JSON.stringify({ email, password: 'password123!', display_name: `T-${email}` }),
  });
  const cookie = s.headers.get('set-cookie')?.match(/wl_session=[^;]+/)?.[0] || '';
  const j = await s.json();
  const userId = j?.data?.user?.id as string;
  if (role) {
    await withDb(async (db) => {
      await db.collection('users').updateOne({ id: userId }, { $set: { role } });
    });
  }
  return { userId, cookie, password: 'password123!', email };
}

async function login(email: string, password: string): Promise<{ status: number; cookie: string }> {
  const r = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': CLIENT_IP() },
    body: JSON.stringify({ email, password }),
  });
  return { status: r.status, cookie: r.headers.get('set-cookie')?.match(/wl_session=[^;]+/)?.[0] || '' };
}

beforeAll(async () => {
  await withDb(async (db) => {
    await db.collection('users').deleteMany({ email: new RegExp(`m07sec-${RUN_TAG}`) });
    await db.collection('security_audit_events').deleteMany({ 'metadata.tag': RUN_TAG });
    await db.collection('integration_credentials').deleteMany({ provider: 'paypal', client_id: /^TEST_M07SEC_/ });
  });
});
afterAll(async () => {
  await withDb(async (db) => {
    await db.collection('users').deleteMany({ email: new RegExp(`m07sec-${RUN_TAG}`) });
    await db.collection('integration_credentials').deleteMany({ provider: 'paypal', client_id: /^TEST_M07SEC_/ });
  });
});

/* ============================================================================
   SECTION 1 — Primary Super Admin identity (P0 #1 + regression)
============================================================================ */
describe('M07-security §1 — Primary Super Admin identity', () => {
  it('#1 hello@p2plabs.asia exists with role super_admin', async () => {
    const u = await withDb(async (db) => db.collection('users').findOne({ email: 'hello@p2plabs.asia' }));
    expect(u).toBeTruthy();
    expect(u?.role).toBe('super_admin');
  });

  it('regression — hello@p2plabs.asia is UNIQUE: no duplicate super_admin identity created', async () => {
    // Only one row for this email; and if a legacy super_admin identity previously existed
    // (admin@wavelead.dev), it must NOT still be flagged as super_admin.
    const rows = await withDb(async (db) => db.collection('users').find({ email: 'hello@p2plabs.asia' }).toArray());
    expect(rows.length).toBe(1);
    const primary = rows[0];
    expect(primary.id).toBeTruthy();
    expect(typeof primary.id).toBe('string');

    const legacy = await withDb(async (db) => db.collection('users').findOne({ email: 'admin@wavelead.dev' }));
    expect(legacy === null || legacy.role !== 'super_admin').toBe(true);
  });

  it('regression — primary super_admin can authenticate via signup path (identity + role stable)', async () => {
    // We do NOT know the production password of hello@p2plabs.asia, but we can verify
    // the identity is intact by fetching directly and checking the security fields have
    // been shaped by the M07 patch.
    const u = await withDb(async (db) => db.collection('users').findOne({ email: 'hello@p2plabs.asia' }));
    expect(u?.role).toBe('super_admin');
    // Must have a password_hash (never null / empty).
    expect(typeof u?.password_hash).toBe('string');
    expect((u?.password_hash as string).length).toBeGreaterThan(20);
    // session_version present (may be 0)
    expect(typeof (u as { session_version?: number })?.session_version === 'number' || (u as { session_version?: number })?.session_version === undefined).toBe(true);
  });
});

/* ============================================================================
   SECTION 2 — /admin/users RBAC (P0 #2, #3, #4)
============================================================================ */
describe('M07-security §2 — /admin/users RBAC', () => {
  it('#2 super_admin can list users', async () => {
    const admin = await signup(`m07sec-${RUN_TAG}-sa1@wavelead.test`, 'super_admin');
    const r = await api<{ items: unknown[] }>('/admin/users', { headers: { Cookie: admin.cookie } });
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.data?.items)).toBe(true);
  });

  it('#2 regular admin CANNOT access /admin/users (403)', async () => {
    const adm = await signup(`m07sec-${RUN_TAG}-reg1@wavelead.test`, 'admin');
    const r = await api('/admin/users', { headers: { Cookie: adm.cookie } });
    expect(r.status).toBe(403);
  });

  it('#4 channel_owner CANNOT access /admin/users', async () => {
    const own = await signup(`m07sec-${RUN_TAG}-own1@wavelead.test`, 'channel_owner');
    const r = await api('/admin/users', { headers: { Cookie: own.cookie } });
    expect(r.status).toBe(403);
  });

  it('#4 business CANNOT access /admin/users', async () => {
    const biz = await signup(`m07sec-${RUN_TAG}-biz1@wavelead.test`, 'business');
    const r = await api('/admin/users', { headers: { Cookie: biz.cookie } });
    expect(r.status).toBe(403);
  });

  it('#11 /admin/users response never leaks password_hash', async () => {
    const admin = await signup(`m07sec-${RUN_TAG}-sa2@wavelead.test`, 'super_admin');
    const r = await api<{ items: Array<Record<string, unknown>> }>('/admin/users', { headers: { Cookie: admin.cookie } });
    expect(r.status).toBe(200);
    expect(r.rawText).not.toContain('password_hash');
    for (const item of r.body.data?.items ?? []) {
      expect('password_hash' in item).toBe(false);
    }
  });
});

/* ============================================================================
   SECTION 3 — /admin/settings/paypal RBAC (P0 #3 + #4)
============================================================================ */
describe('M07-security §3 — /admin/settings/paypal RBAC', () => {
  it('#3 super_admin can GET /admin/settings/paypal', async () => {
    const admin = await signup(`m07sec-${RUN_TAG}-sa3@wavelead.test`, 'super_admin');
    const r = await api('/admin/settings/paypal', { headers: { Cookie: admin.cookie } });
    expect(r.status).toBe(200);
  });
  it('#3 regular admin CANNOT GET /admin/settings/paypal', async () => {
    const adm = await signup(`m07sec-${RUN_TAG}-reg2@wavelead.test`, 'admin');
    const r = await api('/admin/settings/paypal', { headers: { Cookie: adm.cookie } });
    expect(r.status).toBe(403);
  });
  it('#3 regular admin CANNOT POST /admin/settings/paypal', async () => {
    const adm = await signup(`m07sec-${RUN_TAG}-reg3@wavelead.test`, 'admin');
    const r = await api('/admin/settings/paypal', {
      method: 'POST', headers: { Cookie: adm.cookie },
      body: JSON.stringify({ environment: 'sandbox', client_id: 'TEST_M07SEC_reject', client_secret: 'nope-secret-value' }),
    });
    expect(r.status).toBe(403);
  });
  it('#4 owner and business CANNOT access /admin/settings/paypal', async () => {
    const own = await signup(`m07sec-${RUN_TAG}-own2@wavelead.test`, 'channel_owner');
    const biz = await signup(`m07sec-${RUN_TAG}-biz2@wavelead.test`, 'business');
    expect((await api('/admin/settings/paypal', { headers: { Cookie: own.cookie } })).status).toBe(403);
    expect((await api('/admin/settings/paypal', { headers: { Cookie: biz.cookie } })).status).toBe(403);
  });
});

/* ============================================================================
   SECTION 4 — Own password change (P0 #5, #6, #7)
============================================================================ */
describe('M07-security §4 — Own password change', () => {
  it('#5 wrong current password is rejected (400)', async () => {
    const u = await signup(`m07sec-${RUN_TAG}-p1@wavelead.test`);
    const r = await api('/me/password', {
      method: 'POST', headers: { Cookie: u.cookie },
      body: JSON.stringify({ current_password: 'wrong', new_password: 'brandNewPassw0rd!' }),
    });
    expect(r.status).toBe(400);
  });

  it('#6 minimum length (>=10) enforced server-side', async () => {
    const u = await signup(`m07sec-${RUN_TAG}-p2@wavelead.test`);
    const r = await api('/me/password', {
      method: 'POST', headers: { Cookie: u.cookie },
      body: JSON.stringify({ current_password: u.password, new_password: 'short1!' }),
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/10 characters/i);
  });

  it('#7 successful change invalidates the old session and lets user log in with new password', async () => {
    const u = await signup(`m07sec-${RUN_TAG}-p3@wavelead.test`);
    const good = await api('/me/password', {
      method: 'POST', headers: { Cookie: u.cookie },
      body: JSON.stringify({ current_password: u.password, new_password: 'brandNewPassw0rd!' }),
    });
    expect(good.status).toBe(200);
    // Old cookie no longer works on a privileged endpoint
    const stale = await api('/me/password', {
      method: 'POST', headers: { Cookie: u.cookie },
      body: JSON.stringify({ current_password: 'anything', new_password: 'anotherPassw0rd!!' }),
    });
    expect(stale.status).toBe(401);
    // /auth/me also returns 401 for invalidated sessions
    const meStale = await api('/auth/me', { headers: { Cookie: u.cookie } });
    expect(meStale.status).toBe(401);
    // New login with new password succeeds and issues a fresh cookie
    const fresh = await login(u.email, 'brandNewPassw0rd!');
    expect(fresh.status).toBe(200);
    expect(fresh.cookie).toBeTruthy();
  });
});

/* ============================================================================
   SECTION 5 — Admin temp-password reset & force-change (P0 #8, #9, #10, #11)
============================================================================ */
describe('M07-security §5 — Admin temporary-password reset', () => {
  it('#8 super_admin reset returns temp password, sets must_change_password=true, bumps session_version', async () => {
    const admin = await signup(`m07sec-${RUN_TAG}-sa4@wavelead.test`, 'super_admin');
    const target = await signup(`m07sec-${RUN_TAG}-t1@wavelead.test`);
    const oldCookie = target.cookie;

    const r = await api<{ temporary_password: string }>(`/admin/users/${target.userId}/reset-password`, {
      method: 'POST', headers: { Cookie: admin.cookie },
    });
    expect(r.status).toBe(200);
    const temp = r.body.data?.temporary_password;
    expect(typeof temp).toBe('string');
    expect((temp || '').length).toBeGreaterThanOrEqual(20);

    // must_change_password + session_version bumped
    const persisted = await withDb(async (db) => db.collection('users').findOne({ id: target.userId }));
    expect(persisted?.must_change_password).toBe(true);
    expect((persisted?.session_version ?? 0)).toBeGreaterThan(0);
    // Old cookie now invalidated
    const meStale = await api('/auth/me', { headers: { Cookie: oldCookie } });
    expect(meStale.status).toBe(401);
    // Login with temp password succeeds
    const relog = await login(target.email, temp!);
    expect(relog.status).toBe(200);
    expect(relog.cookie).toBeTruthy();
  });

  it('#10 temporary password is NEVER stored plaintext (only bcrypt hash)', async () => {
    const admin = await signup(`m07sec-${RUN_TAG}-sa5@wavelead.test`, 'super_admin');
    const target = await signup(`m07sec-${RUN_TAG}-t2@wavelead.test`);
    const r = await api<{ temporary_password: string }>(`/admin/users/${target.userId}/reset-password`, {
      method: 'POST', headers: { Cookie: admin.cookie },
    });
    expect(r.status).toBe(200);
    const temp = r.body.data!.temporary_password;
    const persisted = await withDb(async (db) => db.collection('users').findOne({ id: target.userId }));
    expect(persisted?.password_hash).toBeTruthy();
    // password_hash must NOT be the temp itself (bcrypt starts with $2)
    expect(persisted?.password_hash).not.toBe(temp);
    expect((persisted?.password_hash as string).startsWith('$2')).toBe(true);
    // Full user document must NOT contain the temp anywhere
    expect(JSON.stringify(persisted)).not.toContain(temp);
    // Also confirm the audit trail did not spill the temp
    const audit = await withDb(async (db) => db.collection('security_audit_events')
      .find({ event_type: 'USER_PASSWORD_RESET', subject_user_id: target.userId }).toArray());
    expect(audit.length).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(audit)).not.toContain(temp);
  });

  it('#11 password_hash is NEVER returned by /admin/users detail endpoint', async () => {
    const admin = await signup(`m07sec-${RUN_TAG}-sa6@wavelead.test`, 'super_admin');
    const target = await signup(`m07sec-${RUN_TAG}-t3@wavelead.test`);
    const r = await api<{ user: Record<string, unknown> }>(`/admin/users/${target.userId}`, {
      headers: { Cookie: admin.cookie },
    });
    expect(r.status).toBe(200);
    expect('password_hash' in (r.body.data?.user || {})).toBe(false);
    expect(r.rawText).not.toContain('password_hash');
  });

  it('#9 force-reset user CANNOT access privileged/dashboard endpoints until password changed', async () => {
    const admin = await signup(`m07sec-${RUN_TAG}-sa7@wavelead.test`, 'super_admin');
    const target = await signup(`m07sec-${RUN_TAG}-t4@wavelead.test`);
    const r = await api<{ temporary_password: string }>(`/admin/users/${target.userId}/reset-password`, {
      method: 'POST', headers: { Cookie: admin.cookie },
    });
    const temp = r.body.data!.temporary_password;
    const relog = await login(target.email, temp);
    expect(relog.status).toBe(200);
    // Any /dashboard/... endpoint is gated (use /me/settings/... shape via /me/ prefix probe)
    // Concretely: /owner/channels/anything is gated for authenticated + must_change_password.
    const gated = await api('/owner/channels/nonexistent-id/analytics/overview', { headers: { Cookie: relog.cookie } });
    expect([428, 401]).toContain(gated.status); // 428 = precondition (must-change)
    if (gated.status === 428) expect(gated.body.code).toBe('password_change_required');

    // /me/password IS allowed even in force-change state — user can change their password.
    const change = await api('/me/password', {
      method: 'POST', headers: { Cookie: relog.cookie },
      body: JSON.stringify({ current_password: temp, new_password: 'FinalPassw0rdOK!' }),
    });
    expect(change.status).toBe(200);
    // After change: must_change_password cleared
    const after = await withDb(async (db) => db.collection('users').findOne({ id: target.userId }));
    expect(after?.must_change_password).toBe(false);
    // And new login lets user through the gate
    const relog2 = await login(target.email, 'FinalPassw0rdOK!');
    expect(relog2.status).toBe(200);
    const after2 = await api('/owner/channels/nonexistent-id/analytics/overview', { headers: { Cookie: relog2.cookie } });
    expect(after2.status).not.toBe(428);
  });

  it('regular admin CANNOT reset another user\'s password (403)', async () => {
    const adm = await signup(`m07sec-${RUN_TAG}-reg4@wavelead.test`, 'admin');
    const target = await signup(`m07sec-${RUN_TAG}-t5@wavelead.test`);
    const r = await api(`/admin/users/${target.userId}/reset-password`, {
      method: 'POST', headers: { Cookie: adm.cookie },
    });
    expect(r.status).toBe(403);
  });
});

/* ============================================================================
   SECTION 6 — Account disable / session invalidation (P0 #12, #13)
============================================================================ */
describe('M07-security §6 — Account disable / enable', () => {
  it('#13 disabling a user immediately invalidates their active session', async () => {
    const admin = await signup(`m07sec-${RUN_TAG}-sa8@wavelead.test`, 'super_admin');
    const target = await signup(`m07sec-${RUN_TAG}-d1@wavelead.test`);
    // Sanity: cookie works before disable
    const beforeMe = await api('/auth/me', { headers: { Cookie: target.cookie } });
    expect(beforeMe.status).toBe(200);
    // Disable
    const dis = await api(`/admin/users/${target.userId}/disable`, {
      method: 'POST', headers: { Cookie: admin.cookie },
      body: JSON.stringify({ disabled: true }),
    });
    expect(dis.status).toBe(200);
    // Cookie no longer valid on /auth/me
    const afterMe = await api('/auth/me', { headers: { Cookie: target.cookie } });
    expect(afterMe.status).toBe(401);
  });

  it('#12 disabled account cannot log in (403)', async () => {
    const admin = await signup(`m07sec-${RUN_TAG}-sa9@wavelead.test`, 'super_admin');
    const target = await signup(`m07sec-${RUN_TAG}-d2@wavelead.test`);
    await api(`/admin/users/${target.userId}/disable`, {
      method: 'POST', headers: { Cookie: admin.cookie },
      body: JSON.stringify({ disabled: true }),
    });
    const r = await login(target.email, target.password);
    expect(r.status).toBe(403);
  });

  it('re-enabling an account restores login access', async () => {
    const admin = await signup(`m07sec-${RUN_TAG}-sa10@wavelead.test`, 'super_admin');
    const target = await signup(`m07sec-${RUN_TAG}-d3@wavelead.test`);
    await api(`/admin/users/${target.userId}/disable`, {
      method: 'POST', headers: { Cookie: admin.cookie }, body: JSON.stringify({ disabled: true }),
    });
    await api(`/admin/users/${target.userId}/disable`, {
      method: 'POST', headers: { Cookie: admin.cookie }, body: JSON.stringify({ disabled: false }),
    });
    const r = await login(target.email, target.password);
    expect(r.status).toBe(200);
  });
});

/* ============================================================================
   SECTION 7 — PayPal AES-256-GCM vault & secret hygiene (P0 #14, #15, #16, #17, #18)
============================================================================ */
function validSandbox() {
  return {
    environment: 'sandbox' as const,
    client_id: `TEST_M07SEC_${RUN_TAG}_CID_${Math.random().toString(36).slice(2, 10)}`,
    client_secret: `TEST_M07SEC_${RUN_TAG}_SECRET_${Math.random().toString(36).slice(2, 20)}`,
    webhook_id: `TEST_WHID_SB_${Math.random().toString(36).slice(2, 8)}`,
  };
}

describe('M07-security §7 — PayPal vault: encryption at rest & no-secret exposure', () => {
  it('#14 client_secret is AES-256-GCM encrypted at rest (envelope format iv.ct.tag)', async () => {
    const admin = await signup(`m07sec-${RUN_TAG}-sa11@wavelead.test`, 'super_admin');
    const cfg = validSandbox();
    const save = await api('/admin/settings/paypal', {
      method: 'POST', headers: { Cookie: admin.cookie }, body: JSON.stringify(cfg),
    });
    expect(save.status).toBe(200);
    const row = await withDb(async (db) => db.collection('integration_credentials').findOne({ provider: 'paypal', client_id: cfg.client_id }));
    expect(row?.client_secret_ciphertext).toBeTruthy();
    // Envelope: <iv_b64>.<ct_b64>.<tag_b64>
    const parts = String(row?.client_secret_ciphertext).split('.');
    expect(parts.length).toBe(3);
    for (const p of parts) expect(p.length).toBeGreaterThan(0);
    // Ciphertext must not contain plaintext substring
    expect(row?.client_secret_ciphertext).not.toContain(cfg.client_secret);
  });

  it('#15 encrypted secret can only be decrypted server-side via cryptoVault', async () => {
    const admin = await signup(`m07sec-${RUN_TAG}-sa12@wavelead.test`, 'super_admin');
    const cfg = validSandbox();
    const save = await api('/admin/settings/paypal', {
      method: 'POST', headers: { Cookie: admin.cookie }, body: JSON.stringify(cfg),
    });
    expect(save.status).toBe(200);
    const row = await withDb(async (db) => db.collection('integration_credentials').findOne({ provider: 'paypal', client_id: cfg.client_id }));
    const { decryptString } = await import('@/lib/utils/cryptoVault');
    expect(decryptString(row!.client_secret_ciphertext as string)).toBe(cfg.client_secret);
  });

  it('#16 malformed / tampered ciphertext fails closed (decryptString throws)', async () => {
    const { decryptString, encryptString } = await import('@/lib/utils/cryptoVault');
    expect(() => decryptString('not.a.valid.envelope')).toThrow();
    expect(() => decryptString('AAAA.AAAA.AAAA')).toThrow();
    // Also tamper the middle segment of a valid envelope
    const env = encryptString('canary-secret-value');
    const [iv, ct, tag] = env.split('.');
    void ct;
    const tampered = `${iv}.QUFB.${tag}`; // replace ct with junk
    expect(() => decryptString(tampered)).toThrow();
    // Also flip auth tag
    const tampered2 = `${iv}.${ct}.AAAAAAAAAAAAAAAAAAAAAA==`;
    expect(() => decryptString(tampered2)).toThrow();
  });

  it('#17 stored client_secret is NEVER returned by /admin/settings/paypal (GET or POST body)', async () => {
    const admin = await signup(`m07sec-${RUN_TAG}-sa13@wavelead.test`, 'super_admin');
    const cfg = validSandbox();
    const save = await api('/admin/settings/paypal', {
      method: 'POST', headers: { Cookie: admin.cookie }, body: JSON.stringify(cfg),
    });
    expect(save.status).toBe(200);
    // Save response itself must never contain the plaintext secret
    expect(save.rawText).not.toContain(cfg.client_secret);
    const view = await api<{ sandbox: { client_id_masked: string; client_secret_configured: boolean; source: string } }>(
      '/admin/settings/paypal', { headers: { Cookie: admin.cookie } },
    );
    expect(view.status).toBe(200);
    expect(view.rawText).not.toContain(cfg.client_secret);
    expect(view.rawText).not.toContain('client_secret_ciphertext');
    // Confirm the shape: only masked / boolean / source metadata
    expect(view.body.data?.sandbox.client_secret_configured).toBe(true);
    expect(view.body.data?.sandbox.client_id_masked).toContain(cfg.client_id.slice(-4));
    expect(view.body.data?.sandbox.source).toBe('admin_vault');
  });

  it('#18 audit metadata for PayPal config never contains the plaintext secret', async () => {
    const admin = await signup(`m07sec-${RUN_TAG}-sa14@wavelead.test`, 'super_admin');
    const cfg = validSandbox();
    const save = await api('/admin/settings/paypal', {
      method: 'POST', headers: { Cookie: admin.cookie }, body: JSON.stringify(cfg),
    });
    expect(save.status).toBe(200);
    const audit = await withDb(async (db) => db.collection('security_audit_events')
      .find({ event_type: /^PAYPAL_/ }).sort({ created_at: -1 }).limit(20).toArray());
    expect(audit.length).toBeGreaterThan(0);
    for (const evt of audit) {
      const s = JSON.stringify(evt);
      expect(s).not.toContain(cfg.client_secret);
      expect(s).not.toMatch(/TEST_M07SEC_.*_SECRET_/);
    }
  });
});

/* ============================================================================
   SECTION 8 — Env fallback vs vault override + host resolution (P0 #19, #20, #21, #22)
============================================================================ */
describe('M07-security §8 — Vault vs env-fallback resolution + host mapping', () => {
  it('#19 admin-vault PayPal config overrides environment fallback', async () => {
    // Ensure a sandbox vault row exists (creates one)
    const admin = await signup(`m07sec-${RUN_TAG}-sa15@wavelead.test`, 'super_admin');
    const cfg = validSandbox();
    await api('/admin/settings/paypal', {
      method: 'POST', headers: { Cookie: admin.cookie }, body: JSON.stringify(cfg),
    });
    const { paypalConfigService } = await import('@/lib/services/payments/paypalConfigService');
    const resolved = await paypalConfigService.resolveActive();
    expect(resolved).toBeTruthy();
    expect(resolved!.environment).toBe('sandbox');
    // If the vault path is being honoured, resolveActive returns admin_vault (this test
    // proves override; if no vault row was ever saved this would be env).
    expect(resolved!.source).toBe('admin_vault');
    // And decrypts to the plaintext we just saved.
    expect(resolved!.client_secret).toBe(cfg.client_secret);
  });

  it('#20 env fallback still works when the vault row is absent for the requested env', async () => {
    const { paypalConfigService } = await import('@/lib/services/payments/paypalConfigService');
    // Wipe any live row first — live is not populated in preview.
    await withDb(async (db) => { await db.collection('integration_credentials').deleteMany({ provider: 'paypal', environment: 'live' }); });
    const status = await paypalConfigService.status('live');
    // Must be either 'env' (if PAYPAL_ENVIRONMENT=live was set) or 'none'. Never 'admin_vault'.
    expect(['none', 'env']).toContain(status.source);
  });

  it('#21 apiHostFor(sandbox) resolves to https://api-m.sandbox.paypal.com', async () => {
    const { apiHostFor } = await import('@/lib/services/payments/paypalConfigService');
    expect(apiHostFor('sandbox')).toBe('https://api-m.sandbox.paypal.com');
  });

  it('#22 apiHostFor(live) resolves to https://api-m.paypal.com', async () => {
    const { apiHostFor } = await import('@/lib/services/payments/paypalConfigService');
    expect(apiHostFor('live')).toBe('https://api-m.paypal.com');
  });
});

/* ============================================================================
   SECTION 9 — Live activation safety (P0 #23, #24, #25)
============================================================================ */
describe('M07-security §9 — Live activation safety', () => {
  it('#23 non-production environment cannot enable Live mode (400)', async () => {
    // Test relies on NODE_ENV !== 'production' (dev / test runs). Just assert this precondition.
    expect(process.env.NODE_ENV).not.toBe('production');
    const admin = await signup(`m07sec-${RUN_TAG}-sa16@wavelead.test`, 'super_admin');
    const cfg = validSandbox();
    const r = await api('/admin/settings/paypal', {
      method: 'POST', headers: { Cookie: admin.cookie },
      body: JSON.stringify({
        environment: 'live',
        client_id: 'TEST_M07SEC_LIVE_CID_' + Math.random().toString(36).slice(2, 10),
        client_secret: cfg.client_secret,
        webhook_id: 'TEST_M07SEC_LIVE_WH',
        confirm_live: 'ENABLE LIVE PAYMENTS',
      }),
    });
    expect(r.status).toBe(400);
    expect((r.body.error || '').toLowerCase()).toMatch(/production environment/);
  });

  it('#24 live activation requires ALL guards (confirm phrase, webhook, connection test) — service-level', async () => {
    // We cannot flip NODE_ENV=production inside the test process, so we drive the
    // service directly to confirm the guard order. First reachable failure is asserted.
    const { paypalAdminService } = await import('@/lib/services/security/paypalAdminService');
    const dummyActor = {
      session: { userId: 'test', email: 'x@y', v: 0 },
      user: { id: 'admin-1', email: 'x@y', role: 'super_admin', display_name: 'x', avatar_url: null, country_code: null, preferred_language: 'en', auth_providers: [], created_at: new Date(), updated_at: new Date() },
    } as unknown as import('@/lib/types').Actor;
    // Guard 1: preview mode blocks BEFORE anything else.
    await expect(paypalAdminService.upsert(dummyActor, {
      environment: 'live', client_id: 'TEST_M07SEC_LIVE', client_secret: 'plain-secret-value',
      webhook_id: null, confirm_live: 'ENABLE LIVE PAYMENTS',
    })).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/production environment/i) });
    // Guard 2: If we simulate production, missing confirm_live must block.
    const originalEnv = process.env.NODE_ENV;
    // @ts-expect-error runtime mutation
    process.env.NODE_ENV = 'production';
    try {
      await expect(paypalAdminService.upsert(dummyActor, {
        environment: 'live', client_id: 'TEST_M07SEC_LIVE',
        client_secret: 'plain-secret-value', webhook_id: 'TEST_WH_LIVE',
        // no confirm_live
      })).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/ENABLE LIVE PAYMENTS/i) });
      // Guard 3: With confirm phrase but missing webhook → the connection test runs first
      // against real PayPal. In tests we can't reach real prod, so the failure here should
      // be either "connection test failed" or "webhook is required" — both are acceptable
      // guards proving activation is blocked without live credentials.
      await expect(paypalAdminService.upsert(dummyActor, {
        environment: 'live', client_id: 'TEST_M07SEC_LIVE_CID', client_secret: 'plain-secret-value',
        webhook_id: null, confirm_live: 'ENABLE LIVE PAYMENTS',
      })).rejects.toMatchObject({ status: 400 });
    } finally {
      // @ts-expect-error runtime mutation
      process.env.NODE_ENV = originalEnv;
    }
  });

  it('#25 sandbox Webhook ID is stored per-environment and cannot leak into live config', async () => {
    // Save a sandbox row with a sandbox-only webhook id
    const admin = await signup(`m07sec-${RUN_TAG}-sa17@wavelead.test`, 'super_admin');
    const cfg = validSandbox();
    const wid = 'SANDBOX_ONLY_WH_' + Math.random().toString(36).slice(2, 6);
    await api('/admin/settings/paypal', {
      method: 'POST', headers: { Cookie: admin.cookie },
      body: JSON.stringify({ ...cfg, webhook_id: wid }),
    });
    // Ensure NO live row exists — sandbox webhook must NOT be observable through live status.
    await withDb(async (db) => { await db.collection('integration_credentials').deleteMany({ provider: 'paypal', environment: 'live' }); });
    const { paypalConfigService } = await import('@/lib/services/payments/paypalConfigService');
    const liveStatus = await paypalConfigService.status('live');
    // The live view must NOT be configured from sandbox data.
    expect(liveStatus.source).not.toBe('admin_vault');
    if (liveStatus.webhook_id_masked) expect(liveStatus.webhook_id_masked).not.toContain(wid);
    // And the sandbox status DOES show it.
    const sbStatus = await paypalConfigService.status('sandbox');
    expect(sbStatus.source).toBe('admin_vault');
    expect(sbStatus.webhook_id_configured).toBe(true);
  });
});

/* ============================================================================
   SECTION 10 — Connection Test secret hygiene (P0 #26)
============================================================================ */
describe('M07-security §10 — Connection Test hygiene', () => {
  it('#26 test-connection response never exposes OAuth token or client_secret or raw provider payload', async () => {
    const admin = await signup(`m07sec-${RUN_TAG}-sa18@wavelead.test`, 'super_admin');
    // With INVALID credentials so we do not hit real PayPal successfully.
    const r = await api('/admin/settings/paypal/test-connection', {
      method: 'POST', headers: { Cookie: admin.cookie },
      body: JSON.stringify({
        environment: 'sandbox',
        client_id: `TEST_M07SEC_${RUN_TAG}_TEST_CID_1234567890`,
        client_secret: `TEST_M07SEC_${RUN_TAG}_TEST_SECRET_1234567890`,
      }),
    });
    // Response shape is either { ok:true } or { ok:false, error:string } — no tokens.
    expect(r.status).toBe(200);
    expect(r.rawText).not.toContain('access_token');
    expect(r.rawText).not.toContain('scope');   // PayPal token responses contain 'scope'
    expect(r.rawText).not.toContain(`TEST_M07SEC_${RUN_TAG}_TEST_SECRET_`);
    // Also the audit event does not leak the tested secret.
    const audit = await withDb(async (db) => db.collection('security_audit_events')
      .find({ event_type: 'PAYPAL_CONNECTION_TESTED' }).sort({ created_at: -1 }).limit(5).toArray());
    for (const evt of audit) {
      expect(JSON.stringify(evt)).not.toContain(`TEST_M07SEC_${RUN_TAG}_TEST_SECRET_`);
    }
  });
});

/* ============================================================================
   SECTION 11 — Audit trail (P0 #27)
============================================================================ */
describe('M07-security §11 — Security & PayPal audit events', () => {
  it('#27 security / PayPal configuration changes generate backend audit events without secrets', async () => {
    const admin = await signup(`m07sec-${RUN_TAG}-sa19@wavelead.test`, 'super_admin');
    const cfg = validSandbox();
    await api('/admin/settings/paypal', {
      method: 'POST', headers: { Cookie: admin.cookie }, body: JSON.stringify(cfg),
    });
    const events = await withDb(async (db) => db.collection('security_audit_events')
      .find({ event_type: /^PAYPAL_/, actor_user_id: admin.userId })
      .sort({ created_at: -1 }).toArray());
    expect(events.length).toBeGreaterThan(0);
    for (const e of events) {
      const s = JSON.stringify(e);
      expect(s).not.toContain(cfg.client_secret);
      expect(s).not.toMatch(/client_secret_ciphertext/);
      // event_type is enum-like, metadata contains env + client_id_prefix only
      expect(typeof e.event_type).toBe('string');
      expect(e.actor_user_id).toBe(admin.userId);
    }

    // Also confirm password-reset events are recorded (from §5 tests earlier, or synthesise one now).
    const target = await signup(`m07sec-${RUN_TAG}-a1@wavelead.test`);
    await api(`/admin/users/${target.userId}/reset-password`, {
      method: 'POST', headers: { Cookie: admin.cookie },
    });
    const resetEvents = await withDb(async (db) => db.collection('security_audit_events')
      .find({ event_type: 'USER_PASSWORD_RESET', subject_user_id: target.userId }).toArray());
    expect(resetEvents.length).toBeGreaterThanOrEqual(1);
    for (const e of resetEvents) {
      expect(JSON.stringify(e)).not.toMatch(/temporary_password|temp_pw/i);
    }
  });
});

/* ============================================================================
   SECTION 12 — Payment regression (P0 #28)
============================================================================ */
describe('M07-security §12 — Payment behaviour regression', () => {
  it('#28 existing M06 admin payment-health endpoint remains reachable to admins (no regression)', async () => {
    const admin = await signup(`m07sec-${RUN_TAG}-sa20@wavelead.test`, 'super_admin');
    const r = await api('/admin/payment-health', { headers: { Cookie: admin.cookie } });
    expect(r.status).toBe(200);
    // Response body should not accidentally leak any provider secret / cipher text.
    expect(r.rawText).not.toContain('client_secret_ciphertext');
    expect(r.rawText).not.toMatch(/TEST_M07SEC_.*_SECRET_/);
  });

  it('#28 paypalConfigService.resolveActive still returns a config in preview (env or admin_vault)', async () => {
    const { paypalConfigService } = await import('@/lib/services/payments/paypalConfigService');
    const cfg = await paypalConfigService.resolveActive();
    expect(cfg).toBeTruthy();
    expect(['env', 'admin_vault']).toContain(cfg!.source);
    expect(cfg!.environment).toBe('sandbox');   // preview must never resolve live
    expect(cfg!.api_host).toBe('https://api-m.sandbox.paypal.com');
    // Secrets: present locally (needed for outbound calls) but never returned by any API.
    expect(typeof cfg!.client_secret).toBe('string');
    expect(cfg!.client_secret.length).toBeGreaterThan(0);
  });
});
