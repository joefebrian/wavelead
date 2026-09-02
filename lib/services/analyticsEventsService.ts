// M11-Batch3 — First-party analytics events.
//
// Contract:
//   • Consent enforced SERVER-SIDE. If analytics = false (or no decision),
//     the event is dropped WITHOUT persistence. The client can send a
//     request, but we will not honour it.
//   • event_name must be in the compile-time allowlist.
//   • metadata is filtered against a strict per-event allowlist, then
//     length-bounded.
//   • user_id, when present, comes from the SERVER SESSION only — never
//     from the request body.
//   • We do NOT store raw IPs, raw headers, raw referrer URLs, or free-text
//     search queries.
import { v4 as uuidv4 } from 'uuid';
import { NextRequest } from 'next/server';
import { getCollection } from '../db/mongo';
import { COLLECTIONS } from '../db/collections';
import { hasAnalyticsConsent, ensureVisitorCookieOnResponse } from './consentService';
import { ANALYTICS_EVENT_NAMES, type AnalyticsEvent, type AnalyticsEventName, type SafeEventMetadata } from '@/lib/types';
import { EVENT_METADATA_ALLOWLIST, META_STRING_MAX, PATHNAME_MAX, REFERRER_DOMAIN_MAX, UTM_MAX } from '@/lib/constants/analyticsEvents';
import { NextResponse } from 'next/server';
import { resolveActor } from '@/lib/auth/rbac';

function sanitizeString(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const trimmed = v.trim();
  if (!trimmed) return null;
  // Strip control chars.
  const clean = trimmed.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, max);
  return clean || null;
}

function sanitizePathname(v: unknown): string {
  const s = sanitizeString(v, PATHNAME_MAX);
  if (!s) return '/';
  // Force leading slash, drop query/fragment. Never include host.
  const noQ = s.split('?')[0].split('#')[0];
  const rooted = noQ.startsWith('/') ? noQ : `/${noQ}`;
  return rooted.slice(0, PATHNAME_MAX);
}

function sanitizeReferrerDomain(v: unknown): string | null {
  const s = sanitizeString(v, REFERRER_DOMAIN_MAX);
  if (!s) return null;
  // Allow only host-like tokens.
  return /^[a-z0-9.-]{1,253}$/i.test(s) ? s.toLowerCase() : null;
}

function sanitizeMeta(eventName: AnalyticsEventName, raw: unknown): SafeEventMetadata {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const allow = EVENT_METADATA_ALLOWLIST[eventName] || {};
  const out: SafeEventMetadata = {};
  for (const [key, kind] of Object.entries(allow)) {
    const val = (raw as Record<string, unknown>)[key];
    if (val === undefined || val === null) continue;
    if (kind === 'string') {
      const s = sanitizeString(val, META_STRING_MAX);
      if (s) out[key] = s;
    } else if (kind === 'number') {
      const n = typeof val === 'number' && Number.isFinite(val) ? val : Number(val);
      if (Number.isFinite(n)) out[key] = Math.trunc(n);
    } else if (kind === 'boolean') {
      if (typeof val === 'boolean') out[key] = val;
    }
  }
  return out;
}

function isAllowedEventName(name: unknown): name is AnalyticsEventName {
  return typeof name === 'string' && (ANALYTICS_EVENT_NAMES as readonly string[]).includes(name);
}

interface IngestResult { status: 'stored' | 'consent_declined' | 'invalid'; event_name?: AnalyticsEventName }

export const analyticsEventsService = {
  // Server-side ingest. Returns a fully-composed NextResponse so cookies
  // (e.g., wl_visitor_id issuance) can be attached in one place.
  async ingest(request: NextRequest, body: unknown): Promise<{ response: NextResponse; result: IngestResult }> {
    // Consent gate BEFORE we even validate the body.
    const consent = hasAnalyticsConsent(request);
    if (!consent) {
      // 204 responses must NOT include a body per the HTTP spec.
      const res = new NextResponse(null, { status: 204 });
      return { response: res, result: { status: 'consent_declined' } };
    }

    if (!body || typeof body !== 'object') {
      return { response: NextResponse.json({ ok: false, error: { message: 'Invalid payload' } }, { status: 400 }), result: { status: 'invalid' } };
    }
    const b = body as Record<string, unknown>;
    if (!isAllowedEventName(b.event_name)) {
      return { response: NextResponse.json({ ok: false, error: { message: 'Unknown event_name' } }, { status: 400 }), result: { status: 'invalid' } };
    }

    // Server-authenticated user_id (never trust client value).
    const actor = await resolveActor(request);
    const userId = actor?.user.id ?? null;

    const response = NextResponse.json({ ok: true, data: { status: 'stored' } });
    const ensured = ensureVisitorCookieOnResponse(request, response);

    const sessionId = sanitizeString(b.session_id, 64);
    const pathname = sanitizePathname(b.pathname);
    const referrerDomain = sanitizeReferrerDomain(b.referrer_domain);
    const utmSource = sanitizeString(b.utm_source, UTM_MAX);
    const utmMedium = sanitizeString(b.utm_medium, UTM_MAX);
    const utmCampaign = sanitizeString(b.utm_campaign, UTM_MAX);

    const now = new Date();
    const doc: AnalyticsEvent = {
      id: uuidv4(),
      anonymous_visitor_id: ensured.visitorId,
      user_id: userId,
      session_id: sessionId,
      event_name: b.event_name,
      pathname,
      referrer_domain: referrerDomain,
      utm_source: utmSource,
      utm_medium: utmMedium,
      utm_campaign: utmCampaign,
      metadata_safe: sanitizeMeta(b.event_name, b.metadata),
      occurred_at: now,
      created_at: now,
    };
    try {
      const c = await getCollection<AnalyticsEvent>(COLLECTIONS.ANALYTICS_EVENTS);
      await c.insertOne(doc as unknown as import('mongodb').OptionalUnlessRequiredId<AnalyticsEvent>);
    } catch { /* never break the render path */ }
    return { response, result: { status: 'stored', event_name: b.event_name } };
  },
};
