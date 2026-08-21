// M07-Lite Sponsorship Leads — targeted regression suite.
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
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': CLIENT_IP, ...(init.headers || {}) },
  });
  let body: { ok?: boolean; data?: T; error?: string } = {};
  try { body = await res.json(); } catch {}
  return { status: res.status, body, setCookie: res.headers.get('set-cookie') };
}
async function signup(email: string, role?: string) {
  // Use a unique IP per signup call to sidestep the 5/min per-IP signup rate limit.
  const ip = `10.${Math.floor(Math.random()*255)}.${Math.floor(Math.random()*255)}.${Math.floor(Math.random()*255)}`;
  const s = await fetch(`${BASE}/auth/signup`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip },
    body: JSON.stringify({ email, password: 'password123', display_name: `T-${email}` }),
  });
  const cookie = s.headers.get('set-cookie')?.match(/wl_session=[^;]+/)?.[0] || '';
  const j = await s.json();
  const userId = j?.data?.user?.id as string;
  if (role) await withDb(async (db) => { await db.collection('users').updateOne({ id: userId }, { $set: { role } }); });
  return { userId, cookie };
}
async function makeApprovedChannel(overrides: Record<string, unknown> = {}): Promise<{ id: string; slug: string; name: string }> {
  const id = uuidv4();
  const slug = String(overrides.slug ?? `spons-${RUN_TAG}-${Math.random().toString(36).slice(2, 8)}`);
  const wcid = `sp_${id.replace(/-/g, '').slice(0, 20)}`;
  const doc: Record<string, unknown> = {
    id, slug, name: `Sponsorable ${RUN_TAG} ${slug.slice(-4)}`,
    whatsapp_url: `https://whatsapp.com/channel/${slug}`, whatsapp_channel_id: wcid,
    description: null, short_description: null, logo_url: null, cover_url: null,
    website_url: null, country_code: 'ID', primary_language: 'id', category_id: null,
    owner_id: null, status: 'approved', verification_status: 'verified',
    is_official: false, is_featured: false, is_nsfw: false, is_demo: false,
    activity_level: 'active', follower_count: 5000, follower_count_source: 'seed',
    follower_count_updated_at: new Date(), created_at: new Date(), updated_at: new Date(), published_at: new Date(),
    ...overrides,
  };
  await withDb(async (db) => { await db.collection('channels').insertOne(doc); });
  return { id, slug, name: doc.name as string };
}
const validPayload = (channelSlug: string, extra: Record<string, unknown> = {}) => ({
  channel_slug: channelSlug,
  company_name: 'Acme Corp',
  contact_name: 'Jane Sponsor',
  work_email: `jane-${RUN_TAG}-${Math.random().toString(36).slice(2,8)}@acme.example`,
  objective: 'brand_awareness',
  budget_range: '1000_2500',
  target_country: 'ID',
  brief: 'We would like to sponsor for our new launch this quarter.',
  ...extra,
});

beforeAll(async () => {
  await withDb(async (db) => {
    await db.collection('sponsorship_leads').deleteMany({ company_name: /^Acme/, work_email: new RegExp(RUN_TAG) });
    await db.collection('channels').deleteMany({ slug: new RegExp(`^spons-${RUN_TAG}`) });
    await db.collection('users').deleteMany({ email: new RegExp(`^spons-${RUN_TAG}`) });
  });
});
afterAll(async () => {
  await withDb(async (db) => {
    await db.collection('sponsorship_leads').deleteMany({ company_name: /^Acme/, work_email: new RegExp(RUN_TAG) });
    await db.collection('channels').deleteMany({ slug: new RegExp(`^spons-${RUN_TAG}`) });
    await db.collection('users').deleteMany({ email: new RegExp(`^spons-${RUN_TAG}`) });
  });
});

describe('M07-Lite — Sponsorship Lead creation', () => {
  it('creates a lead for an approved public channel (anonymous)', async () => {
    const ch = await makeApprovedChannel();
    const r = await api<{ lead: { id: string; status: string; channel_slug_snapshot: string } }>('/sponsorship-leads', {
      method: 'POST', body: JSON.stringify(validPayload(ch.slug)),
    });
    expect(r.status).toBe(201);
    expect(r.body.data?.lead.status).toBe('new');
    expect(r.body.data?.lead.channel_slug_snapshot).toBe(ch.slug);
  });

  it('creates a lead for a business persona and attributes requester_user_id', async () => {
    const ch = await makeApprovedChannel();
    const biz = await signup(`spons-${RUN_TAG}-biz@wavelead.test`, 'business');
    const r = await api<{ lead: { id: string } }>('/sponsorship-leads', {
      method: 'POST', headers: { Cookie: biz.cookie }, body: JSON.stringify(validPayload(ch.slug)),
    });
    expect(r.status).toBe(201);
    const persisted = await withDb(async (db) => db.collection('sponsorship_leads').findOne({ id: r.body.data!.lead.id }));
    expect(persisted?.requester_user_id).toBe(biz.userId);
    expect(persisted?.requester_role).toBe('business');
  });

  it('refuses to create a lead for a non-approved / private channel_slug', async () => {
    const ch = await makeApprovedChannel({ status: 'pending_review' });
    const r = await api('/sponsorship-leads', { method: 'POST', body: JSON.stringify(validPayload(ch.slug)) });
    expect(r.status).toBe(404);
  });

  it('refuses to create a lead for a test-fixture channel (public-visibility gate)', async () => {
    const ch = await makeApprovedChannel({ is_test_fixture: true });
    const r = await api('/sponsorship-leads', { method: 'POST', body: JSON.stringify(validPayload(ch.slug)) });
    expect(r.status).toBe(404);
  });

  it('strips client-supplied channel_id / status / admin_notes injection attempts', async () => {
    const goodCh = await makeApprovedChannel();
    const otherCh = await makeApprovedChannel();
    const r = await api<{ lead: { id: string } }>('/sponsorship-leads', {
      method: 'POST',
      body: JSON.stringify({
        ...validPayload(goodCh.slug),
        // Injection attempts (Zod strips unknown keys):
        channel_id: otherCh.id,
        status: 'won',
        admin_notes: 'client-inserted note',
      }),
    });
    expect(r.status).toBe(201);
    const persisted = await withDb(async (db) => db.collection('sponsorship_leads').findOne({ id: r.body.data!.lead.id }));
    expect(persisted?.channel_id).toBe(goodCh.id); // server-resolved, not client-supplied
    expect(persisted?.status).toBe('new');
    expect(persisted?.admin_notes).toBeNull();
  });

  it('validates required fields and enum values', async () => {
    const ch = await makeApprovedChannel();
    const short = await api('/sponsorship-leads', { method: 'POST', body: JSON.stringify({ ...validPayload(ch.slug), brief: 'no' }) });
    expect(short.status).toBe(400);
    const badEnum = await api('/sponsorship-leads', { method: 'POST', body: JSON.stringify({ ...validPayload(ch.slug), objective: 'hack' }) });
    expect(badEnum.status).toBe(400);
    const badEmail = await api('/sponsorship-leads', { method: 'POST', body: JSON.stringify({ ...validPayload(ch.slug), work_email: 'not-an-email' }) });
    expect(badEmail.status).toBe(400);
  });

  it('rate limits per email (>5 in 1h → 429)', async () => {
    const ch = await makeApprovedChannel();
    const email = `spons-${RUN_TAG}-flood@acme.example`;
    for (let i = 0; i < 5; i++) {
      const r = await api('/sponsorship-leads', { method: 'POST', body: JSON.stringify({ ...validPayload(ch.slug), work_email: email }) });
      expect(r.status).toBe(201);
    }
    const overflow = await api('/sponsorship-leads', { method: 'POST', body: JSON.stringify({ ...validPayload(ch.slug), work_email: email }) });
    expect(overflow.status).toBe(429);
  });
});

describe('M07-Lite — Admin pipeline & privacy', () => {
  it('admin can list leads, non-admin cannot', async () => {
    const ch = await makeApprovedChannel();
    await api('/sponsorship-leads', { method: 'POST', body: JSON.stringify(validPayload(ch.slug)) });
    const user = await signup(`spons-${RUN_TAG}-usr@wavelead.test`);
    const admin = await signup(`spons-${RUN_TAG}-adm@wavelead.test`, 'admin');
    const denied = await api('/admin/sponsorship-leads', { headers: { Cookie: user.cookie } });
    expect(denied.status).toBe(403);
    const allowed = await api<{ items: Array<Record<string, unknown>>; counts: Record<string, number> }>(
      '/admin/sponsorship-leads',
      { headers: { Cookie: admin.cookie } },
    );
    expect(allowed.status).toBe(200);
    expect(Array.isArray(allowed.body.data?.items)).toBe(true);
    expect(typeof allowed.body.data?.counts.new).toBe('number');
  });

  it('admin can PATCH lead status and admin_notes; requester cannot PATCH', async () => {
    const ch = await makeApprovedChannel();
    const requester = await signup(`spons-${RUN_TAG}-req@wavelead.test`, 'business');
    const admin = await signup(`spons-${RUN_TAG}-adm2@wavelead.test`, 'admin');
    const created = await api<{ lead: { id: string } }>('/sponsorship-leads', {
      method: 'POST', headers: { Cookie: requester.cookie }, body: JSON.stringify(validPayload(ch.slug)),
    });
    const id = created.body.data!.lead.id;
    // Requester (business) cannot PATCH admin endpoint.
    const denied = await api(`/admin/sponsorship-leads/${id}`, { method: 'PATCH', headers: { Cookie: requester.cookie }, body: JSON.stringify({ status: 'won' }) });
    expect(denied.status).toBe(403);
    // Admin can.
    const patched = await api<{ lead: { status: string; admin_notes: string } }>(`/admin/sponsorship-leads/${id}`, {
      method: 'PATCH', headers: { Cookie: admin.cookie },
      body: JSON.stringify({ status: 'qualified', admin_notes: 'Called; interested.' }),
    });
    expect(patched.status).toBe(200);
    expect(patched.body.data?.lead.status).toBe('qualified');
    expect(patched.body.data?.lead.admin_notes).toBe('Called; interested.');
    // Full status cycle.
    const won = await api<{ lead: { status: string } }>(`/admin/sponsorship-leads/${id}`, {
      method: 'PATCH', headers: { Cookie: admin.cookie }, body: JSON.stringify({ status: 'won' }),
    });
    expect(won.body.data?.lead.status).toBe('won');
  });

  it('/me/sponsorship-leads returns only the requester\'s own leads (cross-user privacy)', async () => {
    const ch = await makeApprovedChannel();
    const a = await signup(`spons-${RUN_TAG}-mine-a@wavelead.test`);
    const b = await signup(`spons-${RUN_TAG}-mine-b@wavelead.test`);
    await api('/sponsorship-leads', { method: 'POST', headers: { Cookie: a.cookie }, body: JSON.stringify(validPayload(ch.slug, { work_email: `a-${RUN_TAG}@acme.example` })) });
    await api('/sponsorship-leads', { method: 'POST', headers: { Cookie: b.cookie }, body: JSON.stringify(validPayload(ch.slug, { work_email: `b-${RUN_TAG}@acme.example` })) });
    const aList = await api<{ items: Array<{ requester_user_id: string }> }>('/me/sponsorship-leads', { headers: { Cookie: a.cookie } });
    expect(aList.status).toBe(200);
    expect(aList.body.data?.items.length).toBeGreaterThanOrEqual(1);
    for (const l of aList.body.data!.items) expect(l.requester_user_id).toBe(a.userId);
  });

  it('sponsorship leads are NOT exposed publicly', async () => {
    // No public endpoint for listing/reading leads. This is a static regression
    // — if a future refactor adds one, this test will need updating.
    const r = await api('/sponsorship-leads', { method: 'GET' });
    // GET is not registered; expect 404 route not found.
    expect(r.status).toBe(404);
  });
});
