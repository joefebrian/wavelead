// Milestone 04 — Owner Analytics & Growth Intelligence.
//
// These tests exercise the live API on :3000 through the full stack.
// Focus areas per M04 spec:
//   1. Ownership isolation (owner vs stranger vs admin vs anon).
//   2. Rollup idempotency (same result on 1 vs N runs).
//   3. Freshness (today's rollup refreshes; historical stays).
//   4. Canonical source taxonomy (arbitrary source -> other).
//   5. Search query privacy threshold (>= 3 impressions).
//   6. CSV exports reconcile with dashboard.
//   7. Admin rollup trigger authorization.
//   8. 5 raw follow_clicks same session -> follow_clicks=5, unique=1.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MongoClient } from 'mongodb';
import { runSeed } from '@/lib/seed/seedData';
import { v4 as uuidv4 } from 'uuid';

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
  try { body = (await res.json()) as JsonResp<T>; } catch { /* not json */ }
  return { status: res.status, body, setCookie: res.headers.get('set-cookie'), rawRes: res };
}

async function rawText(path: string, init: RequestInit = {}, ip: string = fakeIp()) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'X-Forwarded-For': ip, ...(init.headers || {}) },
  });
  const text = await res.text();
  return { status: res.status, text, contentType: res.headers.get('content-type') || '', disposition: res.headers.get('content-disposition') || '' };
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

async function createOwnedApprovedChannel(ownerId: string) {
  const id = `t-m04-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const key = `0029M04${Math.random().toString(36).slice(2, 12)}xyz`;
  const doc = {
    id,
    slug: `test-${id}`,
    name: `M04 Test Channel ${id}`,
    whatsapp_url: `https://whatsapp.com/channel/${key}`,
    short_description: 'm04 test seed',
    description: null,
    logo_url: null, cover_url: null,
    website_url: null,
    category_id: null,
    country_code: 'ID',
    primary_language: 'en',
    status: 'approved',
    verification_status: 'verified',
    is_featured: false, is_official: false,
    follower_count: 0, activity_level: 'active',
    is_nsfw: false, is_demo: false,
    owner_id: ownerId,
    published_at: new Date(),
    created_at: new Date(), updated_at: new Date(),
  };
  await withDb(async (db) => { await db.collection('channels').insertOne(doc); });
  return doc;
}

function utcKey(d = new Date()): string { return d.toISOString().slice(0, 10); }
function daysAgoKey(n: number): string { return utcKey(new Date(Date.now() - n * 24 * 3600_000)); }

// Insert a synthetic raw event directly into the events collection so we
// have deterministic input for rollups (avoids relying on real user flows).
async function insertEvent(evt: {
  event_type: string; channel_id: string; created_at: Date;
  anonymous_session_id?: string | null; source?: string | null;
  search_query?: string | null; country_code?: string | null; device_type?: string | null;
}) {
  await withDb(async (db) => {
    await db.collection('events').insertOne({
      id: uuidv4(),
      event_type: evt.event_type,
      channel_id: evt.channel_id,
      anonymous_session_id: evt.anonymous_session_id ?? null,
      user_id: null,
      campaign_id: null,
      source: evt.source ?? 'homepage',
      placement: null,
      referrer: null,
      referrer_domain: null,
      search_query: evt.search_query ?? null,
      category_slug: null,
      country_code: evt.country_code ?? null,
      device_type: evt.device_type ?? null,
      page_path: null,
      metadata: {},
      created_at: evt.created_at,
    });
  });
}

beforeAll(async () => {
  await withDb(async (db) => {
    await db.collection('users').deleteMany({});
    await db.collection('channel_daily_metrics').deleteMany({});
    await db.collection('channel_daily_source_metrics').deleteMany({});
    await db.collection('channel_search_query_metrics').deleteMany({});
    await db.collection('analytics_rollup_state').deleteMany({});
    await db.collection('events').deleteMany({ channel_id: /^t-m04-/ });
    await db.collection('channels').deleteMany({ id: /^t-m04-/ });
  });
  await runSeed({});
});

afterAll(async () => {
  await withDb(async (db) => {
    await db.collection('events').deleteMany({ channel_id: /^t-m04-/ });
    await db.collection('channels').deleteMany({ id: /^t-m04-/ });
  });
});

describe('M04 — Ownership isolation', () => {
  it('anonymous cannot access owner analytics (401)', async () => {
    const admin = await signup('admin');
    const ch = await createOwnedApprovedChannel(admin.userId);
    const r = await api(`/owner/channels/${ch.id}/analytics/overview`);
    expect(r.status).toBe(401);
  });

  it('non-owner cannot access another owners analytics (403)', async () => {
    const owner = await signup('user');
    const stranger = await signup('user');
    const ch = await createOwnedApprovedChannel(owner.userId);
    const r = await api(`/owner/channels/${ch.id}/analytics/overview`, { headers: { Cookie: stranger.cookie } });
    expect(r.status).toBe(403);
  });

  it('owner can access their own analytics (200, empty state OK)', async () => {
    const owner = await signup('user');
    const ch = await createOwnedApprovedChannel(owner.userId);
    const r = await api<{ kpis: { follow_clicks: number }; is_empty: boolean }>(`/owner/channels/${ch.id}/analytics/overview`, { headers: { Cookie: owner.cookie } });
    expect(r.status).toBe(200);
    expect(r.body.data!.kpis.follow_clicks).toBe(0);
    expect(r.body.data!.is_empty).toBe(true);
  });

  it('admin can access any channels analytics', async () => {
    const owner = await signup('user');
    const admin = await signup('admin');
    const ch = await createOwnedApprovedChannel(owner.userId);
    const r = await api(`/owner/channels/${ch.id}/analytics/overview`, { headers: { Cookie: admin.cookie } });
    expect(r.status).toBe(200);
  });
});

describe('M04 — Rollup idempotency & correctness', () => {
  it('5 raw follow_clicks same session -> follow_clicks=5, unique_follow_intents=1', async () => {
    const owner = await signup('user');
    const ch = await createOwnedApprovedChannel(owner.userId);
    const day = daysAgoKey(2); // historical completed day
    const dayDate = new Date(`${day}T12:00:00Z`);
    const sess = uuidv4();
    for (let i = 0; i < 5; i++) {
      await insertEvent({ event_type: 'follow_click', channel_id: ch.id, created_at: dayDate, anonymous_session_id: sess, source: 'homepage' });
    }
    const first = await api<{ series: Array<{ date: string; follow_clicks: number; unique_follow_intents: number }> }>(
      `/owner/channels/${ch.id}/analytics/timeseries?window=custom&from=${day}&to=${day}`,
      { headers: { Cookie: owner.cookie } },
    );
    expect(first.status).toBe(200);
    const row = first.body.data!.series.find((s) => s.date === day)!;
    expect(row.follow_clicks).toBe(5);
    expect(row.unique_follow_intents).toBe(1);
  });

  it('running the same rollup 5 times produces identical results', async () => {
    const owner = await signup('user');
    const admin = await signup('admin');
    const ch = await createOwnedApprovedChannel(owner.userId);
    const day = daysAgoKey(3);
    const dayDate = new Date(`${day}T09:30:00Z`);
    // Two distinct sessions with mixed events
    const s1 = uuidv4();
    const s2 = uuidv4();
    for (let i = 0; i < 3; i++) await insertEvent({ event_type: 'channel_impression', channel_id: ch.id, created_at: dayDate, anonymous_session_id: s1, source: 'homepage' });
    await insertEvent({ event_type: 'channel_profile_view', channel_id: ch.id, created_at: dayDate, anonymous_session_id: s1, source: 'homepage' });
    await insertEvent({ event_type: 'channel_profile_view', channel_id: ch.id, created_at: dayDate, anonymous_session_id: s2, source: 'search', search_query: 'finance' });
    await insertEvent({ event_type: 'follow_click', channel_id: ch.id, created_at: dayDate, anonymous_session_id: s2, source: 'search', search_query: 'finance' });
    await insertEvent({ event_type: 'follow_click', channel_id: ch.id, created_at: dayDate, anonymous_session_id: s2, source: 'search', search_query: 'finance' });

    let ref: { discovery_impressions: number; profile_views: number; unique_profile_views: number; follow_clicks: number; unique_follow_intents: number } | null = null;
    for (let i = 0; i < 5; i++) {
      // Force rebuild each time via admin trigger.
      const rb = await api(`/admin/analytics/rollup`, { method: 'POST', headers: { Cookie: admin.cookie }, body: JSON.stringify({ channel_id: ch.id, date_from: day, date_to: day, force: true }) });
      expect(rb.status).toBe(200);
      const r = await api<{ series: Array<{ date: string; discovery_impressions: number; profile_views: number; unique_profile_views: number; follow_clicks: number; unique_follow_intents: number }> }>(
        `/owner/channels/${ch.id}/analytics/timeseries?window=custom&from=${day}&to=${day}`,
        { headers: { Cookie: owner.cookie } },
      );
      const row = r.body.data!.series.find((s) => s.date === day)!;
      const totals = {
        discovery_impressions: row.discovery_impressions,
        profile_views: row.profile_views,
        unique_profile_views: row.unique_profile_views,
        follow_clicks: row.follow_clicks,
        unique_follow_intents: row.unique_follow_intents,
      };
      if (!ref) ref = totals; else expect(totals).toEqual(ref);
    }
    // Sanity of the reference numbers.
    expect(ref).toEqual({ discovery_impressions: 3, profile_views: 2, unique_profile_views: 2, follow_clicks: 2, unique_follow_intents: 1 });
  });

  it('overview sum matches source rollup sum (reconciliation)', async () => {
    const owner = await signup('user');
    const ch = await createOwnedApprovedChannel(owner.userId);
    const day = daysAgoKey(4);
    const dayDate = new Date(`${day}T10:00:00Z`);
    for (let i = 0; i < 4; i++) await insertEvent({ event_type: 'follow_click', channel_id: ch.id, created_at: dayDate, anonymous_session_id: uuidv4(), source: 'homepage' });
    for (let i = 0; i < 2; i++) await insertEvent({ event_type: 'follow_click', channel_id: ch.id, created_at: dayDate, anonymous_session_id: uuidv4(), source: 'search', search_query: 'sports' });

    const ov = await api<{ kpis: { follow_clicks: number; unique_follow_intents: number } }>(
      `/owner/channels/${ch.id}/analytics/overview?window=custom&from=${day}&to=${day}`,
      { headers: { Cookie: owner.cookie } },
    );
    const src = await api<{ items: Array<{ source: string; follow_clicks: number; unique_follow_intents: number }> }>(
      `/owner/channels/${ch.id}/analytics/sources?window=custom&from=${day}&to=${day}`,
      { headers: { Cookie: owner.cookie } },
    );
    const srcClicks = src.body.data!.items.reduce((a, it) => a + it.follow_clicks, 0);
    const srcUnique = src.body.data!.items.reduce((a, it) => a + it.unique_follow_intents, 0);
    expect(srcClicks).toBe(ov.body.data!.kpis.follow_clicks);
    expect(srcUnique).toBe(ov.body.data!.kpis.unique_follow_intents);
  });
});

describe('M04 — Canonical source taxonomy', () => {
  it('arbitrary source values normalize to "other" in source rollups', async () => {
    const owner = await signup('user');
    const ch = await createOwnedApprovedChannel(owner.userId);
    const day = daysAgoKey(5);
    const dayDate = new Date(`${day}T11:00:00Z`);
    // Insert with a bogus source name — should collapse to 'other'.
    await insertEvent({ event_type: 'follow_click', channel_id: ch.id, created_at: dayDate, anonymous_session_id: uuidv4(), source: 'facebook_paid_supercampaign' });
    await insertEvent({ event_type: 'follow_click', channel_id: ch.id, created_at: dayDate, anonymous_session_id: uuidv4(), source: 'homepage_popular' /* legacy */ });
    const r = await api<{ items: Array<{ source: string; follow_clicks: number }> }>(`/owner/channels/${ch.id}/analytics/sources?window=custom&from=${day}&to=${day}`, { headers: { Cookie: owner.cookie } });
    const bySrc = Object.fromEntries(r.body.data!.items.map((it) => [it.source, it.follow_clicks]));
    expect(bySrc.other || 0).toBeGreaterThanOrEqual(1);
    expect(bySrc.homepage || 0).toBeGreaterThanOrEqual(1); // legacy homepage_* -> homepage
    // Never surface the raw arbitrary value.
    expect(bySrc.facebook_paid_supercampaign).toBeUndefined();
  });
});

describe('M04 — Search query privacy threshold', () => {
  it('search terms with < 3 impressions are suppressed', async () => {
    const owner = await signup('user');
    const ch = await createOwnedApprovedChannel(owner.userId);
    const day = daysAgoKey(6);
    const dayDate = new Date(`${day}T09:00:00Z`);
    // "trending topic": 4 impressions (visible)
    for (let i = 0; i < 4; i++) await insertEvent({ event_type: 'search_impression', channel_id: ch.id, created_at: dayDate, anonymous_session_id: uuidv4(), source: 'search', search_query: 'trending topic' });
    // "rare": 2 impressions (suppressed)
    for (let i = 0; i < 2; i++) await insertEvent({ event_type: 'search_impression', channel_id: ch.id, created_at: dayDate, anonymous_session_id: uuidv4(), source: 'search', search_query: 'rare' });
    const r = await api<{ items: Array<{ search_query: string; impressions: number }>; suppressed_count: number; threshold: number }>(
      `/owner/channels/${ch.id}/analytics/discovery?window=custom&from=${day}&to=${day}`,
      { headers: { Cookie: owner.cookie } },
    );
    expect(r.body.data!.threshold).toBe(3);
    const qs = r.body.data!.items.map((it) => it.search_query);
    expect(qs).toContain('trending topic');
    expect(qs).not.toContain('rare');
    expect(r.body.data!.suppressed_count).toBeGreaterThanOrEqual(1);
  });
});

describe('M04 — CSV exports', () => {
  it('overview CSV reconciles with dashboard KPIs', async () => {
    const owner = await signup('user');
    const ch = await createOwnedApprovedChannel(owner.userId);
    const day = daysAgoKey(7);
    const dayDate = new Date(`${day}T12:00:00Z`);
    for (let i = 0; i < 3; i++) await insertEvent({ event_type: 'follow_click', channel_id: ch.id, created_at: dayDate, anonymous_session_id: uuidv4(), source: 'homepage' });

    const csv = await rawText(`/owner/channels/${ch.id}/analytics/export?kind=overview&window=custom&from=${day}&to=${day}`, { headers: { Cookie: owner.cookie } });
    expect(csv.status).toBe(200);
    expect(csv.contentType).toContain('text/csv');
    expect(csv.disposition).toContain('attachment');
    expect(csv.disposition).toContain('overview');
    // parse CSV
    const lines = csv.text.trim().split('\n');
    expect(lines[0]).toContain('date,discovery_impressions,search_impressions,profile_views');
    const targetLine = lines.find((l) => l.startsWith(day))!;
    const cells = targetLine.split(',');
    const followClicksIdx = lines[0].split(',').indexOf('follow_clicks');
    expect(parseInt(cells[followClicksIdx], 10)).toBe(3);

    // Sanity: same query on the API endpoint should agree.
    const ov = await api<{ kpis: { follow_clicks: number } }>(`/owner/channels/${ch.id}/analytics/overview?window=custom&from=${day}&to=${day}`, { headers: { Cookie: owner.cookie } });
    expect(ov.body.data!.kpis.follow_clicks).toBe(3);
  });

  it('cross-owner CSV export returns 403', async () => {
    const owner = await signup('user');
    const stranger = await signup('user');
    const ch = await createOwnedApprovedChannel(owner.userId);
    const r = await fetch(`http://localhost:3000/api/owner/channels/${ch.id}/analytics/export?kind=overview&window=7d`, { headers: { Cookie: stranger.cookie } });
    expect(r.status).toBe(403);
  });
});

describe('M04 — Admin rollup trigger authorization', () => {
  it('non-admin cannot trigger rollup', async () => {
    const owner = await signup('user');
    const ch = await createOwnedApprovedChannel(owner.userId);
    const r = await api(`/admin/analytics/rollup`, { method: 'POST', headers: { Cookie: owner.cookie }, body: JSON.stringify({ channel_id: ch.id, date_from: daysAgoKey(1), date_to: daysAgoKey(0) }) });
    expect(r.status).toBe(403);
  });
  it('moderator cannot trigger rollup either', async () => {
    const mod = await signup('moderator');
    const owner = await signup('user');
    const ch = await createOwnedApprovedChannel(owner.userId);
    const r = await api(`/admin/analytics/rollup`, { method: 'POST', headers: { Cookie: mod.cookie }, body: JSON.stringify({ channel_id: ch.id, date_from: daysAgoKey(1), date_to: daysAgoKey(0) }) });
    expect(r.status).toBe(403);
  });
  it('admin can trigger rollup and dry_run returns planned dates', async () => {
    const admin = await signup('admin');
    const owner = await signup('user');
    const ch = await createOwnedApprovedChannel(owner.userId);
    const r = await api<{ would_refresh: string[] }>(`/admin/analytics/rollup`, { method: 'POST', headers: { Cookie: admin.cookie }, body: JSON.stringify({ channel_id: ch.id, date_from: daysAgoKey(2), date_to: daysAgoKey(0), dry_run: true }) });
    expect(r.status).toBe(200);
    expect(r.body.data!.would_refresh.length).toBe(3);
  });
});

describe('M04 — Custom range validation', () => {
  it('rejects invalid date format', async () => {
    const owner = await signup('user');
    const ch = await createOwnedApprovedChannel(owner.userId);
    const r = await api(`/owner/channels/${ch.id}/analytics/overview?window=custom&from=bad-date&to=2026-01-01`, { headers: { Cookie: owner.cookie } });
    expect(r.status).toBe(400);
  });
  it('rejects from > to', async () => {
    const owner = await signup('user');
    const ch = await createOwnedApprovedChannel(owner.userId);
    const r = await api(`/owner/channels/${ch.id}/analytics/overview?window=custom&from=2026-08-30&to=2026-08-01`, { headers: { Cookie: owner.cookie } });
    expect(r.status).toBe(400);
  });
});
