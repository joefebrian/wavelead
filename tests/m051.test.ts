// Milestone 05.1 — Promote Channel / Sponsored Discovery
// Backend contract + delivery + attribution tests. All Mongo state is scoped
// with an m051- prefix so test resets are surgical.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MongoClient } from 'mongodb';
import { v4 as uuidv4 } from 'uuid';
import { runSeed } from '@/lib/seed/seedData';
import { issueAttributionToken, verifyAttributionToken, deriveSessionBinding } from '@/lib/services/promotion/attributionTokenService';
import { computeNextStatus } from '@/lib/services/promotion/campaignStateService';
import { promotionDeliveryService } from '@/lib/services/promotion/deliveryService';
import { promotionCampaignRepo, promotionRateCardRepo, campaignImpressionDedupRepo } from '@/lib/repositories/promotionRepo';
import type { PromotionCampaign, SponsoredPlacement, VerificationStatus } from '@/lib/types';

const BASE = 'http://localhost:3000/api';
const fakeIp = () => `10.${Math.floor(Math.random()*255)}.${Math.floor(Math.random()*255)}.${Math.floor(Math.random()*255)}`;

async function api<T = unknown>(path: string, init: RequestInit = {}, ip: string = fakeIp()) {
  const res = await fetch(`${BASE}${path}`, { ...init, headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip, ...(init.headers || {}) } });
  let body: { ok?: boolean; data?: T; error?: string } = {};
  try { body = await res.json(); } catch { /* not json */ }
  return { status: res.status, body, setCookie: res.headers.get('set-cookie') };
}
async function withDb<T>(fn: (db: import('mongodb').Db) => Promise<T>): Promise<T> {
  const client = new MongoClient(process.env.MONGO_URL || 'mongodb://localhost:27017');
  await client.connect();
  try { return await fn(client.db(process.env.DB_NAME || 'wavelead')); } finally { await client.close(); }
}
async function signup(role?: 'user' | 'admin') {
  const email = `m051-${role || 'u'}-${Date.now()}${Math.floor(Math.random()*1e6)}@wavelead.test`;
  const r = await api<{ user: { id: string } }>('/auth/signup', { method: 'POST', body: JSON.stringify({ email, password: 'password123', display_name: 'M051' }) });
  const cookie = r.setCookie!.match(/wl_session=[^;]+/)![0];
  if (role === 'admin') {
    await withDb(async (db) => { await db.collection('users').updateOne({ id: r.body.data!.user.id }, { $set: { role: 'admin' } }); });
  }
  return { cookie, userId: r.body.data!.user.id, email };
}

// Create an approved, verified channel owned by the given user.
async function ensureChannel(ownerId: string, opts: { verification_status?: VerificationStatus; country?: string; language?: string; category?: string } = {}) {
  const id = uuidv4();
  const slug = `m051-ch-${id.slice(0, 8)}`;
  const now = new Date();
  const doc = {
    id, slug, name: `M051 Channel ${id.slice(0, 6)}`,
    whatsapp_url: `https://whatsapp.com/channel/0029Va${id.slice(0, 20).replace(/-/g, '')}`,
    whatsapp_channel_id: `0029Va${id.slice(0, 20).replace(/-/g, '')}`,
    description: 'test', short_description: 'test',
    logo_url: null, cover_url: null, website_url: null,
    country_code: opts.country || 'ID',
    primary_language: opts.language || 'id',
    category_id: null,
    owner_id: ownerId,
    status: 'approved',
    verification_status: opts.verification_status || 'verified',
    is_official: opts.verification_status === 'official',
    is_featured: false, is_nsfw: false, is_demo: false,
    activity_level: 'active',
    follower_count: 1000, follower_count_source: 'test', follower_count_updated_at: now,
    created_at: now, updated_at: now, published_at: now,
  };
  await withDb(async (db) => { await db.collection('channels').insertOne(doc); });
  return doc;
}

// Convenience: create pre-approved active campaign directly in DB.
async function seedActiveCampaign(ownerId: string, channelId: string, opts: {
  placements?: SponsoredPlacement[]; budget?: number; countries?: string[]; languages?: string[]; categories?: string[];
  start_offset_ms?: number; end_offset_ms?: number;
} = {}): Promise<PromotionCampaign> {
  const now = new Date();
  const camp: PromotionCampaign = {
    id: uuidv4(),
    owner_user_id: ownerId,
    channel_id: channelId,
    name: 'seed campaign',
    objective: 'visibility',
    placements: opts.placements || ['sponsored_search'],
    targeting: { countries: (opts.countries || []).map((c) => c.toUpperCase()), languages: opts.languages || [], categories: opts.categories || [] },
    budget_total_usd_minor: opts.budget ?? 2000,
    budget_daily_usd_minor: null,
    start_at: new Date(now.getTime() + (opts.start_offset_ms ?? -3600_000)),
    end_at: new Date(now.getTime() + (opts.end_offset_ms ?? 86400_000)),
    status: 'active',
    rate_snapshot: (opts.placements || ['sponsored_search']).map((p) => ({
      placement: p, pricing_model: 'cpm', cpm_usd_minor: 200, rate_card_id: `seed-${p}`, country_code: null, resolved_at: now,
    })),
    delivered_impressions: 0,
    estimated_spend_usd_minor: 0,
    created_at: now, updated_at: now, submitted_at: now,
    reviewed_at: now, reviewed_by: 'admin', rejection_reason: null, rejection_notes: null,
    activated_at: now, paused_at: null, completed_at: null, cancelled_at: null,
  };
  await promotionCampaignRepo.insert(camp);
  return camp;
}

beforeAll(async () => {
  await withDb(async (db) => {
    await db.collection('users').deleteMany({ email: /^m051-/ });
    await db.collection('channels').deleteMany({ slug: /^m051-/ });
    await db.collection('promotion_campaigns').deleteMany({});
    await db.collection('campaign_impression_dedup').deleteMany({});
    await db.collection('events').deleteMany({ campaign_id: { $exists: true, $ne: null } });
  });
  await runSeed({}); // Idempotent — ensures rate cards are seeded.
});

afterAll(async () => {
  await withDb(async (db) => {
    await db.collection('users').deleteMany({ email: /^m051-/ });
    await db.collection('channels').deleteMany({ slug: /^m051-/ });
    await db.collection('promotion_campaigns').deleteMany({});
    await db.collection('campaign_impression_dedup').deleteMany({});
    await db.collection('events').deleteMany({ campaign_id: { $exists: true, $ne: null } });
  });
});

describe('M05.1.1 — Rate cards & seed', () => {
  it('seeds one active global $2 CPM per sponsored placement', async () => {
    const cards = await promotionRateCardRepo.list({ is_fixture: true });
    const placements = new Set(cards.map((c) => c.placement));
    expect(placements.has('sponsored_search')).toBe(true);
    expect(placements.has('sponsored_homepage')).toBe(true);
    expect(placements.has('sponsored_category')).toBe(true);
    expect(placements.has('sponsored_country')).toBe(true);
    expect(placements.has('sponsored_related_channel')).toBe(true);
    for (const c of cards) {
      expect(c.cpm_usd_minor).toBe(200);
      expect(c.country_code).toBeNull();
      expect(c.active).toBe(true);
    }
  });

  it('seed is idempotent — re-running does not duplicate rates', async () => {
    const before = await promotionRateCardRepo.list({ is_fixture: true });
    await runSeed({});
    await runSeed({});
    const after = await promotionRateCardRepo.list({ is_fixture: true });
    expect(after.length).toBe(before.length);
  });

  it('country-specific active rate overrides global', async () => {
    // Upsert an ID-specific rate.
    const now = new Date();
    await promotionRateCardRepo.insert({
      id: `test-id-search-${Date.now()}`, placement: 'sponsored_search', country_code: 'ID', pricing_model: 'cpm',
      cpm_usd_minor: 500, active: true, effective_from: now, effective_to: null,
      is_fixture: false, seed_key: null, created_at: now, updated_at: now, created_by: 'test',
    });
    const idRate = await promotionRateCardRepo.resolve('sponsored_search', 'ID');
    expect(idRate?.cpm_usd_minor).toBe(500);
    const usRate = await promotionRateCardRepo.resolve('sponsored_search', 'US');
    expect(usRate?.cpm_usd_minor).toBe(200); // global fallback
  });

  it('inactive rate is ignored', async () => {
    const now = new Date();
    await promotionRateCardRepo.insert({
      id: `test-inactive-${Date.now()}`, placement: 'sponsored_country', country_code: 'FR', pricing_model: 'cpm',
      cpm_usd_minor: 999, active: false, effective_from: now, effective_to: null,
      is_fixture: false, seed_key: null, created_at: now, updated_at: now, created_by: 'test',
    });
    const r = await promotionRateCardRepo.resolve('sponsored_country', 'FR');
    expect(r?.cpm_usd_minor).toBe(200); // falls to global $2.00
  });
});

describe('M05.1.2 — Attribution token', () => {
  it('valid token round-trips', () => {
    const anon = 'sess-abc';
    const t = issueAttributionToken({ campaign_id: 'c1', channel_id: 'ch1', source: 'search', placement: 'sponsored_search', anonymous_session_id: anon });
    const v = verifyAttributionToken(t, { anonymous_session_id: anon });
    expect(v.valid).toBe(true);
    if (v.valid) {
      expect(v.payload.campaign_id).toBe('c1');
      expect(v.payload.traffic_type).toBe('sponsored');
      expect(v.payload.jti).toBeTruthy();
    }
  });

  it('expired token is rejected', () => {
    const anon = 'sess-abc';
    const past = new Date(Date.now() - 60_000);
    const t = issueAttributionToken({ campaign_id: 'c1', channel_id: 'ch1', source: 'search', placement: 'sponsored_search', anonymous_session_id: anon, ttl_ms: 1000, now: past });
    const v = verifyAttributionToken(t, { anonymous_session_id: anon });
    expect(v.valid).toBe(false);
    if (!v.valid) expect(v.reason).toBe('expired');
  });

  it('session-copy is rejected', () => {
    const t = issueAttributionToken({ campaign_id: 'c1', channel_id: 'ch1', source: 'search', placement: 'sponsored_search', anonymous_session_id: 'sess-A' });
    const v = verifyAttributionToken(t, { anonymous_session_id: 'sess-B' });
    expect(v.valid).toBe(false);
    if (!v.valid) expect(v.reason).toBe('session_mismatch');
  });

  it('tampering with campaign_id breaks the signature', () => {
    const anon = 'sess-abc';
    const t = issueAttributionToken({ campaign_id: 'c1', channel_id: 'ch1', source: 'search', placement: 'sponsored_search', anonymous_session_id: anon });
    const [body, mac] = t.split('.');
    const forged = Buffer.from(body, 'base64').toString('utf8').replace('"c1"', '"c-EVIL"');
    const forgedB64 = Buffer.from(forged).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    const tampered = `${forgedB64}.${mac}`;
    const v = verifyAttributionToken(tampered, { anonymous_session_id: anon });
    expect(v.valid).toBe(false);
    if (!v.valid) expect(v.reason).toBe('bad_signature');
  });

  it('malformed token is rejected without throwing', () => {
    const v1 = verifyAttributionToken('not.a.token', { anonymous_session_id: 'x' });
    const v2 = verifyAttributionToken('', { anonymous_session_id: 'x' });
    const v3 = verifyAttributionToken(null, { anonymous_session_id: 'x' });
    expect(v1.valid).toBe(false);
    expect(v2.valid).toBe(false);
    expect(v3.valid).toBe(false);
  });

  it('does not expose raw anonymous_session_id in payload', () => {
    const anon = 'raw-secret-session-id';
    const t = issueAttributionToken({ campaign_id: 'c1', channel_id: 'ch1', source: 'search', placement: 'sponsored_search', anonymous_session_id: anon });
    const body = t.split('.')[0];
    const decoded = Buffer.from(body.replace(/-/g, '+').replace(/_/g, '/') + '==', 'base64').toString('utf8');
    expect(decoded).not.toContain(anon);
    expect(decoded).toContain(deriveSessionBinding(anon));
  });
});

describe('M05.1.3 — Campaign create / authz', () => {
  it('unverified channel cannot be promoted', async () => {
    const { cookie, userId } = await signup();
    const ch = await ensureChannel(userId, { verification_status: 'claimed' });
    const r = await api<unknown>('/owner/promotions', {
      method: 'POST', headers: { Cookie: cookie },
      body: JSON.stringify({
        channel_id: ch.id, objective: 'visibility', placements: ['sponsored_search'],
        targeting: { countries: [], languages: [], categories: [] },
        budget_total_usd_minor: 1000,
        start_at: new Date(Date.now() + 60_000).toISOString(),
        end_at: new Date(Date.now() + 86_400_000).toISOString(),
      }),
    });
    expect(r.status).toBe(400);
  });

  it('cross-owner promote is 403', async () => {
    const a = await signup();
    const b = await signup();
    const ch = await ensureChannel(a.userId, { verification_status: 'verified' });
    const r = await api<unknown>('/owner/promotions', {
      method: 'POST', headers: { Cookie: b.cookie },
      body: JSON.stringify({
        channel_id: ch.id, objective: 'visibility', placements: ['sponsored_search'],
        targeting: { countries: [], languages: [], categories: [] },
        budget_total_usd_minor: 1000,
        start_at: new Date(Date.now() + 60_000).toISOString(),
        end_at: new Date(Date.now() + 86_400_000).toISOString(),
      }),
    });
    expect(r.status).toBe(403);
  });

  it('happy path: verified owner creates → submit → admin approve → active', async () => {
    const owner = await signup();
    const admin = await signup('admin');
    const ch = await ensureChannel(owner.userId, { verification_status: 'verified' });
    const create = await api<{ campaign: PromotionCampaign }>('/owner/promotions', {
      method: 'POST', headers: { Cookie: owner.cookie },
      body: JSON.stringify({
        channel_id: ch.id, objective: 'visibility', placements: ['sponsored_search', 'sponsored_homepage'],
        targeting: { countries: ['ID'], languages: ['id'], categories: [] },
        budget_total_usd_minor: 10_000,
        start_at: new Date(Date.now() - 60_000).toISOString(),  // start now (in past)
        end_at: new Date(Date.now() + 7 * 86_400_000).toISOString(),
      }),
    });
    expect(create.status).toBe(200);
    const id = create.body.data!.campaign.id;
    const submit = await api<{ campaign: PromotionCampaign }>(`/owner/promotions/${id}/submit`, { method: 'POST', headers: { Cookie: owner.cookie } });
    expect(submit.status).toBe(200);
    expect(submit.body.data!.campaign.status).toBe('pending_review');
    expect(submit.body.data!.campaign.rate_snapshot).toHaveLength(2);
    const approve = await api<{ campaign: PromotionCampaign }>(`/admin/promotions/${id}/approve`, { method: 'POST', headers: { Cookie: admin.cookie } });
    expect(approve.status).toBe(200);
    expect(approve.body.data!.campaign.status).toBe('active');
    expect(approve.body.data!.campaign.activated_at).toBeTruthy();
  });

  it('normal user cannot approve', async () => {
    const owner = await signup();
    const stranger = await signup();
    const ch = await ensureChannel(owner.userId);
    const create = await api<{ campaign: PromotionCampaign }>('/owner/promotions', {
      method: 'POST', headers: { Cookie: owner.cookie },
      body: JSON.stringify({
        channel_id: ch.id, objective: 'visibility', placements: ['sponsored_search'],
        targeting: { countries: [], languages: [], categories: [] },
        budget_total_usd_minor: 1000,
        start_at: new Date(Date.now() + 60_000).toISOString(),
        end_at: new Date(Date.now() + 86_400_000).toISOString(),
      }),
    });
    const id = create.body.data!.campaign.id;
    await api(`/owner/promotions/${id}/submit`, { method: 'POST', headers: { Cookie: owner.cookie } });
    const badApprove = await api(`/admin/promotions/${id}/approve`, { method: 'POST', headers: { Cookie: stranger.cookie } });
    expect(badApprove.status).toBe(403);
  });

  it('missing rate card blocks submit (no silent code fallback)', async () => {
    // Temporarily deactivate the sponsored_related_channel global rate.
    const cards = await promotionRateCardRepo.list({ placement: 'sponsored_related_channel', country_code: null });
    for (const c of cards) await promotionRateCardRepo.update(c.id, { active: false });
    try {
      const owner = await signup();
      const ch = await ensureChannel(owner.userId);
      const create = await api<{ campaign: PromotionCampaign }>('/owner/promotions', {
        method: 'POST', headers: { Cookie: owner.cookie },
        body: JSON.stringify({
          channel_id: ch.id, objective: 'visibility', placements: ['sponsored_related_channel'],
          targeting: { countries: [], languages: [], categories: [] },
          budget_total_usd_minor: 1000,
          start_at: new Date(Date.now() + 60_000).toISOString(),
          end_at: new Date(Date.now() + 86_400_000).toISOString(),
        }),
      });
      const id = create.body.data!.campaign.id;
      const submit = await api<unknown>(`/owner/promotions/${id}/submit`, { method: 'POST', headers: { Cookie: owner.cookie } });
      expect(submit.status).toBe(400);
    } finally {
      for (const c of cards) await promotionRateCardRepo.update(c.id, { active: true });
    }
  });
});

describe('M05.1.4 — Frequency cap', () => {
  it('allows 3, blocks 4th, resets after window expires', async () => {
    const owner = await signup();
    const ch = await ensureChannel(owner.userId, { verification_status: 'verified' });
    const camp = await seedActiveCampaign(owner.userId, ch.id, { placements: ['sponsored_search'] });
    const anon = `sess-freq-${Date.now()}`;

    for (let i = 0; i < 3; i++) {
      const r = await promotionDeliveryService.acknowledgeImpression({ campaign_id: camp.id, placement: 'sponsored_search', anonymous_session_id: anon });
      expect(r.recorded).toBe(true);
    }
    const blocked = await promotionDeliveryService.acknowledgeImpression({ campaign_id: camp.id, placement: 'sponsored_search', anonymous_session_id: anon });
    expect(blocked.recorded).toBe(false);
    expect(blocked.reason).toBe('frequency_capped');
    // Simulate window expiry by manually setting expires_at in the past.
    await withDb(async (db) => {
      await db.collection('campaign_impression_dedup').updateOne(
        { campaign_id: camp.id, anonymous_session_id: anon },
        { $set: { expires_at: new Date(Date.now() - 1000) } },
      );
    });
    const afterReset = await promotionDeliveryService.acknowledgeImpression({ campaign_id: camp.id, placement: 'sponsored_search', anonymous_session_id: anon });
    expect(afterReset.recorded).toBe(true);
    const state = await campaignImpressionDedupRepo.findOne(camp.id, anon);
    expect(state?.impression_count).toBe(1);
  });

  it('different sessions have independent caps', async () => {
    const owner = await signup();
    const ch = await ensureChannel(owner.userId);
    const camp = await seedActiveCampaign(owner.userId, ch.id);
    const a = `sess-A-${Date.now()}`;
    const b = `sess-B-${Date.now()}`;
    for (let i = 0; i < 3; i++) {
      await promotionDeliveryService.acknowledgeImpression({ campaign_id: camp.id, placement: 'sponsored_search', anonymous_session_id: a });
    }
    const okB = await promotionDeliveryService.acknowledgeImpression({ campaign_id: camp.id, placement: 'sponsored_search', anonymous_session_id: b });
    expect(okB.recorded).toBe(true);
  });

  it('different campaigns have independent caps', async () => {
    const owner = await signup();
    const ch = await ensureChannel(owner.userId);
    const c1 = await seedActiveCampaign(owner.userId, ch.id);
    const c2 = await seedActiveCampaign(owner.userId, ch.id);
    const anon = `sess-multi-${Date.now()}`;
    for (let i = 0; i < 3; i++) {
      await promotionDeliveryService.acknowledgeImpression({ campaign_id: c1.id, placement: 'sponsored_search', anonymous_session_id: anon });
    }
    const okC2 = await promotionDeliveryService.acknowledgeImpression({ campaign_id: c2.id, placement: 'sponsored_search', anonymous_session_id: anon });
    expect(okC2.recorded).toBe(true);
  });
});

describe('M05.1.5 — Budget concurrency', () => {
  it('parallel impressions never overspend total budget', async () => {
    const owner = await signup();
    const ch = await ensureChannel(owner.userId);
    // Budget = 3 cents ($0.03). CPM = $2.00 → per-impression $0.002 → ceil to 1 cent → allows exactly 3 imps.
    const camp = await seedActiveCampaign(owner.userId, ch.id, { budget: 3 });
    // 20 parallel attempts, one per unique session (bypass freq cap).
    const attempts = Array.from({ length: 20 }, (_, i) =>
      promotionDeliveryService.acknowledgeImpression({
        campaign_id: camp.id, placement: 'sponsored_search',
        anonymous_session_id: `p-${camp.id}-${i}`,
      }),
    );
    const results = await Promise.all(attempts);
    const recorded = results.filter((r) => r.recorded).length;
    expect(recorded).toBe(3);
    const finalCamp = await promotionCampaignRepo.findById(camp.id);
    expect(finalCamp!.estimated_spend_usd_minor).toBeLessThanOrEqual(camp.budget_total_usd_minor);
    expect(finalCamp!.delivered_impressions).toBe(3);
  });
});

describe('M05.1.6 — Campaign lifecycle reconciliation', () => {
  const owner_id = 'lifecycle-owner';
  const ch_id = 'lifecycle-ch';
  const base = {
    id: 'lc', owner_user_id: owner_id, channel_id: ch_id, name: 'x', objective: 'visibility' as const,
    placements: ['sponsored_search'] as SponsoredPlacement[],
    targeting: { countries: [], languages: [], categories: [] },
    budget_total_usd_minor: 100, budget_daily_usd_minor: null,
    delivered_impressions: 0, estimated_spend_usd_minor: 0,
    created_at: new Date(), updated_at: new Date(), submitted_at: null,
    reviewed_at: null, reviewed_by: null, rejection_reason: null, rejection_notes: null,
    activated_at: null, paused_at: null, completed_at: null, cancelled_at: null,
    rate_snapshot: null,
  } as unknown as PromotionCampaign;

  it('scheduled → active when start_at reached', () => {
    const c = { ...base, status: 'scheduled', start_at: new Date(Date.now() - 1000), end_at: new Date(Date.now() + 86400_000) } as PromotionCampaign;
    expect(computeNextStatus(c, new Date())).toBe('active');
  });
  it('active → completed when end_at passed', () => {
    const c = { ...base, status: 'active', start_at: new Date(Date.now() - 2000), end_at: new Date(Date.now() - 1000) } as PromotionCampaign;
    expect(computeNextStatus(c, new Date())).toBe('completed');
  });
  it('active → completed when budget exhausted', () => {
    const c = { ...base, status: 'active', start_at: new Date(Date.now() - 1000), end_at: new Date(Date.now() + 1000), estimated_spend_usd_minor: 100 } as PromotionCampaign;
    expect(computeNextStatus(c, new Date())).toBe('completed');
  });
  it('paused stays paused until end_at', () => {
    const c = { ...base, status: 'paused', start_at: new Date(Date.now() - 1000), end_at: new Date(Date.now() + 1000) } as PromotionCampaign;
    expect(computeNextStatus(c, new Date())).toBe('paused');
  });
  it('paused → completed once end_at passes', () => {
    const c = { ...base, status: 'paused', start_at: new Date(Date.now() - 2000), end_at: new Date(Date.now() - 1000) } as PromotionCampaign;
    expect(computeNextStatus(c, new Date())).toBe('completed');
  });
  it('cancelled/rejected/completed never reactivate', () => {
    for (const s of ['cancelled', 'rejected', 'completed'] as const) {
      const c = { ...base, status: s, start_at: new Date(Date.now() - 1000), end_at: new Date(Date.now() + 86400_000) } as PromotionCampaign;
      expect(computeNextStatus(c, new Date())).toBe(s);
    }
  });
});

describe('M05.1.7 — Delivery selection & organic isolation', () => {
  it('candidates match targeting; unrelated country is filtered out', async () => {
    const owner = await signup();
    const ch = await ensureChannel(owner.userId, { verification_status: 'verified', country: 'ID' });
    const camp = await seedActiveCampaign(owner.userId, ch.id, { placements: ['sponsored_search'], countries: ['ID'] });
    const idCands = await promotionDeliveryService.selectCandidates({
      placement: 'sponsored_search', country_code: 'ID', anonymous_session_id: `s-${Date.now()}`,
    }, 50);
    const frCands = await promotionDeliveryService.selectCandidates({
      placement: 'sponsored_search', country_code: 'FR', anonymous_session_id: `s-${Date.now()}b`,
    }, 50);
    // Positive: our ID-targeted campaign appears in ID results.
    const idHit = idCands.find((c) => c.campaign_id === camp.id);
    expect(idHit).toBeTruthy();
    expect(idHit!.traffic_type).toBe('sponsored');
    expect(idHit!.placement).toBe('sponsored_search');
    expect(idHit!.source).toBe('search');
    expect(idHit!.attribution_token).toBeTruthy();
    expect(idHit!.delivery_metadata.position_hint).toBeGreaterThanOrEqual(0);
    // Negative: our ID-targeted campaign is NEVER served in FR.
    const frHit = frCands.find((c) => c.campaign_id === camp.id);
    expect(frHit).toBeUndefined();
  });

  it('related_channel placement never returns self-promotion', async () => {
    const owner = await signup();
    const ch = await ensureChannel(owner.userId);
    await seedActiveCampaign(owner.userId, ch.id, { placements: ['sponsored_related_channel'] });
    const cands = await promotionDeliveryService.selectCandidates({
      placement: 'sponsored_related_channel', anonymous_session_id: `s-${Date.now()}`, exclude_channel_id: ch.id,
    });
    expect(cands.find((c) => c.channel.id === ch.id)).toBeUndefined();
  });

  it('unverified channel is not delivered even if its campaign is stored as active', async () => {
    const owner = await signup();
    const ch = await ensureChannel(owner.userId, { verification_status: 'verified' });
    const camp = await seedActiveCampaign(owner.userId, ch.id);
    // Downgrade verification post-hoc.
    await withDb(async (db) => { await db.collection('channels').updateOne({ id: ch.id }, { $set: { verification_status: 'claimed', is_official: false } }); });
    const cands = await promotionDeliveryService.selectCandidates({
      placement: 'sponsored_search', anonymous_session_id: `s-${Date.now()}`,
    });
    expect(cands.find((c) => c.campaign_id === camp.id)).toBeUndefined();
  });

  it('trending / top placements never accept sponsored inventory (defensive)', async () => {
    // The delivery service accepts only sponsored_* values. Anything else is rejected.
    const fake = await promotionDeliveryService.selectCandidates({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      placement: 'sponsored_trending' as any, anonymous_session_id: 'x',
    });
    expect(fake).toEqual([]);
  });
});

describe('M05.1.8 — /track/sponsored/impression endpoint', () => {
  it('valid token → recorded + spend deducted; replayed identical impression obeys freq cap', async () => {
    const owner = await signup();
    const ch = await ensureChannel(owner.userId);
    const camp = await seedActiveCampaign(owner.userId, ch.id, { placements: ['sponsored_search'] });
    const anon = `wl_at_test_${Date.now()}`;
    const token = issueAttributionToken({ campaign_id: camp.id, channel_id: ch.id, source: 'search', placement: 'sponsored_search', anonymous_session_id: anon });
    // Two calls with same session and same token → both allowed, 3rd allowed, 4th blocked.
    const ackFn = async () => api<{ recorded: boolean; reason?: string }>('/track/sponsored/impression', {
      method: 'POST',
      headers: { Cookie: `wl_anon_id=${anon}` },
      body: JSON.stringify({ attribution_token: token }),
    });
    const r1 = await ackFn(); expect(r1.body.data!.recorded).toBe(true);
    const r2 = await ackFn(); expect(r2.body.data!.recorded).toBe(true);
    const r3 = await ackFn(); expect(r3.body.data!.recorded).toBe(true);
    const r4 = await ackFn(); expect(r4.body.data!.recorded).toBe(false);
    expect(r4.body.data!.reason).toBe('frequency_capped');
    // Spend should have deducted exactly 3 cents (ceil(200/1000)=1 minor per imp).
    const c = await promotionCampaignRepo.findById(camp.id);
    expect(c!.estimated_spend_usd_minor).toBe(3);
    expect(c!.delivered_impressions).toBe(3);
  });

  it('invalid/tampered token is silently ignored', async () => {
    const r = await api<{ recorded: boolean; reason?: string }>('/track/sponsored/impression', {
      method: 'POST',
      headers: { Cookie: 'wl_anon_id=some-anon' },
      body: JSON.stringify({ attribution_token: 'garbage' }),
    });
    expect(r.body.data!.recorded).toBe(false);
  });
});

describe('M05.1.9 — Organic ranking isolation', () => {
  it('activating a sponsored campaign does not change organic search ordering for existing channels', async () => {
    // Set up: create the channel FIRST, so the organic list contains it in both snapshots.
    const owner = await signup();
    const ch = await ensureChannel(owner.userId);
    const before = await api<{ items: Array<{ id: string }> }>('/channels?limit=8', { method: 'GET' });
    // Now activate a sponsored campaign for the same channel.
    await seedActiveCampaign(owner.userId, ch.id, { placements: ['sponsored_search'] });
    const after = await api<{ items: Array<{ id: string }> }>('/channels?limit=8', { method: 'GET' });
    // Compare stable identity of the ordering — not full document snapshots
    // (updated_at changes on the seeded campaign\'s parent channel are legitimate).
    const beforeIds = (before.body.data!.items || []).map((c) => c.id);
    const afterIds = (after.body.data!.items || []).map((c) => c.id);
    expect(afterIds).toEqual(beforeIds);
  });
});

describe('M05.1.10 — Paid attribution follow-click preservation', () => {
  it('same session 3 raw follow_clicks with valid attribution_token → clicks=3, UFI=1, all sponsored', async () => {
    const owner = await signup();
    const ch = await ensureChannel(owner.userId);
    const camp = await seedActiveCampaign(owner.userId, ch.id);
    const anon = `follow-anon-${Date.now()}`;
    const token = issueAttributionToken({ campaign_id: camp.id, channel_id: ch.id, source: 'search', placement: 'sponsored_search', anonymous_session_id: anon });
    for (let i = 0; i < 3; i++) {
      const url = `http://localhost:3000/go/${ch.slug}?wl_at=${encodeURIComponent(token)}`;
      await fetch(url, { method: 'GET', headers: { Cookie: `wl_anon_id=${anon}` }, redirect: 'manual' });
    }
    // Give tracking a moment to persist (fire-and-forget).
    await new Promise((r) => setTimeout(r, 400));
    const events = await withDb(async (db) => db.collection('events')
      .find({ channel_id: ch.id, event_type: 'follow_click' }).toArray());
    expect(events.length).toBe(3);
    const sponsored = events.filter((e) => e.traffic_type === 'sponsored');
    expect(sponsored.length).toBe(3);
    expect(sponsored[0].campaign_id).toBe(camp.id);
    // UFI = unique sessions
    const sessions = new Set(events.map((e) => e.anonymous_session_id));
    expect(sessions.size).toBe(1);
  });
});
