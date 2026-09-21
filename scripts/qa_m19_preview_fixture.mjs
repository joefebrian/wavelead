// M19 post-production UI pass — PREVIEW/LOCAL fixture only.
//
// Creates a brand user, a creator user with an approved+verified channel
// (rate card + sample work), one FUNDED campaign with applications and one
// UNFUNDED campaign, so the deployed M19 surfaces can be visually verified.
//
// NEVER run against production. No payment provider is called: the captured
// Campaign Commitment row is written directly into the LOCAL database.
import { MongoClient } from 'mongodb';
import { randomUUID } from 'node:crypto';
import { writeFileSync, readFileSync } from 'node:fs';

const BASE = 'http://localhost:3000';
const MONGO = process.env.MONGO_URL || 'mongodb://localhost:27017';
const DB = process.env.DB_NAME || 'wavelead';
const STAMP = 'm19qa';

const pw = (readFileSync('/dev/urandom').slice(0, 12).toString('base64').replace(/[^A-Za-z0-9]/g, '') + 'Aa1!').slice(0, 16);
const brandEmail = `${STAMP}-brand@wavelead.dev`;
const creatorEmail = `${STAMP}-creator@wavelead.dev`;
const adminEmail = `${STAMP}-admin@wavelead.dev`;

async function api(path, body, cookie) {
  const r = await fetch(`${BASE}/api${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => null);
  return { status: r.status, json: j, setCookie: r.headers.get('set-cookie') || '' };
}

async function signupOrLogin(email, name) {
  let r = await api('/auth/signup', { email, password: pw, display_name: name });
  if (r.status === 409) r = await api('/auth/login', { email, password: pw });
  if (!r.setCookie) throw new Error(`no session for ${email}: ${r.status} ${JSON.stringify(r.json)}`);
  return r.setCookie.split(';')[0];
}

const client = new MongoClient(MONGO);
await client.connect();
const db = client.db(DB);

// ---- users + sessions
const brandCookie = await signupOrLogin(brandEmail, 'M19 QA Brand');
const creatorCookie = await signupOrLogin(creatorEmail, 'M19 QA Creator');
const adminCookie = await signupOrLogin(adminEmail, 'M19 QA Admin');
await db.collection('users').updateOne({ email: adminEmail }, { $set: { role: 'super_admin' } });
const creator = await db.collection('users').findOne({ email: creatorEmail });

// ---- creator channel with rate card + sample work
const chId = randomUUID();
const cat = await db.collection('categories').findOne({ is_active: true });
await db.collection('channels').deleteMany({ slug: `${STAMP}-channel` });
await db.collection('channels').insertOne({
  id: chId, slug: `${STAMP}-channel`, name: 'M19 QA Tech Daily', status: 'approved',
  owner_id: creator.id, submitted_by: creator.id, verification_status: 'verified',
  whatsapp_url: 'https://whatsapp.com/channel/0029VaM19QA', country_code: 'ID',
  category_id: cat?.id ?? null, logo_url: null,
  description: 'QA fixture channel for the M19 applicant pool visual pass.',
  follower_count: 12000, public_followers_count: 18400,
  language: 'id', is_featured: false, created_at: new Date(), updated_at: new Date(),
});
await db.collection('channel_rate_cards').deleteMany({ channel_id: chId });
await db.collection('channel_rate_cards').insertOne({
  id: randomUUID(), channel_id: chId, owner_user_id: creator.id,
  packages: [{
    id: randomUUID(), type: 'single_post', name: 'Single sponsored post',
    description: 'One sponsored post to the full channel audience.',
    price_minor: 250_000, currency: 'USD', deliverables: ['1 post', 'link in caption'],
    estimated_delivery_days: 3, is_active: true, created_at: new Date(), updated_at: new Date(),
  }],
  created_at: new Date(), updated_at: new Date(),
});
await db.collection('channel_sample_works').deleteMany({ channel_id: chId });
await db.collection('channel_sample_works').insertOne({
  id: randomUUID(), channel_id: chId, owner_user_id: creator.id, type: 'sponsored_post',
  title: 'Previous sponsored post', description: 'A past brand collaboration.',
  url: 'https://example.com/m19-qa-sample', created_at: new Date(), updated_at: new Date(),
});

// ---- campaigns
const input = (name, budget) => ({
  name, brand_name: 'Acme Labs (QA)', objective: 'Awareness',
  brief: 'Introduce our new app to Indonesian tech audiences with one sponsored post per channel.',
  target_country_codes: ['ID'], target_category_slugs: [],
  budget_total_usd_minor: budget, deliverables: '1 sponsored post',
  creator_requirements: 'Tech audience, minimum 10k followers',
  application_deadline: new Date(Date.now() + 30 * 864e5).toISOString(),
});
await db.collection('brand_campaigns').deleteMany({ name: { $regex: `^${STAMP}` } });
const funded = (await api('/brand/campaigns', input(`${STAMP} funded launch`, 1_000_000), brandCookie)).json?.data?.campaign;
const unfunded = (await api('/brand/campaigns', input(`${STAMP} unfunded launch`, 400_000), brandCookie)).json?.data?.campaign;
if (!funded || !unfunded) throw new Error('campaign creation failed');

// Captured commitment written directly (LOCAL DB, no provider call, no money).
await db.collection('brand_campaign_commitments').insertOne({
  id: randomUUID(), campaign_id: funded.id, brand_user_id: (await db.collection('users').findOne({ email: brandEmail })).id,
  payment_purpose: 'CAMPAIGN_COMMITMENT_DEPOSIT', provider: 'qa-fixture',
  provider_order_id: `qa-${randomUUID()}`, provider_capture_id: `qa-cap-${randomUUID()}`,
  currency: 'USD', campaign_budget_snapshot_minor: 1_000_000, commitment_percent: 5,
  required_commitment_amount_minor: 50_000, amount_minor: 50_000, captured_amount_minor: 50_000,
  refunded_amount_minor: 0, refund_refs: [], finalization_mismatch: null,
  status: 'captured', approve_url: null, return_url: '', cancel_url: '',
  captured_at: new Date(), created_at: new Date(), updated_at: new Date(),
});
const open = await api(`/brand/campaigns/${funded.id}/open`, {}, brandCookie);

// ---- applications from the creator
const apply = await api(`/campaign-opportunities/${funded.id}/apply`, {
  channel_id: chId, proposed_rate_usd_minor: 250_000,
  pitch: 'Our audience is Jakarta-based tech professionals who engage heavily with app launches.',
  audience_note: 'Mostly 25-34, Jakarta and Bandung', message_to_brand: 'Happy to align on the posting date.',
}, creatorCookie);
const appId = apply.json?.data?.application?.id;
if (appId) await api(`/brand/campaign-applications/${appId}/approve`, {}, brandCookie);

writeFileSync('/app/memory/qa_credentials_ephemeral.txt',
  `# PREVIEW/LOCAL ONLY — M19 post-production UI pass fixture (never production)\n`
  + `password_for_all_three: ${pw}\n${brandEmail}\n${creatorEmail}\n${adminEmail}\n`, { mode: 0o600 });

console.log(JSON.stringify({
  funded_campaign: funded.id, funded_open_status: open.status,
  unfunded_campaign: unfunded.id, application: appId, channel: chId,
  brand: brandEmail, creator: creatorEmail, admin: adminEmail,
}, null, 2));
await client.close();
