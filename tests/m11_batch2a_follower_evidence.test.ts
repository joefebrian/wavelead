// M11-Batch2A — Follower Evidence (owner-submitted, admin-verified).
//
// Verifies:
//   \u00a71 Owner can submit follower evidence; snapshot inserted as pending
//   \u00a72 Non-owner cannot submit (403)
//   \u00a73 Admin can verify a pending snapshot; public profile shows the count + freshness
//   \u00a74 Admin can reject a pending snapshot with reason; owner sees rejection reason
//   \u00a75 Owner can REPLACE a pending submission — previous row \u2192 superseded
//   \u00a76 Verified snapshots are IMMUTABLE (re-verify \u2192 409, re-reject \u2192 409)
//   \u00a77 Freshness derivation (fresh / aging / stale / outdated) matches product spec
//   \u00a78 Public "Verified" badge is renamed to "Owner Verified"
//   \u00a79 review_note is admin-internal (never returned in owner listMine payload)
import { describe, it, expect, beforeAll } from 'vitest';
import { MongoClient, type Db } from 'mongodb';
import { v4 as uuidv4 } from 'uuid';
import { COLLECTIONS } from '@/lib/db/collections';
import { deriveAudienceFreshness, classifyLevel } from '@/lib/utils/audienceFreshness';

const BASE = 'http://localhost:3000/api';
const PAGE = 'http://localhost:3000';
const RUN_TAG = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;

async function withDb<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  const client = new MongoClient(process.env.MONGO_URL || 'mongodb://localhost:27017');
  await client.connect();
  try { return await fn(client.db(process.env.DB_NAME || 'wavelead')); }
  finally { await client.close(); }
}

function ip(): string { return `10.${Math.floor(Math.random()*255)}.${Math.floor(Math.random()*255)}.${Math.floor(Math.random()*255)}`; }

async function signup(email: string): Promise<{ userId: string; cookie: string }> {
  const res = await fetch(`${BASE}/auth/signup`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip() },
    body: JSON.stringify({ email, password: 'password123!', display_name: email.split('@')[0] }),
  });
  const setCookie = res.headers.get('set-cookie') || '';
  const cookie = setCookie.split(';')[0];
  const j = await res.json() as { data?: { user?: { id?: string } } };
  const userId = j?.data?.user?.id as string;
  expect(userId).toBeTruthy();
  return { userId, cookie };
}

async function promoteRole(userId: string, role: string): Promise<void> {
  await withDb(async (db) => { await db.collection('users').updateOne({ id: userId }, { $set: { role } }); });
}

async function login(email: string): Promise<string> {
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip() },
    body: JSON.stringify({ email, password: 'password123!' }),
  });
  const setCookie = res.headers.get('set-cookie') || '';
  return setCookie.split(';')[0];
}

async function seedApprovedChannel(ownerId: string, name = 'B2A'): Promise<{ id: string; slug: string; name: string }> {
  const id = uuidv4();
  const slug = `b2a-${id.slice(0, 8)}`;
  const wa = `0029B2a${id.slice(0, 20).replace(/-/g, '')}`;
  const now = new Date();
  const doc = {
    id, slug, name: `${name} ${id.slice(0, 6)}`,
    whatsapp_url: `https://whatsapp.com/channel/${wa}`,
    whatsapp_channel_id: wa,
    description: 'batch2a evidence test channel',
    short_description: 'batch2a evidence test channel',
    logo_url: null, cover_url: null, website_url: null,
    country_code: 'US', follower_count: 0,
    is_official: false, is_verified: true, verification_status: 'verified',
    // M11-Batch2B invariant: public "Owner Verified" badge requires ownership
    // approved AND activation active. This test asserts the badge renders on
    // the public profile, so we seed the fixture as fully activated.
    activation_status: 'active', activation_active_at: now, activation_revoked_at: null,
    owner_id: ownerId, category_id: null, tags: [], status: 'approved',
    view_count: 0, click_count: 0, follow_intent_count: 0,
    created_at: now, updated_at: now, published_at: now,
  };
  await withDb(async (db) => { await db.collection(COLLECTIONS.CHANNELS).insertOne(doc as unknown as Record<string, unknown>); });
  return { id, slug, name: doc.name };
}

function fakeAttachment(): unknown {
  return {
    provider: 'uploadthing',
    storage_key: `ut-${uuidv4()}`,
    url: `https://utfs.io/f/${uuidv4()}.png`,
    mime_type: 'image/png',
    file_name_safe: 'evidence.png',
    size_bytes: 123_456,
    uploaded_at: new Date().toISOString(),
  };
}

async function jsonPost(path: string, cookie: string, body: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json', cookie, 'X-Forwarded-For': ip() },
    body: JSON.stringify(body),
  });
  const j = await res.json().catch(() => ({}));
  return { status: res.status, json: j as Record<string, unknown> };
}

async function jsonGet(path: string, cookie: string): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`${BASE}${path}`, { headers: { cookie, 'X-Forwarded-For': ip() } });
  const j = await res.json().catch(() => ({}));
  return { status: res.status, json: j as Record<string, unknown> };
}

describe('M11-Batch2A — Follower Evidence', () => {
  let ownerCookie = '';
  let strangerCookie = '';
  let adminCookie = '';
  let channelId = '';
  let channelSlug = '';

  beforeAll(async () => {
    const owner = await signup(`b2a-${RUN_TAG}-owner@t.test`);
    const stranger = await signup(`b2a-${RUN_TAG}-stranger@t.test`);
    const admin = await signup(`b2a-${RUN_TAG}-admin@t.test`);
    await promoteRole(admin.userId, 'admin');
    // Re-login admin so the resolved-role session reflects the promotion.
    adminCookie = await login(`b2a-${RUN_TAG}-admin@t.test`);
    ownerCookie = owner.cookie;
    strangerCookie = stranger.cookie;
    const ch = await seedApprovedChannel(owner.userId, 'B2A');
    channelId = ch.id;
    channelSlug = ch.slug;
  });

  it('\u00a71 owner can submit \u2192 pending snapshot returned', async () => {
    const r = await jsonPost(`/owner/channels/${channelId}/audience-snapshots`, ownerCookie, {
      followers: 12345,
      evidence_attachment: fakeAttachment(),
      submission_note: 'first submission',
    });
    expect(r.status).toBe(201);
    const snap = (r.json.data as { snapshot?: Record<string, unknown> })?.snapshot as Record<string, unknown>;
    expect(snap).toBeTruthy();
    expect(snap.status).toBe('pending');
    expect(snap.followers).toBe(12345);
    expect((snap as { review_note?: unknown }).review_note).toBeUndefined(); // \u00a79 admin-only field
  });

  it('\u00a72 non-owner cannot submit \u2192 403', async () => {
    const r = await jsonPost(`/owner/channels/${channelId}/audience-snapshots`, strangerCookie, {
      followers: 999,
      evidence_attachment: fakeAttachment(),
    });
    expect(r.status).toBe(403);
  });

  it('\u00a75 owner replacing pending \u2192 old pending becomes superseded', async () => {
    // Owner submits AGAIN \u2014 first one from \u00a71 should transition to superseded.
    const r2 = await jsonPost(`/owner/channels/${channelId}/audience-snapshots`, ownerCookie, {
      followers: 12500,
      evidence_attachment: fakeAttachment(),
      submission_note: 'replacement',
    });
    expect(r2.status).toBe(201);
    // Fetch history via the owner endpoint.
    const list = await jsonGet(`/owner/channels/${channelId}/audience-snapshots`, ownerCookie);
    expect(list.status).toBe(200);
    const items = ((list.json.data as { items?: Array<Record<string, unknown>> })?.items ?? []) as Array<Record<string, unknown>>;
    const pendings = items.filter((s) => s.status === 'pending');
    const superseded = items.filter((s) => s.status === 'superseded');
    expect(pendings).toHaveLength(1);
    expect(superseded.length).toBeGreaterThanOrEqual(1);
    const supersededRow = superseded[0];
    expect(supersededRow.superseded_by_snapshot_id).toBe(pendings[0].id);
  });

  it('\u00a73 admin verifies latest pending \u2192 public profile shows verified follower count + freshness', async () => {
    // Grab latest pending id
    const list = await jsonGet(`/owner/channels/${channelId}/audience-snapshots`, ownerCookie);
    const items = ((list.json.data as { items?: Array<Record<string, unknown>> })?.items ?? []) as Array<Record<string, unknown>>;
    const pending = items.find((s) => s.status === 'pending') as Record<string, unknown>;
    expect(pending).toBeTruthy();

    // Admin queue must list it
    const queue = await jsonGet('/admin/audience-snapshots', adminCookie);
    expect(queue.status).toBe(200);
    const queueItems = ((queue.json.data as { items?: Array<Record<string, unknown>> })?.items ?? []) as Array<Record<string, unknown>>;
    expect(queueItems.some((q) => q.id === pending.id)).toBe(true);

    // Verify it
    const verify = await jsonPost(`/admin/audience-snapshots/${pending.id}/verify`, adminCookie, { review_note: 'looks good' });
    expect(verify.status).toBe(200);

    // Re-verifying an already-verified row is 409 (\u00a76)
    const reVerify = await jsonPost(`/admin/audience-snapshots/${pending.id}/verify`, adminCookie, {});
    expect(reVerify.status).toBe(409);
    // Cannot reject an already-verified row either.
    const reReject = await jsonPost(`/admin/audience-snapshots/${pending.id}/reject`, adminCookie, { rejection_reason: 'other' });
    expect(reReject.status).toBe(409);

    // Public profile now shows Owner Verified badge + verified follower count.
    const pubRes = await fetch(`${PAGE}/channel/${channelSlug}`, { headers: { 'X-Forwarded-For': ip() } });
    expect(pubRes.status).toBe(200);
    const html = await pubRes.text();
    expect(html).toContain('12,500 followers');
    expect(html).toContain('data-testid="owner-verified-badge"');
    expect(html).toContain('Owner Verified');
    // Badge should be renamed \u2014 no legacy "Verified" pill copy in the current channel page (
    //   check via a unique older phrase that no longer appears).
    expect(html).not.toMatch(/WaveLead has verified ownership or control of this channel listing/);
    // Reach card includes an "Updated" freshness label.
    expect(html).toMatch(/Updated \w+ \d+, \d{4}/);
  });

  it('\u00a74 admin rejects a fresh pending submission \u2192 owner sees rejection reason', async () => {
    // Owner submits a NEW one (since prior pending was verified, this creates a fresh pending row).
    const submit = await jsonPost(`/owner/channels/${channelId}/audience-snapshots`, ownerCookie, {
      followers: 13000,
      evidence_attachment: fakeAttachment(),
    });
    expect(submit.status).toBe(201);
    const pendingId = ((submit.json.data as { snapshot?: { id?: string } })?.snapshot?.id) as string;
    expect(pendingId).toBeTruthy();

    const reject = await jsonPost(`/admin/audience-snapshots/${pendingId}/reject`, adminCookie, {
      rejection_reason: 'illegible',
      review_note: 'admin-only note',
    });
    expect(reject.status).toBe(200);

    // Owner history \u2014 last row is rejected + rejection_reason present, review_note NOT present.
    const list = await jsonGet(`/owner/channels/${channelId}/audience-snapshots`, ownerCookie);
    const items = ((list.json.data as { items?: Array<Record<string, unknown>> })?.items ?? []) as Array<Record<string, unknown>>;
    const row = items.find((s) => s.id === pendingId) as Record<string, unknown>;
    expect(row.status).toBe('rejected');
    expect(row.rejection_reason).toBe('illegible');
    expect((row as { review_note?: unknown }).review_note).toBeUndefined();

    // Public profile still shows the earlier VERIFIED count (12,500), not the rejected 13,000.
    const html = await (await fetch(`${PAGE}/channel/${channelSlug}`, { headers: { 'X-Forwarded-For': ip() } })).text();
    expect(html).toContain('12,500 followers');
    expect(html).not.toContain('13,000 followers');
  });

  it('\u00a77 freshness classifier matches product buckets', () => {
    expect(classifyLevel(0)).toBe('fresh');
    expect(classifyLevel(30)).toBe('fresh');
    expect(classifyLevel(31)).toBe('aging');
    expect(classifyLevel(90)).toBe('aging');
    expect(classifyLevel(91)).toBe('stale');
    expect(classifyLevel(180)).toBe('stale');
    expect(classifyLevel(181)).toBe('outdated');
    // Absolute date always present.
    const now = new Date('2026-09-03T00:00:00Z');
    const f = deriveAudienceFreshness({ evidence_date: null, reported_at: new Date('2026-09-01T00:00:00Z') }, now);
    expect(f.level).toBe('fresh');
    expect(f.qualifier).toBeNull();
    expect(f.label).toMatch(/Updated \w+ \d+, 2026$/);
    const aged = deriveAudienceFreshness({ evidence_date: null, reported_at: new Date('2026-07-01T00:00:00Z') }, now);
    expect(aged.level).toBe('aging');
    expect(aged.qualifier).toMatch(/days ago$/);
    const stale = deriveAudienceFreshness({ evidence_date: null, reported_at: new Date('2026-05-01T00:00:00Z') }, now);
    expect(stale.level).toBe('stale');
    expect(stale.qualifier).toBe('Stale');
    const old = deriveAudienceFreshness({ evidence_date: null, reported_at: new Date('2025-12-01T00:00:00Z') }, now);
    expect(old.level).toBe('outdated');
    expect(old.qualifier).toBe('Outdated');
  });
});
