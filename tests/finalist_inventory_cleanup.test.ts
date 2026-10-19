// WaveLead — Finalist Readiness: production inventory cleanup & real channel
// discovery.
//
// Contract under test: the canonical public-visibility policy in
// lib/services/publicChannelVisibility.ts is (a) evidence-based, (b) applied
// consistently by EVERY public surface, and (c) purely a visibility
// projection — it never mutates moderation state, ownership state or
// follower observations.
//
// Fixtures created here are namespaced by RUN_TAG and removed in afterAll.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MongoClient } from 'mongodb';
import { v4 as uuidv4 } from 'uuid';
import {
  buildPublicChannelFilter,
  isChannelPublicallyVisible,
  isObviousPublicFixtureSlug,
  publicVisibilitySuppressionReason,
  PUBLIC_CHANNEL_EXCLUSION_CLAUSES,
} from '@/lib/services/publicChannelVisibility';

const BASE = 'http://localhost:3000/api';
const ORIGIN = 'http://localhost:3000';
const CLIENT_IP = `10.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;
const RUN_TAG = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
const MARK = `fir${RUN_TAG}`; // appears in slug/name so we can clean up precisely

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
    whatsapp_channel_id: `fir_${id.replace(/-/g, '').slice(0, 20)}`,
    description: 'Finalist readiness regression fixture for inventory cleanup.',
    short_description: 'Finalist readiness regression fixture.',
    logo_url: null, cover_url: null, website_url: null,
    country_code: 'ID', primary_language: 'id', category_id: null,
    owner_id: null, status: 'approved', verification_status: 'unverified',
    is_official: false, is_featured: false, is_nsfw: false,
    is_demo: false, activity_level: 'active',
    follower_count: 4321, follower_count_source: 'submitter',
    follower_count_updated_at: new Date(),
    created_at: new Date(), updated_at: new Date(), published_at: new Date(),
    ...overrides,
  };
  await withDb(async (db) => { await db.collection('channels').insertOne(doc); });
  return { id, slug, name };
}

// ---- seeded records -------------------------------------------------------
let legit: Seeded;          // real, approved, non-verified → MUST be public
let demoRec: Seeded;        // is_demo:true                 → MUST be hidden
let qaGenerated: Seeded;    // b2-ch-<8hex>                 → MUST be hidden
let seedUrlRec: Seeded;     // whatsapp.com/channel/demo-…  → MUST be hidden
let demoSourceRec: Seeded;  // follower_count_source demo_seed → MUST be hidden
let pendingRec: Seeded;     // pending_review               → MUST be hidden
let rejectedRec: Seeded;    // rejected                     → MUST be hidden

beforeAll(async () => {
  legit = await insertChannel({ slug: `kopi-senja-${MARK}`, name: `Kopi Senja ${MARK}` });
  demoRec = await insertChannel({ slug: `nusantara-demo-${MARK}`, name: `Nusantara Demo ${MARK}`, is_demo: true });
  qaGenerated = await insertChannel({ slug: 'b2-ch-0000ffee', name: `LoadFixture ${MARK}` });
  seedUrlRec = await insertChannel({
    slug: `seedurl-${MARK}`, name: `SeedUrl ${MARK}`,
    whatsapp_url: `https://whatsapp.com/channel/demo-seedurl-${MARK}`,
  });
  demoSourceRec = await insertChannel({
    slug: `demosource-${MARK}`, name: `DemoSource ${MARK}`, follower_count_source: 'demo_seed',
  });
  pendingRec = await insertChannel({ slug: `pendingreal-${MARK}`, name: `PendingReal ${MARK}`, status: 'pending_review' });
  rejectedRec = await insertChannel({ slug: `rejectedreal-${MARK}`, name: `RejectedReal ${MARK}`, status: 'rejected' });
});

afterAll(async () => {
  await withDb(async (db) => {
    await db.collection('channels').deleteMany({ slug: new RegExp(MARK) });
    await db.collection('channels').deleteMany({ name: new RegExp(MARK) });
  });
});

// ===========================================================================
// 1. POLICY UNIT CONTRACT
// ===========================================================================
describe('finalist — visibility policy unit contract', () => {
  it('classifies every demo/fixture evidence family with a named reason', () => {
    expect(publicVisibilitySuppressionReason({ slug: 'a', name: 'A', is_test_fixture: true })).toBe('is_test_fixture');
    expect(publicVisibilitySuppressionReason({ slug: 'a', name: 'A', is_demo: true })).toBe('is_demo');
    expect(publicVisibilitySuppressionReason({ slug: 'b2-ch-733f3c48', name: 'u1' })).toBe('qa_generated_slug');
    expect(publicVisibilitySuppressionReason({ slug: 'gb-ch-d6dcb853', name: 'nfin' })).toBe('qa_generated_slug');
    expect(publicVisibilitySuppressionReason({ slug: 'gc-ch-43d7425b', name: 'r1' })).toBe('qa_generated_slug');
    expect(publicVisibilitySuppressionReason({ slug: 'ut-ch-2b7fbc23', name: 'a1' })).toBe('qa_generated_slug');
    expect(publicVisibilitySuppressionReason({ slug: 'b2brs-9be2de2b', name: 'B2BRS' })).toBe('qa_generated_slug');
    expect(publicVisibilitySuppressionReason({ slug: 'b21-smoke-9ec71d96', name: 'B2.1' })).toBe('qa_generated_slug');
    expect(publicVisibilitySuppressionReason({ slug: 'smoke-ch-m06p3', name: 'M06' })).toBe('ops_fixture_slug');
    expect(publicVisibilitySuppressionReason({ slug: 'hardening-1788290699', name: 'H' })).toBe('ops_fixture_slug');
    expect(publicVisibilitySuppressionReason({ slug: 'qa-verified-channel', name: 'QA' })).toBe('ops_fixture_slug');
    expect(publicVisibilitySuppressionReason({ slug: 'test-legacy-1', name: 'Legacy' })).toBe('legacy_fixture_slug');
    expect(publicVisibilitySuppressionReason({ slug: 'nameonly-1', name: 'Test Legacy Name' })).toBe('legacy_fixture_name');
    expect(publicVisibilitySuppressionReason({ slug: 'x', name: 'X', whatsapp_url: 'https://whatsapp.com/channel/demo-x-1' })).toBe('seed_whatsapp_url');
    expect(publicVisibilitySuppressionReason({ slug: 'x', name: 'X', follower_count_source: 'demo_seed' })).toBe('non_public_follower_source');
  });

  it('does NOT false-positive on organic slugs that merely look similar', () => {
    const organic = [
      { slug: 'b2b-marketing-tips', name: 'B2B Marketing Tips' },
      { slug: 'gb-chess-club', name: 'GB Chess Club' },
      { slug: 'qatar-news-daily', name: 'Qatar News Daily' },
      { slug: 'smokey-bbq-recipes', name: 'Smokey BBQ Recipes' },
      { slug: 'testimoni-pelanggan', name: 'Testimoni Pelanggan' },
      { slug: 'bali-united-fc', name: 'Bali United FC' },
      { slug: 'tiara-andini', name: 'Tiara Andini' },
      { slug: 'b2-channel-review', name: 'B2 Channel Review' },
    ];
    for (const c of organic) {
      expect({ slug: c.slug, reason: publicVisibilitySuppressionReason(c) }).toEqual({ slug: c.slug, reason: null });
      expect(isChannelPublicallyVisible(c)).toBe(true);
      expect(isObviousPublicFixtureSlug(c.slug)).toBe(false);
    }
  });

  it('keeps "seed" and "test" follower sources publicly eligible (legacy legit rows)', () => {
    expect(publicVisibilitySuppressionReason({ slug: 'organic-x', name: 'Organic X', follower_count_source: 'seed' })).toBeNull();
    expect(publicVisibilitySuppressionReason({ slug: 'organic-y', name: 'Organic Y', follower_count_source: 'test' })).toBeNull();
  });

  it('buildPublicChannelFilter preserves caller $and / $or and appends every clause', () => {
    const f = buildPublicChannelFilter({
      status: 'approved',
      $or: [{ name: /x/i }],
      $and: [{ country_code: 'ID' }],
    });
    expect(f.status).toBe('approved');
    expect(Array.isArray(f.$or)).toBe(true);
    const and = f.$and as Record<string, unknown>[];
    expect(and[0]).toEqual({ country_code: 'ID' });
    expect(and).toHaveLength(1 + PUBLIC_CHANNEL_EXCLUSION_CLAUSES.length);
  });

  it('in-memory predicate mirrors the Mongo clause set (same row count)', async () => {
    const dbRows = await withDb(async (db) =>
      db.collection('channels').find(buildPublicChannelFilter({ status: 'approved' }) as never)
        .project({ slug: 1, name: 1, is_demo: 1, is_test_fixture: 1, whatsapp_url: 1, follower_count_source: 1 })
        .toArray());
    for (const r of dbRows) {
      expect({ slug: r.slug, visible: isChannelPublicallyVisible(r as never) })
        .toEqual({ slug: r.slug, visible: true });
    }
  });
});

// ===========================================================================
// 2. PUBLIC SURFACE CONSISTENCY
// ===========================================================================
describe('finalist — public surfaces hide demo inventory and show real inventory', () => {
  it('real approved submitted channel IS publicly discoverable', async () => {
    const list = await api<{ items: Array<{ slug: string }> }>(`/channels?limit=60&q=${MARK}`);
    expect(list.status).toBe(200);
    expect((list.body.data?.items || []).some((i) => i.slug === legit.slug)).toBe(true);

    const direct = await api<{ channel: { slug: string } }>(`/channels/${legit.slug}`);
    expect(direct.status).toBe(200);
    expect(direct.body.data?.channel.slug).toBe(legit.slug);
  });

  const hidden = () => [demoRec, qaGenerated, seedUrlRec, demoSourceRec, pendingRec, rejectedRec];

  it('demo / QA / restricted records are absent from BROWSE', async () => {
    const list = await api<{ items: Array<{ slug: string }> }>(`/channels?limit=60&q=${MARK}`);
    const slugs = (list.body.data?.items || []).map((i) => i.slug);
    for (const h of hidden()) expect({ slug: h.slug, present: slugs.includes(h.slug) }).toEqual({ slug: h.slug, present: false });
  });

  it('demo / QA / restricted records are absent from SEARCH', async () => {
    const r = await api<{ items: Array<{ slug: string }> }>(`/channels?q=${encodeURIComponent(MARK)}&limit=60`);
    const slugs = (r.body.data?.items || []).map((i) => i.slug);
    for (const h of hidden()) expect({ slug: h.slug, present: slugs.includes(h.slug) }).toEqual({ slug: h.slug, present: false });
  });

  it('direct public URL / API cannot bypass visibility filtering (404 each)', async () => {
    for (const h of hidden()) {
      const r = await api(`/channels/${h.slug}`);
      expect({ slug: h.slug, status: r.status }).toEqual({ slug: h.slug, status: 404 });
    }
  });

  it('TOP surface applies the canonical policy (regression: used to use a raw filter)', async () => {
    const r = await api<{ items: Array<{ slug: string }> }>(`/channels/top?country=ID&limit=50`);
    expect(r.status).toBe(200);
    const slugs = (r.body.data?.items || []).map((i) => i.slug);
    for (const h of hidden()) expect({ slug: h.slug, present: slugs.includes(h.slug) }).toEqual({ slug: h.slug, present: false });
  });

  it('RISING / trending surface applies the canonical policy', async () => {
    const r = await api<{ items: Array<{ slug: string }> }>(`/channels/rising?limit=24`);
    expect(r.status).toBe(200);
    const slugs = (r.body.data?.items || []).map((i) => i.slug);
    for (const h of hidden()) expect({ slug: h.slug, present: slugs.includes(h.slug) }).toEqual({ slug: h.slug, present: false });
  });

  it('COUNTRY-scoped inventory uses the same eligible set', async () => {
    const r = await api<{ items: Array<{ slug: string }> }>(`/channels?country=ID&limit=60&q=${MARK}`);
    const slugs = (r.body.data?.items || []).map((i) => i.slug);
    expect(slugs).toContain(legit.slug);
    for (const h of hidden()) expect({ slug: h.slug, present: slugs.includes(h.slug) }).toEqual({ slug: h.slug, present: false });
  });

  it('homepage bundle counts never include demo inventory', async () => {
    const r = await api<{ stats: { totalApproved: number }; popular: Array<{ slug: string }>; topIndonesia: Array<{ slug: string }> }>('/discovery/home');
    expect(r.status).toBe(200);
    const total = r.body.data?.stats.totalApproved ?? -1;
    const dbTotal = await withDb(async (db) =>
      db.collection('channels').countDocuments(buildPublicChannelFilter({ status: 'approved' }) as never));
    expect(total).toBe(dbTotal);
    // No suppressed record may appear in any homepage section.
    const homeSlugs = [
      ...(r.body.data?.popular || []).map((i) => i.slug),
      ...(r.body.data?.topIndonesia || []).map((i) => i.slug),
    ];
    for (const h of hidden()) expect({ slug: h.slug, present: homeSlugs.includes(h.slug) })
      .toEqual({ slug: h.slug, present: false });
  });

  it('SITEMAP excludes hidden demonstration records and includes the real one', async () => {
    const res = await fetch(`${ORIGIN}/sitemap.xml`);
    expect(res.status).toBe(200);
    const xml = await res.text();
    expect(xml).toContain(`/channel/${legit.slug}`);
    for (const h of hidden()) expect({ slug: h.slug, inSitemap: xml.includes(`/channel/${h.slug}`) })
      .toEqual({ slug: h.slug, inSitemap: false });
  });
});

// ===========================================================================
// 3. DATA INTEGRITY — the policy must not mutate anything
// ===========================================================================
describe('finalist — data integrity (visibility projection only)', () => {
  it('non-verified approved channel is never labelled verified', async () => {
    const r = await api<{ channel: { is_verified: boolean; is_official: boolean; has_owner: boolean } }>(`/channels/${legit.slug}`);
    expect(r.status).toBe(200);
    expect(r.body.data?.channel.is_verified).toBe(false);
    expect(r.body.data?.channel.is_official).toBe(false);
    expect(r.body.data?.channel.has_owner).toBe(false);
  });

  it('public response never leaks internal provenance markers', async () => {
    const r = await api<{ channel: Record<string, unknown> }>(`/channels/${legit.slug}`);
    for (const k of ['is_test_fixture', 'owner_id', 'verification_status', 'reviewed_by', 'rejection_reason']) {
      expect({ k, has: Object.prototype.hasOwnProperty.call(r.body.data?.channel || {}, k) }).toEqual({ k, has: false });
    }
  });

  it('no fabricated follower numbers: reported count equals the stored observation', async () => {
    const r = await api<{ channel: { follower_count: number } }>(`/channels/${legit.slug}`);
    const stored = await withDb(async (db) => db.collection('channels').findOne({ id: legit.id }));
    expect(r.body.data?.channel.follower_count).toBe(4321);
    expect(stored?.follower_count).toBe(4321);
    expect(stored?.follower_count_source).toBe('submitter');
  });

  it('suppressed records are preserved untouched in the database', async () => {
    for (const h of [demoRec, qaGenerated, seedUrlRec, demoSourceRec, pendingRec, rejectedRec]) {
      const row = await withDb(async (db) => db.collection('channels').findOne({ id: h.id }));
      expect({ slug: h.slug, exists: !!row }).toEqual({ slug: h.slug, exists: true });
    }
    // Moderation + ownership state untouched by the visibility layer.
    const pend = await withDb(async (db) => db.collection('channels').findOne({ id: pendingRec.id }));
    expect(pend?.status).toBe('pending_review');
    const rej = await withDb(async (db) => db.collection('channels').findOne({ id: rejectedRec.id }));
    expect(rej?.status).toBe('rejected');
    const demo = await withDb(async (db) => db.collection('channels').findOne({ id: demoRec.id }));
    expect(demo?.status).toBe('approved');
    expect(demo?.verification_status).toBe('unverified');
  });
});
