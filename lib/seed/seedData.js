// Deterministic seed data. All demo channels are clearly marked is_demo=true
// so downstream analytics can exclude them from real metrics.
import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../db/mongo.js';
import { COLLECTIONS } from '../db/collections.js';
import { slugify } from '../utils/slug.js';

const CATEGORIES = [
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

const COUNTRIES = ['ID', 'IN', 'BR', 'US', 'MX', 'PH', 'MY', 'SG', 'TH', 'VN', 'GB'];

// 20 demo channels — all fictional. No real brand names claimed as official.
const DEMO_CHANNELS = [
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

export async function runSeed({ force = false } = {}) {
  const db = await getDb();
  const summary = { categories: 0, channels: 0, skipped: false };

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
      description: `${name} channels on WaveHub`,
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
    // Rebuild category slug → id map.
    const allCats = await categoriesColl.find({}).toArray();
    const bySlug = new Map(allCats.map(c => [c.slug, c.id]));
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
        verification_status: ch.featured ? 'verified' : 'unclaimed',
        is_official: false,
        is_featured: !!ch.featured,
        is_nsfw: false,
        is_demo: true, // clearly flagged demo/dev data
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
  return summary;
}

export const SEED_METADATA = {
  countries: COUNTRIES,
  categoryCount: CATEGORIES.length,
  demoChannelCount: DEMO_CHANNELS.length,
};
