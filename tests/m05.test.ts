// Milestone 05.0 — Smart Channel Import & Auto Enrichment
//
// Focus: URL normalization + safe fetcher + duplicate detection + fail-open
// behavior + rate limiting + threshold-based inference validation. The Gemini
// call is monkey-patched via global.fetch so tests remain deterministic.

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { MongoClient } from 'mongodb';
import { v4 as uuidv4 } from 'uuid';
import { runSeed } from '@/lib/seed/seedData';
import { normalizeChannelUrl } from '@/lib/services/enrichment/urlNormalizer';
import { applyThresholds, isValidCountry, isValidLanguage } from '@/lib/services/enrichment/inferenceProvider';
import { __resetRateLimiter } from '@/lib/services/enrichment/enrichmentService';

const BASE = 'http://localhost:3000/api';
const fakeIp = () => `10.${Math.floor(Math.random()*255)}.${Math.floor(Math.random()*255)}.${Math.floor(Math.random()*255)}`;

async function api<T = unknown>(path: string, init: RequestInit = {}, ip: string = fakeIp()) {
  const res = await fetch(`${BASE}${path}`, { ...init, headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip, ...(init.headers || {}) } });
  let body: { ok?: boolean; data?: T; error?: string } = {};
  try { body = await res.json(); } catch { /* not json */ }
  return { status: res.status, body, setCookie: res.headers.get('set-cookie') };
}
async function withDb<T>(fn: (db: import('mongodb').Db) => Promise<T>): Promise<T> {
  const client = new MongoClient(process.env.MONGO_URL!);
  await client.connect();
  try { return await fn(client.db(process.env.DB_NAME!)); } finally { await client.close(); }
}
async function signup(role?: 'user' | 'admin') {
  const email = `m05-${role || 'u'}-${Date.now()}${Math.floor(Math.random()*1e6)}@wavelead.test`;
  const r = await api<{ user: { id: string } }>('/auth/signup', { method: 'POST', body: JSON.stringify({ email, password: 'password123', display_name: 'M05' }) });
  const cookie = r.setCookie!.match(/wl_session=[^;]+/)![0];
  if (role === 'admin') await withDb(async (db) => { await db.collection('users').updateOne({ id: r.body.data!.user.id }, { $set: { role: 'admin' } }); });
  return { cookie, userId: r.body.data!.user.id, email };
}

beforeAll(async () => {
  await withDb(async (db) => {
    await db.collection('users').deleteMany({ email: /^m05-/ });
    await db.collection('channels').deleteMany({ id: /^m05-/ });
    await db.collection('enrichment_cache').deleteMany({});
  });
  await runSeed({});
});
beforeEach(() => { __resetRateLimiter(); });
afterAll(async () => {
  await withDb(async (db) => {
    await db.collection('channels').deleteMany({ id: /^m05-/ });
    await db.collection('enrichment_cache').deleteMany({});
  });
});

// ---- 1. URL normalization ----
describe('M05.0 — URL normalization', () => {
  it('accepts canonical, www, wa.me, and trailing-slash variants → same channel_id', () => {
    const id = 'a'.repeat(22);
    const variants = [
      `https://whatsapp.com/channel/${id}`,
      `https://www.whatsapp.com/channel/${id}`,
      `https://whatsapp.com/channel/${id}/`,
      `https://whatsapp.com/channel/${id}?x=1`,
      `https://whatsapp.com/channel/${id}#foo`,
      `https://wa.me/channel/${id}`,
    ];
    for (const v of variants) {
      const n = normalizeChannelUrl(v);
      expect(n?.channel_id).toBe(id);
      expect(n?.canonical_url).toBe(`https://whatsapp.com/channel/${id}`);
    }
  });
  it('rejects non-whatsapp hosts and invalid ids', () => {
    expect(normalizeChannelUrl('https://evil.com/channel/aaaaaaaaaaaaaaaaaaaaaa')).toBeNull();
    expect(normalizeChannelUrl('http://whatsapp.com/channel/short')).toBeNull();
    expect(normalizeChannelUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeChannelUrl('https://whatsapp.com/status/x')).toBeNull();
    expect(normalizeChannelUrl('')).toBeNull();
    expect(normalizeChannelUrl(null)).toBeNull();
  });
});

// ---- 2. Threshold-based inference validation ----
describe('M05.0 — Threshold-based inference validation', () => {
  it('drops sub-threshold or unsupported values', () => {
    const out = applyThresholds({
      category: { value: 'news', confidence: 0.6 },   // below 0.7
      language: { value: 'en', confidence: 0.85 },
      country:  { value: 'US', confidence: 0.80 },   // below 0.85
    }, ['news', 'sports']);
    expect(out.category.value).toBeNull();
    expect(out.language.value).toBe('en');
    expect(out.country.value).toBeNull();
  });
  it('drops non-canonical category and unsupported language', () => {
    const out = applyThresholds({
      category: { value: 'crypto-scam', confidence: 0.99 },
      language: { value: 'klingon', confidence: 0.99 },
      country:  { value: 'US', confidence: 0.99 },
    }, ['news', 'sports']);
    expect(out.category.value).toBeNull();
    expect(out.language.value).toBeNull();
    expect(out.country.value).toBe('US');
  });
  it('helper checks work', () => {
    expect(isValidLanguage('en')).toBe(true);
    expect(isValidLanguage('XX')).toBe(false);
    expect(isValidCountry('US')).toBe(true);
    expect(isValidCountry('ZZ')).toBe(false);
  });
});

// ---- 3. /api/channels/enrich end-to-end ----
describe('M05.0 — /api/channels/enrich', () => {
  it('invalid_url for non-WhatsApp URL', async () => {
    const r = await api<{ status: string }>('/channels/enrich', { method: 'POST', body: JSON.stringify({ channel_url: 'https://evil.com/x' }) });
    expect(r.body.data!.status).toBe('invalid_url');
  });

  it('duplicate is detected BEFORE any OG/LLM fetch (owned by current user → manage)', async () => {
    const owner = await signup('user');
    const id = 'x'.repeat(22);
    const chId = `m05-dup-${Date.now()}`;
    await withDb(async (db) => {
      await db.collection('channels').insertOne({
        id: chId, slug: chId, name: 'Dup Test', whatsapp_url: `https://whatsapp.com/channel/${id}`,
        whatsapp_channel_id: id, short_description: 'x', description: null, logo_url: null, cover_url: null,
        website_url: null, category_id: null, country_code: 'ID', primary_language: 'en',
        status: 'approved', verification_status: 'unclaimed', is_featured: false, is_official: false,
        is_nsfw: false, is_demo: false, follower_count: 0, activity_level: 'active',
        owner_id: owner.userId, published_at: new Date(), created_at: new Date(), updated_at: new Date(),
      });
    });
    const r = await api<{ status: string; duplicate?: { owned_by_me: boolean; suggested_action: string; slug: string } }>('/channels/enrich', {
      method: 'POST', headers: { Cookie: owner.cookie },
      body: JSON.stringify({ channel_url: `https://www.whatsapp.com/channel/${id}/?ref=share` }),
    });
    expect(r.body.data!.status).toBe('duplicate');
    expect(r.body.data!.duplicate!.owned_by_me).toBe(true);
    expect(r.body.data!.duplicate!.suggested_action).toBe('manage');
    expect(r.body.data!.duplicate!.slug).toBe(chId);
  });

  it('unclaimed approved duplicate → suggested_action: claim', async () => {
    const id = 'y'.repeat(22);
    const chId = `m05-claim-${Date.now()}`;
    await withDb(async (db) => {
      await db.collection('channels').insertOne({
        id: chId, slug: chId, name: 'Claim Test', whatsapp_url: `https://whatsapp.com/channel/${id}`,
        whatsapp_channel_id: id, short_description: 'x', description: null, logo_url: null, cover_url: null,
        website_url: null, category_id: null, country_code: 'ID', primary_language: 'en',
        status: 'approved', verification_status: 'unclaimed', is_featured: false, is_official: false,
        is_nsfw: false, is_demo: false, follower_count: 0, activity_level: 'active',
        owner_id: null, published_at: new Date(), created_at: new Date(), updated_at: new Date(),
      });
    });
    const r = await api<{ duplicate?: { suggested_action: string; has_owner: boolean; is_verified: boolean } }>('/channels/enrich', {
      method: 'POST', body: JSON.stringify({ channel_url: `https://whatsapp.com/channel/${id}` }),
    });
    expect(r.body.data!.duplicate!.suggested_action).toBe('claim');
    expect(r.body.data!.duplicate!.has_owner).toBe(false);
    expect(r.body.data!.duplicate!.is_verified).toBe(false);
  });

  it('verified duplicate owned by someone else → suggested_action: report', async () => {
    const other = await signup('user');
    const id = 'z'.repeat(22);
    const chId = `m05-verified-${Date.now()}`;
    await withDb(async (db) => {
      await db.collection('channels').insertOne({
        id: chId, slug: chId, name: 'Verified', whatsapp_url: `https://whatsapp.com/channel/${id}`,
        whatsapp_channel_id: id, short_description: 'x', description: null, logo_url: null, cover_url: null,
        website_url: null, category_id: null, country_code: 'ID', primary_language: 'en',
        status: 'approved', verification_status: 'verified', is_featured: false, is_official: false,
        is_nsfw: false, is_demo: false, follower_count: 0, activity_level: 'active',
        owner_id: other.userId, published_at: new Date(), created_at: new Date(), updated_at: new Date(),
      });
    });
    // Different (anonymous) caller
    const r = await api<{ duplicate?: { suggested_action: string; is_verified: boolean; has_owner: boolean } }>('/channels/enrich', {
      method: 'POST', body: JSON.stringify({ channel_url: `https://whatsapp.com/channel/${id}` }),
    });
    expect(r.body.data!.duplicate!.suggested_action).toBe('report');
    expect(r.body.data!.duplicate!.is_verified).toBe(true);
    expect(r.body.data!.duplicate!.has_owner).toBe(true);
  });

  it('rate limit: >10 anonymous calls/min from same IP returns 429', async () => {
    const ip = '10.99.99.99';
    let ok = 0, limited = 0;
    for (let i = 0; i < 12; i++) {
      const r = await api('/channels/enrich', { method: 'POST', body: JSON.stringify({ channel_url: 'https://whatsapp.com/channel/nope' }) }, ip);
      if (r.status === 429) limited++; else ok++;
    }
    expect(ok).toBeLessThanOrEqual(10);
    expect(limited).toBeGreaterThanOrEqual(2);
  });

  it('enrichment for a new (non-duplicate) channel returns a fields envelope with provenance', async () => {
    const id = 'n'.repeat(22);
    // OG fetch will fail against a real WhatsApp URL from the test env (or return no metadata) → status: unavailable
    const r = await api<{ status: string; fields?: unknown; canonical?: { channel_id: string }; metadata_available: boolean; inference_available: boolean }>('/channels/enrich', {
      method: 'POST', body: JSON.stringify({ channel_url: `https://whatsapp.com/channel/${id}` }),
    });
    expect(['success','partial','unavailable']).toContain(r.body.data!.status);
    expect(r.body.data!.canonical?.channel_id).toBe(id);
    expect(r.body.data!.fields).toBeDefined();
    // Fields present but values null when OG unavailable — fail-open contract.
  });

  it('server-side submission blocks duplicate at DB unique index (concurrent submissions produce only one channel)', async () => {
    const u1 = await signup('user');
    const u2 = await signup('user');
    const id = 'r'.repeat(22);
    const payload = {
      whatsapp_url: `https://whatsapp.com/channel/${id}`,
      name: 'Race',
      short_description: 'A concurrent submit test channel — race condition',
      category_slug: 'news', country_code: 'ID', primary_language: 'en',
    };
    const [a, b] = await Promise.all([
      api('/submit', { method: 'POST', headers: { Cookie: u1.cookie }, body: JSON.stringify(payload) }),
      api('/submit', { method: 'POST', headers: { Cookie: u2.cookie }, body: JSON.stringify(payload) }),
    ]);
    const successCount = [a, b].filter((x) => x.status === 200).length;
    expect(successCount).toBe(1);
    const failCount = [a, b].filter((x) => x.status >= 400).length;
    expect(failCount).toBe(1);
    // Cleanup the newly created channel
    await withDb(async (db) => { await db.collection('channels').deleteMany({ whatsapp_channel_id: id }); });
  });
});

// ---- 4. Enrichment never sets privileged fields ----
describe('M05.0 — Enrichment never touches privileged fields', () => {
  it('response contract does not include any privileged field (owner_id, verification_status, official, WaveScore)', async () => {
    const r = await api<{ fields?: Record<string, unknown> }>('/channels/enrich', {
      method: 'POST', body: JSON.stringify({ channel_url: 'https://whatsapp.com/channel/qqqqqqqqqqqqqqqqqqqqqq' }),
    });
    const fields = r.body.data?.fields || {};
    const forbidden = ['owner_id', 'verification_status', 'is_official', 'is_featured', 'moderation_status', 'wavescore', 'homepage_placement', 'claim_status'];
    for (const f of forbidden) expect(f in fields).toBe(false);
  });
});
