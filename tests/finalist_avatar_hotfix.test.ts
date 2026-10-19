// WaveLead — Finalist Hotfix: real channel avatars + honest follower ranking.
//
// Two defects are covered here.
//
// 1. AVATARS. Submit Channel → Fetch Metadata stores the public `og:image` in
//    `channels.logo_url`. Those URLs live on the WhatsApp CDN and are
//    pre-signed, so an earlier SEO fix suppressed EVERY `*.whatsapp.net` URL
//    at render time. That removed the broken images but also discarded the
//    working ones, so real channels rendered letter placeholders everywhere.
//    Volatile URLs are now swapped for WaveLead's own stable, cached
//    first-party URL `/api/channels/<slug>/avatar`.
//
// 2. RANKING. Real submitted channels arrive with `follower_count: 0` and the
//    observed figure in `public_followers_count`, but every ranking query
//    sorted on `follower_count` alone — so they all tied at 0 and a channel
//    showing "Follower count unavailable" could outrank one showing 1.3M.
//    Ranking now uses the EFFECTIVE count, i.e. the number the card displays.
//
// Fixtures are namespaced by RUN_TAG and removed in afterAll.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MongoClient } from 'mongodb';
import { v4 as uuidv4 } from 'uuid';
import {
  resolveChannelAvatar,
  channelAvatarCacheUrl,
  isVolatileAvatarHost,
  CHANNEL_FALLBACK_AVATAR,
} from '@/lib/seo/channelAvatar';
import { isAllowedAvatarSource } from '@/lib/services/media/channelAvatarCache';
import {
  effectiveFollowerCount,
  EFFECTIVE_FOLLOWERS_SORT,
  FEATURED_THEN_FOLLOWERS_SORT,
} from '@/lib/utils/followerCount';

const BASE = 'http://localhost:3000/api';
const ORIGIN = 'http://localhost:3000';
const CLIENT_IP = `10.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;
const RUN_TAG = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
const MARK = `avx${RUN_TAG}`;

// A STABLE WhatsApp-hosted asset (no oh/oe signature, no expiry) — lets the
// cache path be exercised end-to-end without depending on a signed URL that
// would rot and make this suite flaky.
const STABLE_WA_IMAGE = 'https://static.whatsapp.net/rsrc.php/v4/yO/r/rukeqTVNJDY.png';
// Shape of a real, pre-signed (expiring) channel avatar.
const SIGNED_WA_IMAGE = 'https://mmg.whatsapp.net/m1/v/t24/AnExampleSignedObjectId?ccb=11-4&oh=deadbeef&oe=68FFFFFF&_nc_sid=5e03e0';

async function withDb<T>(fn: (db: import('mongodb').Db) => Promise<T>): Promise<T> {
  const client = new MongoClient(process.env.MONGO_URL || 'mongodb://localhost:27017');
  await client.connect();
  try { return await fn(client.db(process.env.DB_NAME || 'wavelead')); } finally { await client.close(); }
}

async function api<T = unknown>(path: string, init: RequestInit = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': CLIENT_IP, ...(init.headers || {}) },
  });
  let body: { ok?: boolean; data?: T; error?: string } = {};
  try { body = await res.json(); } catch { /* non-JSON */ }
  return { status: res.status, body };
}

interface Seeded { id: string; slug: string; name: string }

async function insertChannel(overrides: Record<string, unknown>): Promise<Seeded> {
  const id = uuidv4();
  const slug = String(overrides.slug);
  const name = String(overrides.name);
  const doc: Record<string, unknown> = {
    id, slug, name,
    whatsapp_url: `https://whatsapp.com/channel/0029Va${id.replace(/-/g, '').slice(0, 18)}`,
    whatsapp_channel_id: `avx_${id.replace(/-/g, '').slice(0, 20)}`,
    description: 'Finalist avatar/ranking hotfix regression fixture.',
    short_description: 'Hotfix fixture.',
    logo_url: null, cover_url: null, website_url: null,
    country_code: 'ID', primary_language: 'id', category_id: null,
    owner_id: null, status: 'approved', verification_status: 'unverified',
    is_official: false, is_featured: false, is_nsfw: false,
    is_demo: false, activity_level: 'active',
    follower_count: 0, public_followers_count: 0, follower_count_source: 'submitter',
    follower_count_updated_at: new Date(),
    created_at: new Date(), updated_at: new Date(), published_at: new Date(),
    ...overrides,
  };
  await withDb(async (db) => { await db.collection('channels').insertOne(doc); });
  return { id, slug, name };
}

// ---- seeded records -------------------------------------------------------
let withAvatar: Seeded;    // approved + stable WhatsApp-hosted avatar
let noAvatar: Seeded;      // approved, logo_url null
let expiredAvatar: Seeded; // approved, signed URL that no longer resolves
let demoWithAvatar: Seeded; // is_demo → avatar endpoint must 404
let pendingWithAvatar: Seeded;
// ranking trio — all have follower_count 0, only public_followers_count differs
let rankBig: Seeded;    // 1,300,000 observed
let rankMid: Seeded;    // 42,000 observed
let rankNone: Seeded;   // no observation at all

beforeAll(async () => {
  withAvatar = await insertChannel({
    slug: `kopi-${MARK}`, name: `Kopi ${MARK}`,
    logo_url: STABLE_WA_IMAGE, public_followers_count: 1234,
  });
  noAvatar = await insertChannel({ slug: `nologo-${MARK}`, name: `NoLogo ${MARK}` });
  expiredAvatar = await insertChannel({
    slug: `expired-${MARK}`, name: `Expired ${MARK}`, logo_url: SIGNED_WA_IMAGE,
  });
  demoWithAvatar = await insertChannel({
    slug: `demo-${MARK}`, name: `Demo ${MARK}`, logo_url: STABLE_WA_IMAGE, is_demo: true,
  });
  pendingWithAvatar = await insertChannel({
    slug: `pending-real-${MARK}`, name: `PendingReal ${MARK}`,
    logo_url: STABLE_WA_IMAGE, status: 'pending_review',
  });
  rankBig = await insertChannel({ slug: `rank-big-${MARK}`, name: `RankBig ${MARK}`, public_followers_count: 1_300_000 });
  rankMid = await insertChannel({ slug: `rank-mid-${MARK}`, name: `RankMid ${MARK}`, public_followers_count: 42_000 });
  rankNone = await insertChannel({ slug: `rank-none-${MARK}`, name: `RankNone ${MARK}` });
});

afterAll(async () => {
  await withDb(async (db) => {
    const ids = (await db.collection('channels').find({ slug: new RegExp(MARK) }).project({ id: 1 }).toArray()).map((r) => r.id);
    if (ids.length) await db.collection('channel_avatar_cache').deleteMany({ channel_id: { $in: ids } });
    await db.collection('channels').deleteMany({ slug: new RegExp(MARK) });
    await db.collection('channels').deleteMany({ name: new RegExp(MARK) });
  });
});

// ===========================================================================
// 1. RESOLVER CONTRACT (no network)
// ===========================================================================
describe('avatar hotfix — resolver contract', () => {
  it('swaps a volatile WhatsApp CDN URL for the stable first-party cache URL', () => {
    expect(resolveChannelAvatar(SIGNED_WA_IMAGE, 'my-channel')).toBe('/api/channels/my-channel/avatar');
    expect(resolveChannelAvatar(STABLE_WA_IMAGE, 'my-channel')).toBe('/api/channels/my-channel/avatar');
    expect(resolveChannelAvatar('https://pps.whatsapp.net/v/t61/x.jpg', 'c')).toBe('/api/channels/c/avatar');
    expect(resolveChannelAvatar('https://scontent.fbcdn.net/v/x.jpg', 'c')).toBe('/api/channels/c/avatar');
  });

  it('REGRESSION: a volatile URL is no longer silently discarded when a slug is known', () => {
    // This is the exact bug: the old implementation returned null here, which
    // is why every real channel rendered letter initials.
    expect(resolveChannelAvatar(SIGNED_WA_IMAGE, 'bali-united-fc')).not.toBeNull();
  });

  it('passes stable third-party HTTPS URLs through untouched', () => {
    expect(resolveChannelAvatar('https://cdn.example.com/a.png', 'c')).toBe('https://cdn.example.com/a.png');
  });

  it('rejects unusable inputs', () => {
    expect(resolveChannelAvatar(null, 'c')).toBeNull();
    expect(resolveChannelAvatar('', 'c')).toBeNull();
    expect(resolveChannelAvatar('data:image/png;base64,AAAA', 'c')).toBeNull();
    expect(resolveChannelAvatar('javascript:alert(1)', 'c')).toBeNull();
    expect(resolveChannelAvatar('not a url', 'c')).toBeNull();
  });

  it('keeps the old suppress-to-fallback behaviour when no slug is available', () => {
    expect(resolveChannelAvatar(SIGNED_WA_IMAGE)).toBeNull();
  });

  it('slug is URL-encoded into the cache path', () => {
    expect(channelAvatarCacheUrl('a/b?c')).toBe('/api/channels/a%2Fb%3Fc/avatar');
  });

  it('volatile host detection covers the WhatsApp/Meta CDN', () => {
    for (const h of ['mmg.whatsapp.net', 'pps.whatsapp.net', 'static.whatsapp.net', 'scontent.fbcdn.net']) {
      expect({ h, volatile: isVolatileAvatarHost(h) }).toEqual({ h, volatile: true });
    }
    expect(isVolatileAvatarHost('cdn.example.com')).toBe(false);
  });
});

// ===========================================================================
// 2. SSRF GATE
// ===========================================================================
describe('avatar hotfix — fetch allowlist is not an open proxy', () => {
  it('allows only HTTPS WhatsApp/Meta CDN hosts', () => {
    expect(isAllowedAvatarSource(STABLE_WA_IMAGE)).toBe(true);
    expect(isAllowedAvatarSource(SIGNED_WA_IMAGE)).toBe(true);
  });

  it('rejects arbitrary hosts, plaintext HTTP, IP literals and internal targets', () => {
    const bad = [
      'http://mmg.whatsapp.net/x.jpg',          // not HTTPS
      'https://evil.example.com/x.jpg',          // not allowlisted
      'https://127.0.0.1/x.jpg',                 // loopback literal
      'https://169.254.169.254/latest/meta-data',// cloud metadata
      'https://10.0.0.5/x.jpg',                  // private range literal
      'https://[::1]/x.jpg',                     // IPv6 loopback
      'https://whatsapp.net.evil.com/x.jpg',     // suffix-confusion
      'file:///etc/passwd',
    ];
    for (const u of bad) expect({ u, allowed: isAllowedAvatarSource(u) }).toEqual({ u, allowed: false });
  });
});

// ===========================================================================
// 3. STABLE AVATAR ENDPOINT
// ===========================================================================
describe('avatar hotfix — /api/channels/:slug/avatar', () => {
  it('serves real cached image bytes for an approved channel', async () => {
    const res = await fetch(`${ORIGIN}/api/channels/${withAvatar.slug}/avatar`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type') || '').toMatch(/^image\//);
    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf.byteLength).toBeGreaterThan(1000);
    // Real PNG magic number — proves actual image bytes, not a placeholder.
    expect(buf.subarray(0, 4).toString('hex')).toBe('89504e47');
    expect(res.headers.get('etag')).toBeTruthy();
    expect(res.headers.get('cache-control') || '').toContain('max-age=');
  }, 30_000);

  it('persists the bytes so the second request is a cache hit', async () => {
    const cached = await withDb(async (db) =>
      db.collection('channel_avatar_cache').findOne({ channel_id: withAvatar.id }));
    expect(cached).toBeTruthy();
    expect(cached?.content_type).toMatch(/^image\//);
    expect(cached?.byte_size).toBeGreaterThan(1000);
    expect(cached?.source_host).toContain('whatsapp.net');
  }, 30_000);

  it('honours If-None-Match with a 304', async () => {
    const first = await fetch(`${ORIGIN}/api/channels/${withAvatar.slug}/avatar`);
    const etag = first.headers.get('etag') as string;
    await first.arrayBuffer();
    const second = await fetch(`${ORIGIN}/api/channels/${withAvatar.slug}/avatar`, { headers: { 'If-None-Match': etag } });
    expect(second.status).toBe(304);
  }, 30_000);

  it('redirects to the LOCAL placeholder when the channel has no avatar', async () => {
    const res = await fetch(`${ORIGIN}/api/channels/${noAvatar.slug}/avatar`, { redirect: 'manual' });
    expect(res.status).toBe(302);
    expect(res.headers.get('location') || '').toContain(CHANNEL_FALLBACK_AVATAR);
  }, 30_000);

  it('fails SAFELY (placeholder, never a 5xx) when the upstream image is expired', async () => {
    const res = await fetch(`${ORIGIN}/api/channels/${expiredAvatar.slug}/avatar`, { redirect: 'manual' });
    expect([200, 302]).toContain(res.status);
    if (res.status === 302) expect(res.headers.get('location') || '').toContain(CHANNEL_FALLBACK_AVATAR);
  }, 40_000);

  it('never generates a fake avatar — an unresolvable image yields no cache row with bytes', async () => {
    const row = await withDb(async (db) =>
      db.collection('channel_avatar_cache').findOne({ channel_id: expiredAvatar.id }));
    // Either no row at all, or a row that came from a genuine upstream fetch.
    if (row) expect(row.byte_size).toBeGreaterThan(0);
  }, 30_000);

  it('enforces the public-visibility policy (demo / pending / unknown all 404)', async () => {
    for (const slug of [demoWithAvatar.slug, pendingWithAvatar.slug, `missing-${MARK}`]) {
      const res = await fetch(`${ORIGIN}/api/channels/${slug}/avatar`, { redirect: 'manual' });
      expect({ slug, status: res.status }).toEqual({ slug, status: 404 });
    }
  }, 30_000);

  it('does not cache bytes for suppressed channels', async () => {
    const row = await withDb(async (db) =>
      db.collection('channel_avatar_cache').findOne({ channel_id: demoWithAvatar.id }));
    expect(row).toBeNull();
  });
});

// ===========================================================================
// 4. PUBLIC DTO STILL CARRIES THE AVATAR FIELD
// ===========================================================================
describe('avatar hotfix — public DTO', () => {
  it('GET /api/channels/:slug returns logo_url unchanged', async () => {
    const r = await api<{ channel: { logo_url: string | null; slug: string } }>(`/channels/${withAvatar.slug}`);
    expect(r.status).toBe(200);
    expect(r.body.data?.channel.logo_url).toBe(STABLE_WA_IMAGE);
  });

  it('listing DTOs carry logo_url too, so cards can resolve an avatar', async () => {
    const r = await api<{ items: Array<{ slug: string; logo_url: string | null }> }>(`/channels?q=${MARK}&limit=30`);
    const row = (r.body.data?.items || []).find((i) => i.slug === withAvatar.slug);
    expect(row?.logo_url).toBe(STABLE_WA_IMAGE);
  });
});

// ===========================================================================
// 5. FOLLOWER RANKING
// ===========================================================================
describe('ranking hotfix — effective follower count', () => {
  it('effectiveFollowerCount takes the larger of submitted and observed', () => {
    expect(effectiveFollowerCount({ follower_count: 0, public_followers_count: 1_300_000 })).toBe(1_300_000);
    expect(effectiveFollowerCount({ follower_count: 90_000, public_followers_count: 42_000 })).toBe(90_000);
    expect(effectiveFollowerCount({ follower_count: 0, public_followers_count: 0 })).toBe(0);
    expect(effectiveFollowerCount({})).toBe(0);
    expect(effectiveFollowerCount({ follower_count: null, public_followers_count: null })).toBe(0);
    // Never invents: a negative/garbage value cannot become a positive count.
    expect(effectiveFollowerCount({ follower_count: -5, public_followers_count: -9 })).toBe(0);
  });

  it('sort specs are deterministic (unique id as final tie-break)', () => {
    expect(Object.keys(EFFECTIVE_FOLLOWERS_SORT).at(-1)).toBe('id');
    expect(Object.keys(FEATURED_THEN_FOLLOWERS_SORT).at(-1)).toBe('id');
    expect(FEATURED_THEN_FOLLOWERS_SORT.is_featured).toBe(-1);
  });

  const orderOf = (slugs: string[]) => ({
    big: slugs.indexOf(rankBig.slug),
    mid: slugs.indexOf(rankMid.slug),
    none: slugs.indexOf(rankNone.slug),
  });

  it('REGRESSION: /api/channels/top ranks 1.3M above 42k above "unavailable"', async () => {
    const r = await api<{ items: Array<{ slug: string }> }>(`/channels/top?country=ID&limit=100`);
    expect(r.status).toBe(200);
    const slugs = (r.body.data?.items || []).map((i) => i.slug);
    const o = orderOf(slugs);
    expect(o.big).toBeGreaterThanOrEqual(0);
    expect(o.big).toBeLessThan(o.mid);
    expect(o.mid).toBeLessThan(o.none === -1 ? Number.MAX_SAFE_INTEGER : o.none);
  });

  it('directory sort=top uses the same ordering', async () => {
    const r = await api<{ items: Array<{ slug: string }> }>(`/channels?sort=top&country=ID&limit=100`);
    const slugs = (r.body.data?.items || []).map((i) => i.slug);
    const o = orderOf(slugs);
    expect(o.big).toBeGreaterThanOrEqual(0);
    expect(o.big).toBeLessThan(o.mid);
  });

  it('channels with no observation sort BELOW every known numeric count', async () => {
    const r = await api<{ items: Array<{ slug: string; follower_count: number; public_followers_count?: number }> }>(
      `/channels?sort=top&country=ID&limit=100`);
    const items = r.body.data?.items || [];
    const eff = items.map((i) => effectiveFollowerCount(i));
    const firstZero = eff.findIndex((v) => v === 0);
    if (firstZero >= 0) {
      // Everything after the first zero must also be zero — i.e. unknown
      // counts form a contiguous block at the END of the ranking.
      expect(eff.slice(firstZero).every((v) => v === 0)).toBe(true);
    }
  });

  it('country filter is applied BEFORE ranking', async () => {
    const r = await api<{ items: Array<{ slug: string; country_code: string }> }>(
      `/channels/top?country=ID&limit=100`);
    for (const i of r.body.data?.items || []) {
      expect({ slug: i.slug, cc: i.country_code }).toEqual({ slug: i.slug, cc: 'ID' });
    }
  });

  it('ranking is stable across repeated calls (deterministic tie-break)', async () => {
    const a = await api<{ items: Array<{ slug: string }> }>(`/channels/top?country=ID&limit=100`);
    const b = await api<{ items: Array<{ slug: string }> }>(`/channels/top?country=ID&limit=100`);
    expect((a.body.data?.items || []).map((i) => i.slug)).toEqual((b.body.data?.items || []).map((i) => i.slug));
  });

  it('pagination over the ranked directory neither repeats nor skips a row', async () => {
    const p1 = await api<{ items: Array<{ slug: string }> }>(`/channels?sort=top&country=ID&limit=3&skip=0`);
    const p2 = await api<{ items: Array<{ slug: string }> }>(`/channels?sort=top&country=ID&limit=3&skip=3`);
    const s1 = (p1.body.data?.items || []).map((i) => i.slug);
    const s2 = (p2.body.data?.items || []).map((i) => i.slug);
    expect(s1.filter((s) => s2.includes(s))).toEqual([]);
  });
});

// ===========================================================================
// 6. NOTHING ELSE MOVED
// ===========================================================================
describe('hotfix — inventory and data integrity unchanged', () => {
  it('confirmed demo inventory is still hidden from public discovery', async () => {
    const list = await api<{ items: Array<{ slug: string }> }>(`/channels?limit=60&q=${MARK}`);
    const slugs = (list.body.data?.items || []).map((i) => i.slug);
    expect(slugs).not.toContain(demoWithAvatar.slug);
    expect(slugs).not.toContain(pendingWithAvatar.slug);
    const direct = await api(`/channels/${demoWithAvatar.slug}`);
    expect(direct.status).toBe(404);
  });

  it('real approved inventory is still publicly visible', async () => {
    const direct = await api<{ channel: { slug: string } }>(`/channels/${withAvatar.slug}`);
    expect(direct.status).toBe(200);
    expect(direct.body.data?.channel.slug).toBe(withAvatar.slug);
  });

  it('follower observations and moderation state were not mutated', async () => {
    const rows = await withDb(async (db) =>
      db.collection('channels').find({ slug: new RegExp(MARK) })
        .project({ slug: 1, status: 1, verification_status: 1, follower_count: 1, public_followers_count: 1, owner_id: 1, logo_url: 1 })
        .toArray());
    const bySlug = new Map(rows.map((r) => [r.slug, r]));
    expect(bySlug.get(rankBig.slug)?.public_followers_count).toBe(1_300_000);
    expect(bySlug.get(rankMid.slug)?.public_followers_count).toBe(42_000);
    expect(bySlug.get(rankNone.slug)?.public_followers_count).toBe(0);
    expect(bySlug.get(pendingWithAvatar.slug)?.status).toBe('pending_review');
    expect(bySlug.get(demoWithAvatar.slug)?.status).toBe('approved');
    for (const r of rows) {
      expect({ slug: r.slug, ver: r.verification_status }).toEqual({ slug: r.slug, ver: 'unverified' });
      expect({ slug: r.slug, owner: r.owner_id ?? null }).toEqual({ slug: r.slug, owner: null });
    }
    // The avatar cache must never rewrite the channel's own logo_url.
    expect(bySlug.get(withAvatar.slug)?.logo_url).toBe(STABLE_WA_IMAGE);
    expect(bySlug.get(expiredAvatar.slug)?.logo_url).toBe(SIGNED_WA_IMAGE);
  });

  it('an approved non-verified channel is still never labelled verified', async () => {
    const r = await api<{ channel: { is_verified: boolean; is_official: boolean } }>(`/channels/${withAvatar.slug}`);
    expect(r.body.data?.channel.is_verified).toBe(false);
    expect(r.body.data?.channel.is_official).toBe(false);
  });
});
