'use client';
// M19.3 — Canonical GA4 product-analytics event layer.
//
// One helper. One event allowlist. One parameter allowlist. One PII gate.
// Every GA4 event in the app MUST go through trackGa4Event(). Direct
// window.gtag('event', …) calls are forbidden outside components/analytics/
// GoogleAnalytics.tsx (which owns page_view + consent) — a source-level test
// enforces that in tests/m19_3_ga4.test.ts.
//
// Non-goals: financial reconciliation, revenue reporting, purchase events.
// WaveLead DB / Admin Reports remain authoritative for money.
import { safeGa4Path } from '@/lib/analytics/ga4Location';

// ---------------------------------------------------------------------------
// Consent gate
// ---------------------------------------------------------------------------
// GoogleAnalytics.tsx flips this to true only after the server-persisted
// consent record reports analytics === true, and immediately back to false on
// revoke. The tag script stays resident in the page once loaded, so this
// module-level gate is what actually stops post-revoke gtag('event', …) hits.
let ga4Granted = false;
export function setGa4ConsentGranted(v: boolean): void { ga4Granted = v; }
export function isGa4ConsentGranted(): boolean { return ga4Granted; }

// ---------------------------------------------------------------------------
// Event allowlist (semantic product events only — no UI implementation details)
// ---------------------------------------------------------------------------
export const GA4_EVENTS = [
  // Auth
  'sign_up',
  'login',

  // Channel-owner funnel
  'channel_submission_started',
  'channel_submitted',
  'verification_started',
  'fast_verification_checkout_started',
  'channel_verified',
  'rate_card_created',
  'sample_work_added',

  // Brand / direct sponsorship funnel
  'channel_profile_viewed',
  'sponsorship_request_started',
  'sponsorship_request_sent',
  'booking_started',
  'booking_created',
  'delivery_submitted',
  'booking_completed',

  // Brand campaign funnel
  'campaign_created',
  'campaign_commitment_started',
  'campaign_opened',
  'campaign_viewed',
  'campaign_application_started',
  'campaign_application_submitted',
  'campaign_application_shortlisted',
  'campaign_application_approved',
  'campaign_booking_started',

  // Commercial products (intent only — NOT revenue confirmation)
  'brand_pro_checkout_started',
  'founding_lifetime_checkout_started',
  'owner_activation_checkout_started',

  // Support surface (aggregate UI only)
  'support_widget_opened',
  'support_conversation_started',

  // Public discovery
  'category_viewed',
  'country_viewed',
  'trending_viewed',
  'search_used',
] as const;
export type Ga4Event = typeof GA4_EVENTS[number];

// ---------------------------------------------------------------------------
// Parameter allowlist (safe, small, semantic — never any identifier)
// ---------------------------------------------------------------------------
const PARAM_ALLOWLIST = new Set([
  // Auth
  'account_type',
  // Funnels
  'country_code',
  'category_slug',
  'verification_method',
  'channel_category',
  'channel_country',
  'currency',
  'objective',
  'target_country',
  'target_category',
  'product_name',
  'trend_period',
  'result_count_bucket',
]);

const PARAM_VALUE_ALLOWLIST: Record<string, ReadonlySet<string>> = {
  account_type:        new Set(['brand', 'channel_owner', 'both', 'unknown']),
  verification_method: new Set(['fast', 'manual']),
  product_name:        new Set(['brand_pro_30_day', 'founding_lifetime', 'owner_activation']),
  trend_period:        new Set(['7d', '30d', 'most_followed']),
  currency:            new Set(['USD', 'IDR']),
  result_count_bucket: new Set(['0', '1-5', '6-20', '21-100', '100+']),
};

// ---------------------------------------------------------------------------
// PII / provider-identifier guard. If ANY value looks like an email, phone,
// UUID, provider order/capture id, JWT, or long opaque token, we drop the
// entire event rather than truncate — an event that leaks is worse than an
// event that never fires.
// ---------------------------------------------------------------------------
const SHAPE_EMAIL   = /[^\s@]+@[^\s@]+\.[^\s@]{2,}/;
const SHAPE_UUID    = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;
const SHAPE_JWT     = /\beyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\b/;
const SHAPE_LONGHEX = /\b[0-9a-f]{24,}\b/i;
const SHAPE_LONGTOK = /[A-Za-z0-9_\-]{40,}/;
// Provider prefixes to reject on sight (PayPal orders, captures, refunds).
const SHAPE_PAYPAL  = /\b(?:PAYID-|PAY-|CAP[TX]?-|RE-\d|PayerID)\b/i;
const SHAPE_PHONE_CHARS = /^[+\d\s\-().]+$/;

function looksSensitive(v: unknown): boolean {
  if (typeof v !== 'string') return false;
  if (SHAPE_EMAIL.test(v))   return true;
  if (SHAPE_UUID.test(v))    return true;
  if (SHAPE_JWT.test(v))     return true;
  if (SHAPE_PAYPAL.test(v))  return true;
  if (SHAPE_LONGHEX.test(v)) return true;
  if (SHAPE_LONGTOK.test(v)) return true;
  // Phone: 8+ digits AND the whole value only uses phone-shaped chars.
  const digitsOnly = v.replace(/\D/g, '');
  if (digitsOnly.length >= 8 && SHAPE_PHONE_CHARS.test(v)) return true;
  return false;
}

export interface Ga4Params { [k: string]: string | number | boolean | null | undefined; }

/** Public entry point. Silent no-op on missing consent, unknown event, or PII shape. */
export function trackGa4Event(event: Ga4Event, params: Ga4Params = {}): void {
  if (typeof window === 'undefined') return;
  if (!ga4Granted) return;                                    // consent gate
  if (!window.gtag) return;                                   // GA4 not loaded
  if (!(GA4_EVENTS as readonly string[]).includes(event)) return;

  const safe: Record<string, string | number | boolean> = {};
  for (const [k, raw] of Object.entries(params)) {
    if (raw === undefined || raw === null || raw === '') continue;
    if (!PARAM_ALLOWLIST.has(k)) continue;                    // param name gate
    const v = typeof raw === 'string' ? raw.trim() : raw;
    if (typeof v === 'string') {
      // PII / provider-identifier check runs BEFORE length/vocabulary so a
      // sensitive value never slips past by being long or off-vocabulary.
      if (looksSensitive(v)) return;                          // hard-abort the event
      if (v.length === 0 || v.length > 60) continue;          // reject "long" strings entirely
      const perValue = PARAM_VALUE_ALLOWLIST[k];
      if (perValue && !perValue.has(v)) continue;             // reject values outside the vocabulary
      safe[k] = v;
    } else if (typeof v === 'number') {
      if (!Number.isFinite(v)) continue;
      safe[k] = v;
    } else if (typeof v === 'boolean') {
      safe[k] = v;
    }
  }

  // Pin the sanitised page location so GA4 cannot auto-collect provider or
  // internal identifiers from window.location (PayPal token/PayerID, etc.).
  const url = safeGa4Path(window.location.pathname, window.location.search);
  safe.page_path = url;
  safe.page_location = window.location.origin + url;
  window.gtag('event', event, safe);
}

// ---------------------------------------------------------------------------
// Once-per-page fire helper. Blocks duplicates from React strict-mode double
// mount, route rehydration, form double-callbacks and browser-return re-runs.
// The key is caller-supplied and lives in-memory for the lifetime of the page.
// ---------------------------------------------------------------------------
const _fired = new Set<string>();
export function trackGa4EventOnce(key: string, event: Ga4Event, params: Ga4Params = {}): void {
  if (_fired.has(key)) return;
  _fired.add(key);
  trackGa4Event(event, params);
}
/** Test-only reset. */
export function _resetGa4EventsFiredForTest(): void { _fired.clear(); }
