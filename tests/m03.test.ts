// Milestone 03 tests \u2014 Ownership & Trust.
// Exercises the live API on :3000 through the full stack. Focuses on the
// security invariants the spec calls out: duplicate/hijack protection,
// evidence privacy, cross-owner denial, privileged-field injection, and
// sensitive change request routing.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MongoClient } from 'mongodb';
import { runSeed } from '@/lib/seed/seedData';

const BASE = 'http://localhost:3000/api';

function uniqueEmail(prefix: string): string {
  return `${prefix}+${Date.now()}${Math.floor(Math.random() * 1e6)}@wavelead.test`;
}
function fakeIp(): string { return `10.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`; }

interface JsonResp<T = unknown> { ok: boolean; data?: T; error?: string; }

async function api<T = unknown>(path: string, init: RequestInit = {}, ip: string = fakeIp()) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip, ...(init.headers || {}) },
  });
  let body: JsonResp<T> = { ok: false };
  try { body = (await res.json()) as JsonResp<T>; } catch { /* ignore */ }
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

async function signup(role?: 'user' | 'moderator' | 'admin' | 'super_admin') {
  const email = uniqueEmail(role || 'u');
  const res = await api<{ user: { id: string; email: string } }>('/auth/signup', {
    method: 'POST',
    body: JSON.stringify({ email, password: 'password123', display_name: `t-${role || 'u'}` }),
  });
  const cookie = extractSessionCookie(res.setCookie)!;
  if (role && role !== 'user') {
    await withDb(async (db) => { await db.collection('users').updateOne({ id: res.body.data!.user.id }, { $set: { role, updated_at: new Date() } }); });
  }
  return { cookie, userId: res.body.data!.user.id, email };
}

// Create a fresh approved channel for isolation across tests.
async function createApprovedChannel(overrides: Record<string, unknown> = {}) {
  const id = `t-ch-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const key = `0029TEST${Math.random().toString(36).slice(2, 12)}xyz`;
  const doc = {
    id,
    slug: `m03-${id}`,
    name: `M03 Channel ${id}`,
    whatsapp_url: `https://whatsapp.com/channel/${key}`,
    short_description: 'seed for M03 tests',
    description: null,
    logo_url: null, cover_url: null,
    website_url: null,
    category_id: null,
    country_code: 'ID',
    primary_language: 'en',
    status: 'approved',
    verification_status: 'unclaimed',
    is_featured: false, is_official: false,
    follower_count: 0, activity_level: 'active',
    is_nsfw: false, is_demo: false,
    tags: [], quality_score: 0, wavescore: 0,
    owner_id: null,
    published_at: new Date(),
    created_at: new Date(), updated_at: new Date(),
    ...overrides,
  };
  await withDb(async (db) => { await db.collection('channels').insertOne(doc); });
  return doc;
}

beforeAll(async () => {
  await withDb(async (db) => {
    await db.collection('users').deleteMany({});
    await db.collection('channel_claims').deleteMany({});
    await db.collection('channel_change_requests').deleteMany({});
    // channels: keep seed but remove any test rows from previous runs
    await db.collection('channels').deleteMany({ id: /^t-ch-/ });
  });
  await runSeed({});
});

afterAll(async () => {
  // Remove test artifacts so release-gate QA queries see a clean slate.
  await withDb(async (db) => {
    await db.collection('channels').deleteMany({ id: /^t-ch-/ });
  });
});

describe('M03 \u2014 Claim submission & privacy', () => {
  it('anonymous cannot submit a claim', async () => {
    const ch = await createApprovedChannel();
    const r = await api(`/claims/${ch.slug}`, { method: 'POST', body: JSON.stringify({ verification_method: 'social', evidence_urls: [{ evidence_type: 'website', evidence_url: 'https://example.com' }] }) });
    expect(r.status).toBe(401);
  });

  it('authenticated user can submit a claim; only they can see their moderator_notes-free copy', async () => {
    const ch = await createApprovedChannel({ website_url: 'https://acme.example.com' });
    const u = await signup('user');
    const r = await api(`/claims/${ch.slug}`, {
      method: 'POST', headers: { Cookie: u.cookie },
      body: JSON.stringify({ verification_method: 'social', claimant_note: 'i own it', evidence_urls: [{ evidence_type: 'youtube', evidence_url: 'https://youtube.com/@acme' }] }),
    });
    expect(r.status).toBe(200);
    const list = await api<{ items: Array<Record<string, unknown>> }>('/me/claims', { headers: { Cookie: u.cookie } });
    expect(list.status).toBe(200);
    const claim = list.body.data!.items[0];
    expect(claim.status).toBe('pending');
    expect(claim).not.toHaveProperty('moderator_notes');   // never leaked to claimant list
  });

  it('duplicate active claim by same user is rejected (409)', async () => {
    const ch = await createApprovedChannel();
    const u = await signup('user');
    const first = await api(`/claims/${ch.slug}`, { method: 'POST', headers: { Cookie: u.cookie }, body: JSON.stringify({ verification_method: 'manual', claimant_note: 'i really do run this channel via my company account.' }) });
    expect(first.status).toBe(200);
    const second = await api(`/claims/${ch.slug}`, { method: 'POST', headers: { Cookie: u.cookie }, body: JSON.stringify({ verification_method: 'manual', claimant_note: 'trying again' }) });
    expect(second.status).toBe(409);
  });

  it('cannot claim a channel that already has a verified owner (hijack protection)', async () => {
    const ch = await createApprovedChannel({ owner_id: 'someone-else', verification_status: 'verified' });
    const u = await signup('user');
    const r = await api(`/claims/${ch.slug}`, { method: 'POST', headers: { Cookie: u.cookie }, body: JSON.stringify({ verification_method: 'social', evidence_urls: [{ evidence_type: 'website', evidence_url: 'https://example.com' }] }) });
    expect(r.status).toBe(409);
  });

  it('cannot claim a non-approved channel', async () => {
    const ch = await createApprovedChannel({ status: 'pending_review' });
    const u = await signup('user');
    const r = await api(`/claims/${ch.slug}`, { method: 'POST', headers: { Cookie: u.cookie }, body: JSON.stringify({ verification_method: 'manual', claimant_note: 'nope' }) });
    expect(r.status).toBe(400);
  });

  it('normal user cannot view moderator claim queue (403)', async () => {
    const u = await signup('user');
    const r = await api('/admin/claims', { headers: { Cookie: u.cookie } });
    expect(r.status).toBe(403);
  });
});

describe('M03 \u2014 Moderator lifecycle: request-info, resubmit, approve, ownership assignment', () => {
  it('happy path: submit \u2192 request info \u2192 resubmit \u2192 approve grants ownership atomically', async () => {
    const ch = await createApprovedChannel({ website_url: 'https://match.example.com' });
    const u = await signup('user');
    const mod = await signup('moderator');

    const sub = await api<{ claim: { id: string } }>(`/claims/${ch.slug}`, { method: 'POST', headers: { Cookie: u.cookie }, body: JSON.stringify({ verification_method: 'social', claimant_note: 'i run it', evidence_urls: [{ evidence_type: 'website', evidence_url: 'https://match.example.com' }] }) });
    expect(sub.status).toBe(200);
    const claimId = sub.body.data!.claim.id;

    // Moderator requests more info.
    const req = await api(`/admin/claims/${claimId}/request-info`, { method: 'POST', headers: { Cookie: mod.cookie }, body: JSON.stringify({ message: 'Please share screenshot of channel admin panel URL' }) });
    expect(req.status).toBe(200);
    const mine = await api<{ items: Array<{ id: string; status: string }> }>('/me/claims', { headers: { Cookie: u.cookie } });
    expect(mine.body.data!.items.find((c) => c.id === claimId)?.status).toBe('needs_information');

    // Claimant resubmits.
    const res = await api(`/claims/${claimId}/resubmit`, { method: 'POST', headers: { Cookie: u.cookie }, body: JSON.stringify({ verification_method: 'social', claimant_note: 'here is more evidence attached', evidence_urls: [{ evidence_type: 'youtube', evidence_url: 'https://youtube.com/@me' }] }) });
    expect(res.status).toBe(200);

    // Moderator approves.
    const app = await api(`/admin/claims/${claimId}/approve`, { method: 'POST', headers: { Cookie: mod.cookie }, body: JSON.stringify({}) });
    expect(app.status).toBe(200);

    await withDb(async (db) => {
      const c = await db.collection('channels').findOne({ id: ch.id });
      expect(c!.owner_id).toBe(u.userId);
      expect(c!.verification_status).toBe('verified');
      const audit1 = await db.collection('audit_logs').findOne({ action: 'CLAIM_APPROVED', entity_id: claimId });
      const audit2 = await db.collection('audit_logs').findOne({ action: 'CHANNEL_OWNER_ASSIGNED', entity_id: ch.id });
      expect(audit1).not.toBeNull();
      expect(audit2).not.toBeNull();
    });
  });

  it('conflicting claims: approving one cancels other active claims for the same channel', async () => {
    const ch = await createApprovedChannel();
    const alice = await signup('user');
    const bob = await signup('user');
    const mod = await signup('moderator');

    const a = await api<{ claim: { id: string } }>(`/claims/${ch.slug}`, { method: 'POST', headers: { Cookie: alice.cookie }, body: JSON.stringify({ verification_method: 'manual', claimant_note: 'alice claim about channel' }) });
    const b = await api<{ claim: { id: string } }>(`/claims/${ch.slug}`, { method: 'POST', headers: { Cookie: bob.cookie }, body: JSON.stringify({ verification_method: 'manual', claimant_note: 'bob claim about channel' }) });
    expect(a.status).toBe(200); expect(b.status).toBe(200);
    const okApprove = await api(`/admin/claims/${a.body.data!.claim.id}/approve`, { method: 'POST', headers: { Cookie: mod.cookie }, body: JSON.stringify({}) });
    expect(okApprove.status).toBe(200);

    await withDb(async (db) => {
      const c = await db.collection('channels').findOne({ id: ch.id });
      expect(c!.owner_id).toBe(alice.userId);
      const bClaim = await db.collection('channel_claims').findOne({ id: b.body.data!.claim.id });
      expect(bClaim!.status).toBe('cancelled');   // bob's claim auto-cancelled
    });

    // Now try to approve bob's claim again \u2014 must fail atomically (409).
    const dupApprove = await api(`/admin/claims/${b.body.data!.claim.id}/approve`, { method: 'POST', headers: { Cookie: mod.cookie }, body: JSON.stringify({}) });
    expect([409, 400]).toContain(dupApprove.status);
  });

  it('rejected claim stays private and stores structured reason + audit', async () => {
    const ch = await createApprovedChannel();
    const u = await signup('user');
    const mod = await signup('moderator');
    const sub = await api<{ claim: { id: string } }>(`/claims/${ch.slug}`, { method: 'POST', headers: { Cookie: u.cookie }, body: JSON.stringify({ verification_method: 'manual', claimant_note: 'a claim that will be rejected' }) });
    const rej = await api(`/admin/claims/${sub.body.data!.claim.id}/reject`, { method: 'POST', headers: { Cookie: mod.cookie }, body: JSON.stringify({ reason: 'insufficient_evidence', moderator_notes: 'internal only' }) });
    expect(rej.status).toBe(200);
    await withDb(async (db) => {
      const claim = await db.collection('channel_claims').findOne({ id: sub.body.data!.claim.id });
      expect(claim!.status).toBe('rejected');
      expect(claim!.reject_reason).toBe('insufficient_evidence');
      const c = await db.collection('channels').findOne({ id: ch.id });
      expect(c!.owner_id ?? null).toBeNull();
      const audit = await db.collection('audit_logs').findOne({ action: 'CLAIM_REJECTED', entity_id: sub.body.data!.claim.id });
      expect(audit).not.toBeNull();
    });
  });

  it('rejected claim MUST NOT hide the channel from public discovery', async () => {
    // Invariant per spec: only channel-moderation can change a channel's
    // discovery visibility. A rejected ownership claim leaves the listing
    // fully public, still unclaimed, and eligible for a new legitimate claim.
    const ch = await createApprovedChannel();
    const u = await signup('user');
    const mod = await signup('moderator');
    const sub = await api<{ claim: { id: string } }>(`/claims/${ch.slug}`, { method: 'POST', headers: { Cookie: u.cookie }, body: JSON.stringify({ verification_method: 'manual', claimant_note: 'claim that will be rejected but must not hide the channel' }) });
    await api(`/admin/claims/${sub.body.data!.claim.id}/reject`, { method: 'POST', headers: { Cookie: mod.cookie }, body: JSON.stringify({ reason: 'insufficient_evidence' }) });

    // Channel still approved + unclaimed in DB.
    await withDb(async (db) => {
      const c = await db.collection('channels').findOne({ id: ch.id });
      expect(c!.status).toBe('approved');
      expect(c!.verification_status).toBe('unclaimed');
      expect(c!.owner_id ?? null).toBeNull();
    });
    // Still visible via public detail + list + search.
    const detail = await api<{ channel: { slug: string } }>(`/channels/${ch.slug}`);
    expect(detail.status).toBe(200);
    const list = await api<{ items: Array<{ slug: string }> }>(`/channels?limit=200`);
    expect(list.body.data!.items.some((it) => it.slug === ch.slug)).toBe(true);
    const search = await api<{ items: Array<{ slug: string }> }>(`/channels?q=${encodeURIComponent(ch.name)}`);
    expect(search.body.data!.items.some((it) => it.slug === ch.slug)).toBe(true);
    // Claim CTA remains available: a NEW user can still submit a claim.
    const u2 = await signup('user');
    const retry = await api(`/claims/${ch.slug}`, { method: 'POST', headers: { Cookie: u2.cookie }, body: JSON.stringify({ verification_method: 'manual', claimant_note: 'another user can still claim after a previous rejection' }) });
    expect(retry.status).toBe(200);
  });
});

describe('M03 \u2014 Owner channel management: safe edits, cross-owner denial, privilege injection', () => {
  async function claimAndApprove(channelOverrides: Record<string, unknown> = {}) {
    const ch = await createApprovedChannel(channelOverrides);
    const u = await signup('user');
    const mod = await signup('moderator');
    const sub = await api<{ claim: { id: string } }>(`/claims/${ch.slug}`, { method: 'POST', headers: { Cookie: u.cookie }, body: JSON.stringify({ verification_method: 'manual', claimant_note: 'owner path setup for M03 tests' }) });
    await api(`/admin/claims/${sub.body.data!.claim.id}/approve`, { method: 'POST', headers: { Cookie: mod.cookie }, body: JSON.stringify({}) });
    return { channel: ch, owner: u, mod };
  }

  it('owner can update safe fields and result appears on public profile', async () => {
    const { channel, owner } = await claimAndApprove();
    const r = await api(`/me/channels/${channel.id}`, {
      method: 'PATCH', headers: { Cookie: owner.cookie },
      body: JSON.stringify({ short_description: 'A brand new description for the channel.', logo_url: 'https://example.com/logo.png' }),
    });
    expect(r.status).toBe(200);
    const pub = await api<{ channel: { short_description: string; logo_url: string } }>(`/channels/${channel.slug}`);
    expect(pub.body.data!.channel.short_description).toBe('A brand new description for the channel.');
  });

  it('non-owner cannot GET or PATCH a channel they do not own', async () => {
    const { channel } = await claimAndApprove();
    const stranger = await signup('user');
    const g = await api(`/me/channels/${channel.id}`, { headers: { Cookie: stranger.cookie } });
    expect(g.status).toBe(403);
    const p = await api(`/me/channels/${channel.id}`, { method: 'PATCH', headers: { Cookie: stranger.cookie }, body: JSON.stringify({ short_description: 'ha ha i pwned you now' }) });
    expect(p.status).toBe(403);
  });

  it('privileged field injection is stripped (owner cannot self-verify/feature/reassign)', async () => {
    const { channel, owner } = await claimAndApprove();
    const inject = await api(`/me/channels/${channel.id}`, {
      method: 'PATCH', headers: { Cookie: owner.cookie },
      body: JSON.stringify({
        short_description: 'valid safe edit',
        verification_status: 'official',
        is_featured: true,
        is_official: true,
        owner_id: 'someone-else',
        featured_priority: 1,
        wavescore: 9999,
      }),
    });
    // Zod .strict() means unknown keys raise a validation error, so the PATCH is rejected. That's fine \u2014 what matters is the state didn't leak.
    expect([200, 400]).toContain(inject.status);
    await withDb(async (db) => {
      const c = await db.collection('channels').findOne({ id: channel.id });
      expect(c!.verification_status).toBe('verified');    // NOT official
      expect(c!.is_featured).toBe(false);
      expect(c!.is_official).toBe(false);
      expect(c!.owner_id).toBe(owner.userId);
    });
  });

  it('anonymous /me/channels returns 401', async () => {
    const r = await api('/me/channels');
    expect(r.status).toBe(401);
  });
});

describe('M03 \u2014 Sensitive change requests', () => {
  async function claimAndApprove() {
    const ch = await createApprovedChannel();
    const u = await signup('user');
    const mod = await signup('moderator');
    const sub = await api<{ claim: { id: string } }>(`/claims/${ch.slug}`, { method: 'POST', headers: { Cookie: u.cookie }, body: JSON.stringify({ verification_method: 'manual', claimant_note: 'setup for change requests' }) });
    await api(`/admin/claims/${sub.body.data!.claim.id}/approve`, { method: 'POST', headers: { Cookie: mod.cookie }, body: JSON.stringify({}) });
    return { channel: ch, owner: u, mod };
  }

  it('owner submits a sensitive change; public channel is NOT changed until moderator approves', async () => {
    const { channel, owner, mod } = await claimAndApprove();
    const newUrlKey = `0029RENAME${Math.random().toString(36).slice(2, 10)}`;
    const cr = await api<{ change_request_id: string }>(`/me/channels/${channel.id}/change-request`, {
      method: 'POST', headers: { Cookie: owner.cookie },
      body: JSON.stringify({ changes: { name: 'Renamed Channel', whatsapp_url: `https://whatsapp.com/channel/${newUrlKey}` } }),
    });
    expect(cr.status).toBe(200);
    // Public unchanged.
    const pubBefore = await api<{ channel: { name: string; whatsapp_url: string } }>(`/channels/${channel.slug}`);
    expect(pubBefore.body.data!.channel.name).toBe(channel.name);
    expect(pubBefore.body.data!.channel.whatsapp_url).toBe(channel.whatsapp_url);

    // Moderator approves.
    const app = await api(`/admin/channel-changes/${cr.body.data!.change_request_id}/approve`, { method: 'POST', headers: { Cookie: mod.cookie }, body: JSON.stringify({}) });
    expect(app.status).toBe(200);

    const pubAfter = await api<{ channel: { name: string; whatsapp_url: string } }>(`/channels/${channel.slug}`);
    expect(pubAfter.body.data!.channel.name).toBe('Renamed Channel');
    expect(pubAfter.body.data!.channel.whatsapp_url).toContain(newUrlKey);
  });

  it('non-owner cannot submit a change request', async () => {
    const { channel } = await claimAndApprove();
    const stranger = await signup('user');
    const r = await api(`/me/channels/${channel.id}/change-request`, { method: 'POST', headers: { Cookie: stranger.cookie }, body: JSON.stringify({ changes: { name: 'hijack' } }) });
    expect(r.status).toBe(403);
  });

  it('only one pending change request per channel', async () => {
    const { channel, owner } = await claimAndApprove();
    await api(`/me/channels/${channel.id}/change-request`, { method: 'POST', headers: { Cookie: owner.cookie }, body: JSON.stringify({ changes: { name: 'v1' } }) });
    const dup = await api(`/me/channels/${channel.id}/change-request`, { method: 'POST', headers: { Cookie: owner.cookie }, body: JSON.stringify({ changes: { name: 'v2' } }) });
    expect(dup.status).toBe(409);
  });
});

describe('M03 \u2014 Public verified badge & regression', () => {
  it('trust-state invariant: is_verified NEVER true without owner_id (defensive)', async () => {
    // Even if a legacy row somehow has verification_status='verified' with a
    // NULL owner_id, the public sanitizer must NOT surface is_verified/
    // is_official. Otherwise the public UI would show a Verified badge
    // alongside a Claim CTA at the same time.
    const ch = await createApprovedChannel({ owner_id: null, verification_status: 'verified' });
    const r = await api<{ channel: { is_verified: boolean; is_official: boolean; has_owner: boolean } }>(`/channels/${ch.slug}`);
    expect(r.status).toBe(200);
    expect(r.body.data!.channel.is_verified).toBe(false);
    expect(r.body.data!.channel.is_official).toBe(false);
    expect(r.body.data!.channel.has_owner).toBe(false);
  });

  it('sanitizer exposes is_verified/is_official/has_owner and hides internals', async () => {
    // M11-Batch2B: public is_verified now requires ownership approved AND
    // activation active — seed the fixture accordingly.
    const ch = await createApprovedChannel({ owner_id: 'x', verification_status: 'verified', activation_status: 'active' });
    const r = await api<{ channel: Record<string, unknown> }>(`/channels/${ch.slug}`);
    expect(r.status).toBe(200);
    expect(r.body.data!.channel.is_verified).toBe(true);
    expect(r.body.data!.channel.is_official).toBe(false);
    expect(r.body.data!.channel.has_owner).toBe(true);
    expect(r.body.data!.channel).not.toHaveProperty('verification_status');
    expect(r.body.data!.channel).not.toHaveProperty('owner_id');
    expect(r.body.data!.channel).not.toHaveProperty('reviewed_by');
  });

  it('M11-Batch2B release-safety: flag OFF (default) → verified ownership without activation still shows Owner Verified', async () => {
    // Release-safety default is CHANNEL_OWNER_ACTIVATION_REQUIRED=false so
    // existing production owners retain their badge until activation is
    // launched. The strict-mode invariant (flag ON) is covered separately
    // in tests/m11_batch2b_release_safety.test.ts.
    const ch = await createApprovedChannel({ owner_id: 'x', verification_status: 'verified' /* no activation seeded */ });
    const r = await api<{ channel: { is_verified: boolean; has_owner: boolean } }>(`/channels/${ch.slug}`);
    expect(r.status).toBe(200);
    expect(r.body.data!.channel.is_verified).toBe(true);
    expect(r.body.data!.channel.has_owner).toBe(true);
  });

  it('Follow-Intent tracking regression: /go/<approved> still 302s to whatsapp', async () => {
    const ch = await createApprovedChannel();
    const r = await fetch(`http://localhost:3000/go/${ch.slug}?source=test`, { redirect: 'manual' });
    expect(r.status).toBe(302);
    expect((r.headers.get('location') || '').includes('whatsapp.com') || (r.headers.get('location') || '').includes('wa.me')).toBe(true);
  });
});
