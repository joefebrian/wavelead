// Phase 3 — SaaS Entitlements. Targeted tests only (per credit budget).
//
// Coverage:
//   §1 Pure resolver — plan → entitlements (unit)
//   §2 Default-to-free for pre-existing users (no `plan` field)
//   §3 Admin/super_admin bypass (never limited by SaaS caps)
//   §4 requireEntitlement / requireQuota guard semantics
//   §5 GET /api/entitlements/me endpoint
//   §6 Server gate: max_managed_channels enforces on channel-claim submit
//   §7 Free marketplace monetization NOT gated (product invariant)
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MongoClient, type Db } from 'mongodb';
import { v4 as uuidv4 } from 'uuid';
import {
  entitlementsForPlan,
  getUserPlan,
  resolveEntitlements,
  hasEntitlement,
  hasQuota,
  requireEntitlement,
  requireQuota,
  serializeEntitlements,
  UNLIMITED,
} from '@/lib/entitlements';
import { HttpError } from '@/lib/auth/rbac';
import type { Actor, Channel, PublicUser } from '@/lib/types';
import { COLLECTIONS } from '@/lib/db/collections';

const BASE = 'http://localhost:3000/api';
const CLIENT_IP = () => `10.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;
const RUN_TAG = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;

async function withDb<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  const client = new MongoClient(process.env.MONGO_URL || 'mongodb://localhost:27017');
  await client.connect();
  try { return await fn(client.db(process.env.DB_NAME || 'wavelead')); } finally { await client.close(); }
}

async function signup(email: string, opts: { role?: string; plan?: 'free' | 'pro' | 'enterprise' } = {}): Promise<{ userId: string; cookie: string; user: PublicUser }> {
  const r = await fetch(`${BASE}/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': CLIENT_IP() },
    body: JSON.stringify({ email, password: 'password123!', display_name: `T-${email.split('@')[0]}` }),
  });
  const cookie = r.headers.get('set-cookie')?.match(/wl_session=[^;]+/)?.[0] || '';
  const j = await r.json() as { data?: { user?: PublicUser } };
  const user = j?.data?.user as PublicUser;
  if (opts.role || opts.plan) {
    await withDb(async (db) => {
      const patch: Record<string, unknown> = {};
      if (opts.role) patch.role = opts.role;
      if (opts.plan) patch.plan = opts.plan;
      await db.collection('users').updateOne({ id: user.id }, { $set: patch });
    });
  }
  return { userId: user.id, cookie, user };
}

function mkActor(overrides: Partial<PublicUser> = {}): Actor {
  const user: PublicUser = {
    id: uuidv4(),
    email: `x-${uuidv4()}@t.test`,
    display_name: 'X',
    avatar_url: null,
    role: 'user',
    country_code: null,
    preferred_language: 'en',
    auth_providers: ['password'],
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
  return { session: { userId: user.id, v: 0 } as unknown as Actor['session'], user };
}

async function purge() {
  await withDb(async (db) => {
    await db.collection('users').deleteMany({ email: new RegExp(`m09ent-${RUN_TAG}`) });
    await db.collection(COLLECTIONS.CHANNELS).deleteMany({ slug: new RegExp(`m09ent-${RUN_TAG}`) });
    await db.collection(COLLECTIONS.CHANNELS).deleteMany({ whatsapp_channel_id: new RegExp('^m09ent-wa-') });
    await db.collection(COLLECTIONS.CHANNEL_CLAIMS).deleteMany({ claimant_email: new RegExp(`m09ent-${RUN_TAG}`) });
  });
}
beforeAll(async () => { await purge(); });
afterAll(async () => { await purge(); });

// ============================================================================
// §1 — Pure resolver
// ============================================================================
describe('Phase 3 Entitlements §1 — Pure resolver', () => {
  it('#1 free plan → free caps + no advanced flags', () => {
    const e = entitlementsForPlan('free');
    expect(e.plan).toBe('free');
    expect(e.max_managed_channels).toBe(1);
    expect(e.analytics_history_days).toBe(30);
    expect(e.advanced_analytics).toBe(false);
    expect(e.revenue_intelligence).toBe(false);
    expect(e.team_workspace).toBe(false);
    expect(e.api_access).toBe(false);
    // Marketplace baseline MUST remain true for Free (product invariant).
    expect(e.marketplace_participation).toBe(true);
    expect(e.earnings_and_payouts).toBe(true);
    expect(e.promote_pay_per_campaign).toBe(true);
    expect(e.basic_rate_card).toBe(true);
    expect(e.basic_analytics).toBe(true);
  });

  it('#2 pro plan → advanced intelligence flags on, multi-channel cap raised', () => {
    const e = entitlementsForPlan('pro');
    expect(e.plan).toBe('pro');
    expect(e.max_managed_channels).toBe(10);
    expect(e.analytics_history_days).toBe(365);
    expect(e.advanced_analytics).toBe(true);
    expect(e.revenue_intelligence).toBe(true);
    expect(e.rate_card_intelligence).toBe(true);
    expect(e.advanced_exports).toBe(true);
    // Enterprise-only flags stay off.
    expect(e.team_workspace).toBe(false);
    expect(e.api_access).toBe(false);
    expect(e.bulk_operations).toBe(false);
  });

  it('#3 enterprise plan → team + bulk + api + unlimited caps', () => {
    const e = entitlementsForPlan('enterprise');
    expect(e.plan).toBe('enterprise');
    expect(e.max_managed_channels).toBe(UNLIMITED);
    expect(e.analytics_history_days).toBe(UNLIMITED);
    expect(e.team_seats).toBeGreaterThan(0);
    expect(e.team_workspace).toBe(true);
    expect(e.bulk_operations).toBe(true);
    expect(e.portfolio_analytics).toBe(true);
    expect(e.api_access).toBe(true);
    expect(e.account_management).toBe(true);
    // Pro flags remain on (superset).
    expect(e.advanced_analytics).toBe(true);
    expect(e.revenue_intelligence).toBe(true);
  });

  it('#4 unknown / missing plan value safely resolves to free', () => {
    // Cast is intentional — simulate a legacy/garbage value from the DB.
    expect(entitlementsForPlan('bogus' as unknown as 'free').plan).toBe('free');
    expect(getUserPlan(null)).toBe('free');
    expect(getUserPlan(undefined)).toBe('free');
    expect(getUserPlan({ plan: undefined } as unknown as PublicUser)).toBe('free');
    expect(getUserPlan({ plan: null } as unknown as PublicUser)).toBe('free');
    expect(getUserPlan({ plan: 'garbage' } as unknown as PublicUser)).toBe('free');
    expect(getUserPlan({ plan: 'pro' } as unknown as PublicUser)).toBe('pro');
    expect(getUserPlan({ plan: 'enterprise' } as unknown as PublicUser)).toBe('enterprise');
  });
});

// ============================================================================
// §2 — Default-to-free for pre-existing users
// ============================================================================
describe('Phase 3 Entitlements §2 — Default to Free', () => {
  it('#5 user record with NO plan field resolves to Free entitlements', () => {
    const actor = mkActor({ role: 'user' }); // no plan field
    const e = resolveEntitlements(actor);
    expect(e.plan).toBe('free');
    expect(e.max_managed_channels).toBe(1);
    expect(e.advanced_analytics).toBe(false);
    // Marketplace loop preserved.
    expect(e.marketplace_participation).toBe(true);
    expect(e.earnings_and_payouts).toBe(true);
  });

  it('#6 user record with plan=pro resolves to Pro entitlements', () => {
    const actor = mkActor({ role: 'channel_owner', plan: 'pro' } as unknown as Partial<PublicUser>);
    const e = resolveEntitlements(actor);
    expect(e.plan).toBe('pro');
    expect(e.max_managed_channels).toBe(10);
    expect(e.advanced_analytics).toBe(true);
  });
});

// ============================================================================
// §3 — Admin bypass
// ============================================================================
describe('Phase 3 Entitlements §3 — Admin/super_admin bypass', () => {
  it('#7 admin on the Free plan still gets unlimited channels + every flag on', () => {
    const actor = mkActor({ role: 'admin', plan: 'free' } as unknown as Partial<PublicUser>);
    const e = resolveEntitlements(actor);
    expect(e.max_managed_channels).toBe(UNLIMITED);
    expect(e.team_workspace).toBe(true);
    expect(e.api_access).toBe(true);
    expect(e.revenue_intelligence).toBe(true);
    // hasQuota MUST return true even at absurd counts.
    expect(hasQuota(actor, 'max_managed_channels', 999_999)).toBe(true);
  });

  it('#8 super_admin bypass — requireQuota never throws', () => {
    const actor = mkActor({ role: 'super_admin' });
    expect(() => requireQuota(actor, 'max_managed_channels', 1_000_000)).not.toThrow();
    expect(() => requireEntitlement(actor, 'team_workspace')).not.toThrow();
    expect(() => requireEntitlement(actor, 'api_access')).not.toThrow();
  });

  it('#9 non-admin free user CANNOT bypass — quota blocks at cap', () => {
    const actor = mkActor({ role: 'channel_owner', plan: 'free' } as unknown as Partial<PublicUser>);
    expect(hasQuota(actor, 'max_managed_channels', 0)).toBe(true);
    expect(hasQuota(actor, 'max_managed_channels', 1)).toBe(false);
    expect(() => requireQuota(actor, 'max_managed_channels', 1)).toThrow(HttpError);
  });
});

// ============================================================================
// §4 — Guard semantics
// ============================================================================
describe('Phase 3 Entitlements §4 — Guards', () => {
  it('#10 requireEntitlement throws HttpError(403, PLAN_REQUIRED: <key>) for free user', () => {
    const actor = mkActor({ role: 'channel_owner', plan: 'free' } as unknown as Partial<PublicUser>);
    try {
      requireEntitlement(actor, 'revenue_intelligence');
      throw new Error('should have thrown');
    } catch (e) {
      const err = e as HttpError & { code?: string };
      expect(err).toBeInstanceOf(HttpError);
      expect(err.status).toBe(403);
      expect(err.message).toContain('PLAN_REQUIRED');
      expect(err.message).toContain('revenue_intelligence');
      expect(err.code).toBe('PLAN_REQUIRED');
    }
  });

  it('#11 requireQuota throws HttpError(403, QUOTA_EXCEEDED: <key>) at cap', () => {
    const actor = mkActor({ role: 'channel_owner', plan: 'free' } as unknown as Partial<PublicUser>);
    try {
      requireQuota(actor, 'max_managed_channels', 1);
      throw new Error('should have thrown');
    } catch (e) {
      const err = e as HttpError & { code?: string };
      expect(err).toBeInstanceOf(HttpError);
      expect(err.status).toBe(403);
      expect(err.message).toContain('QUOTA_EXCEEDED');
      expect(err.message).toContain('max_managed_channels');
      expect(err.code).toBe('QUOTA_EXCEEDED');
    }
  });

  it('#12 pro user passes advanced_analytics gate; enterprise-only still throws', () => {
    const actor = mkActor({ role: 'channel_owner', plan: 'pro' } as unknown as Partial<PublicUser>);
    expect(hasEntitlement(actor, 'advanced_analytics')).toBe(true);
    expect(() => requireEntitlement(actor, 'advanced_analytics')).not.toThrow();
    expect(hasEntitlement(actor, 'team_workspace')).toBe(false);
    expect(() => requireEntitlement(actor, 'team_workspace')).toThrow(HttpError);
  });
});

// ============================================================================
// §5 — GET /api/entitlements/me
// ============================================================================
describe('Phase 3 Entitlements §5 — /api/entitlements/me', () => {
  it('#13 visitor gets Free entitlements without auth', async () => {
    const r = await fetch(`${BASE}/entitlements/me`, { headers: { 'X-Forwarded-For': CLIENT_IP() } });
    const j = await r.json() as { ok: boolean; data: { plan: string; is_admin_bypass: boolean; entitlements: Record<string, unknown> } };
    expect(r.status).toBe(200);
    expect(j.data.plan).toBe('free');
    expect(j.data.is_admin_bypass).toBe(false);
    expect(j.data.entitlements.max_managed_channels).toBe(1);
    expect(j.data.entitlements.marketplace_participation).toBe(true);
    expect(j.data.entitlements.advanced_analytics).toBe(false);
  });

  it('#14 signed-up user with no plan field returns plan=free', async () => {
    const { cookie } = await signup(`m09ent-${RUN_TAG}-free@wavelead.test`);
    const r = await fetch(`${BASE}/entitlements/me`, { headers: { Cookie: cookie, 'X-Forwarded-For': CLIENT_IP() } });
    const j = await r.json() as { data: { plan: string; is_admin_bypass: boolean; entitlements: Record<string, unknown> } };
    expect(j.data.plan).toBe('free');
    expect(j.data.is_admin_bypass).toBe(false);
    expect(j.data.entitlements.max_managed_channels).toBe(1);
  });

  it('#15 admin bypass exposes unlimited quotas (serialized as null) + all flags', async () => {
    const { cookie } = await signup(`m09ent-${RUN_TAG}-adm@wavelead.test`, { role: 'admin' });
    const r = await fetch(`${BASE}/entitlements/me`, { headers: { Cookie: cookie, 'X-Forwarded-For': CLIENT_IP() } });
    const j = await r.json() as { data: { plan: string; is_admin_bypass: boolean; entitlements: Record<string, unknown> } };
    expect(j.data.is_admin_bypass).toBe(true);
    // POSITIVE_INFINITY serializes to null per serializeEntitlements.
    expect(j.data.entitlements.max_managed_channels).toBeNull();
    expect(j.data.entitlements.team_workspace).toBe(true);
    expect(j.data.entitlements.api_access).toBe(true);
  });

  it('#16 pro-plan user returns plan=pro and pro flag set', async () => {
    const { cookie } = await signup(`m09ent-${RUN_TAG}-pro@wavelead.test`, { plan: 'pro' });
    const r = await fetch(`${BASE}/entitlements/me`, { headers: { Cookie: cookie, 'X-Forwarded-For': CLIENT_IP() } });
    const j = await r.json() as { data: { plan: string; entitlements: Record<string, unknown> } };
    expect(j.data.plan).toBe('pro');
    expect(j.data.entitlements.max_managed_channels).toBe(10);
    expect(j.data.entitlements.advanced_analytics).toBe(true);
    expect(j.data.entitlements.team_workspace).toBe(false);
  });
});

// ============================================================================
// §6 — Server gate: max_managed_channels on channel-claim submit
// ============================================================================
async function insertApprovedChannel(slug: string, patch: Partial<Channel> = {}): Promise<Channel> {
  const c: Channel = {
    id: uuidv4(),
    slug,
    name: `Ent Test ${slug}`,
    whatsapp_url: `https://whatsapp.com/channel/${slug}`,
    whatsapp_channel_id: `m09ent-wa-${uuidv4()}`,
    description: null,
    short_description: null,
    logo_url: null,
    cover_url: null,
    website_url: null,
    country_code: null,
    primary_language: null,
    category_id: null,
    owner_id: null,
    status: 'approved',
    verification_status: 'unclaimed',
    ...(patch as Partial<Channel>),
  } as Channel;
  await withDb(async (db) => { await db.collection<Channel>(COLLECTIONS.CHANNELS).insertOne(c); });
  return c;
}

describe('Phase 3 Entitlements §6 — Channel-claim quota gate', () => {
  it('#17 Free user with 1 owned channel — second claim is blocked (QUOTA_EXCEEDED)', async () => {
    // 1) Create a Free user and grant them ownership of an existing channel.
    const email = `m09ent-${RUN_TAG}-free-owner@wavelead.test`;
    const { userId, cookie } = await signup(email);
    const owned = await insertApprovedChannel(`m09ent-${RUN_TAG}-owned`, { owner_id: userId, verification_status: 'verified' });
    void owned;

    // 2) Try to claim a SECOND approved channel — should fail with 403.
    const target = await insertApprovedChannel(`m09ent-${RUN_TAG}-target`);
    const r = await fetch(`${BASE}/claims/${target.slug}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie, 'X-Forwarded-For': CLIENT_IP() },
      body: JSON.stringify({ verification_method: 'domain', evidence_urls: [], claimant_note: 'gated' }),
    });
    const j = await r.json() as { ok: boolean; error?: string };
    expect(r.status).toBe(403);
    expect(j.ok).toBe(false);
    expect(j.error || '').toContain('QUOTA_EXCEEDED');
    expect(j.error || '').toContain('max_managed_channels');
  });

  it('#18 Pro user with 1 owned channel — second claim PASSES the quota gate', async () => {
    const email = `m09ent-${RUN_TAG}-pro-owner@wavelead.test`;
    const { userId, cookie } = await signup(email, { plan: 'pro' });
    await insertApprovedChannel(`m09ent-${RUN_TAG}-pro-owned`, { owner_id: userId, verification_status: 'verified' });
    const target = await insertApprovedChannel(`m09ent-${RUN_TAG}-pro-target`);
    const r = await fetch(`${BASE}/claims/${target.slug}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie, 'X-Forwarded-For': CLIENT_IP() },
      body: JSON.stringify({ verification_method: 'domain', evidence_urls: [], claimant_note: 'pro-ok' }),
    });
    // Pro plan cap is 10 — quota is not the blocker. Whatever the claim
    // response is (201 accepted, or an unrelated validation error), it must
    // NOT be QUOTA_EXCEEDED.
    const j = await r.json() as { error?: string };
    expect(j.error || '').not.toContain('QUOTA_EXCEEDED');
  });

  it('#19 Admin bypass — admin with 1 owned channel can still claim more', async () => {
    const email = `m09ent-${RUN_TAG}-admin-owner@wavelead.test`;
    const { userId, cookie } = await signup(email, { role: 'admin' });
    await insertApprovedChannel(`m09ent-${RUN_TAG}-adm-owned`, { owner_id: userId, verification_status: 'verified' });
    const target = await insertApprovedChannel(`m09ent-${RUN_TAG}-adm-target`);
    const r = await fetch(`${BASE}/claims/${target.slug}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie, 'X-Forwarded-For': CLIENT_IP() },
      body: JSON.stringify({ verification_method: 'domain', evidence_urls: [], claimant_note: 'adm-ok' }),
    });
    const j = await r.json() as { error?: string };
    expect(j.error || '').not.toContain('QUOTA_EXCEEDED');
  });

  it('#20 Verification-upgrade path is NOT gated (claiming a channel you already own)', async () => {
    // If a Free user already owns a channel (owned count = 1) and files a
    // claim on THE SAME channel to upgrade its verification status, the
    // quota gate must NOT fire — the claim does not grant a NEW ownership.
    const email = `m09ent-${RUN_TAG}-self-owner@wavelead.test`;
    const { userId, cookie } = await signup(email);
    const chan = await insertApprovedChannel(`m09ent-${RUN_TAG}-self`, { owner_id: userId, verification_status: 'claimed' });
    const r = await fetch(`${BASE}/claims/${chan.slug}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie, 'X-Forwarded-For': CLIENT_IP() },
      body: JSON.stringify({ verification_method: 'domain', evidence_urls: [], claimant_note: 'self-verify' }),
    });
    const j = await r.json() as { error?: string };
    expect(j.error || '').not.toContain('QUOTA_EXCEEDED');
  });
});

// ============================================================================
// §7 — Free marketplace monetization stays open (product invariant)
// ============================================================================
describe('Phase 3 Entitlements §7 — Free monetization NOT gated', () => {
  it('#21 Free plan explicitly grants marketplace_participation + earnings_and_payouts', () => {
    const e = entitlementsForPlan('free');
    expect(e.marketplace_participation).toBe(true);
    expect(e.earnings_and_payouts).toBe(true);
    expect(e.basic_rate_card).toBe(true);
    expect(e.promote_pay_per_campaign).toBe(true);
  });

  it('#22 requireEntitlement on marketplace_participation NEVER throws for a Free user', () => {
    const actor = mkActor({ role: 'channel_owner', plan: 'free' } as unknown as Partial<PublicUser>);
    expect(() => requireEntitlement(actor, 'marketplace_participation')).not.toThrow();
    expect(() => requireEntitlement(actor, 'earnings_and_payouts')).not.toThrow();
    expect(() => requireEntitlement(actor, 'promote_pay_per_campaign')).not.toThrow();
    expect(() => requireEntitlement(actor, 'basic_rate_card')).not.toThrow();
  });

  it('#23 serializeEntitlements maps unlimited caps to null (JSON-safe)', () => {
    const ent = entitlementsForPlan('enterprise');
    const wire = serializeEntitlements(ent);
    expect(wire.max_managed_channels).toBeNull();
    expect(wire.analytics_history_days).toBeNull();
    expect(wire.marketplace_participation).toBe(true);
  });
});
