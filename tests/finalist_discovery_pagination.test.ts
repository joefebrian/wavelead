// WaveLead — Finalist Discovery Polish: category pagination, count accuracy
// and the Top Channels country selector.
//
// THE BUG: /channels, /category/[slug], /country/[slug] and /search each asked
// the service for a hardcoded `limit: 30` with NO `skip` and rendered no
// pagination control, while honestly printing the real total in the heading.
// A category with 149 eligible channels therefore showed 30 cards and no way
// to reach the other 119. The service layer and the public API already
// supported limit/skip and returned `total` — the UI never exposed it.
//
// This suite seeds a category with MORE than one page of eligible channels and
// proves every record is reachable, exactly once, with the suppressed
// inventory still invisible on every page.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MongoClient } from 'mongodb';
import { v4 as uuidv4 } from 'uuid';
import { buildPublicChannelFilter } from '@/lib/services/publicChannelVisibility';

const BASE = 'http://localhost:3000/api';
const ORIGIN = 'http://localhost:3000';
const CLIENT_IP = `10.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;
const RUN_TAG = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
const MARK = `pag${RUN_TAG}`;

const CATEGORY_SLUG = 'news';
const PAGE_SIZE = 30;
const ELIGIBLE = 75; // 3 pages: 30 + 30 + 15

async function withDb<T>(fn: (db: import('mongodb').Db) => Promise<T>): Promise<T> {
  const client = new MongoClient(process.env.MONGO_URL || 'mongodb://localhost:27017');
  await client.connect();
  try { return await fn(client.db(process.env.DB_NAME || 'wavelead')); } finally { await client.close(); }
}

async function api<T = unknown>(path: string) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': CLIENT_IP },
  });
  let body: { ok?: boolean; data?: T; error?: string } = {};
  try { body = await res.json(); } catch { /* non-JSON */ }
  return { status: res.status, body };
}

type Listing = { items: Array<{ id: string; slug: string; country_code: string }>; total: number };

/** React inserts <!-- --> between adjacent text nodes; remove it before asserting on copy. */
function stripHtml(html: string): string {
  return html.replace(/<!--[\s\S]*?-->/g, '');
}

const page = (p: number, extra = '') =>
  api<Listing>(`/channels?category=${CATEGORY_SLUG}&sort=top&limit=${PAGE_SIZE}&skip=${(p - 1) * PAGE_SIZE}${extra}`);

let categoryId: string;
const eligibleSlugs: string[] = [];
const suppressedSlugs: string[] = [];

function doc(overrides: Record<string, unknown>) {
  const id = uuidv4();
  return {
    id,
    whatsapp_url: `https://whatsapp.com/channel/0029Va${id.replace(/-/g, '').slice(0, 18)}`,
    whatsapp_channel_id: `pag_${id.replace(/-/g, '').slice(0, 20)}`,
    description: 'Finalist discovery pagination regression fixture record.',
    short_description: 'Pagination fixture.',
    logo_url: null, cover_url: null, website_url: null,
    country_code: 'ID', primary_language: 'id', category_id: categoryId,
    owner_id: null, status: 'approved', verification_status: 'unverified',
    is_official: false, is_featured: false, is_nsfw: false,
    is_demo: false, activity_level: 'active',
    follower_count: 0, public_followers_count: 0, follower_count_source: 'submitter',
    // Identical timestamp on purpose: proves the `newest` sort has a unique
    // tie-break and cannot duplicate or drop rows while paginating.
    created_at: new Date('2026-01-01T00:00:00.000Z'),
    updated_at: new Date(), published_at: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

beforeAll(async () => {
  await withDb(async (db) => {
    const cat = await db.collection('categories').findOne({ slug: CATEGORY_SLUG });
    categoryId = cat!.id;

    const rows: Record<string, unknown>[] = [];
    for (let i = 0; i < ELIGIBLE; i++) {
      const slug = `news-${MARK}-${String(i).padStart(3, '0')}`;
      eligibleSlugs.push(slug);
      rows.push(doc({
        slug, name: `News ${MARK} ${i}`,
        // Descending observed audience; a deliberate block of ties at 0 at the
        // tail exercises the unique tie-break.
        public_followers_count: i < 60 ? (ELIGIBLE - i) * 1000 : 0,
      }));
    }

    // Records in the SAME category that must never surface publicly.
    const sup: Array<Record<string, unknown>> = [
      { slug: `news-${MARK}-demo`, name: `News ${MARK} Demo`, is_demo: true },
      { slug: `news-${MARK}-fixture`, name: `News ${MARK} Fixture`, is_test_fixture: true },
      { slug: `news-${MARK}-pending`, name: `News ${MARK} Pending`, status: 'pending_review' },
      { slug: `news-${MARK}-rejected`, name: `News ${MARK} Rejected`, status: 'rejected' },
      { slug: 'b2-ch-00ff00aa', name: `News ${MARK} QA` },
    ];
    for (const s of sup) { suppressedSlugs.push(String(s.slug)); rows.push(doc(s)); }

    await db.collection('channels').insertMany(rows as never);
  });
});

afterAll(async () => {
  await withDb(async (db) => {
    await db.collection('channels').deleteMany({ slug: new RegExp(MARK) });
    await db.collection('channels').deleteMany({ name: new RegExp(MARK) });
  });
});

// ===========================================================================
// 1. COUNT ACCURACY
// ===========================================================================
describe('discovery polish — count accuracy', () => {
  it('total is the full eligible count, NOT the first page size', async () => {
    const r = await page(1);
    expect(r.status).toBe(200);
    expect(r.body.data?.items.length).toBe(PAGE_SIZE);
    // The whole point of the bug report: 75 eligible must not report as 30.
    expect(r.body.data?.total).toBeGreaterThanOrEqual(ELIGIBLE);
    expect(r.body.data?.total).not.toBe(PAGE_SIZE);
  });

  it('total matches a direct DB count using the SAME eligibility rules', async () => {
    const r = await page(1);
    const dbTotal = await withDb(async (db) =>
      db.collection('channels').countDocuments(
        buildPublicChannelFilter({ status: 'approved', category_id: categoryId }) as never));
    expect(r.body.data?.total).toBe(dbTotal);
  });

  it('count excludes demo, fixture, QA, pending and rejected records', async () => {
    const r = await page(1);
    const everything = await withDb(async (db) =>
      db.collection('channels').countDocuments({ category_id: categoryId, slug: new RegExp(MARK) }));
    // 75 eligible + 4 suppressed sharing the MARK (the QA slug has no MARK).
    expect(everything).toBe(ELIGIBLE + 4);
    // ...yet the reported total only grew by the eligible ones.
    const dbTotal = await withDb(async (db) =>
      db.collection('channels').countDocuments(
        buildPublicChannelFilter({ status: 'approved', category_id: categoryId }) as never));
    expect(r.body.data?.total).toBe(dbTotal);
  });

  it('the heading count on /category/news equals the eligible DB total', async () => {
    const dbTotal = await withDb(async (db) =>
      db.collection('channels').countDocuments(
        buildPublicChannelFilter({ status: 'approved', category_id: categoryId }) as never));
    const html = await fetch(`${ORIGIN}/category/${CATEGORY_SLUG}`).then((r) => r.text());
    const text = stripHtml(html);
    expect(text).toContain(`${dbTotal.toLocaleString()} approved channel`);
    const listing = await page(1);
    expect(listing.body.data?.total).toBe(dbTotal);
  }, 30_000);
});

// ===========================================================================
// 2. PAGINATION REACHES EVERY RECORD
// ===========================================================================
describe('discovery polish — category pagination', () => {
  it('first page returns at most the page size', async () => {
    const r = await page(1);
    expect(r.body.data?.items.length).toBeLessThanOrEqual(PAGE_SIZE);
  });

  it('second page returns the NEXT records, not a repeat of the first', async () => {
    const [p1, p2] = await Promise.all([page(1), page(2)]);
    const s1 = (p1.body.data?.items || []).map((i) => i.slug);
    const s2 = (p2.body.data?.items || []).map((i) => i.slug);
    expect(s2.length).toBeGreaterThan(0);
    expect(s1.filter((s) => s2.includes(s))).toEqual([]);
  });

  it('every eligible record is reachable, exactly once, with no gaps', async () => {
    const total = (await page(1)).body.data!.total;
    const pages = Math.ceil(total / PAGE_SIZE);
    const seen: string[] = [];
    for (let p = 1; p <= pages; p++) {
      const r = await page(p);
      seen.push(...(r.body.data?.items || []).map((i) => i.slug));
    }
    // No duplicates anywhere across the whole walk.
    expect(seen.length).toBe(new Set(seen).size);
    // Exactly `total` records surfaced.
    expect(seen.length).toBe(total);
    // Every single seeded eligible record was reachable.
    const missing = eligibleSlugs.filter((s) => !seen.includes(s));
    expect(missing).toEqual([]);
  }, 60_000);

  it('the last page is accessible and beyond it is empty', async () => {
    const total = (await page(1)).body.data!.total;
    const pages = Math.ceil(total / PAGE_SIZE);
    const last = await page(pages);
    expect(last.body.data?.items.length).toBeGreaterThan(0);
    const past = await page(pages + 1);
    expect(past.body.data?.items.length).toBe(0);
  }, 30_000);

  it('suppressed records never appear on ANY page', async () => {
    const total = (await page(1)).body.data!.total;
    const pages = Math.ceil(total / PAGE_SIZE);
    const seen: string[] = [];
    for (let p = 1; p <= pages; p++) {
      const r = await page(p);
      seen.push(...(r.body.data?.items || []).map((i) => i.slug));
    }
    for (const s of suppressedSlugs) {
      expect({ slug: s, leaked: seen.includes(s) }).toEqual({ slug: s, leaked: false });
    }
  }, 60_000);

  it('ordering is deterministic across repeated identical requests', async () => {
    const a = await page(2);
    const b = await page(2);
    expect((a.body.data?.items || []).map((i) => i.slug))
      .toEqual((b.body.data?.items || []).map((i) => i.slug));
  });

  it('the `newest` sort paginates safely despite identical timestamps', async () => {
    const mk = (p: number) => api<Listing>(
      `/channels?category=${CATEGORY_SLUG}&sort=newest&limit=${PAGE_SIZE}&skip=${(p - 1) * PAGE_SIZE}`);
    const [p1, p2] = await Promise.all([mk(1), mk(2)]);
    const s1 = (p1.body.data?.items || []).map((i) => i.slug);
    const s2 = (p2.body.data?.items || []).map((i) => i.slug);
    expect(s1.filter((s) => s2.includes(s))).toEqual([]);
  });

  it('filters are preserved on every page (category stays scoped)', async () => {
    const r = await page(2);
    const slugs = (r.body.data?.items || []).map((i) => i.slug);
    const rows = await withDb(async (db) =>
      db.collection('channels').find({ slug: { $in: slugs } }).project({ slug: 1, category_id: 1 }).toArray());
    for (const row of rows) {
      expect({ slug: row.slug, cat: row.category_id }).toEqual({ slug: row.slug, cat: categoryId });
    }
  });
});

// ===========================================================================
// 3. SERVER-RENDERED PAGES EXPOSE THE PAGINATION
// ===========================================================================
describe('discovery polish — server-rendered pagination surface', () => {
  it('/category/news renders a crawlable rel=next pagination link', async () => {
    const res = await fetch(`${ORIGIN}/category/${CATEGORY_SLUG}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('rel="next"');
    expect(html).toContain(`/category/${CATEGORY_SLUG}?page=2`);
    // Honest progress label, driven by the real total.
    expect(html).toMatch(/Showing\s*1[–-]30 of/);
  }, 30_000);

  it('/category/news?page=2 server-renders DIFFERENT records', async () => {
    const [r1, r2] = await Promise.all([
      fetch(`${ORIGIN}/category/${CATEGORY_SLUG}`).then((r) => r.text()),
      fetch(`${ORIGIN}/category/${CATEGORY_SLUG}?page=2`).then((r) => r.text()),
    ]);
    const first = eligibleSlugs.filter((s) => r1.includes(`/channel/${s}"`));
    const second = eligibleSlugs.filter((s) => r2.includes(`/channel/${s}"`));
    expect(first.length).toBeGreaterThan(0);
    expect(second.length).toBeGreaterThan(0);
    expect(first.filter((s) => second.includes(s))).toEqual([]);
  }, 30_000);

  it('/channels, /country/indonesia and /search all expose the control', async () => {
    for (const path of ['/channels', '/country/indonesia', `/search?q=News+${MARK}`]) {
      const html = await fetch(`${ORIGIN}${path}`).then((r) => r.text());
      expect({ path, hasControl: html.includes('loadmore-progress') }).toEqual({ path, hasControl: true });
    }
  }, 40_000);

  it('suppressed records are absent from the server-rendered HTML of every page', async () => {
    for (const p of [1, 2, 3]) {
      const html = await fetch(`${ORIGIN}/category/${CATEGORY_SLUG}?page=${p}`).then((r) => r.text());
      for (const s of suppressedSlugs) {
        expect({ p, slug: s, leaked: html.includes(`/channel/${s}"`) }).toEqual({ p, slug: s, leaked: false });
      }
    }
  }, 40_000);
});

// ===========================================================================
// 4. SEARCH PAGINATION + COUNT
// ===========================================================================
describe('discovery polish — search pagination', () => {
  it('search paginates and does not repeat records', async () => {
    const mk = (skip: number) => api<Listing>(`/channels?q=${MARK}&limit=${PAGE_SIZE}&skip=${skip}`);
    const [p1, p2] = await Promise.all([mk(0), mk(PAGE_SIZE)]);
    const s1 = (p1.body.data?.items || []).map((i) => i.slug);
    const s2 = (p2.body.data?.items || []).map((i) => i.slug);
    expect(s1.length).toBe(PAGE_SIZE);
    expect(s2.length).toBeGreaterThan(0);
    expect(s1.filter((s) => s2.includes(s))).toEqual([]);
  }, 30_000);

  it('search total respects the category post-filter (count accuracy)', async () => {
    const scoped = await api<Listing>(`/channels?q=${MARK}&category=${CATEGORY_SLUG}&limit=5`);
    const walk = await api<Listing>(`/channels?q=${MARK}&category=${CATEGORY_SLUG}&limit=60`);
    // The reported total must be consistent with what paging actually yields,
    // not an unfiltered superset.
    expect(scoped.body.data?.total).toBe(walk.body.data?.total);
    expect(scoped.body.data?.total).toBeGreaterThanOrEqual(ELIGIBLE);
  }, 30_000);

  it('search never surfaces suppressed records', async () => {
    const r = await api<Listing>(`/channels?q=${MARK}&limit=60`);
    const slugs = (r.body.data?.items || []).map((i) => i.slug);
    for (const s of suppressedSlugs) {
      expect({ slug: s, leaked: slugs.includes(s) }).toEqual({ slug: s, leaked: false });
    }
  }, 30_000);
});

// ===========================================================================
// 5. TOP — COUNTRY SCOPING, RANKING, PAGINATION
// ===========================================================================
describe('discovery polish — /top country scoping and pagination', () => {
  it('country-scoped Top returns only that country and paginates', async () => {
    const mk = (skip: number) => api<Listing>(`/channels?country=ID&sort=top&limit=${PAGE_SIZE}&skip=${skip}`);
    const [p1, p2] = await Promise.all([mk(0), mk(PAGE_SIZE)]);
    const all = [...(p1.body.data?.items || []), ...(p2.body.data?.items || [])];
    expect(all.length).toBeGreaterThan(PAGE_SIZE);
    for (const i of all) expect({ slug: i.slug, cc: i.country_code }).toEqual({ slug: i.slug, cc: 'ID' });
    const s1 = (p1.body.data?.items || []).map((i) => i.slug);
    const s2 = (p2.body.data?.items || []).map((i) => i.slug);
    expect(s1.filter((s) => s2.includes(s))).toEqual([]);
  }, 30_000);

  it('changing the country scopes to a different set (pagination resets)', async () => {
    const id = await api<Listing>(`/channels?country=ID&sort=top&limit=${PAGE_SIZE}`);
    const us = await api<Listing>(`/channels?country=US&sort=top&limit=${PAGE_SIZE}`);
    const idSlugs = (id.body.data?.items || []).map((i) => i.slug);
    const usSlugs = (us.body.data?.items || []).map((i) => i.slug);
    expect(idSlugs.filter((s) => usSlugs.includes(s))).toEqual([]);
  });

  it('/top renders the Indonesia-first selector instead of ~240 country pills', async () => {
    const html = await fetch(`${ORIGIN}/top`).then((r) => r.text());
    expect(html).toContain('top-country-selector');
    expect(html).toContain('country-pill-ID');          // home market present
    expect(html).toContain('country-pill-all');          // All Countries option
    expect(html).toContain('country-more-button');       // searchable full list
    // The old behaviour rendered a pill per country; assert we are nowhere near.
    const pillCount = (html.match(/country-pill-/g) || []).length;
    expect(pillCount).toBeLessThan(30);
  }, 30_000);

  it('/top?country=XX deep links still work and keep the selected state', async () => {
    const res = await fetch(`${ORIGIN}/top?country=US`);
    expect(res.status).toBe(200);
    const text = stripHtml(await res.text());
    expect(text).toContain('Top WhatsApp Channels in United States');
    expect(text).toContain('Top channels in United States');
  }, 30_000);

  it('/top?country=all renders the worldwide view', async () => {
    const res = await fetch(`${ORIGIN}/top?country=all`);
    expect(res.status).toBe(200);
    expect(stripHtml(await res.text())).toContain('Top WhatsApp Channels Worldwide');
  }, 30_000);

  it('/top default market is still Indonesia (unchanged behaviour)', async () => {
    const text = stripHtml(await fetch(`${ORIGIN}/top`).then((r) => r.text()));
    expect(text).toContain('Top WhatsApp Channels in Indonesia');
  }, 30_000);

  it('/top paginates and continues the rank numbering', async () => {
    const html = await fetch(`${ORIGIN}/top?country=ID&page=2`).then((r) => r.text());
    expect(html).toContain('loadmore-progress');
    expect(html).toMatch(/Showing\s*31[–-]/);
  }, 30_000);
});

// ===========================================================================
// 6. EXISTING SEO ROUTES STILL VALID
// ===========================================================================
describe('discovery polish — SEO routes preserved', () => {
  it('all public discovery routes still return 200', async () => {
    for (const p of ['/channels', '/channels?sort=newest', `/category/${CATEGORY_SLUG}`,
      '/country/indonesia', '/top', '/top?country=ID', '/trending', '/categories', '/countries']) {
      const res = await fetch(`${ORIGIN}${p}`);
      expect({ p, status: res.status }).toEqual({ p, status: 200 });
    }
  }, 60_000);

  it('canonical URLs are unchanged by the ?page= parameter', async () => {
    const html = await fetch(`${ORIGIN}/category/${CATEGORY_SLUG}?page=2`).then((r) => r.text());
    expect(html).toContain(`/category/${CATEGORY_SLUG}"`);
    expect(html).not.toContain(`rel="canonical" href="${ORIGIN}/category/${CATEGORY_SLUG}?page=2"`);
  }, 30_000);
});
