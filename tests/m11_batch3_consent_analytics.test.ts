// M11-Batch3 — Cookie Consent + First-Party Analytics.
//
// Verifies (server-side enforcement is what actually matters):
//   §1  GET /api/consent returns null consent when no cookie is present
//   §2  POST /api/consent sets wl_consent + wl_visitor_id cookies and
//       persists a consent_records row (analytics=true)
//   §3  Reject Non-Essential: POST /api/consent { analytics:false } is
//       equally functional (cookie set, DB row inserted)
//   §4  Analytics ingest WITHOUT consent → 204, no row persisted
//   §5  Analytics ingest WITH consent → 200 (stored), row persisted with
//       server-derived visitor_id, safe metadata allow-listed
//   §6  Unknown event_name rejected with 400 (allowlist)
//   §7  Client-supplied user_id is NEVER trusted; server uses session
//   §8  Revocation: switching analytics back to false stops persistence
//   §9  /cookies + /privacy render truthful copy (no third-party trackers,
//       no fingerprinting claims)
//  §10  Footer has "Cookie Preferences" trigger
//  §11  P2P Labs attribution + Batch 1 pricing invariants unchanged
import { describe, it, expect, beforeAll } from 'vitest';
import { MongoClient, type Db } from 'mongodb';
import { COLLECTIONS } from '@/lib/db/collections';

const BASE = 'http://localhost:3000/api';
const PAGE = 'http://localhost:3000';
const RUN_TAG = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;

async function withDb<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  const client = new MongoClient(process.env.MONGO_URL || 'mongodb://localhost:27017');
  await client.connect();
  try { return await fn(client.db(process.env.DB_NAME || 'wavelead')); }
  finally { await client.close(); }
}

function ip(): string { return `10.${Math.floor(Math.random()*255)}.${Math.floor(Math.random()*255)}.${Math.floor(Math.random()*255)}`; }

interface CookieJar { get(name: string): string | null; asHeader(): string; parseSetCookie(sc: string | null): void; }
function mkJar(): CookieJar {
  const map = new Map<string, string>();
  return {
    get(name) { return map.get(name) ?? null; },
    asHeader() { return Array.from(map.entries()).map(([k, v]) => `${k}=${v}`).join('; '); },
    parseSetCookie(sc) {
      if (!sc) return;
      // Node fetch collapses multiple set-cookie into one header. Split safely.
      const parts = sc.split(/,(?=\s*[a-zA-Z0-9_\-]+=)/);
      for (const p of parts) {
        const first = p.split(';')[0].trim();
        const eq = first.indexOf('=');
        if (eq <= 0) continue;
        const k = first.slice(0, eq).trim();
        const v = first.slice(eq + 1).trim();
        if (v === '') { map.delete(k); continue; }
        map.set(k, v);
      }
    },
  };
}

async function jFetch(path: string, jar: CookieJar, init: RequestInit = {}) {
  const headers = new Headers(init.headers || {});
  headers.set('X-Forwarded-For', ip());
  const c = jar.asHeader(); if (c) headers.set('cookie', c);
  const res = await fetch(`${BASE}${path}`, { ...init, headers });
  jar.parseSetCookie(res.headers.get('set-cookie'));
  let j: Record<string, unknown> = {};
  try { j = (await res.json()) as Record<string, unknown>; } catch { /* 204 has no body */ }
  return { status: res.status, json: j };
}

async function pageGet(path: string): Promise<{ status: number; html: string }> {
  const r = await fetch(`${PAGE}${path}`, { headers: { 'X-Forwarded-For': ip() } });
  return { status: r.status, html: await r.text() };
}

describe('M11-Batch3 — Consent Manager', () => {
  it('§1 GET /api/consent returns null consent when no cookie present', async () => {
    const jar = mkJar();
    const r = await jFetch('/consent', jar);
    expect(r.status).toBe(200);
    const d = r.json.data as { consent?: unknown; visitor_id?: unknown; policy_version?: number };
    expect(d.consent).toBeNull();
    expect(d.visitor_id).toBeNull();
    expect(d.policy_version).toBe(1);
  });

  it('§2 POST /api/consent (Accept All) sets wl_consent + wl_visitor_id and persists a record', async () => {
    const jar = mkJar();
    const r = await jFetch('/consent', jar, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ analytics: true }),
    });
    expect(r.status).toBe(200);
    const visitor = jar.get('wl_visitor_id');
    const consent = jar.get('wl_consent');
    expect(visitor).toBeTruthy();
    expect(consent).toBeTruthy();
    // DB audit row for THIS visitor exists.
    const rows = await withDb(async (db) => db.collection(COLLECTIONS.CONSENT_RECORDS).find({ anonymous_visitor_id: visitor as string }).toArray());
    expect(rows.length).toBe(1);
    expect(rows[0].analytics).toBe(true);
    expect(rows[0].necessary).toBe(true);
    expect(rows[0].policy_version).toBe(1);
  });

  it('§3 Reject Non-Essential is equally functional', async () => {
    const jar = mkJar();
    const r = await jFetch('/consent', jar, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ analytics: false }),
    });
    expect(r.status).toBe(200);
    const visitor = jar.get('wl_visitor_id');
    const consent = jar.get('wl_consent');
    expect(visitor).toBeTruthy();
    expect(consent).toBeTruthy();
    const rows = await withDb(async (db) => db.collection(COLLECTIONS.CONSENT_RECORDS).find({ anonymous_visitor_id: visitor as string }).toArray());
    expect(rows.length).toBe(1);
    expect(rows[0].analytics).toBe(false);
  });

  it('§10 footer surfaces a "Cookie Preferences" trigger on every page', async () => {
    const home = await pageGet('/');
    expect(home.status).toBe(200);
    expect(home.html).toContain('data-testid="footer-cookie-preferences"');
    expect(home.html).toContain('Cookie Preferences');
  });
});

describe('M11-Batch3 — Analytics Consent Enforcement', () => {
  it('§4 no consent → analytics event dropped (204) and NOT persisted', async () => {
    const jar = mkJar();
    // No consent decision — try to send an event anyway.
    const r = await jFetch('/analytics/events', jar, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event_name: 'page_view', pathname: `/no-consent-${RUN_TAG}` }),
    });
    expect(r.status).toBe(204);
    const persisted = await withDb(async (db) => db.collection(COLLECTIONS.ANALYTICS_EVENTS).countDocuments({ pathname: `/no-consent-${RUN_TAG}` }));
    expect(persisted).toBe(0);
  });

  it('§5 with analytics=true → event persisted with server-derived visitor_id and allowlisted metadata', async () => {
    const jar = mkJar();
    // 1) Accept analytics.
    await jFetch('/consent', jar, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ analytics: true }) });
    const visitor = jar.get('wl_visitor_id');
    expect(visitor).toBeTruthy();

    // 2) Send a channel_profile_view with server-known fields + a disallowed key.
    const path = `/consent-yes-${RUN_TAG}`;
    const r = await jFetch('/analytics/events', jar, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event_name: 'channel_profile_view',
        pathname: path,
        referrer_domain: 'google.com',
        utm_source: 'newsletter',
        session_id: `sess-${RUN_TAG}`,
        metadata: {
          channel_id: 'chan-abc',
          channel_slug: 'nice-slug',
          password: 'not-allowed',        // must be stripped
          email: 'never@stored.test',     // must be stripped
        },
      }),
    });
    expect(r.status).toBe(200);
    // 3) Verify DB row.
    const row = await withDb(async (db) => db.collection(COLLECTIONS.ANALYTICS_EVENTS).findOne({ pathname: path }));
    expect(row).toBeTruthy();
    expect(row!.anonymous_visitor_id).toBe(visitor);
    expect(row!.event_name).toBe('channel_profile_view');
    expect(row!.metadata_safe).toEqual({ channel_id: 'chan-abc', channel_slug: 'nice-slug' });
    expect(row!.utm_source).toBe('newsletter');
    expect(row!.referrer_domain).toBe('google.com');
    // Sensitive fields never leak.
    const raw = JSON.stringify(row);
    expect(raw).not.toContain('not-allowed');
    expect(raw).not.toContain('never@stored.test');
  });

  it('§6 unknown event_name rejected 400 (allowlist)', async () => {
    const jar = mkJar();
    await jFetch('/consent', jar, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ analytics: true }) });
    const r = await jFetch('/analytics/events', jar, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event_name: 'evil_pixel_fire', pathname: '/x' }),
    });
    expect(r.status).toBe(400);
  });

  it('§7 client-supplied user_id is IGNORED; server uses session (anonymous → null)', async () => {
    const jar = mkJar();
    await jFetch('/consent', jar, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ analytics: true }) });
    const path = `/spoof-uid-${RUN_TAG}`;
    await jFetch('/analytics/events', jar, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event_name: 'page_view', pathname: path, user_id: 'ATTACKER-CONTROLLED' }),
    });
    const row = await withDb(async (db) => db.collection(COLLECTIONS.ANALYTICS_EVENTS).findOne({ pathname: path }));
    expect(row).toBeTruthy();
    expect(row!.user_id).toBeNull();
  });

  it('§8 revocation stops persistence going forward', async () => {
    const jar = mkJar();
    // Grant, send one event, verify it persists.
    await jFetch('/consent', jar, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ analytics: true }) });
    const before = `/revoke-before-${RUN_TAG}`;
    await jFetch('/analytics/events', jar, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ event_name: 'page_view', pathname: before }) });
    const b = await withDb(async (db) => db.collection(COLLECTIONS.ANALYTICS_EVENTS).findOne({ pathname: before }));
    expect(b).toBeTruthy();

    // Revoke.
    await jFetch('/consent', jar, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ analytics: false }) });
    // Second event MUST NOT persist.
    const after = `/revoke-after-${RUN_TAG}`;
    const r = await jFetch('/analytics/events', jar, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ event_name: 'page_view', pathname: after }) });
    expect(r.status).toBe(204);
    const a = await withDb(async (db) => db.collection(COLLECTIONS.ANALYTICS_EVENTS).findOne({ pathname: after }));
    expect(a).toBeNull();
  });
});

describe('M11-Batch3 — Policies + Invariants', () => {
  it('§9 /cookies renders truthful copy (categories, first-party, no third-party trackers, no fingerprinting)', async () => {
    const r = await pageGet('/cookies');
    expect(r.status).toBe(200);
    // Categories & names.
    expect(r.html).toMatch(/Necessary/);
    expect(r.html).toMatch(/Analytics/);
    // First-party identifiers described.
    expect(r.html).toContain('wl_visitor_id');
    expect(r.html).toContain('wl_consent');
    // Anti-tracker claims present.
    expect(r.html).toMatch(/fingerprinting/i);
    expect(r.html).toMatch(/session replay/i);
    expect(r.html).toMatch(/retargeting/i);
    // Cookie preferences re-open trigger exists on this page too.
    expect(r.html).toContain('data-testid="cookies-preferences-manager"');
  });

  it('§9 /privacy reflects Batch 3 behaviour truthfully', async () => {
    const r = await pageGet('/privacy');
    expect(r.status).toBe(200);
    expect(r.html).toMatch(/first-party visitor identifier/i);
    expect(r.html).toContain('wl_visitor_id');
    expect(r.html).toMatch(/off by default/i);
    // Never claim we collect nothing.
    expect(r.html).not.toMatch(/we collect no data/i);
  });

  it('§11 P2P Labs attribution + Batch 1 pricing unchanged', async () => {
    const home = await pageGet('/');
    expect(home.status).toBe(200);
    expect(home.html).toContain('data-testid="footer-attribution"');
    expect(home.html).toContain('P2P Labs');
    expect(home.html).toContain('Founding Beta');
    expect(home.html).toMatch(/\$19\s*\/\s*mo/i);
  });
});
