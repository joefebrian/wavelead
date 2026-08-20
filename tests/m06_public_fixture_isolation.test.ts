// M06.1 hardening — Public Channel Visibility (fixture isolation).
//
// Regression contract for the canonical public-visibility policy defined in
// lib/services/publicChannelVisibility.ts. Verifies every public surface
// (browse, direct-lookup, search) applies the SAME rule and that legitimate
// approved channels containing incidental words like "test" are NOT hidden.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MongoClient } from 'mongodb';
import { v4 as uuidv4 } from 'uuid';

const BASE = 'http://localhost:3000/api';
const CLIENT_IP = `10.${Math.floor(Math.random()*255)}.${Math.floor(Math.random()*255)}.${Math.floor(Math.random()*255)}`;
const RUN_TAG = `${Date.now()}${Math.floor(Math.random()*1e6)}`;

async function withDb<T>(fn: (db: import('mongodb').Db) => Promise<T>): Promise<T> {
  const client = new MongoClient(process.env.MONGO_URL || 'mongodb://localhost:27017');
  await client.connect();
  try { return await fn(client.db(process.env.DB_NAME || 'wavelead')); } finally { await client.close(); }
}
async function api<T = unknown>(path: string, init: RequestInit = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'X-Forwarded-For': CLIENT_IP,
      ...(init.headers || {}),
    },
  });
  let body: { ok?: boolean; data?: T; error?: string } = {};
  try { body = await res.json(); } catch {}
  return { status: res.status, body, setCookie: res.headers.get('set-cookie') };
}

// Minimal channel fixture insert. Callers control slug/name + optional marker.
async function insertChannel(overrides: Record<string, unknown>): Promise<{ id: string; slug: string }> {
  const id = uuidv4();
  const slug = String(overrides.slug ?? `unspecified-${id.slice(0, 8)}`);
  const wcid = `pfi_${id.replace(/-/g, '').slice(0, 20)}`;
  const doc: Record<string, unknown> = {
    id, slug,
    whatsapp_url: `https://whatsapp.com/channel/${slug}`, whatsapp_channel_id: wcid,
    description: null, short_description: null, logo_url: null, cover_url: null,
    website_url: null, country_code: 'US', primary_language: 'en', category_id: null,
    owner_id: null, status: 'approved', verification_status: 'unverified',
    is_official: false, is_featured: false, is_nsfw: false, is_demo: false,
    activity_level: 'active', follower_count: 10, follower_count_source: 'seed',
    follower_count_updated_at: new Date(), created_at: new Date(), updated_at: new Date(), published_at: new Date(),
    ...overrides,
  };
  await withDb(async (db) => { await db.collection('channels').insertOne(doc); });
  return { id, slug };
}

beforeAll(async () => {
  // Nothing to seed globally — each test inserts its own fixtures.
});

afterAll(async () => {
  await withDb(async (db) => {
    // Only remove rows we created (namespaced by RUN_TAG).
    await db.collection('channels').deleteMany({ slug: new RegExp(`-pfi-${RUN_TAG}$`) });
    await db.collection('channels').deleteMany({ slug: new RegExp(`^pfi-${RUN_TAG}-`) });
  });
});

describe('M06.1 — public channel visibility (fixture isolation)', () => {
  it('durable marker: is_test_fixture=true → excluded from BROWSE', async () => {
    const { slug } = await insertChannel({
      slug: `organic-A-pfi-${RUN_TAG}`, name: `PublicSounding A ${RUN_TAG}`,
      is_test_fixture: true,
    });
    const r = await api<{ items: Array<{ slug: string }> }>(`/channels?limit=100`);
    expect(r.status).toBe(200);
    const slugs = (r.body.data?.items || []).map((i) => i.slug);
    expect(slugs).not.toContain(slug);
  });

  it('durable marker: is_test_fixture=true → 404 on DIRECT LOOKUP', async () => {
    const { slug } = await insertChannel({
      slug: `organic-B-pfi-${RUN_TAG}`, name: `PublicSounding B ${RUN_TAG}`,
      is_test_fixture: true,
    });
    const r = await api(`/channels/${slug}`);
    expect(r.status).toBe(404);
  });

  it('durable marker: is_test_fixture=true → excluded from SEARCH', async () => {
    const uniqName = `Fixture-C-${RUN_TAG}`;
    const { slug } = await insertChannel({
      slug: `organic-C-pfi-${RUN_TAG}`, name: uniqName,
      is_test_fixture: true,
    });
    // Search by the unique portion of the name. Without the marker, this row
    // would rank first. With the marker, it MUST be excluded from results.
    const r = await api<{ items: Array<{ slug: string }> }>(`/channels?q=${encodeURIComponent(RUN_TAG)}&limit=50`);
    expect(r.status).toBe(200);
    const slugs = (r.body.data?.items || []).map((i) => i.slug);
    expect(slugs).not.toContain(slug);
  });

  it('legacy pattern: slug ^test- (no marker) → excluded from all three surfaces', async () => {
    const slug = `test-pfi-${RUN_TAG}-legacy-slug`;
    await insertChannel({ slug, name: `LegacyPatternSlug ${RUN_TAG}` });
    const list = await api<{ items: Array<{ slug: string }> }>(`/channels?limit=100`);
    expect(list.body.data?.items.some((i) => i.slug === slug)).toBe(false);
    const direct = await api(`/channels/${slug}`);
    expect(direct.status).toBe(404);
    const search = await api<{ items: Array<{ slug: string }> }>(`/channels?q=${encodeURIComponent(RUN_TAG)}&limit=50`);
    expect(search.body.data?.items.some((i) => i.slug === slug)).toBe(false);
  });

  it('legacy pattern: name ^"Test " (no marker) → excluded from all three surfaces', async () => {
    const slug = `pfi-${RUN_TAG}-legacy-name`;
    const name = `Test LegacyPatternName ${RUN_TAG}`;
    await insertChannel({ slug, name });
    const list = await api<{ items: Array<{ slug: string }> }>(`/channels?limit=100`);
    expect(list.body.data?.items.some((i) => i.slug === slug)).toBe(false);
    const direct = await api(`/channels/${slug}`);
    expect(direct.status).toBe(404);
    const search = await api<{ items: Array<{ slug: string }> }>(`/channels?q=${encodeURIComponent(RUN_TAG)}&limit=50`);
    expect(search.body.data?.items.some((i) => i.slug === slug)).toBe(false);
  });

  it('legitimate channel with "test" in short_description IS still visible everywhere', async () => {
    // Slug and name are BOTH organic; only the incidental description mentions
    // the word "test" (as in "Software Testing weekly digest"). This is a
    // real channel and must not be false-positive-filtered.
    const slug = `pfi-${RUN_TAG}-legit`;
    const name = `Software Testing Digest ${RUN_TAG}`;
    await insertChannel({
      slug, name,
      short_description: 'A legitimate approved channel that happens to talk about testing.',
    });
    // Browse: the row appears.
    const list = await api<{ items: Array<{ slug: string }> }>(`/channels?limit=200`);
    expect(list.body.data?.items.some((i) => i.slug === slug)).toBe(true);
    // Direct lookup: 200.
    const direct = await api<{ channel: { slug: string } }>(`/channels/${slug}`);
    expect(direct.status).toBe(200);
    expect(direct.body.data?.channel.slug).toBe(slug);
    // Search: appears for the unique portion of the name.
    const search = await api<{ items: Array<{ slug: string }> }>(`/channels?q=${encodeURIComponent(RUN_TAG)}&limit=50`);
    expect(search.body.data?.items.some((i) => i.slug === slug)).toBe(true);
  });

  it('sanitizer never leaks is_test_fixture in a public response', async () => {
    // Insert a marker=false legitimate channel — the public response must
    // simply not carry the field.
    const slug = `pfi-${RUN_TAG}-sanitize`;
    await insertChannel({ slug, name: `SanitizerRegression ${RUN_TAG}` });
    const r = await api<{ channel: Record<string, unknown> }>(`/channels/${slug}`);
    expect(r.status).toBe(200);
    expect(r.body.data?.channel).not.toHaveProperty('is_test_fixture');
    // Also owner-internal fields must remain hidden (regression).
    for (const k of ['owner_id', 'verification_status', 'reviewed_by', 'reviewed_at', 'rejection_reason', 'rejection_notes']) {
      expect(r.body.data?.channel).not.toHaveProperty(k);
    }
  });

  it('public submission cannot self-set is_test_fixture', async () => {
    // Sign up a normal user, then attempt to submit a channel with a
    // client-supplied is_test_fixture=true. The submission Zod schema strips
    // unknown fields, so the persisted row MUST NOT carry the marker.
    const email = `pfi-sub-${RUN_TAG}@wavelead.test`;
    const signup = await fetch(`${BASE}/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': CLIENT_IP },
      body: JSON.stringify({ email, password: 'password123', display_name: 'PFI' }),
    });
    const cookie = signup.headers.get('set-cookie')?.match(/wl_session=[^;]+/)?.[0] || '';
    // Use a unique WhatsApp channel key so we don't collide with any prior seed.
    const key = `0029PFI${RUN_TAG.slice(0, 12)}xyz`;
    const submission = await fetch(`${BASE}/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie, 'X-Forwarded-For': CLIENT_IP },
      body: JSON.stringify({
        whatsapp_url: `https://whatsapp.com/channel/${key}`,
        name: `PublicSubmit ${RUN_TAG}`,
        short_description: 'Owner-submitted public channel; injection attempt below.',
        category_slug: 'news',
        country_code: 'ID',
        primary_language: 'en',
        // Injection attempts:
        is_test_fixture: true,
        status: 'approved',
        is_featured: true,
      }),
    });
    expect(submission.status).toBe(200);
    const body = await submission.json();
    const created = body?.data?.channel;
    expect(created).toBeTruthy();
    // Fetch straight from Mongo — the sanitizer would already hide it.
    const persisted = await withDb(async (db) => db.collection('channels').findOne({ id: created.id }));
    expect(persisted).toBeTruthy();
    expect(persisted?.is_test_fixture).toBeFalsy(); // absent or false — NEVER true
    expect(persisted?.status).toBe('pending_review'); // moderation state, not client-forced approved
    expect(persisted?.is_featured).toBe(false);
    // Clean up the submitted row.
    await withDb(async (db) => {
      await db.collection('channels').deleteOne({ id: created.id });
      await db.collection('users').deleteOne({ email });
    });
  });

  it('search relevance for a normal seeded channel is UNCHANGED by the fixture filter', async () => {
    // The seeded "Wave Sports Weekly" (Sports category) must still be the
    // first result for q="sport" — the fixture filter only removes flagged
    // rows and does not touch the scoring pipeline.
    const r = await api<{ items: Array<{ slug: string; name: string }> }>(`/channels?q=sport&limit=10`);
    expect(r.status).toBe(200);
    const items = r.body.data?.items || [];
    expect(items.length).toBeGreaterThan(0);
    expect(items[0].slug).toBe('wave-sports-weekly');
  });
});
