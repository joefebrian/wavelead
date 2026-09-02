// Public Beta — Buyer authentication / Brand entry UX audit.
//
// This is NOT new auth. It's an audit that every spec invariant holds:
//   §1 Public discovery works without login (no gating regressions)
//   §2 Transactional booking requires login server-side
//   §3 Auth transition UX preserves the returnTo context
//   §4 buyer_user_id is ALWAYS server-derived, never trusted from the client
//   §5 One buyer cannot inspect / mutate another buyer's order
//   §6 Redirect / returnTo validator blocks open-redirect payloads
//   §7 Owner sign-in path unchanged (no accidental brand-signup fork)
//   §8 No second auth system: /brand-login, brand_users, brand-signup absent
//   §9 Brand persona reachable from single account & keeps RBAC untouched
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MongoClient, type Db } from 'mongodb';
import { v4 as uuidv4 } from 'uuid';
import { COLLECTIONS } from '@/lib/db/collections';
import { isSafeInternalNext } from '@/lib/auth/postLoginRedirect';

const BASE = 'http://localhost:3000/api';
const PAGE_BASE = 'http://localhost:3000';
const CLIENT_IP = () => `10.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;
const RUN_TAG = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;

async function withDb<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  const client = new MongoClient(process.env.MONGO_URL || 'mongodb://localhost:27017');
  await client.connect();
  try { return await fn(client.db(process.env.DB_NAME || 'wavelead')); } finally { await client.close(); }
}
interface Envelope<T> { ok?: boolean; data?: T; error?: string }
async function api<T = unknown>(path: string, init: RequestInit = {}): Promise<{ status: number; body: Envelope<T>; headers: Headers }> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': CLIENT_IP(), ...(init.headers || {}) },
  });
  let body: Envelope<T> = {};
  try { body = await res.json(); } catch { /* ignore */ }
  return { status: res.status, body, headers: res.headers };
}
async function signup(email: string): Promise<{ userId: string; cookie: string }> {
  const r = await fetch(`${BASE}/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': CLIENT_IP() },
    body: JSON.stringify({ email, password: 'password123!', display_name: `T-${email.split('@')[0]}` }),
  });
  const cookie = r.headers.get('set-cookie')?.match(/wl_session=[^;]+/)?.[0] || '';
  const j = await r.json() as { data?: { user?: { id: string } } };
  return { userId: (j?.data?.user?.id as string), cookie };
}

// Fixture: a verified channel + an active rate card with one fixed-price
// package so we can drive the booking endpoint.
async function seedChannelWithPackage(ownerId: string): Promise<{ channelId: string; slug: string; packageId: string }> {
  const channelId = uuidv4();
  const slug = `m10auth-${RUN_TAG}-${uuidv4().slice(0, 6)}`;
  const now = new Date();
  await withDb(async (db) => {
    await db.collection(COLLECTIONS.CHANNELS).insertOne({
      id: channelId,
      slug,
      name: `Auth Fixture ${slug}`,
      whatsapp_url: `https://whatsapp.com/channel/${slug}`,
      whatsapp_channel_id: `m10auth-wa-${uuidv4()}`,
      description: null, short_description: null, logo_url: null, cover_url: null,
      website_url: null, country_code: null, primary_language: null, category_id: null,
      owner_id: ownerId, status: 'approved', verification_status: 'verified',
      created_at: now, updated_at: now,
    });
    // Rate card
    await db.collection('channel_rate_cards').insertOne({
      id: uuidv4(), channel_id: channelId, owner_user_id: ownerId, currency: 'USD',
      status: 'published', packages: [{
        id: 'pkg-fixed', name: 'Test Fixed', description: 'Test',
        type: 'shoutout', is_active: true,
        deliverables: ['single_post'], estimated_delivery_days: 7,
        price_minor: 5000, quantity_available: null,
      }],
      created_at: now, updated_at: now,
    });
  });
  return { channelId, slug, packageId: 'pkg-fixed' };
}

async function purge() {
  await withDb(async (db) => {
    await db.collection('users').deleteMany({ email: new RegExp(`m10auth-${RUN_TAG}`) });
    await db.collection(COLLECTIONS.CHANNELS).deleteMany({ slug: new RegExp(`m10auth-${RUN_TAG}`) });
    await db.collection('channel_rate_cards').deleteMany({ channel_id: new RegExp(`.`) , packages: { $elemMatch: { name: 'Test Fixed' } } });
    await db.collection(COLLECTIONS.MARKETPLACE_ORDERS).deleteMany({ 'brief.contact_email': new RegExp(`m10auth-${RUN_TAG}`) });
  });
}
beforeAll(async () => { await purge(); });
afterAll(async () => { await purge(); });

// ============================================================================
// §1 — Public discovery works without login
// ============================================================================
describe('Buyer Auth §1 — Public discovery (anon)', () => {
  it('#1 homepage / channels / categories / countries render for anonymous visitors', async () => {
    for (const p of ['/', '/channels', '/categories', '/pricing']) {
      const r = await fetch(`${PAGE_BASE}${p}`, { headers: { 'X-Forwarded-For': CLIENT_IP() } });
      expect(r.status).toBe(200);
    }
  });
});

// ============================================================================
// §2 — Booking requires login
// ============================================================================
describe('Buyer Auth §2 — Server gate on booking', () => {
  it('#2 anonymous POST /marketplace/orders → 401 with clear message', async () => {
    const owner = await signup(`m10auth-${RUN_TAG}-owner@wavelead.test`);
    const fx = await seedChannelWithPackage(owner.userId);
    const r = await api(`/marketplace/orders`, {
      method: 'POST',
      body: JSON.stringify({
        channel_id: fx.channelId, package_id: fx.packageId,
        company_name: 'Acme', contact_name: 'Anon Bot', contact_email: `m10auth-${RUN_TAG}-anon@t.test`,
        campaign_objective: 'Boost', brief: 'Test brief',
      }),
    });
    expect(r.status).toBe(401);
    expect((r.body.error || '').toLowerCase()).toMatch(/sign(?:ed)?\s?in|must be signed in/);
  });

  it('#3 sponsor page renders the auth-transition gate for anonymous visitors', async () => {
    const owner = await signup(`m10auth-${RUN_TAG}-owner2@wavelead.test`);
    const fx = await seedChannelWithPackage(owner.userId);
    const r = await fetch(`${PAGE_BASE}/sponsor/${fx.slug}?package=${fx.packageId}`, { headers: { 'X-Forwarded-For': CLIENT_IP() } });
    expect(r.status).toBe(200);
    const html = await r.text();
    // Auth-transition card + preserved returnTo URL in the Sign In / Create Account CTAs.
    expect(html).toContain('data-testid="mp-signin-gate"');
    expect(html).toMatch(/Sign in to submit this sponsorship request|Continue to Sign In/);
    expect(html).toMatch(/Create an account/);
    // The Sign-In link must carry `next=<encoded sponsor URL>` so post-login continuation works.
    expect(html).toMatch(new RegExp(`/login\\?next=${encodeURIComponent(`/sponsor/${fx.slug}`)}`));
    expect(html).toMatch(new RegExp(`/signup\\?next=${encodeURIComponent(`/sponsor/${fx.slug}`)}`));
  });
});

// ============================================================================
// §4 — buyer_user_id ALWAYS server-derived
// ============================================================================
describe('Buyer Auth §4 — buyer_user_id from session only', () => {
  it('#4 client-supplied buyer_user_id in the payload is IGNORED — server uses actor.user.id', async () => {
    const owner = await signup(`m10auth-${RUN_TAG}-owner3@wavelead.test`);
    const fx = await seedChannelWithPackage(owner.userId);
    const buyer = await signup(`m10auth-${RUN_TAG}-buyer@wavelead.test`);
    const fakeVictimId = uuidv4();

    const r = await api<{ order: { id: string; buyer_user_id: string } }>(`/marketplace/orders`, {
      method: 'POST',
      headers: { Cookie: buyer.cookie },
      body: JSON.stringify({
        // eslint-disable-next-line @typescript-eslint/naming-convention
        buyer_user_id: fakeVictimId, // <── attempt to inject a foreign user id
        channel_id: fx.channelId, package_id: fx.packageId,
        company_name: 'Acme', contact_name: 'Real Buyer',
        contact_email: `m10auth-${RUN_TAG}-buyer@t.test`,
        campaign_objective: 'Boost', brief: 'Test',
      }),
    });
    expect(r.status).toBe(201);
    // Server MUST rewrite buyer_user_id to the authenticated actor's id.
    expect(r.body.data?.order.buyer_user_id).toBe(buyer.userId);
    expect(r.body.data?.order.buyer_user_id).not.toBe(fakeVictimId);
  });
});

// ============================================================================
// §5 — Buyer order isolation
// ============================================================================
describe('Buyer Auth §5 — Buyer isolation', () => {
  it('#5 buyer B cannot inspect / accept / revise buyer A\'s order', async () => {
    const owner = await signup(`m10auth-${RUN_TAG}-owner4@wavelead.test`);
    const fx = await seedChannelWithPackage(owner.userId);
    const A = await signup(`m10auth-${RUN_TAG}-buyerA@wavelead.test`);
    const B = await signup(`m10auth-${RUN_TAG}-buyerB@wavelead.test`);

    // A creates an order.
    const created = await api<{ order: { id: string } }>(`/marketplace/orders`, {
      method: 'POST', headers: { Cookie: A.cookie },
      body: JSON.stringify({
        channel_id: fx.channelId, package_id: fx.packageId,
        company_name: 'A-Corp', contact_name: 'A', contact_email: `m10auth-${RUN_TAG}-a@t.test`,
        campaign_objective: 'X', brief: 'X',
      }),
    });
    expect(created.status).toBe(201);
    const orderId = created.body.data!.order.id;

    // Buyer B listing only returns their own orders (empty here — no side effects).
    const bList = await api<{ items: Array<{ id: string }> }>(`/marketplace/buyer/orders`, { headers: { Cookie: B.cookie } });
    expect(bList.status).toBe(200);
    expect(bList.body.data?.items.some((o) => o.id === orderId)).toBe(false);

    // Buyer A sees their own.
    const aList = await api<{ items: Array<{ id: string }> }>(`/marketplace/buyer/orders`, { headers: { Cookie: A.cookie } });
    expect(aList.body.data?.items.some((o) => o.id === orderId)).toBe(true);

    // Buyer B attempting Accept / Request Revision on A's order → 403.
    const accept = await api(`/marketplace/orders/${orderId}/accept-delivery`, {
      method: 'POST', headers: { Cookie: B.cookie }, body: JSON.stringify({}),
    });
    expect([403, 400, 404]).toContain(accept.status); // some paths return 403 pre-precondition; must NOT be 200.
    expect(accept.body.ok).not.toBe(true);

    const revise = await api(`/marketplace/orders/${orderId}/request-revision`, {
      method: 'POST', headers: { Cookie: B.cookie }, body: JSON.stringify({ note: 'test' }),
    });
    expect([403, 400, 404]).toContain(revise.status);
    expect(revise.body.ok).not.toBe(true);
  });
});

// ============================================================================
// §6 — Open-redirect validator holds
// ============================================================================
describe('Buyer Auth §6 — Safe returnTo', () => {
  it('#6 isSafeInternalNext rejects open-redirect payloads', () => {
    // Positive
    expect(isSafeInternalNext('/sponsor/foo')).toBe(true);
    expect(isSafeInternalNext('/dashboard/sponsorships')).toBe(true);
    // Negative
    expect(isSafeInternalNext('//evil.com')).toBe(false);
    expect(isSafeInternalNext('/\\evil.com')).toBe(false);
    expect(isSafeInternalNext('https://evil.com/x')).toBe(false);
    expect(isSafeInternalNext('javascript:alert(1)')).toBe(false);
    expect(isSafeInternalNext('/api/auth/logout')).toBe(false);
    expect(isSafeInternalNext('/x\r\nSet-Cookie: a=b')).toBe(false);
    expect(isSafeInternalNext('/x\\y')).toBe(false);
    expect(isSafeInternalNext('')).toBe(false);
    expect(isSafeInternalNext(null)).toBe(false);
    expect(isSafeInternalNext('/' + 'x'.repeat(1024))).toBe(false);
  });

  it('#7 login endpoint honors safe next + defaults for unsafe next', async () => {
    const email = `m10auth-${RUN_TAG}-lnext@wavelead.test`;
    // Signup first so we can log in.
    await signup(email);
    // Safe next → returned as-is.
    const r1 = await api<{ redirect_to: string }>(`/auth/login`, {
      method: 'POST',
      body: JSON.stringify({ email, password: 'password123!', next: '/sponsor/foo-bar' }),
    });
    expect(r1.status).toBe(200);
    expect(r1.body.data?.redirect_to).toBe('/sponsor/foo-bar');
    // Unsafe next → server refuses and falls back to role default.
    const r2 = await api<{ redirect_to: string }>(`/auth/login`, {
      method: 'POST',
      body: JSON.stringify({ email, password: 'password123!', next: 'https://evil.com' }),
    });
    expect(r2.status).toBe(200);
    expect(r2.body.data?.redirect_to?.startsWith('/')).toBe(true);
    expect(r2.body.data?.redirect_to).not.toContain('evil.com');
  });
});

// ============================================================================
// §7/§8 — One account system: no second auth surface
// ============================================================================
describe('Buyer Auth §7/§8 — One account, no fork', () => {
  it('#8 no /brand-login, /brand-signup, /advertiser-login public route exists', async () => {
    for (const p of ['/brand-login', '/brand-signup', '/advertiser-login', '/buyer-signup']) {
      const r = await fetch(`${PAGE_BASE}${p}`, { redirect: 'manual', headers: { 'X-Forwarded-For': CLIENT_IP() } });
      expect(r.status).toBe(404);
    }
  });

  it('#9 no /api/brand/auth, /api/buyer/login, /api/advertiser/login endpoints', async () => {
    for (const p of ['/brand/login', '/brand/signup', '/buyer/login', '/advertiser/login']) {
      const r = await api(p, { method: 'POST', body: JSON.stringify({ email: 't@t', password: 'x' }) });
      expect([404, 405]).toContain(r.status);
    }
  });

  it('#10 no BrandUser / brand_users collection in the DB catalog', async () => {
    const forbidden = await withDb(async (db) => {
      const cols = await db.listCollections().toArray();
      return cols.map((c) => c.name).filter((n) => /brand[_-]?users|buyer[_-]?users|advertiser[_-]?accounts/.test(n));
    });
    expect(forbidden).toEqual([]);
  });
});

// ============================================================================
// §9 — Brand persona reachable from single account
// ============================================================================
describe('Buyer Auth §9 — Brand persona', () => {
  it('#11 PUT persona=brand from a signed-in account works; RBAC role untouched; brand nav rendered', async () => {
    const email = `m10auth-${RUN_TAG}-brand@wavelead.test`;
    const { userId, cookie } = await signup(email);
    const before = await withDb(async (db) => db.collection('users').findOne({ id: userId }));
    const roleBefore = (before as unknown as { role: string })?.role;

    const r = await api(`/me/persona`, {
      method: 'PUT', headers: { Cookie: cookie }, body: JSON.stringify({ persona: 'brand' }),
    });
    expect(r.status).toBe(200);
    const after = await withDb(async (db) => db.collection('users').findOne({ id: userId }));
    expect((after as unknown as { role: string })?.role).toBe(roleBefore);
    expect((after as unknown as { persona: string })?.persona).toBe('brand');

    // Brand nav section rendered on dashboard.
    const page = await fetch(`${PAGE_BASE}/dashboard`, { headers: { Cookie: cookie, 'X-Forwarded-For': CLIENT_IP() } });
    const html = await page.text();
    expect(html).toContain('data-testid="brand-nav-section"');
    expect(html).toContain('data-testid="brand-card-discover"');
    expect(html).toContain('data-testid="brand-card-sponsorships"');
  });

  it('#12 persona=both keeps both workspaces reachable on one session', async () => {
    const { cookie } = await signup(`m10auth-${RUN_TAG}-both@wavelead.test`);
    await api(`/me/persona`, { method: 'PUT', headers: { Cookie: cookie }, body: JSON.stringify({ persona: 'both' }) });
    const page = await fetch(`${PAGE_BASE}/dashboard`, { headers: { Cookie: cookie, 'X-Forwarded-For': CLIENT_IP() } });
    const html = await page.text();
    expect(html).toContain('data-testid="owner-nav-section"');
    expect(html).toContain('data-testid="brand-nav-section"');
    expect(html).toContain('data-testid="persona-view-switch"');
  });
});

// ============================================================================
// §10 — Owner login unchanged (no accidental brand fork)
// ============================================================================
describe('Buyer Auth §10 — Owner login unchanged', () => {
  it('#13 an existing account signs in and lands on /dashboard by default', async () => {
    const email = `m10auth-${RUN_TAG}-owner-login@wavelead.test`;
    await signup(email);
    const r = await api<{ redirect_to: string }>(`/auth/login`, {
      method: 'POST', body: JSON.stringify({ email, password: 'password123!' }),
    });
    expect(r.status).toBe(200);
    expect(r.body.data?.redirect_to).toBe('/dashboard');
  });
});
