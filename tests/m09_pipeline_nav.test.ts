// Phase 3 — Pipeline nav discoverability (small patch).
//
// Coverage:
//   #1 Free user sees the Pipeline card + button in the dashboard nav
//   #2 Pro user sees the Pipeline card + button
//   #3 Enterprise user sees the Pipeline card + button
//   #4 Clicking the link routes to /dashboard/sponsorships/pipeline
//      • Free → upgrade state (server-side gate authoritative)
//      • Pro  → kanban (server-side gate authoritative)
//   #5 Existing sponsorships nav entry ("My Sponsorships") still present
//   #6 "Pro" nav copy label used — NOT "CRM" / "Deals" / "Sales CRM"
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MongoClient, type Db } from 'mongodb';

const BASE = 'http://localhost:3000/api';
const PAGE_BASE = 'http://localhost:3000';
const CLIENT_IP = () => `10.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;
const RUN_TAG = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;

async function withDb<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  const client = new MongoClient(process.env.MONGO_URL || 'mongodb://localhost:27017');
  await client.connect();
  try { return await fn(client.db(process.env.DB_NAME || 'wavelead')); } finally { await client.close(); }
}
async function signup(email: string, opts: { plan?: 'pro' | 'enterprise' } = {}): Promise<string> {
  const r = await fetch(`${BASE}/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': CLIENT_IP() },
    body: JSON.stringify({ email, password: 'password123!', display_name: `T-${email.split('@')[0]}` }),
  });
  const cookie = r.headers.get('set-cookie')?.match(/wl_session=[^;]+/)?.[0] || '';
  if (opts.plan) {
    const j = await r.json() as { data?: { user?: { id: string } } };
    const uid = j?.data?.user?.id as string;
    await withDb(async (db) => { await db.collection('users').updateOne({ id: uid }, { $set: { plan: opts.plan } }); });
  }
  return cookie;
}
async function fetchDashboardHtml(cookie: string): Promise<string> {
  const r = await fetch(`${PAGE_BASE}/dashboard`, { headers: { Cookie: cookie, 'X-Forwarded-For': CLIENT_IP() } });
  expect(r.status).toBe(200);
  return r.text();
}
async function purge() {
  await withDb(async (db) => {
    await db.collection('users').deleteMany({ email: new RegExp(`m09nav-${RUN_TAG}`) });
  });
}
beforeAll(async () => { await purge(); });
afterAll(async () => { await purge(); });

describe('Phase 3 Nav §1 — Pipeline discoverability in owner dashboard', () => {
  it('#1 Free user sees Pipeline card + button in /dashboard SSR', async () => {
    const cookie = await signup(`m09nav-${RUN_TAG}-free@wavelead.test`);
    const html = await fetchDashboardHtml(cookie);
    expect(html).toContain('data-testid="nav-pipeline-card"');
    expect(html).toContain('data-testid="nav-pipeline-button"');
    expect(html).toContain('/dashboard/sponsorships/pipeline');
    expect(html).toContain('>Pipeline<');
    // Copy invariants — must NOT rebrand as CRM/Deals.
    expect(html).not.toMatch(/\bCRM\b/);
    expect(html).not.toMatch(/\bDeals\b/);
    expect(html).not.toMatch(/\bSales CRM\b/);
  });

  it('#2 Pro user sees the same Pipeline entry (nav is not conditional)', async () => {
    const cookie = await signup(`m09nav-${RUN_TAG}-pro@wavelead.test`, { plan: 'pro' });
    const html = await fetchDashboardHtml(cookie);
    expect(html).toContain('data-testid="nav-pipeline-card"');
    expect(html).toContain('data-testid="nav-pipeline-button"');
  });

  it('#3 Enterprise user sees the Pipeline entry', async () => {
    const cookie = await signup(`m09nav-${RUN_TAG}-ent@wavelead.test`, { plan: 'enterprise' });
    const html = await fetchDashboardHtml(cookie);
    expect(html).toContain('data-testid="nav-pipeline-card"');
    expect(html).toContain('data-testid="nav-pipeline-button"');
  });

  it('#4 clicking Pipeline routes correctly: Free → upgrade state, Pro → kanban (server gate authoritative)', async () => {
    const free = await signup(`m09nav-${RUN_TAG}-route-free@wavelead.test`);
    const rf = await fetch(`${PAGE_BASE}/dashboard/sponsorships/pipeline`, { headers: { Cookie: free, 'X-Forwarded-For': CLIENT_IP() } });
    expect(rf.status).toBe(200);
    const freeHtml = await rf.text();
    expect(freeHtml).toContain('data-testid="pipeline-upgrade"');
    expect(freeHtml).not.toContain('data-testid="pipeline-kanban"');

    const pro = await signup(`m09nav-${RUN_TAG}-route-pro@wavelead.test`, { plan: 'pro' });
    const rp = await fetch(`${PAGE_BASE}/dashboard/sponsorships/pipeline`, { headers: { Cookie: pro, 'X-Forwarded-For': CLIENT_IP() } });
    expect(rp.status).toBe(200);
    const proHtml = await rp.text();
    expect(proHtml).toContain('data-testid="pipeline-kanban"');
    expect(proHtml).not.toContain('data-testid="pipeline-upgrade"');
  });

  it('#5 existing sponsorships nav entry ("My Sponsorships") still present on /dashboard', async () => {
    const cookie = await signup(`m09nav-${RUN_TAG}-exist@wavelead.test`);
    const html = await fetchDashboardHtml(cookie);
    expect(html).toContain('/dashboard/sponsorships"');
    expect(html).toContain('My Sponsorships');
    // Earnings & Campaigns nav entries also present for owner discoverability.
    expect(html).toContain('/dashboard/earnings');
    expect(html).toContain('/dashboard/promotions');
  });
});
