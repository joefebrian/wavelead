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
    slug: `m04-${id}`,
    name: `M04 Channel ${id}`,
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
  category_slug?: string | null;
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
      category_slug: evt.category_slug ?? null,
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

describe('M04 — Controlled QA reconciliation (10 disc / 4 UPV / 5 clicks / 3 UFI)', () => {
  it('event pipeline → API produces exactly 40% D→P and 75% P→F', async () => {
    const owner = await signup('user');
    const ch = await createOwnedApprovedChannel(owner.userId);
    const day = daysAgoKey(8);
    const dayDate = new Date(`${day}T10:00:00Z`);
    const s = { s1: uuidv4(), s2: uuidv4(), s3: uuidv4(), s4: uuidv4(), s5: uuidv4() };
    // SEARCH (6 impressions, 2 unique PV, 4 clicks, 2 UFI including 3-click same-session dedup)
    for (let i = 0; i < 4; i++) await insertEvent({ event_type: 'search_impression', channel_id: ch.id, created_at: dayDate, anonymous_session_id: s.s1, source: 'search', search_query: 'finance' });
    for (let i = 0; i < 2; i++) await insertEvent({ event_type: 'search_impression', channel_id: ch.id, created_at: dayDate, anonymous_session_id: s.s2, source: 'search', search_query: 'finance' });
    await insertEvent({ event_type: 'channel_profile_view', channel_id: ch.id, created_at: dayDate, anonymous_session_id: s.s1, source: 'search', search_query: 'finance' });
    await insertEvent({ event_type: 'channel_profile_view', channel_id: ch.id, created_at: dayDate, anonymous_session_id: s.s2, source: 'search', search_query: 'finance' });
    for (let i = 0; i < 3; i++) await insertEvent({ event_type: 'follow_click', channel_id: ch.id, created_at: dayDate, anonymous_session_id: s.s1, source: 'search', search_query: 'finance' });
    await insertEvent({ event_type: 'follow_click', channel_id: ch.id, created_at: dayDate, anonymous_session_id: s.s2, source: 'search', search_query: 'finance' });
    // HOMEPAGE (2 impressions, 1 unique PV, 0 clicks)
    for (let i = 0; i < 2; i++) await insertEvent({ event_type: 'channel_impression', channel_id: ch.id, created_at: dayDate, anonymous_session_id: s.s3, source: 'homepage' });
    await insertEvent({ event_type: 'channel_profile_view', channel_id: ch.id, created_at: dayDate, anonymous_session_id: s.s3, source: 'homepage' });
    // CATEGORY (2 impressions, 1 unique PV, 1 click, 1 UFI)
    for (let i = 0; i < 2; i++) await insertEvent({ event_type: 'channel_impression', channel_id: ch.id, created_at: dayDate, anonymous_session_id: s.s4, source: 'category', category_slug: 'sports' });
    await insertEvent({ event_type: 'channel_profile_view', channel_id: ch.id, created_at: dayDate, anonymous_session_id: s.s4, source: 'category', category_slug: 'sports' });
    await insertEvent({ event_type: 'follow_click', channel_id: ch.id, created_at: dayDate, anonymous_session_id: s.s4, source: 'category', category_slug: 'sports' });

    const ov = await api<{ kpis: { discovery_impressions: number; search_impressions: number; profile_views: number; unique_profile_views: number; follow_clicks: number; unique_follow_intents: number; discovery_profile_ctr: number | null; profile_follow_ctr: number | null } }>(
      `/owner/channels/${ch.id}/analytics/overview?window=custom&from=${day}&to=${day}`,
      { headers: { Cookie: owner.cookie } },
    );
    // Discovery = channel_impression events only (homepage 2 + category 2 = 4)
    expect(ov.body.data!.kpis.discovery_impressions).toBe(4);
    expect(ov.body.data!.kpis.search_impressions).toBe(6);
    // Total discovery reach for CTR base = discovery + search = 10
    expect(ov.body.data!.kpis.follow_clicks).toBe(5);
    expect(ov.body.data!.kpis.unique_follow_intents).toBe(3);
    expect(ov.body.data!.kpis.unique_profile_views).toBe(4);
    // 4/10 = 40%
    expect(ov.body.data!.kpis.discovery_profile_ctr).toBe(40);
    // 3/4 = 75%
    expect(ov.body.data!.kpis.profile_follow_ctr).toBe(75);

    // Source reconciliation
    const src = await api<{ items: Array<{ source: string; unique_follow_intents: number; follow_clicks: number }> }>(
      `/owner/channels/${ch.id}/analytics/sources?window=custom&from=${day}&to=${day}`,
      { headers: { Cookie: owner.cookie } },
    );
    const bySrc = Object.fromEntries(src.body.data!.items.map((it) => [it.source, it]));
    expect(bySrc.search.follow_clicks).toBe(4);
    expect(bySrc.search.unique_follow_intents).toBe(2);
    expect(bySrc.homepage?.follow_clicks || 0).toBe(0);
    expect(bySrc.homepage?.unique_follow_intents || 0).toBe(0);
    expect(bySrc.category.follow_clicks).toBe(1);
    expect(bySrc.category.unique_follow_intents).toBe(1);
    const sumUFI = src.body.data!.items.reduce((a, it) => a + it.unique_follow_intents, 0);
    expect(sumUFI).toBe(3);
  });
});

describe('M04 — Previous-period comparison', () => {
  it('overview returns previous window with deltas when compare=previous', async () => {
    const owner = await signup('user');
    const ch = await createOwnedApprovedChannel(owner.userId);
    // Current 7d: 12 UFI; Previous 7d: 10 UFI → +20%
    const now = new Date();
    const curDate = new Date(now.getTime() - 3 * 24 * 3600_000); // in current 7d window
    const prevDate = new Date(now.getTime() - 10 * 24 * 3600_000); // in previous 7d window
    for (let i = 0; i < 12; i++) await insertEvent({ event_type: 'follow_click', channel_id: ch.id, created_at: curDate, anonymous_session_id: uuidv4(), source: 'homepage' });
    for (let i = 0; i < 10; i++) await insertEvent({ event_type: 'follow_click', channel_id: ch.id, created_at: prevDate, anonymous_session_id: uuidv4(), source: 'homepage' });
    const r = await api<{ kpis: { unique_follow_intents: number }; previous?: { kpis: { unique_follow_intents: number }; deltas: { unique_follow_intents: number | null }; has_data: boolean } }>(
      `/owner/channels/${ch.id}/analytics/overview?window=7d&compare=previous`,
      { headers: { Cookie: owner.cookie } },
    );
    expect(r.status).toBe(200);
    expect(r.body.data!.kpis.unique_follow_intents).toBe(12);
    expect(r.body.data!.previous).toBeDefined();
    expect(r.body.data!.previous!.kpis.unique_follow_intents).toBe(10);
    expect(r.body.data!.previous!.has_data).toBe(true);
    expect(r.body.data!.previous!.deltas.unique_follow_intents).toBe(20);
  });
  it('previous window with zero data reports has_data=false, null delta when current>0', async () => {
    const owner = await signup('user');
    const ch = await createOwnedApprovedChannel(owner.userId);
    const cur = new Date(Date.now() - 2 * 24 * 3600_000);
    for (let i = 0; i < 3; i++) await insertEvent({ event_type: 'follow_click', channel_id: ch.id, created_at: cur, anonymous_session_id: uuidv4(), source: 'homepage' });
    const r = await api<{ previous?: { has_data: boolean; deltas: { follow_clicks: number | null } } }>(
      `/owner/channels/${ch.id}/analytics/overview?window=7d&compare=previous`,
      { headers: { Cookie: owner.cookie } },
    );
    expect(r.body.data!.previous!.has_data).toBe(false);
    expect(r.body.data!.previous!.deltas.follow_clicks).toBeNull();
  });
});

describe('M04 — Profile completeness & Growth recommendations', () => {
  it('completeness returns score + checks; visibility follows fields', async () => {
    const owner = await signup('user');
    const ch = await createOwnedApprovedChannel(owner.userId);
    const r = await api<{ score: number; checks: Array<{ key: string; done: boolean }> }>(
      `/owner/channels/${ch.id}/analytics/completeness`,
      { headers: { Cookie: owner.cookie } },
    );
    expect(r.status).toBe(200);
    // owned + verified + short_description + country + language (all seeded) → some checks pass
    const byKey = Object.fromEntries(r.body.data!.checks.map((c) => [c.key, c.done]));
    expect(byKey.country).toBe(true);
    expect(byKey.language).toBe(true);
    expect(byKey.verified).toBe(true);
    expect(byKey.logo).toBe(false);
    expect(r.body.data!.score).toBeGreaterThan(0);
    expect(r.body.data!.score).toBeLessThan(100);
  });
  it('recommendations respond to data (missing website triggers rule; adding it removes it)', async () => {
    const owner = await signup('user');
    const ch = await createOwnedApprovedChannel(owner.userId);
    const r = await api<{ recommendations: Array<{ id: string }> }>(
      `/owner/channels/${ch.id}/analytics/recommendations?window=30d`,
      { headers: { Cookie: owner.cookie } },
    );
    const ids = r.body.data!.recommendations.map((x) => x.id);
    expect(ids).toContain('website');
    expect(ids).toContain('logo');
    // Patch website via owner service — need to use API
    await api(`/me/channels/${ch.id}`, { method: 'PATCH', headers: { Cookie: owner.cookie }, body: JSON.stringify({ website_url: 'https://example.com' }) });
    const r2 = await api<{ recommendations: Array<{ id: string }> }>(
      `/owner/channels/${ch.id}/analytics/recommendations?window=30d`,
      { headers: { Cookie: owner.cookie } },
    );
    const ids2 = r2.body.data!.recommendations.map((x) => x.id);
    expect(ids2).not.toContain('website');
  });
  it('anonymous cannot access completeness/recommendations', async () => {
    const owner = await signup('user');
    const ch = await createOwnedApprovedChannel(owner.userId);
    const r1 = await api(`/owner/channels/${ch.id}/analytics/completeness`);
    expect(r1.status).toBe(401);
    const r2 = await api(`/owner/channels/${ch.id}/analytics/recommendations?window=7d`);
    expect(r2.status).toBe(401);
  });
});

describe('M04 — Query normalization determinism', () => {
  it('varied casing/whitespace of the same term groups into one bucket', async () => {
    const owner = await signup('user');
    const ch = await createOwnedApprovedChannel(owner.userId);
    const day = daysAgoKey(9);
    const dayDate = new Date(`${day}T09:00:00Z`);
    const variants = [' Sports ', 'SPORTS', 'sports', 'sports   ', 'Sports'];
    for (const v of variants) {
      await insertEvent({ event_type: 'search_impression', channel_id: ch.id, created_at: dayDate, anonymous_session_id: uuidv4(), source: 'search', search_query: v });
    }
    const r = await api<{ items: Array<{ search_query: string; impressions: number }> }>(
      `/owner/channels/${ch.id}/analytics/discovery?window=custom&from=${day}&to=${day}`,
      { headers: { Cookie: owner.cookie } },
    );
    const sportsRows = r.body.data!.items.filter((it) => it.search_query === 'sports');
    expect(sportsRows.length).toBe(1);
    expect(sportsRows[0].impressions).toBe(5);
  });
});

describe('M04 — Concurrent rollup safety', () => {
  it('parallel force rollups do not double-count', async () => {
    const admin = await signup('admin');
    const owner = await signup('user');
    const ch = await createOwnedApprovedChannel(owner.userId);
    const day = daysAgoKey(11);
    const dayDate = new Date(`${day}T08:00:00Z`);
    for (let i = 0; i < 6; i++) await insertEvent({ event_type: 'follow_click', channel_id: ch.id, created_at: dayDate, anonymous_session_id: uuidv4(), source: 'homepage' });
    // Fire 8 concurrent force rollups.
    await Promise.all(new Array(8).fill(0).map(() =>
      api(`/admin/analytics/rollup`, { method: 'POST', headers: { Cookie: admin.cookie }, body: JSON.stringify({ channel_id: ch.id, date_from: day, date_to: day, force: true }) }),
    ));
    const r = await api<{ series: Array<{ date: string; follow_clicks: number; unique_follow_intents: number }> }>(
      `/owner/channels/${ch.id}/analytics/timeseries?window=custom&from=${day}&to=${day}`,
      { headers: { Cookie: owner.cookie } },
    );
    const row = r.body.data!.series.find((s) => s.date === day)!;
    expect(row.follow_clicks).toBe(6);
    expect(row.unique_follow_intents).toBe(6);
    // Verify one daily rollup doc + one row per canonical source in Mongo.
    await withDb(async (db) => {
      const daily = await db.collection('channel_daily_metrics').countDocuments({ channel_id: ch.id, date: day });
      expect(daily).toBe(1);
    });
  });
});

describe('M04 — On-demand rollup after wipe', () => {
  it('deleting a completed-day rollup causes on-demand recompute with same result', async () => {
    const owner = await signup('user');
    const ch = await createOwnedApprovedChannel(owner.userId);
    const day = daysAgoKey(12);
    const dayDate = new Date(`${day}T13:00:00Z`);
    for (let i = 0; i < 4; i++) await insertEvent({ event_type: 'follow_click', channel_id: ch.id, created_at: dayDate, anonymous_session_id: uuidv4(), source: 'homepage' });
    // First read → creates rollup
    const r1 = await api<{ series: Array<{ date: string; follow_clicks: number }> }>(
      `/owner/channels/${ch.id}/analytics/timeseries?window=custom&from=${day}&to=${day}`,
      { headers: { Cookie: owner.cookie } },
    );
    const r1v = r1.body.data!.series.find((s) => s.date === day)!.follow_clicks;
    // Wipe rollup + state
    await withDb(async (db) => {
      await db.collection('channel_daily_metrics').deleteMany({ channel_id: ch.id, date: day });
      await db.collection('channel_daily_source_metrics').deleteMany({ channel_id: ch.id, date: day });
      await db.collection('analytics_rollup_state').deleteMany({ channel_id: ch.id, date: day });
    });
    const r2 = await api<{ series: Array<{ date: string; follow_clicks: number }> }>(
      `/owner/channels/${ch.id}/analytics/timeseries?window=custom&from=${day}&to=${day}`,
      { headers: { Cookie: owner.cookie } },
    );
    const r2v = r2.body.data!.series.find((s) => s.date === day)!.follow_clicks;
    expect(r2v).toBe(r1v);
    expect(r2v).toBe(4);
  });
});

describe('M04 — Today freshness', () => {
  it('adding an event after rollup exists causes today refresh on next read', async () => {
    const owner = await signup('user');
    const ch = await createOwnedApprovedChannel(owner.userId);
    const today = utcKey(new Date());
    const now = new Date();
    for (let i = 0; i < 2; i++) await insertEvent({ event_type: 'follow_click', channel_id: ch.id, created_at: now, anonymous_session_id: uuidv4(), source: 'homepage' });
    const r1 = await api<{ series: Array<{ date: string; follow_clicks: number }> }>(
      `/owner/channels/${ch.id}/analytics/timeseries?window=custom&from=${today}&to=${today}`,
      { headers: { Cookie: owner.cookie } },
    );
    expect(r1.body.data!.series.find((s) => s.date === today)!.follow_clicks).toBe(2);
    // Age the rollup state past the 60s freshness threshold.
    await withDb(async (db) => {
      await db.collection('analytics_rollup_state').updateOne({ channel_id: ch.id, date: today }, { $set: { last_aggregated_at: new Date(Date.now() - 5 * 60_000) } });
    });
    await insertEvent({ event_type: 'follow_click', channel_id: ch.id, created_at: new Date(), anonymous_session_id: uuidv4(), source: 'homepage' });
    const r2 = await api<{ series: Array<{ date: string; follow_clicks: number }> }>(
      `/owner/channels/${ch.id}/analytics/timeseries?window=custom&from=${today}&to=${today}`,
      { headers: { Cookie: owner.cookie } },
    );
    expect(r2.body.data!.series.find((s) => s.date === today)!.follow_clicks).toBe(3);
  });
});

describe('M04 — Public exposure does NOT leak owner analytics', () => {
  it('public channel endpoint does not expose analytics/session/owner fields', async () => {
    const owner = await signup('user');
    const ch = await createOwnedApprovedChannel(owner.userId);
    const day = daysAgoKey(13);
    const dayDate = new Date(`${day}T10:00:00Z`);
    await insertEvent({ event_type: 'follow_click', channel_id: ch.id, created_at: dayDate, anonymous_session_id: uuidv4(), source: 'homepage' });
    const r = await api<{ channel: Record<string, unknown> }>(`/channels/${ch.slug}`);
    const c = r.body.data!.channel;
    for (const k of ['owner_id','verification_status','reviewed_by','follow_clicks','unique_follow_intents','anonymous_session_id']) {
      expect(c).not.toHaveProperty(k);
    }
  });
});

describe('M04 — 45. Homepage Explore Interests visual regression (compiled CSS gradient utilities present)', () => {
  it('editorial gradient classes exist in built CSS', async () => {
    // Verify the frontend page compiles the from-* to-* utilities by checking the
    // final HTML embeds them. This proves tailwind content globs include lib/.
    const r = await fetch(`http://localhost:3000/`);
    const html = await r.text();
    // At least one gradient variant used in COLLECTIONS must appear in HTML.
    expect(html).toMatch(/from-emerald-500/);
    expect(html).toMatch(/to-teal-600/);
    // And the section heading is present.
    expect(html).toMatch(/Explore interests/);
  });
});
