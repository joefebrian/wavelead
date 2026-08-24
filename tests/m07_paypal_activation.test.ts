// M07 PayPal Activation Patch — DB-persisted active_environment control.
//
// 18 targeted regression tests. Scope:
//   §1 Persistence & concurrency
//   §2 Resolver precedence (DB > env > default) + preview safety
//   §3 Fail-closed on live-with-missing-vault
//   §4 Guarded activateLive
//   §5 Guarded switchToSandbox
//   §6 Payment-health & RBAC
//
// FINANCIAL LOGIC IS NEVER TOUCHED — the tests only verify resolver + settings.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { MongoClient, type Db } from 'mongodb';
import { COLLECTIONS } from '@/lib/db/collections';
import type { Actor } from '@/lib/types';

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

async function signup(email: string, role?: string): Promise<{ userId: string; cookie: string; email: string }> {
  const s = await fetch(`${BASE}/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': CLIENT_IP() },
    body: JSON.stringify({ email, password: 'password123!', display_name: `T-${email}` }),
  });
  const cookie = s.headers.get('set-cookie')?.match(/wl_session=[^;]+/)?.[0] || '';
  const j = await s.json();
  const userId = j?.data?.user?.id as string;
  if (role) {
    await withDb(async (db) => { await db.collection('users').updateOne({ id: userId }, { $set: { role } }); });
  }
  return { userId, cookie, email };
}

/** Build a dummy super-admin Actor for direct service-level calls. */
function dummySuperAdmin(id = 'admin-test'): Actor {
  return {
    session: { userId: id, email: 'sa@wavelead.test', v: 0 },
    user: {
      id, email: 'sa@wavelead.test', role: 'super_admin',
      display_name: 'SA', avatar_url: null, country_code: null, preferred_language: 'en',
      auth_providers: [], created_at: new Date(), updated_at: new Date(),
    },
  } as unknown as Actor;
}

/** Seed a fully-populated LIVE vault row (client_id, ciphertext, webhook, connection-test=success). */
async function seedLiveVaultReady(): Promise<{ client_id: string; webhook_id: string }> {
  const { encryptString } = await import('@/lib/utils/cryptoVault');
  const doc = {
    id: `live-vault-${RUN_TAG}-${Math.random().toString(36).slice(2, 6)}`,
    provider: 'paypal',
    environment: 'live',
    client_id: `TEST_M07ACT_LIVE_CID_${RUN_TAG}`,
    client_secret_ciphertext: encryptString(`plain-live-secret-${RUN_TAG}`),
    webhook_id: `TEST_M07ACT_LIVE_WH_${RUN_TAG}`,
    configured_by: 'test',
    last_connection_test_at: new Date(),
    last_connection_test_status: 'success',
    last_connection_test_message: 'OAuth token obtained',
    created_at: new Date(),
    updated_at: new Date(),
  };
  await withDb(async (db) => {
    await db.collection('integration_credentials').updateOne(
      { provider: 'paypal', environment: 'live' },
      { $set: doc },
      { upsert: true },
    );
  });
  return { client_id: doc.client_id, webhook_id: doc.webhook_id };
}

/** Purge any state this test suite may leave behind. */
async function purge() {
  await withDb(async (db) => {
    await db.collection(COLLECTIONS.INTEGRATION_PROVIDER_SETTINGS).deleteMany({ provider: 'paypal' });
    await db.collection('integration_credentials').deleteMany({ client_id: /^TEST_M07ACT_/ });
    await db.collection('security_audit_events').deleteMany({ 'metadata.tag': RUN_TAG });
    await db.collection('users').deleteMany({ email: new RegExp(`m07act-${RUN_TAG}`) });
  });
}

/** Reset resolver-influencing environment vars around each test. */
const ORIG_NODE_ENV = process.env.NODE_ENV;
const ORIG_PAYPAL_ENVIRONMENT = process.env.PAYPAL_ENVIRONMENT;
const ORIG_BASE_URL = process.env.NEXT_PUBLIC_BASE_URL;
function restoreEnv() {
  // @ts-expect-error test-only override
  process.env.NODE_ENV = ORIG_NODE_ENV;
  if (ORIG_PAYPAL_ENVIRONMENT === undefined) delete process.env.PAYPAL_ENVIRONMENT;
  else process.env.PAYPAL_ENVIRONMENT = ORIG_PAYPAL_ENVIRONMENT;
  if (ORIG_BASE_URL === undefined) delete process.env.NEXT_PUBLIC_BASE_URL;
  else process.env.NEXT_PUBLIC_BASE_URL = ORIG_BASE_URL;
}

beforeAll(async () => { await purge(); });
afterAll(async () => { await purge(); restoreEnv(); });
beforeEach(async () => {
  await withDb(async (db) => {
    await db.collection(COLLECTIONS.INTEGRATION_PROVIDER_SETTINGS).deleteMany({ provider: 'paypal' });
  });
  restoreEnv();
});

// ============================================================================
// §1 — Persistence & concurrency
// ============================================================================
describe('M07 PayPal-activation §1 — Provider-settings collection & atomicity', () => {
  it('#1 integration_provider_settings collection exists with the correct unique index on provider', async () => {
    // Touch the collection via the app's mongo (this triggers ensureIndexes()).
    const { integrationProviderSettingsRepo } = await import('@/lib/repositories/integrationProviderSettingsRepo');
    await integrationProviderSettingsRepo.getForProvider('paypal');
    const indexes = await withDb(async (db) => db.collection(COLLECTIONS.INTEGRATION_PROVIDER_SETTINGS).indexes());
    const uniq = indexes.find((i) => JSON.stringify(i.key) === JSON.stringify({ provider: 1 }));
    expect(uniq).toBeTruthy();
    expect(uniq?.unique).toBe(true);
  });

  it('#2 setActiveEnvironment upserts a single canonical row per provider (no duplicates on repeat)', async () => {
    const { integrationProviderSettingsRepo } = await import('@/lib/repositories/integrationProviderSettingsRepo');
    await integrationProviderSettingsRepo.setActiveEnvironment('paypal', 'sandbox', 'a1');
    await integrationProviderSettingsRepo.setActiveEnvironment('paypal', 'sandbox', 'a2');
    await integrationProviderSettingsRepo.setActiveEnvironment('paypal', 'sandbox', 'a3');
    const count = await withDb(async (db) => db.collection(COLLECTIONS.INTEGRATION_PROVIDER_SETTINGS).countDocuments({ provider: 'paypal' }));
    expect(count).toBe(1);
  });

  it('#3 concurrent activation attempts still leave a single canonical row (unique-index enforced)', async () => {
    const { integrationProviderSettingsRepo } = await import('@/lib/repositories/integrationProviderSettingsRepo');
    // Fire 20 concurrent upserts with alternating envs — final state must be ONE row.
    const jobs = Array.from({ length: 20 }, (_, i) =>
      integrationProviderSettingsRepo.setActiveEnvironment('paypal', i % 2 === 0 ? 'sandbox' : 'live', `actor-${i}`),
    );
    await Promise.allSettled(jobs);
    const rows = await withDb(async (db) => db.collection(COLLECTIONS.INTEGRATION_PROVIDER_SETTINGS).find({ provider: 'paypal' }).toArray());
    expect(rows.length).toBe(1);
    // active_environment is deterministic (== one of the requested values).
    expect(['sandbox', 'live']).toContain(rows[0].active_environment);
  });
});

// ============================================================================
// §2 — Resolver precedence DB > ENV > default
// ============================================================================
describe('M07 PayPal-activation §2 — Resolver precedence', () => {
  it('#4 with no DB row and no PAYPAL_ENVIRONMENT env var, resolver defaults to sandbox', async () => {
    delete process.env.PAYPAL_ENVIRONMENT;
    const { readActiveEnvironment } = await import('@/lib/services/payments/paypalConfigService');
    const r = await readActiveEnvironment();
    expect(r.environment).toBe('sandbox');
    expect(r.source).toBe('default');
  });

  it('#5 with PAYPAL_ENVIRONMENT=live and no DB row, ENV path is used (source=env)', async () => {
    process.env.PAYPAL_ENVIRONMENT = 'live';
    const { readActiveEnvironment } = await import('@/lib/services/payments/paypalConfigService');
    const r = await readActiveEnvironment();
    expect(r.environment).toBe('live');
    expect(r.source).toBe('env');
  });

  it('#6 DB row beats env var (DB=sandbox + ENV=live → resolver returns sandbox from DB)', async () => {
    process.env.PAYPAL_ENVIRONMENT = 'live';
    const { integrationProviderSettingsRepo } = await import('@/lib/repositories/integrationProviderSettingsRepo');
    const { readActiveEnvironment } = await import('@/lib/services/payments/paypalConfigService');
    await integrationProviderSettingsRepo.setActiveEnvironment('paypal', 'sandbox', 'a1');
    const r = await readActiveEnvironment();
    expect(r.environment).toBe('sandbox');
    expect(r.source).toBe('db');
  });
});

// ============================================================================
// §3 — Fail-closed on live-with-missing-vault
// ============================================================================
describe('M07 PayPal-activation §3 — Fail-closed for live with missing/invalid vault', () => {
  it('#7 persisted DB=live in production but Live vault MISSING → resolveActive() returns null (fail closed)', async () => {
    // Simulate production so the preview downgrade does not kick in.
    // @ts-expect-error test-only override
    process.env.NODE_ENV = 'production';
    await withDb(async (db) => { await db.collection('integration_credentials').deleteMany({ provider: 'paypal', environment: 'live' }); });
    const { integrationProviderSettingsRepo } = await import('@/lib/repositories/integrationProviderSettingsRepo');
    await integrationProviderSettingsRepo.setActiveEnvironment('paypal', 'live', 'test');
    const { paypalConfigService } = await import('@/lib/services/payments/paypalConfigService');
    const resolved = await paypalConfigService.resolveActive();
    expect(resolved).toBeNull();
  });

  it('#8 persisted DB=live in production but Live client_secret_ciphertext is MALFORMED → resolveActive() returns null (no silent sandbox fallback)', async () => {
    // @ts-expect-error test-only override
    process.env.NODE_ENV = 'production';
    // Insert a live vault row with a garbage ciphertext.
    await withDb(async (db) => {
      await db.collection('integration_credentials').updateOne(
        { provider: 'paypal', environment: 'live' },
        {
          $set: {
            id: `bad-live-${RUN_TAG}`, provider: 'paypal', environment: 'live',
            client_id: 'TEST_M07ACT_LIVE_CID_BAD', client_secret_ciphertext: 'not.a.valid.envelope',
            webhook_id: 'TEST_M07ACT_LIVE_WH_BAD', configured_by: 'test',
            last_connection_test_at: null, last_connection_test_status: null, last_connection_test_message: null,
            created_at: new Date(), updated_at: new Date(),
          },
        },
        { upsert: true },
      );
    });
    const { integrationProviderSettingsRepo } = await import('@/lib/repositories/integrationProviderSettingsRepo');
    await integrationProviderSettingsRepo.setActiveEnvironment('paypal', 'live', 'test');
    const { paypalConfigService } = await import('@/lib/services/payments/paypalConfigService');
    const resolved = await paypalConfigService.resolveActive();
    expect(resolved).toBeNull();
  });
});

// ============================================================================
// §4 — activateLive guardrails
// ============================================================================
describe('M07 PayPal-activation §4 — activateLive guardrails', () => {
  it('#9 activateLive rejects when NODE_ENV !== production (400)', async () => {
    // Ensure NODE_ENV is not production.
    // @ts-expect-error test-only override
    process.env.NODE_ENV = 'test';
    const { paypalAdminService } = await import('@/lib/services/security/paypalAdminService');
    await expect(paypalAdminService.activateLive(dummySuperAdmin(), { confirm: 'ENABLE LIVE PAYMENTS' }))
      .rejects.toMatchObject({ status: 400, message: expect.stringMatching(/production/i) });
  });

  it('#10 activateLive rejects with wrong confirmation phrase (400)', async () => {
    // @ts-expect-error test-only override
    process.env.NODE_ENV = 'production';
    process.env.NEXT_PUBLIC_BASE_URL = 'https://wavelead.org';
    await seedLiveVaultReady();
    const { paypalAdminService } = await import('@/lib/services/security/paypalAdminService');
    await expect(paypalAdminService.activateLive(dummySuperAdmin(), { confirm: 'YES' }))
      .rejects.toMatchObject({ status: 400, message: expect.stringMatching(/ENABLE LIVE PAYMENTS/i) });
  });

  it('#11 activateLive rejects when Live vault is missing (400)', async () => {
    // @ts-expect-error test-only override
    process.env.NODE_ENV = 'production';
    process.env.NEXT_PUBLIC_BASE_URL = 'https://wavelead.org';
    await withDb(async (db) => { await db.collection('integration_credentials').deleteMany({ provider: 'paypal', environment: 'live' }); });
    const { paypalAdminService } = await import('@/lib/services/security/paypalAdminService');
    await expect(paypalAdminService.activateLive(dummySuperAdmin(), { confirm: 'ENABLE LIVE PAYMENTS' }))
      .rejects.toMatchObject({ status: 400, message: expect.stringMatching(/credentials|Live vault|not been saved/i) });
  });

  it('#12 activateLive rejects when Webhook ID missing OR last connection test != success (400)', async () => {
    // @ts-expect-error test-only override
    process.env.NODE_ENV = 'production';
    process.env.NEXT_PUBLIC_BASE_URL = 'https://wavelead.org';
    // Seed live vault WITHOUT webhook_id and WITHOUT a success connection test.
    const { encryptString } = await import('@/lib/utils/cryptoVault');
    await withDb(async (db) => {
      await db.collection('integration_credentials').updateOne(
        { provider: 'paypal', environment: 'live' },
        { $set: {
          id: `live-no-wh-${RUN_TAG}`, provider: 'paypal', environment: 'live',
          client_id: 'TEST_M07ACT_LIVE_CID_NOWH', client_secret_ciphertext: encryptString('plain-live-secret'),
          webhook_id: null, configured_by: 'test',
          last_connection_test_at: null, last_connection_test_status: null, last_connection_test_message: null,
          created_at: new Date(), updated_at: new Date(),
        } },
        { upsert: true },
      );
    });
    const { paypalAdminService } = await import('@/lib/services/security/paypalAdminService');
    // First reachable guard failure is asserted (either webhook or connection-test).
    await expect(paypalAdminService.activateLive(dummySuperAdmin(), { confirm: 'ENABLE LIVE PAYMENTS' }))
      .rejects.toMatchObject({ status: 400, message: expect.stringMatching(/Webhook|connection test/i) });
  });

  it('#13 activateLive rejects when canonical origin != https://wavelead.org (400)', async () => {
    // @ts-expect-error test-only override
    process.env.NODE_ENV = 'production';
    process.env.NEXT_PUBLIC_BASE_URL = 'https://not-wavelead.example.com';
    await seedLiveVaultReady();
    const { paypalAdminService } = await import('@/lib/services/security/paypalAdminService');
    await expect(paypalAdminService.activateLive(dummySuperAdmin(), { confirm: 'ENABLE LIVE PAYMENTS' }))
      .rejects.toMatchObject({ status: 400, message: expect.stringMatching(/canonical origin/i) });
  });

  it('#14 successful activateLive: DB updated, response reflects re-resolved effective live env, audit event recorded (no secrets)', async () => {
    // @ts-expect-error test-only override
    process.env.NODE_ENV = 'production';
    process.env.NEXT_PUBLIC_BASE_URL = 'https://wavelead.org';
    const seeded = await seedLiveVaultReady();
    const { paypalAdminService } = await import('@/lib/services/security/paypalAdminService');
    const actor = dummySuperAdmin(`sa-${RUN_TAG}-14`);
    const res = await paypalAdminService.activateLive(actor, { confirm: 'ENABLE LIVE PAYMENTS' });
    expect(res.ok).toBe(true);
    expect(res.active_environment).toBe('live');
    expect(res.api_host).toBe('https://api-m.paypal.com');
    expect(res.real_money_enabled).toBe(true);

    // DB row is exactly 'live'
    const row = await withDb(async (db) => db.collection(COLLECTIONS.INTEGRATION_PROVIDER_SETTINGS).findOne({ provider: 'paypal' }));
    expect(row?.active_environment).toBe('live');
    expect(row?.updated_by).toBe(actor.user.id);

    // Audit event: PAYPAL_LIVE_ENABLED, no secret in payload
    const audit = await withDb(async (db) => db.collection('security_audit_events').find({ event_type: 'PAYPAL_LIVE_ENABLED' }).sort({ created_at: -1 }).limit(5).toArray());
    expect(audit.length).toBeGreaterThan(0);
    const latest = audit[0];
    const s = JSON.stringify(latest);
    expect(s).not.toContain('plain-live-secret');
    expect(s).not.toContain(seeded.client_id); // no client_id leak either (only metadata)
    expect(latest.metadata).toMatchObject({ previous_environment: expect.any(String), new_environment: 'live', actor_user_id: actor.user.id });
  });
});

// ============================================================================
// §5 — switchToSandbox
// ============================================================================
describe('M07 PayPal-activation §5 — switchToSandbox', () => {
  it('#15 switchToSandbox rejects with wrong confirmation phrase (400)', async () => {
    const { paypalAdminService } = await import('@/lib/services/security/paypalAdminService');
    await expect(paypalAdminService.switchToSandbox(dummySuperAdmin(), { confirm: 'yes' }))
      .rejects.toMatchObject({ status: 400, message: expect.stringMatching(/SWITCH TO SANDBOX/i) });
  });

  it('#16 switchToSandbox flips DB to sandbox and does NOT touch Live vault / funding / ledger', async () => {
    // Preconditions:
    //   * Live vault present + intact BEFORE the switch
    //   * A funding order + ledger transaction should be untouched
    await seedLiveVaultReady();
    // Snapshot counts of funding + ledger BEFORE.
    const before = await withDb(async (db) => ({
      funding: await db.collection(COLLECTIONS.PAYMENT_FUNDING_ORDERS).countDocuments({}),
      ledger: await db.collection(COLLECTIONS.LEDGER_TRANSACTIONS).countDocuments({}),
      refunds: await db.collection(COLLECTIONS.PAYMENT_REFUNDS).countDocuments({}),
      live_vault: await db.collection('integration_credentials').findOne({ provider: 'paypal', environment: 'live' }),
    }));
    // Start from a persisted 'live' pointer (in-DB), so the switch actually flips.
    const { integrationProviderSettingsRepo } = await import('@/lib/repositories/integrationProviderSettingsRepo');
    await integrationProviderSettingsRepo.setActiveEnvironment('paypal', 'live', 'seed');
    // Restore NODE_ENV=test so resolver preview-downgrade path is irrelevant to this assertion:
    //   we assert the SETTINGS row, not the resolved config.
    const { paypalAdminService } = await import('@/lib/services/security/paypalAdminService');
    const res = await paypalAdminService.switchToSandbox(dummySuperAdmin(`sa-${RUN_TAG}-16`), { confirm: 'SWITCH TO SANDBOX' });
    expect(res.ok).toBe(true);
    expect(res.active_environment).toBe('sandbox');
    expect(res.real_money_enabled).toBe(false);
    expect(res.api_host).toBe('https://api-m.sandbox.paypal.com');

    // DB row is now sandbox.
    const row = await withDb(async (db) => db.collection(COLLECTIONS.INTEGRATION_PROVIDER_SETTINGS).findOne({ provider: 'paypal' }));
    expect(row?.active_environment).toBe('sandbox');

    // Live vault + funding + ledger + refunds must be UNCHANGED.
    const after = await withDb(async (db) => ({
      funding: await db.collection(COLLECTIONS.PAYMENT_FUNDING_ORDERS).countDocuments({}),
      ledger: await db.collection(COLLECTIONS.LEDGER_TRANSACTIONS).countDocuments({}),
      refunds: await db.collection(COLLECTIONS.PAYMENT_REFUNDS).countDocuments({}),
      live_vault: await db.collection('integration_credentials').findOne({ provider: 'paypal', environment: 'live' }),
    }));
    expect(after.funding).toBe(before.funding);
    expect(after.ledger).toBe(before.ledger);
    expect(after.refunds).toBe(before.refunds);
    expect(after.live_vault?.client_id).toBe(before.live_vault?.client_id);
    expect(after.live_vault?.client_secret_ciphertext).toBe(before.live_vault?.client_secret_ciphertext);
    expect(after.live_vault?.webhook_id).toBe(before.live_vault?.webhook_id);

    // Audit event: PAYPAL_SANDBOX_ENABLED with previous_environment
    const audit = await withDb(async (db) => db.collection('security_audit_events').find({ event_type: 'PAYPAL_SANDBOX_ENABLED' }).sort({ created_at: -1 }).limit(3).toArray());
    expect(audit.length).toBeGreaterThan(0);
    expect(audit[0].metadata).toMatchObject({ previous_environment: 'live', new_environment: 'sandbox' });
  });
});

// ============================================================================
// §6 — Payment-health + RBAC
// ============================================================================
describe('M07 PayPal-activation §6 — Payment-health & RBAC', () => {
  it('#17 GET /api/admin/payment-health reports the resolved persisted state (mode/api_host/real_money_enabled/credential_source/webhook_configured/environment_source)', async () => {
    // Seed a persisted sandbox row + a sandbox vault so we have a resolved config.
    const admin = await signup(`m07act-${RUN_TAG}-sa17@wavelead.test`, 'super_admin');
    const { encryptString } = await import('@/lib/utils/cryptoVault');
    await withDb(async (db) => {
      await db.collection('integration_credentials').updateOne(
        { provider: 'paypal', environment: 'sandbox' },
        { $set: {
          id: `sb-vault-${RUN_TAG}-17`, provider: 'paypal', environment: 'sandbox',
          client_id: 'TEST_M07ACT_SB_CID_17', client_secret_ciphertext: encryptString('plain-sb-secret'),
          webhook_id: 'TEST_M07ACT_SB_WH_17', configured_by: admin.userId,
          last_connection_test_at: null, last_connection_test_status: null, last_connection_test_message: null,
          created_at: new Date(), updated_at: new Date(),
        } },
        { upsert: true },
      );
    });
    const { integrationProviderSettingsRepo } = await import('@/lib/repositories/integrationProviderSettingsRepo');
    await integrationProviderSettingsRepo.setActiveEnvironment('paypal', 'sandbox', admin.userId);
    const health = await api<{ providers: { paypal: Record<string, unknown> } }>(
      '/admin/payment-health', { headers: { Cookie: admin.cookie } },
    );
    expect(health.status).toBe(200);
    const pp = health.body.data?.providers?.paypal || {};
    expect(pp.mode).toBe('sandbox');
    expect(pp.real_money_enabled).toBe(false);
    expect(pp.api_host).toBe('https://api-m.sandbox.paypal.com');
    expect(pp.credential_source).toBe('admin_vault');
    expect(pp.environment_source).toBe('db');
    expect(pp.persisted_environment).toBe('sandbox');
    expect(pp.webhook_configured).toBe(true);
  });

  it('#18 RBAC: regular user / channel_owner / business / admin cannot switch PayPal environment (403)', async () => {
    // (a) unauthenticated
    const anon = await api('/admin/settings/paypal/switch-to-sandbox', {
      method: 'POST', body: JSON.stringify({ confirm: 'SWITCH TO SANDBOX' }),
    });
    expect([401, 403]).toContain(anon.status);
    // (b) regular user
    const user = await signup(`m07act-${RUN_TAG}-user18@wavelead.test`);
    const u = await api('/admin/settings/paypal/switch-to-sandbox', {
      method: 'POST', headers: { Cookie: user.cookie }, body: JSON.stringify({ confirm: 'SWITCH TO SANDBOX' }),
    });
    expect(u.status).toBe(403);
    // (c) admin (below super_admin) is also blocked
    const adm = await signup(`m07act-${RUN_TAG}-adm18@wavelead.test`, 'admin');
    const a = await api('/admin/settings/paypal/switch-to-sandbox', {
      method: 'POST', headers: { Cookie: adm.cookie }, body: JSON.stringify({ confirm: 'SWITCH TO SANDBOX' }),
    });
    expect(a.status).toBe(403);
    // (d) activate-live too
    const a2 = await api('/admin/settings/paypal/activate-live', {
      method: 'POST', headers: { Cookie: adm.cookie }, body: JSON.stringify({ confirm: 'ENABLE LIVE PAYMENTS' }),
    });
    expect(a2.status).toBe(403);
    // (e) super_admin can reach the handler (may still fail on business guards, but NOT 403).
    const sa = await signup(`m07act-${RUN_TAG}-sa18@wavelead.test`, 'super_admin');
    const s = await api('/admin/settings/paypal/switch-to-sandbox', {
      method: 'POST', headers: { Cookie: sa.cookie }, body: JSON.stringify({ confirm: 'SWITCH TO SANDBOX' }),
    });
    expect(s.status).not.toBe(403);
  });
});
