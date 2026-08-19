import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../db/mongo';
import { COLLECTIONS } from '../db/collections';
import { slugify } from '../utils/slug';

interface DemoChannel {
  name: string; category: string; country: string; lang: string; desc: string; followers: number; featured?: boolean;
}

const CATEGORIES: [string, string][] = [
  ['News', 'newspaper'], ['Politics', 'landmark'], ['Entertainment', 'sparkles'],
  ['Sports', 'trophy'], ['Finance', 'line-chart'], ['Business', 'briefcase'],
  ['Technology', 'cpu'], ['Gaming', 'gamepad-2'], ['Music', 'music'],
  ['Movies & TV', 'clapperboard'], ['Creators', 'mic'], ['Lifestyle', 'leaf'],
  ['Fashion', 'shirt'], ['Beauty', 'sparkle'], ['Food', 'utensils'],
  ['Travel', 'plane'], ['Automotive', 'car'], ['Education', 'graduation-cap'],
  ['Deals', 'tag'], ['Shopping', 'shopping-bag'], ['Community', 'users'],
  ['Local', 'map-pin'], ['Jobs', 'briefcase-business'], ['AI', 'brain'],
  ['Crypto', 'bitcoin'],
];

export const COUNTRIES = ['ID', 'IN', 'BR', 'US', 'MX', 'PH', 'MY', 'SG', 'TH', 'VN', 'GB'];

const DEMO_CHANNELS: DemoChannel[] = [
  { name: 'Nusantara Daily', category: 'News', country: 'ID', lang: 'id', desc: 'Independent daily briefings on Indonesian current affairs.', followers: 128400, featured: true },
  { name: 'Wave Sports Weekly', category: 'Sports', country: 'ID', lang: 'id', desc: 'Football, badminton and MotoGP news every week.', followers: 87220, featured: true },
  { name: 'Fintech Pulse', category: 'Finance', country: 'SG', lang: 'en', desc: 'Southeast Asia fintech, banking and market moves.', followers: 54210, featured: true },
  { name: 'Rupiah Watch', category: 'Finance', country: 'ID', lang: 'id', desc: 'Personal finance and macro trends for Indonesian readers.', followers: 33110 },
  { name: 'CineNight', category: 'Movies & TV', country: 'US', lang: 'en', desc: 'Independent film picks, festival buzz, streaming recs.', followers: 42990, featured: true },
  { name: 'GameLoop Asia', category: 'Gaming', country: 'PH', lang: 'en', desc: 'Esports scores, mobile game meta and PC launches.', followers: 66780 },
  { name: 'Kompas AI', category: 'AI', country: 'ID', lang: 'id', desc: 'Weekly AI research summaries in Bahasa Indonesia.', followers: 24500, featured: true },
  { name: 'Neural Notes', category: 'AI', country: 'US', lang: 'en', desc: 'Digestible machine-learning research and product releases.', followers: 71230 },
  { name: 'Bloco Cripto', category: 'Crypto', country: 'BR', lang: 'pt', desc: 'Portuguese-language crypto news and on-chain analysis.', followers: 38200 },
  { name: 'Chennai Foodies', category: 'Food', country: 'IN', lang: 'en', desc: 'Street food, hidden gems and home recipes across Chennai.', followers: 51800 },
  { name: 'Bali Travel Diaries', category: 'Travel', country: 'ID', lang: 'en', desc: 'Real traveler tips, hotels, ferries and hidden beaches.', followers: 60110, featured: true },
  { name: 'Founder Field Notes', category: 'Business', country: 'US', lang: 'en', desc: 'Notes from operators building B2B SaaS companies.', followers: 29450 },
  { name: 'Deal Radar MY', category: 'Deals', country: 'MY', lang: 'en', desc: 'Malaysia flash sales, Shopee & Lazada coupons.', followers: 18600 },
  { name: 'Kerja Jakarta', category: 'Jobs', country: 'ID', lang: 'id', desc: 'Curated tech and creative roles in Jakarta.', followers: 22040 },
  { name: 'Wanderly UK', category: 'Travel', country: 'GB', lang: 'en', desc: 'Weekend getaways and rail deals across the UK.', followers: 15340 },
  { name: 'Style Manila', category: 'Fashion', country: 'PH', lang: 'en', desc: 'Filipino streetwear, drops and thrift finds.', followers: 26910 },
  { name: 'Auto Kaki', category: 'Automotive', country: 'MY', lang: 'en', desc: 'Car launches, EV news and mods, Malaysian scene.', followers: 19870 },
  { name: 'Ed Bright', category: 'Education', country: 'IN', lang: 'en', desc: 'Study strategies, exam updates and scholarship news.', followers: 44230 },
  { name: 'Community Corner', category: 'Community', country: 'ID', lang: 'id', desc: 'Local volunteer events and neighborhood updates.', followers: 9200 },
  { name: 'Beat Lab', category: 'Music', country: 'US', lang: 'en', desc: 'Producer tips, sample packs and interviews with DJs.', followers: 31780 },
];

export interface SeedResult { categories: number; channels: number; skipped: boolean; }

export async function runSeed({ force = false }: { force?: boolean } = {}): Promise<SeedResult> {
  const db = await getDb();
  const summary: SeedResult = { categories: 0, channels: 0, skipped: false };

  const categoriesColl = db.collection(COLLECTIONS.CATEGORIES);
  const channelsColl = db.collection(COLLECTIONS.CHANNELS);

  const existingCategories = await categoriesColl.countDocuments();
  if (existingCategories === 0 || force) {
    if (force) await categoriesColl.deleteMany({});
    const now = new Date();
    const docs = CATEGORIES.map(([name, icon], i) => ({
      id: uuidv4(),
      name,
      slug: slugify(name),
      description: `${name} channels on WaveLead`,
      icon,
      parent_id: null,
      is_active: true,
      display_order: i,
      created_at: now,
      updated_at: now,
    }));
    await categoriesColl.insertMany(docs, { ordered: false });
    summary.categories = docs.length;
  }

  const existingChannels = await channelsColl.countDocuments();
  if (existingChannels === 0 || force) {
    if (force) await channelsColl.deleteMany({ is_demo: true });
    const allCats = await categoriesColl.find({}).toArray();
    const bySlug = new Map<string, string>(allCats.map((c) => [c.slug as string, c.id as string]));
    const now = new Date();
    const docs = DEMO_CHANNELS.map((ch, i) => {
      const slug = slugify(ch.name);
      return {
        id: uuidv4(),
        slug,
        name: ch.name,
        whatsapp_url: `https://whatsapp.com/channel/demo-${slug}-${i}`,
        description: ch.desc,
        short_description: ch.desc.length > 90 ? ch.desc.slice(0, 87) + '...' : ch.desc,
        logo_url: null,
        cover_url: null,
        website_url: null,
        country_code: ch.country,
        primary_language: ch.lang,
        category_id: bySlug.get(slugify(ch.category)) || null,
        owner_id: null,
        status: 'approved',
        // verification_status='verified' MUST always coexist with an owner_id.
        // Seed data has no owner, so start unclaimed. Featured curation is
        // independent of ownership verification.
        verification_status: 'unclaimed',
        is_official: false,
        is_featured: !!ch.featured,
        is_nsfw: false,
        is_demo: true,
        activity_level: 'active',
        follower_count: ch.followers,
        follower_count_source: 'demo_seed',
        follower_count_updated_at: now,
        created_at: now,
        updated_at: now,
        published_at: now,
      };
    });
    await channelsColl.insertMany(docs, { ordered: false });
    summary.channels = docs.length;
  }

  if (summary.categories === 0 && summary.channels === 0) summary.skipped = true;
  await seedPromotionRateCards();
  await grandfatherPreM06Campaigns();
  return summary;
}

// ----- M06.0: mark pre-existing already-approved campaigns as `legacy_waived`
// so they keep serving after M06 gating goes live. Idempotent: only inserts a
// waiver funding row when NO funding row exists yet for the campaign.
async function grandfatherPreM06Campaigns(): Promise<void> {
  const { promotionCampaignRepo } = await import('@/lib/repositories/promotionRepo');
  const { paymentFundingOrderRepo } = await import('@/lib/repositories/paymentRepo');
  const { v4: uuidv4 } = await import('uuid');
  const camps = await promotionCampaignRepo.list({
    status: { $in: ['approved', 'scheduled', 'active', 'paused'] },
  } as unknown as Record<string, unknown>);
  const now = new Date();
  for (const c of camps) {
    const existing = await paymentFundingOrderRepo.listForCampaign(c.id);
    if (existing.length > 0) continue;
    await paymentFundingOrderRepo.insert({
      id: uuidv4(), campaign_id: c.id, owner_user_id: c.owner_user_id,
      provider: 'paypal', provider_order_id: null, provider_capture_id: null,
      currency: 'USD', amount_minor: 0, amount_captured_minor: 0, amount_refunded_minor: 0,
      amount_usd_micros: 0,
      status: 'legacy_waived',
      approve_url: null, return_url: null, cancel_url: null,
      paid_at: null, cancelled_at: null, refunded_at: null,
      created_at: now, updated_at: now,
    });
    // Phase 3: seed the cached funded amount so atomicDeliverImpression's
    // funds check treats legacy campaigns as fully covered by their budget.
    // No ledger transaction is posted — legacy campaigns are grandfathered,
    // not "fake-funded". checkIntegrity() only reasons about ledger rows.
    if ((c.funded_amount_usd_micros ?? 0) < c.budget_total_usd_minor * 10_000) {
      await promotionCampaignRepo.incrementFundedAmount(c.id, c.budget_total_usd_minor * 10_000 - (c.funded_amount_usd_micros ?? 0));
    }
  }
}

// ----- M05.1: Idempotent QA fixture: $2.00 CPM global rate per placement.
// Production admins can override per placement + country via /admin/promotion-rates.
async function seedPromotionRateCards(): Promise<void> {
  const { promotionRateCardRepo } = await import('@/lib/repositories/promotionRepo');
  const { SPONSORED_PLACEMENTS } = await import('@/lib/types');
  const now = new Date();
  for (const placement of SPONSORED_PLACEMENTS) {
    const seed_key = `m051_default_global_${placement}`;
    await promotionRateCardRepo.upsertBySeedKey(seed_key, {
      id: `seed-${placement}`,
      placement,
      country_code: null,
      pricing_model: 'cpm',
      cpm_usd_minor: 200, // $2.00 CPM QA fixture
      active: true,
      effective_from: now,
      effective_to: null,
      is_fixture: true,
      seed_key,
      created_at: now,
      updated_at: now,
      created_by: 'seed',
    });
  }
}

export const SEED_METADATA = {
  countries: COUNTRIES,
  categoryCount: CATEGORIES.length,
  demoChannelCount: DEMO_CHANNELS.length,
};
