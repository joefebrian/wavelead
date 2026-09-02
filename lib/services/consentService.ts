// M11-Batch3 — Cookie consent service.
//
// Semantics:
//   • wl_visitor_id  → HttpOnly first-party UUID, 1 year, path=/.
//     Anonymous browsing identity. Never derived by fingerprinting.
//   • wl_consent    → HttpOnly JSON-encoded consent state.
//     { a: 0|1, v: <policy_version>, ts: <consented_at epoch>, u: <updated_at epoch> }
//     Absence of the cookie means NO decision yet → banner is shown, and no
//     optional analytics events are persisted.
//
// The client never trusts, edits, or forges these cookies. Every analytics
// endpoint re-reads them server-side; consent is enforced on the server.
import { v4 as uuidv4 } from 'uuid';
import { NextRequest, NextResponse } from 'next/server';
import { getCollection, stripId } from '../db/mongo';
import { COLLECTIONS } from '../db/collections';
import { CONSENT_POLICY_VERSION } from '@/lib/types';
import type { ConsentRecord, ConsentState } from '@/lib/types';

export const VISITOR_COOKIE = 'wl_visitor_id';
export const CONSENT_COOKIE = 'wl_consent';
const YEAR_SECONDS = 60 * 60 * 24 * 365;

function cookieOpts(maxAge: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge,
  };
}

export function readVisitorId(request: NextRequest): string | null {
  return request.cookies.get(VISITOR_COOKIE)?.value || null;
}

function encodeConsent(state: ConsentState): string {
  const raw = JSON.stringify({
    a: state.analytics ? 1 : 0,
    v: state.policy_version,
    ts: Date.parse(state.consented_at),
    u: Date.parse(state.updated_at),
  });
  return Buffer.from(raw, 'utf8').toString('base64url');
}

function decodeConsent(raw: string | undefined | null): ConsentState | null {
  if (!raw) return null;
  try {
    const json = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as { a?: number; v?: number; ts?: number; u?: number };
    if (typeof json.a !== 'number' || typeof json.v !== 'number' || typeof json.ts !== 'number') return null;
    return {
      necessary: true,
      analytics: json.a === 1,
      policy_version: json.v,
      consented_at: new Date(json.ts).toISOString(),
      updated_at: new Date(typeof json.u === 'number' ? json.u : json.ts).toISOString(),
    };
  } catch { return null; }
}

export function readConsent(request: NextRequest): ConsentState | null {
  return decodeConsent(request.cookies.get(CONSENT_COOKIE)?.value);
}

// Server-side gate used by the analytics ingest endpoint. Returns null if the
// user has NOT granted analytics consent for the current policy version.
export function hasAnalyticsConsent(request: NextRequest): ConsentState | null {
  const s = readConsent(request);
  if (!s) return null;
  if (!s.analytics) return null;
  if (s.policy_version !== CONSENT_POLICY_VERSION) return null;
  return s;
}

export interface EnsuredCookies {
  visitorId: string;
  visitorCookieWasSet: boolean;
  consent: ConsentState | null;
}

// Ensure a visitor id exists on the response. If already present in the
// request cookies, return that value and DO NOT rewrite (idempotent).
export function ensureVisitorCookieOnResponse(request: NextRequest, response: NextResponse): EnsuredCookies {
  const existing = readVisitorId(request);
  const consent = readConsent(request);
  if (existing) return { visitorId: existing, visitorCookieWasSet: false, consent };
  const id = uuidv4();
  response.cookies.set({ name: VISITOR_COOKIE, value: id, ...cookieOpts(YEAR_SECONDS) });
  return { visitorId: id, visitorCookieWasSet: true, consent };
}

export function setConsentCookieOnResponse(response: NextResponse, state: ConsentState): void {
  response.cookies.set({ name: CONSENT_COOKIE, value: encodeConsent(state), ...cookieOpts(YEAR_SECONDS) });
}

export function clearConsentCookieOnResponse(response: NextResponse): void {
  response.cookies.set({ name: CONSENT_COOKIE, value: '', ...cookieOpts(0) });
}

export const consentService = {
  // Reads current state from request cookies. Used by GET /api/consent.
  read(request: NextRequest) {
    return { visitorId: readVisitorId(request), consent: readConsent(request), policy_version: CONSENT_POLICY_VERSION };
  },

  // Persist a decision. Sets cookies on the given response, and appends a row
  // to consent_records. `user_id` is server-authenticated — the caller must
  // pass it from resolveActor(), NEVER trust a client-supplied value.
  async record(
    request: NextRequest,
    response: NextResponse,
    { analytics, userId }: { analytics: boolean; userId: string | null },
  ): Promise<{ visitorId: string; consent: ConsentState }> {
    const ensured = ensureVisitorCookieOnResponse(request, response);
    const now = new Date();
    const priorConsentedAt = ensured.consent?.consented_at || now.toISOString();
    const state: ConsentState = {
      necessary: true,
      analytics,
      policy_version: CONSENT_POLICY_VERSION,
      consented_at: priorConsentedAt,
      updated_at: now.toISOString(),
    };
    setConsentCookieOnResponse(response, state);

    const record: ConsentRecord = {
      id: uuidv4(),
      anonymous_visitor_id: ensured.visitorId,
      user_id: userId,
      necessary: true,
      analytics,
      policy_version: CONSENT_POLICY_VERSION,
      consented_at: new Date(state.consented_at),
      updated_at: now,
      created_at: now,
    };
    try {
      const c = await getCollection<ConsentRecord>(COLLECTIONS.CONSENT_RECORDS);
      await c.insertOne(record as unknown as import('mongodb').OptionalUnlessRequiredId<ConsentRecord>);
    } catch { /* never break the flow on audit-write failure */ }
    void stripId; // reserved for future read helpers
    return { visitorId: ensured.visitorId, consent: state };
  },
};
