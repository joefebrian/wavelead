// Phase A — Sponsored ranking + relevance gate + pacing (M08.A).
//
// 15 targeted tests covering:
//   §1 Relevance HARD gate (no budget can override)
//   §2 Budget is NEVER a direct ranking variable
//   §3 Quality signals (verification, completeness, cold-start neutral)
//   §4 Time pacing (throttle + catch-up + budget hard cap)
//   §5 Placement smoke — all 5 sponsored surfaces still work
//
// FINANCIAL LOGIC IS UNCHANGED — this suite only exercises the ranking module
// and the delivery service. Impression acknowledgement / ledger paths remain
// covered by M06.0 tests which continue to pass in the regression run.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MongoClient, type Db } from 'mongodb';
import { v4 as uuidv4 } from 'uuid';
import { promotionCampaignRepo } from '@/lib/repositories/promotionRepo';
import { promotionDeliveryService } from '@/lib/services/promotion/deliveryService';
import { scoreCandidate, isEligibleByRelevance, computePacing, computeQuality, computeRelevance, MIN_RELEVANCE_THRESHOLD } from '@/lib/services/promotion/sponsoredRankingService';
import { runSeed } from '@/lib/seed/seedData';
import type { PromotionCampaign, SponsoredPlacement, Channel } from '@/lib/types';

async function withDb<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  const client = new MongoClient(process.env.MONGO_URL || 'mongodb://localhost:27017');
  await client.connect();
  try { return await fn(client.db(process.env.DB_NAME || 'wavelead')); } finally { await client.close(); }
}

// ----- seed helpers (mirror m051.test.ts) -----
async function seedChannel(opts: {
  name?: string; description?: string; country?: string; language?: string;
  verified?: 'verified' | 'official' | 'claimed'; logo?: boolean; category?: string;
} = {}): Promise<Channel> {
  const id = uuidv4();
  const slug = `m08a-ch-${id.slice(0, 8)}`;
  const now = new Date();
  const doc = {
    id, slug,
    name: opts.name || `M08A ${id.slice(0, 6)}`,
    whatsapp_url: `https://whatsapp.com/channel/0029Va${id.slice(0, 20).replace(/-/g, '')}`,
    whatsapp_channel_id: `0029Va${id.slice(0, 20).replace(/-/g, '')}`,
    description: opts.description || 'a completely-populated test channel description',
    short_description: opts.description || 'a completely-populated test channel description',
    logo_url: opts.logo === false ? null : 'https://example.com/logo.png',
    cover_url: null, website_url: null,
    country_code: opts.country || 'ID',
    primary_language: opts.language || 'id',
    category_slug: opts.category || 'tech',
    primary_category_slug: opts.category || 'tech',
    category_id: null,
    owner_id: null,
    status: 'approved',
    verification_status: opts.verified || 'verified',
    is_official: opts.verified === 'official',
    is_featured: false, is_nsfw: false, is_demo: false,
    activity_level: 'active',
    follower_count: 1000, follower_count_source: 'test', follower_count_updated_at: now,
    created_at: now, updated_at: now, published_at: now,
  };
  await withDb(async (db) => { await db.collection('channels').insertOne(doc); });
  return doc as unknown as Channel;
}

async function seedCampaign(channelId: string, opts: {
  placements?: SponsoredPlacement[]; budget?: number; spent?: number;
  countries?: string[]; languages?: string[]; categories?: string[];
  start_offset_ms?: number; end_offset_ms?: number;
  delivered_impressions?: number;
} = {}): Promise<PromotionCampaign> {
  const now = new Date();
  const placements = opts.placements || ['sponsored_search'];
  const camp: PromotionCampaign = {
    id: uuidv4(),
    owner_user_id: 'seed-owner',
    channel_id: channelId,
    name: 'seed camp',
    objective: 'visibility',
    placements,
    targeting: { countries: (opts.countries || []).map((c) => c.toUpperCase()), languages: opts.languages || [], categories: opts.categories || [] },
    budget_total_usd_minor: opts.budget ?? 2000,
    budget_daily_usd_minor: null,
    start_at: new Date(now.getTime() + (opts.start_offset_ms ?? -3600_000)),
    end_at: new Date(now.getTime() + (opts.end_offset_ms ?? 86400_000)),
    status: 'active',
    rate_snapshot: placements.map((p) => ({ placement: p, pricing_model: 'cpm', cpm_usd_minor: 200, rate_card_id: `seed-${p}`, country_code: null, resolved_at: now })),
    delivered_impressions: opts.delivered_impressions ?? 0,
    estimated_spend_usd_minor: opts.spent ?? 0,
    created_at: now, updated_at: now, submitted_at: now,
    reviewed_at: now, reviewed_by: 'admin', rejection_reason: null, rejection_notes: null,
    activated_at: now, paused_at: null, completed_at: null, cancelled_at: null,
  };
  await promotionCampaignRepo.insert(camp);
  // Fund the campaign so the delivery gate accepts it.
  const { paymentFundingOrderRepo } = await import('@/lib/repositories/paymentRepo');
  await paymentFundingOrderRepo.insert({
    id: uuidv4(), campaign_id: camp.id, owner_user_id: 'seed-owner',
    provider: 'paypal', provider_order_id: null, provider_capture_id: null,
    currency: 'USD', amount_minor: 0, amount_captured_minor: 0, amount_refunded_minor: 0,
    amount_usd_micros: 0, status: 'legacy_waived',
    approve_url: null, return_url: null, cancel_url: null,
    paid_at: null, cancelled_at: null, refunded_at: null,
    created_at: now, updated_at: now,
  });
  await promotionCampaignRepo.incrementFundedAmount(camp.id, camp.budget_total_usd_minor * 10_000);
  return camp;
}

async function purge() {
  await withDb(async (db) => {
    await db.collection('channels').deleteMany({ slug: /^m08a-/ });
    await db.collection('promotion_campaigns').deleteMany({ owner_user_id: 'seed-owner' });
    await db.collection('payment_funding_orders').deleteMany({ owner_user_id: 'seed-owner' });
    await db.collection('campaign_impression_dedup').deleteMany({});
  });
}
beforeAll(async () => { await purge(); await runSeed({}); });
afterAll(async () => { await purge(); });

// ============================================================================
// §1 — Relevance HARD gate
// ============================================================================
describe('M08.A §1 — Relevance HARD gate', () => {
  it('#1 sponsored_search: relevance BELOW threshold makes campaign INELIGIBLE regardless of budget size', async () => {
    // Highly irrelevant channel (name/description have no shared tokens with query) + huge budget.
    const ch = await seedChannel({ name: 'Zebra Zoo', description: 'wildlife zoology safari' });
    const camp = await seedCampaign(ch.id, { placements: ['sponsored_search'], budget: 10_000_000_00 });
    const cands = await promotionDeliveryService.selectCandidates({
      placement: 'sponsored_search', search_query: 'crypto trading bitcoin', anonymous_session_id: `s-${Date.now()}`,
    }, 50);
    expect(cands.find((c) => c.campaign_id === camp.id)).toBeUndefined();
  });

  it('#2 sponsored_search: high-budget low-relevance loses to low-budget high-relevance', async () => {
    // Big-budget generic channel
    const bigCh = await seedChannel({ name: 'General News', description: 'general news updates for everyone' });
    const bigCamp = await seedCampaign(bigCh.id, { placements: ['sponsored_search'], budget: 10_000_000_00 });
    // Small-budget targeted channel
    const preciseCh = await seedChannel({ name: 'Bitcoin Trading Signals', description: 'bitcoin ethereum crypto trading signals daily' });
    const preciseCamp = await seedCampaign(preciseCh.id, { placements: ['sponsored_search'], budget: 500 });
    const cands = await promotionDeliveryService.selectCandidates({
      placement: 'sponsored_search', search_query: 'bitcoin trading signals', anonymous_session_id: `s-${Date.now()}`,
    }, 5);
    const preciseIdx = cands.findIndex((c) => c.campaign_id === preciseCamp.id);
    const bigIdx = cands.findIndex((c) => c.campaign_id === bigCamp.id);
    // The precise campaign must beat the huge-budget generic one.
    expect(preciseIdx).toBeGreaterThanOrEqual(0);
    if (bigIdx >= 0) expect(preciseIdx).toBeLessThan(bigIdx);
  });

  it('#3 isEligibleByRelevance / MIN_RELEVANCE_THRESHOLD are exported and behave', () => {
    expect(MIN_RELEVANCE_THRESHOLD).toBeGreaterThan(0);
    expect(MIN_RELEVANCE_THRESHOLD).toBeLessThan(1);
    expect(isEligibleByRelevance(0)).toBe(false);
    expect(isEligibleByRelevance(1)).toBe(true);
    expect(isEligibleByRelevance(MIN_RELEVANCE_THRESHOLD - 0.001)).toBe(false);
    expect(isEligibleByRelevance(MIN_RELEVANCE_THRESHOLD)).toBe(true);
  });
});

// ============================================================================
// §2 — Budget is NEVER a direct ranking variable
// ============================================================================
describe('M08.A §2 — Budget is not a direct ranking variable', () => {
  it('#4 two campaigns identical in everything except budget → sponsored_rank is EQUAL', async () => {
    const chA = await seedChannel({ name: 'Alpha Beta', description: 'alpha beta gamma content' });
    const chB = await seedChannel({ name: 'Alpha Beta', description: 'alpha beta gamma content' });
    const campA = await seedCampaign(chA.id, { budget: 100 });
    const campB = await seedCampaign(chB.id, { budget: 100_000 });
    const now = new Date();
    const ctx = { placement: 'sponsored_search' as const, country_code: 'ID', language: 'id', category_slug: 'tech', search_query: 'alpha beta', exclude_channel_id: null, now };
    const rA = scoreCandidate(campA, chA, ctx);
    const rB = scoreCandidate(campB, chB, ctx);
    expect(rA.sponsored_rank).toBeCloseTo(rB.sponsored_rank, 6);
    expect(rA.relevance).toBeCloseTo(rB.relevance, 6);
    expect(rA.quality).toBeCloseTo(rB.quality, 6);
    expect(rA.pacing_score).toBeCloseTo(rB.pacing_score, 6);
  });
});

// ============================================================================
// §3 — Quality signals
// ============================================================================
describe('M08.A §3 — Quality signals', () => {
  it('#5 verified channel scores higher than claimed-only channel on quality', async () => {
    const chVerified = await seedChannel({ verified: 'verified' });
    const chClaimed = await seedChannel({ verified: 'claimed' });
    const camp = await seedCampaign(chVerified.id, {});
    const qV = computeQuality(camp, chVerified);
    const qC = computeQuality(camp, chClaimed);
    expect(qV).toBeGreaterThan(qC);
  });

  it('#6 official channel scores higher than verified channel on quality', async () => {
    const chOfficial = await seedChannel({ verified: 'official' });
    const chVerified = await seedChannel({ verified: 'verified' });
    const camp = await seedCampaign(chOfficial.id, {});
    const qO = computeQuality(camp, chOfficial);
    const qV = computeQuality(camp, chVerified);
    expect(qO).toBeGreaterThan(qV);
  });

  it('#7 cold-start (0 impressions) campaign gets a NEUTRAL quality baseline (not zero)', async () => {
    const ch = await seedChannel({ verified: 'verified' });
    const camp = await seedCampaign(ch.id, { delivered_impressions: 0 });
    const q = computeQuality(camp, ch);
    // Neutral baseline must comfortably exceed 0.5 for a verified channel with a complete profile.
    expect(q).toBeGreaterThanOrEqual(0.6);
  });

  it('#8 quality signal alone cannot override relevance below threshold', async () => {
    // Verified + complete channel but query has zero token overlap.
    const ch = await seedChannel({ verified: 'official', name: 'Alpha', description: 'alpha beta' });
    const camp = await seedCampaign(ch.id, { placements: ['sponsored_search'], budget: 100_000 });
    const cands = await promotionDeliveryService.selectCandidates({
      placement: 'sponsored_search', search_query: 'crypto blockchain nft', anonymous_session_id: `s-${Date.now()}`,
    }, 10);
    expect(cands.find((c) => c.campaign_id === camp.id)).toBeUndefined();
  });
});

// ============================================================================
// §4 — Time pacing
// ============================================================================
describe('M08.A §4 — Time pacing', () => {
  it('#9 heavily over-paced campaign is paced_out AND filtered from delivery', async () => {
    // 1 day into a 10-day schedule → target_spend = 10%. Already spent 90%.
    const ch = await seedChannel({ name: 'Bitcoin Alpha', description: 'bitcoin content daily' });
    const camp = await seedCampaign(ch.id, {
      placements: ['sponsored_search'],
      budget: 10_000,
      spent: 9_000,          // 90% spent
      start_offset_ms: -1 * 86400_000,       // 1 day elapsed
      end_offset_ms:    9 * 86400_000,       // 9 days remain
    });
    const p = computePacing(camp, new Date());
    expect(p.paced_out).toBe(true);
    const cands = await promotionDeliveryService.selectCandidates({
      placement: 'sponsored_search', search_query: 'bitcoin content daily', anonymous_session_id: `s-${Date.now()}`,
    }, 50);
    expect(cands.find((c) => c.campaign_id === camp.id)).toBeUndefined();
  });

  it('#10 under-delivered campaign in final 10% window gets a catchup exemption (not paced_out)', async () => {
    // 95% through schedule, only 30% spent → catchup exempt.
    const ch = await seedChannel({ name: 'Bitcoin Alpha', description: 'bitcoin content daily' });
    const camp = await seedCampaign(ch.id, {
      placements: ['sponsored_search'],
      budget: 10_000,
      spent: 3_000,          // 30% spent
      start_offset_ms: -95 * 3600_000,       // 95h elapsed
      end_offset_ms:    5 * 3600_000,        // 5h remain (~5% of a 100h schedule)
    });
    const p = computePacing(camp, new Date());
    expect(p.catchup_exempt).toBe(true);
    expect(p.paced_out).toBe(false);
    // And its pacing_score is boosted for the catchup window.
    expect(p.pacing_score).toBeGreaterThanOrEqual(0.7);
  });

  it('#11 fresh campaign (very small elapsed_fraction) is NOT immediately throttled', async () => {
    // 30 seconds into a 10-day schedule with tiny spend.
    const ch = await seedChannel({ name: 'Bitcoin Alpha', description: 'bitcoin content daily' });
    const camp = await seedCampaign(ch.id, {
      placements: ['sponsored_search'],
      budget: 10_000,
      spent: 0,
      start_offset_ms: -30_000,
      end_offset_ms:    10 * 86400_000,
    });
    const p = computePacing(camp, new Date());
    expect(p.paced_out).toBe(false);
    expect(p.pacing_score).toBeGreaterThan(0.5);
  });

  it('#12 pacing does NOT protect against budget hard cap — a fully-spent campaign is still ineligible', async () => {
    // 50% through schedule, budget fully consumed → budget guard kicks in
    // BEFORE the pacing_score sort even runs.
    const ch = await seedChannel({ name: 'Bitcoin Alpha', description: 'bitcoin content daily' });
    const camp = await seedCampaign(ch.id, {
      placements: ['sponsored_search'],
      budget: 10_000,
      spent: 10_000,
      start_offset_ms: -5 * 86400_000,
      end_offset_ms:    5 * 86400_000,
    });
    const cands = await promotionDeliveryService.selectCandidates({
      placement: 'sponsored_search', search_query: 'bitcoin content daily', anonymous_session_id: `s-${Date.now()}`,
    }, 50);
    expect(cands.find((c) => c.campaign_id === camp.id)).toBeUndefined();
  });
});

// ============================================================================
// §5 — Placement smoke — all 5 sponsored surfaces still work
// ============================================================================
describe('M08.A §5 — Placement smoke (all 5 sponsored surfaces still deliver)', () => {
  it('#13 homepage / country / category placements return the eligible candidate', async () => {
    const ch = await seedChannel({ country: 'ID', language: 'id', category: 'tech' });
    const camp = await seedCampaign(ch.id, {
      placements: ['sponsored_homepage', 'sponsored_country', 'sponsored_category'],
      countries: ['ID'], languages: ['id'], categories: ['tech'],
    });
    const hp = await promotionDeliveryService.selectCandidates({
      placement: 'sponsored_homepage', country_code: 'ID', language: 'id', anonymous_session_id: `s-${Date.now()}-hp`,
    }, 5);
    const co = await promotionDeliveryService.selectCandidates({
      placement: 'sponsored_country', country_code: 'ID', anonymous_session_id: `s-${Date.now()}-co`,
    }, 5);
    const ca = await promotionDeliveryService.selectCandidates({
      placement: 'sponsored_category', category_slug: 'tech', anonymous_session_id: `s-${Date.now()}-ca`,
    }, 5);
    expect(hp.find((c) => c.campaign_id === camp.id)).toBeTruthy();
    expect(co.find((c) => c.campaign_id === camp.id)).toBeTruthy();
    expect(ca.find((c) => c.campaign_id === camp.id)).toBeTruthy();
  });

  it('#14 sponsored_related_channel excludes the source channel and returns an eligible sibling', async () => {
    const source = await seedChannel({ category: 'tech', language: 'en' });
    const sibling = await seedChannel({ category: 'tech', language: 'en' });
    const camp = await seedCampaign(sibling.id, {
      placements: ['sponsored_related_channel'], categories: ['tech'], languages: ['en'],
    });
    const cands = await promotionDeliveryService.selectCandidates({
      placement: 'sponsored_related_channel', category_slug: 'tech', language: 'en',
      exclude_channel_id: source.id, anonymous_session_id: `s-${Date.now()}-rel`,
    }, 10);
    expect(cands.find((c) => c.campaign_id === camp.id)).toBeTruthy();
    expect(cands.find((c) => c.channel.id === source.id)).toBeUndefined();
  });

  it('#15 sponsored_search returns the highly-relevant candidate for its query', async () => {
    const ch = await seedChannel({ name: 'Bitcoin Signals', description: 'bitcoin trading signals daily' });
    const camp = await seedCampaign(ch.id, { placements: ['sponsored_search'], budget: 5_000 });
    const cands = await promotionDeliveryService.selectCandidates({
      placement: 'sponsored_search', search_query: 'bitcoin trading signals', anonymous_session_id: `s-${Date.now()}-sr`,
    }, 5);
    expect(cands.find((c) => c.campaign_id === camp.id)).toBeTruthy();
  });
});

// (Extra internal sanity: computeRelevance zero-overlap on search)
describe('M08.A §6 — Internal invariant', () => {
  it('computeRelevance for sponsored_search with zero query overlap is below the threshold', () => {
    const ch = { id: 'x', name: 'Nothing', short_description: 'nothing', country_code: 'ID', primary_language: 'id', logo_url: null } as unknown as Channel;
    const camp = { placements: ['sponsored_search'], targeting: { countries: [], languages: [], categories: [] } } as unknown as PromotionCampaign;
    const r = computeRelevance(camp, ch, {
      placement: 'sponsored_search', country_code: null, language: null, category_slug: null,
      search_query: 'quantum entanglement bitcoin', exclude_channel_id: null, now: new Date(),
    });
    expect(r).toBeLessThan(MIN_RELEVANCE_THRESHOLD);
  });
});
