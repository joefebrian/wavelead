// Phase 3 — Persona / onboarding UX. Targeted tests only.
//
// Coverage:
//   §1 Existing users: no persona → dashboard renders + persona picker shows;
//                       skip persists dismissal; picker hides afterward
//   §2 Owner preference sets persona=owner + owner checklist; role unchanged
//   §3 Brand preference sets persona=brand + brand checklist
//   §4 Both preference shows the view switcher + both checklists
//   §5 Persona NEVER mutates security role / RBAC / plan / entitlements
//   §6 Server-side validation rejects garbage
//   §7 Checklists reference EXISTING routes only
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
interface Envelope<T> { ok?: boolean; data?: T; error?: string }
async function api<T = unknown>(path: string, init: RequestInit = {}): Promise<{ status: number; body: Envelope<T> }> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': CLIENT_IP(), ...(init.headers || {}) },
  });
  let body: Envelope<T> = {};
  try { body = await res.json(); } catch { /* ignore */ }
  return { status: res.status, body };
}
async function signup(email: string, opts: { plan?: 'pro' | 'enterprise' } = {}): Promise<{ userId: string; cookie: string }> {
  const r = await fetch(`${BASE}/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': CLIENT_IP() },
    body: JSON.stringify({ email, password: 'password123!', display_name: `T-${email.split('@')[0]}` }),
  });
  const cookie = r.headers.get('set-cookie')?.match(/wl_session=[^;]+/)?.[0] || '';
  const j = await r.json() as { data?: { user?: { id: string } } };
  const userId = j?.data?.user?.id as string;
  if (opts.plan) await withDb(async (db) => { await db.collection('users').updateOne({ id: userId }, { $set: { plan: opts.plan } }); });
  return { userId, cookie };
}
async function readUser(id: string) {
  return withDb(async (db) => db.collection('users').findOne({ id })) as unknown as Promise<{ id: string; role: string; plan?: string; persona?: string | null; persona_prompt_dismissed_at?: Date | null } | null>;
}
async function purge() {
  await withDb(async (db) => {
    await db.collection('users').deleteMany({ email: new RegExp(`m09per-${RUN_TAG}`) });
  });
}
beforeAll(async () => { await purge(); });
afterAll(async () => { await purge(); });

// ============================================================================
// §1 — Existing users / picker flow
// ============================================================================
describe('Phase 3 Persona §1 — Picker + Skip', () => {
  it('#1 no persona yet → should_prompt=true and dashboard renders the picker', async () => {
    const { userId, cookie } = await signup(`m09per-${RUN_TAG}-new@wavelead.test`);
    void userId;
    const r = await api<{ persona: string | null; should_prompt: boolean; prompt_dismissed: boolean }>(`/me/persona`, { headers: { Cookie: cookie } });
    expect(r.status).toBe(200);
    expect(r.body.data?.persona).toBeNull();
    expect(r.body.data?.should_prompt).toBe(true);
    expect(r.body.data?.prompt_dismissed).toBe(false);

    const page = await fetch(`${PAGE_BASE}/dashboard`, { headers: { Cookie: cookie, 'X-Forwarded-For': CLIENT_IP() } });
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain('data-testid="persona-picker"');
    expect(html).toContain('data-testid="persona-choose-owner"');
    expect(html).toContain('data-testid="persona-choose-brand"');
    expect(html).toContain('data-testid="persona-choose-both"');
    expect(html).toContain('data-testid="persona-skip"');
    // Dashboard is NOT blocked — existing owner-nav still renders.
    expect(html).toContain('data-testid="nav-pipeline-card"');
  });

  it('#2 dismiss persists prompt_dismissed=true and hides picker on next load', async () => {
    const { cookie } = await signup(`m09per-${RUN_TAG}-dismiss@wavelead.test`);
    const d = await api(`/me/persona/dismiss`, { method: 'POST', headers: { Cookie: cookie } });
    expect(d.status).toBe(200);
    const r = await api<{ persona: string | null; should_prompt: boolean; prompt_dismissed: boolean }>(`/me/persona`, { headers: { Cookie: cookie } });
    expect(r.body.data?.persona).toBeNull();
    expect(r.body.data?.prompt_dismissed).toBe(true);
    expect(r.body.data?.should_prompt).toBe(false);
    const page = await fetch(`${PAGE_BASE}/dashboard`, { headers: { Cookie: cookie, 'X-Forwarded-For': CLIENT_IP() } });
    const html = await page.text();
    expect(html).not.toContain('data-testid="persona-picker"');
    // Dashboard still fully usable — sponsorships / pipeline nav intact.
    expect(html).toContain('data-testid="nav-pipeline-card"');
    expect(html).toContain('/dashboard/sponsorships');
  });
});

// ============================================================================
// §2 — Owner preference
// ============================================================================
describe('Phase 3 Persona §2 — Owner', () => {
  it('#3 PUT persona=owner → state.persona=owner + owner_checklist populated + dashboard renders it', async () => {
    const { userId, cookie } = await signup(`m09per-${RUN_TAG}-owner@wavelead.test`);
    const r = await api<{ persona: string; owner_checklist: Array<{ key: string; label: string; done: boolean; href: string }> | null; brand_checklist: unknown }>(
      `/me/persona`, { method: 'PUT', headers: { Cookie: cookie }, body: JSON.stringify({ persona: 'owner' }) },
    );
    expect(r.status).toBe(200);
    expect(r.body.data?.persona).toBe('owner');
    expect(r.body.data?.brand_checklist).toBeNull();
    const items = r.body.data?.owner_checklist || [];
    expect(items.length).toBeGreaterThanOrEqual(5);
    const keys = items.map((i) => i.key);
    expect(keys).toContain('add_channel');
    expect(keys).toContain('verify_ownership');
    expect(keys).toContain('complete_profile');
    expect(keys).toContain('create_package');
    expect(keys).toContain('payout_details');
    expect(keys).toContain('review_opportunities');
    // Every href points at an existing route we've verified elsewhere.
    for (const it of items) {
      expect(it.href.startsWith('/dashboard/') || it.href.startsWith('/submit') || it.href === '/channels').toBe(true);
    }

    // Confirm the underlying DB record persisted only the persona field.
    const u = await readUser(userId);
    expect(u?.persona).toBe('owner');
    expect(u?.persona_prompt_dismissed_at).toBeTruthy();

    const page = await fetch(`${PAGE_BASE}/dashboard`, { headers: { Cookie: cookie, 'X-Forwarded-For': CLIENT_IP() } });
    const html = await page.text();
    expect(html).toContain('data-testid="owner-checklist"');
    expect(html).not.toContain('data-testid="brand-checklist"');
    expect(html).not.toContain('data-testid="persona-picker"');
  });
});

// ============================================================================
// §3 — Brand preference
// ============================================================================
describe('Phase 3 Persona §3 — Brand', () => {
  it('#4 PUT persona=brand → brand_checklist populated + owner_checklist null', async () => {
    const { cookie } = await signup(`m09per-${RUN_TAG}-brand@wavelead.test`);
    const r = await api<{ persona: string; owner_checklist: unknown; brand_checklist: Array<{ key: string; href: string }> | null }>(
      `/me/persona`, { method: 'PUT', headers: { Cookie: cookie }, body: JSON.stringify({ persona: 'brand' }) },
    );
    expect(r.body.data?.persona).toBe('brand');
    expect(r.body.data?.owner_checklist).toBeNull();
    const items = r.body.data?.brand_checklist || [];
    expect(items.length).toBeGreaterThanOrEqual(4);
    const keys = items.map((i) => i.key);
    expect(keys).toContain('discover');
    expect(keys).toContain('first_sponsorship');
    expect(keys).toContain('track_delivery');

    const page = await fetch(`${PAGE_BASE}/dashboard`, { headers: { Cookie: cookie, 'X-Forwarded-For': CLIENT_IP() } });
    const html = await page.text();
    expect(html).toContain('data-testid="brand-checklist"');
    expect(html).not.toContain('data-testid="owner-checklist"');
  });
});

// ============================================================================
// §4 — Both preference + view switcher
// ============================================================================
describe('Phase 3 Persona §4 — Both', () => {
  it('#5 PUT persona=both → both checklists populated + view switcher rendered', async () => {
    const { cookie } = await signup(`m09per-${RUN_TAG}-both@wavelead.test`);
    const r = await api<{ persona: string; owner_checklist: unknown; brand_checklist: unknown }>(
      `/me/persona`, { method: 'PUT', headers: { Cookie: cookie }, body: JSON.stringify({ persona: 'both' }) },
    );
    expect(r.body.data?.persona).toBe('both');
    expect(r.body.data?.owner_checklist).not.toBeNull();
    expect(r.body.data?.brand_checklist).not.toBeNull();

    const page = await fetch(`${PAGE_BASE}/dashboard`, { headers: { Cookie: cookie, 'X-Forwarded-For': CLIENT_IP() } });
    const html = await page.text();
    expect(html).toContain('data-testid="persona-view-switch"');
    expect(html).toContain('data-testid="persona-view-owner"');
    expect(html).toContain('data-testid="persona-view-brand"');
    // Owner checklist shown by default; brand accessible via toggle.
    expect(html).toContain('data-testid="owner-checklist"');
  });
});

// ============================================================================
// §5 — RBAC / plan / entitlements NEVER touched by persona
// ============================================================================
describe('Phase 3 Persona §5 — Isolation from RBAC / plan / entitlements', () => {
  it('#6 setting persona does not change user.role', async () => {
    const { userId, cookie } = await signup(`m09per-${RUN_TAG}-role@wavelead.test`);
    const before = await readUser(userId);
    expect(before?.role).toBeTruthy();
    await api(`/me/persona`, { method: 'PUT', headers: { Cookie: cookie }, body: JSON.stringify({ persona: 'owner' }) });
    await api(`/me/persona`, { method: 'PUT', headers: { Cookie: cookie }, body: JSON.stringify({ persona: 'brand' }) });
    await api(`/me/persona`, { method: 'PUT', headers: { Cookie: cookie }, body: JSON.stringify({ persona: 'both' }) });
    const after = await readUser(userId);
    expect(after?.role).toBe(before?.role);
  });

  it('#7 setting persona does not change plan or Pro entitlement gate', async () => {
    const { cookie } = await signup(`m09per-${RUN_TAG}-plan@wavelead.test`);
    // Choose owner persona.
    await api(`/me/persona`, { method: 'PUT', headers: { Cookie: cookie }, body: JSON.stringify({ persona: 'owner' }) });
    const ent = await api<{ plan: string; entitlements: Record<string, unknown> }>(`/entitlements/me`, { headers: { Cookie: cookie } });
    expect(ent.body.data?.plan).toBe('free');
    // Pro feature still gated.
    expect(ent.body.data?.entitlements.revenue_intelligence).toBe(false);
    const pipe = await api(`/owner/sponsorship-pipeline`, { headers: { Cookie: cookie } });
    expect(pipe.status).toBe(403);
  });
});

// ============================================================================
// §6 — Server-side validation
// ============================================================================
describe('Phase 3 Persona §6 — Validation', () => {
  it('#8 rejects invalid persona value with 400', async () => {
    const { cookie } = await signup(`m09per-${RUN_TAG}-val@wavelead.test`);
    const r = await api(`/me/persona`, { method: 'PUT', headers: { Cookie: cookie }, body: JSON.stringify({ persona: 'admin' }) });
    expect(r.status).toBe(400);
    const r2 = await api(`/me/persona`, { method: 'PUT', headers: { Cookie: cookie }, body: JSON.stringify({}) });
    expect(r2.status).toBe(400);
  });

  it('#9 unauthenticated returns 401', async () => {
    const r = await api(`/me/persona`);
    expect(r.status).toBe(401);
  });
});

// ============================================================================
// §7 — Checklists reference EXISTING routes only
// ============================================================================
describe('Phase 3 Persona §7 — Existing routes', () => {
  it('#10 every owner checklist href resolves 200/307 (existing route)', async () => {
    const { cookie } = await signup(`m09per-${RUN_TAG}-links@wavelead.test`);
    const r = await api<{ owner_checklist: Array<{ href: string; key: string }> | null }>(
      `/me/persona`, { method: 'PUT', headers: { Cookie: cookie }, body: JSON.stringify({ persona: 'both' }) },
    );
    const items = r.body.data?.owner_checklist || [];
    expect(items.length).toBeGreaterThan(0);
    for (const it of items) {
      const h = await fetch(`${PAGE_BASE}${it.href}`, { redirect: 'manual', headers: { Cookie: cookie, 'X-Forwarded-For': CLIENT_IP() } });
      expect([200, 307, 308]).toContain(h.status);
    }
  });
});
