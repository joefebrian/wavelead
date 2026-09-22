// M19.2 — Preview-only smoke campaign fixture.
//
// Creates EXACTLY ONE clearly-labelled internal brand campaign so we can walk
// the full Brand-side production flow (create → fund commitment via PROVIDER
// abstraction → open → applicant view → capacity preview) on a safe surface.
//
// Safety invariants:
//   • NEVER runs against production. Refuses if NODE_ENV === 'production'.
//   • NEVER performs a real-money PayPal call. The captured 5% Campaign
//     Commitment row is written directly into the LOCAL preview DB so no
//     provider is charged. The campaign is labelled internally so it can be
//     removed by slug/name/id later.
//   • Owner 90 / WaveLead 10, funded_capacity, and Payment Protection are
//     NEVER touched here. All financial logic remains authoritative in the
//     services and their tests.
import { MongoClient } from 'mongodb';
import { randomUUID, randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';

const BASE = 'http://localhost:3000';
const MONGO = process.env.MONGO_URL || 'mongodb://localhost:27017';
const DB = process.env.DB_NAME || 'wavelead';

if ((process.env.NODE_ENV || '').toLowerCase() === 'production') {
  console.error('Refusing to seed the smoke campaign against production.');
  process.exit(2);
}

const LABEL = '[SMOKE-TEST · INTERNAL · DO NOT USE]';
const BRAND_EMAIL = 'wl-smoke-brand@wavelead.dev';
const CAMPAIGN_NAME = `${LABEL} M19.2 Smoke Campaign`;
const BRAND_DISPLAY_NAME = 'WaveLead Smoke Test (Internal)';
const pw = (randomBytes(12).toString('base64').replace(/[^A-Za-z0-9]/g, '') + 'Aa1!').slice(0, 16);

async function api(path, body, cookie) {
  const r = await fetch(`${BASE}/api${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10_000),
  });
  const j = await r.json().catch(() => null);
  return { status: r.status, json: j, setCookie: r.headers.get('set-cookie') || '' };
}
async function signupOrLogin() {
  let r = await api('/auth/signup', { email: BRAND_EMAIL, password: pw, display_name: BRAND_DISPLAY_NAME });
  if (r.status === 409) r = await api('/auth/login', { email: BRAND_EMAIL, password: pw });
  if (!r.setCookie) throw new Error(`no session: ${r.status} ${JSON.stringify(r.json)}`);
  return r.setCookie.split(';')[0];
}

const client = new MongoClient(MONGO);
await client.connect();
const db = client.db(DB);

// Idempotent: if a smoke campaign already exists, reuse it.
let existing = await db.collection('brand_campaigns').findOne({ name: CAMPAIGN_NAME });
const cookie = await signupOrLogin();
const brandUser = await db.collection('users').findOne({ email: BRAND_EMAIL });

let campaign = existing;
if (!campaign) {
  const create = await api('/brand/campaigns', {
    name: CAMPAIGN_NAME,
    brand_name: BRAND_DISPLAY_NAME,
    objective: 'Awareness',
    brief: 'INTERNAL SMOKE TEST — verifies the production Brand-side campaign UI end-to-end. Not a real offer.',
    target_country_codes: ['ID'],
    target_category_slugs: [],
    budget_total_usd_minor: 500_000, // $5,000 planning budget
    deliverables: '1 sponsored post',
    creator_requirements: 'Internal smoke fixture only',
    application_deadline: new Date(Date.now() + 30 * 864e5).toISOString(),
  }, cookie);
  if (!create.json?.data?.campaign) throw new Error(`create failed: ${create.status} ${JSON.stringify(create.json)}`);
  campaign = create.json.data.campaign;
}

// Write a captured commitment row directly (LOCAL DB only — NO provider call,
// NO real money, NO fake capture id from PayPal). Marked provider='qa-fixture'.
const already = await db.collection('brand_campaign_commitments').findOne({ campaign_id: campaign.id, status: 'captured' });
if (!already) {
  await db.collection('brand_campaign_commitments').insertOne({
    id: randomUUID(),
    campaign_id: campaign.id,
    brand_user_id: brandUser.id,
    payment_purpose: 'CAMPAIGN_COMMITMENT_DEPOSIT',
    provider: 'qa-fixture',
    provider_order_id: `smoke-${randomUUID()}`,
    provider_capture_id: `smoke-cap-${randomUUID()}`,
    currency: 'USD',
    campaign_budget_snapshot_minor: campaign.budget_total_usd_minor,
    commitment_percent: 5,
    required_commitment_amount_minor: Math.round(campaign.budget_total_usd_minor * 5 / 100),
    amount_minor: Math.round(campaign.budget_total_usd_minor * 5 / 100),
    captured_amount_minor: Math.round(campaign.budget_total_usd_minor * 5 / 100),
    refunded_amount_minor: 0,
    refund_refs: [],
    finalization_mismatch: null,
    status: 'captured',
    approve_url: null,
    return_url: '',
    cancel_url: '',
    captured_at: new Date(),
    created_at: new Date(),
    updated_at: new Date(),
  });
}
const open = await api(`/brand/campaigns/${campaign.id}/open`, {}, cookie);

writeFileSync('/app/memory/smoke_campaign_ephemeral.txt',
  `# PREVIEW ONLY — M19.2 smoke campaign fixture (never production, never a real payment)\n`
  + `campaign_id: ${campaign.id}\n`
  + `campaign_name: ${CAMPAIGN_NAME}\n`
  + `brand_email: ${BRAND_EMAIL}\n`
  + `brand_password: ${pw}\n`
  + `provider_marker: qa-fixture (no real PayPal call)\n`,
  { mode: 0o600 });

console.log(JSON.stringify({
  environment: process.env.NODE_ENV || 'development',
  base_url: BASE,
  smoke_campaign_id: campaign.id,
  smoke_campaign_label: CAMPAIGN_NAME,
  brand_email: BRAND_EMAIL,
  provider_marker: 'qa-fixture',
  open_status: open.status,
  real_money_captured: false,
  paypal_called: false,
}, null, 2));
await client.close();
