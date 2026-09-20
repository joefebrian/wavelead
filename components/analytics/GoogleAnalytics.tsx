'use client';
// M17 — GA4 (G-MYGZLGH4SR) gated by WaveLead's EXISTING analytics consent.
//
// Rules:
//   • Nothing is loaded before the user grants analytics consent. Consent
//     Mode defaults to analytics_storage='denied'; we only flip to 'granted'
//     after the server-persisted consent record says analytics === true.
//   • One page_view per meaningful navigation (send_page_view:false + manual
//     page_view on pathname/search change) — no duplicates.
//   • Never sends PII, payment identifiers, evidence URLs or message content.
import { useEffect, useRef, useState, Suspense } from 'react';
import Script from 'next/script';
import { usePathname, useSearchParams } from 'next/navigation';
import { safeGa4Path } from '@/lib/analytics/ga4Location';

export const GA4_MEASUREMENT_ID = 'G-MYGZLGH4SR';

// M18 audit — live consent mirror. gtag.js stays resident in the page once it
// has loaded, so a revocation must also gate every event helper: with the tag
// resident, a post-revocation gtag('event', …) would still reach Google as a
// cookieless ping, which WaveLead's BASIC Consent Mode policy forbids.
let ga4Granted = false;

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

function PageViews({ enabled }: { enabled: boolean }) {
  const pathname = usePathname();
  const search = useSearchParams();
  const last = useRef<string | null>(null);
  useEffect(() => {
    if (!enabled || typeof window === 'undefined' || !window.gtag) return;
    const qs = search?.toString();
    // M18 audit — strip provider/internal identifiers (PayPal token & PayerID,
    // brand_pro, activation, order, attempt, founding_lifetime, funding, …).
    const url = safeGa4Path(pathname || '/', qs);
    if (last.current === url) return;      // de-dupe: one view per navigation
    last.current = url;
    const loc = window.location.origin + url;
    // gtag('set') makes the sanitized location authoritative for EVERY later
    // hit (page_view, custom events, automatic user_engagement), overriding
    // GA4's automatic document.location collection.
    window.gtag('set', { page_path: url, page_location: loc });
    window.gtag('event', 'page_view', { page_path: url, page_location: loc });
  }, [enabled, pathname, search]);
  return null;
}

export default function GoogleAnalytics() {
  const [granted, setGranted] = useState(false);

  // Read the authoritative, server-persisted consent decision.
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const r = await fetch('/api/consent', { credentials: 'include' });
        const j = await r.json() as { data?: { consent?: { analytics?: boolean } } };
        if (!cancelled) setGranted(!!j?.data?.consent?.analytics);
      } catch { /* no consent record → stays denied */ }
    }
    load();
    // The consent banner dispatches this after a decision is persisted.
    const onChange = () => load();
    window.addEventListener('wl-consent-changed', onChange);
    return () => { cancelled = true; window.removeEventListener('wl-consent-changed', onChange); };
  }, []);

  // Flip Consent Mode when consent changes after the tag is already present.
  useEffect(() => {
    ga4Granted = granted;            // gate the event helper immediately
    if (typeof window === 'undefined' || !window.gtag) return;
    window.gtag('consent', 'update', { analytics_storage: granted ? 'granted' : 'denied' });
  }, [granted]);

  if (!granted) return null;   // no GA4 network request before consent

  return (
    <>
      <Script id="ga4-consent-default" strategy="afterInteractive">
        {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}window.gtag=window.gtag||gtag;
gtag('consent','default',{ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied',analytics_storage:'denied'});
gtag('consent','update',{analytics_storage:'granted'});`}
      </Script>
      <Script id="ga4-src" strategy="afterInteractive" src={`https://www.googletagmanager.com/gtag/js?id=${GA4_MEASUREMENT_ID}`} />
      <Script id="ga4-init" strategy="afterInteractive">
        {`gtag('js', new Date());gtag('config','${GA4_MEASUREMENT_ID}',{send_page_view:false,anonymize_ip:true});`}
      </Script>
      <Suspense fallback={null}><PageViews enabled={granted} /></Suspense>
    </>
  );
}

/**
 * Safe GA4 event helper. Only whitelisted, non-sensitive product events.
 * Never pass legal names, emails, phones, PayPal identifiers, evidence URLs,
 * message content or tokens.
 */
export const GA4_SAFE_EVENTS = [
  'channel_submit_started', 'channel_submit_completed',
  'fast_verification_started', 'fast_verification_payment_completed',
  'owner_identity_completed', 'owner_verified', 'manual_verification_submitted',
  'sponsorship_request_sent', 'sponsorship_request_accepted', 'marketplace_booking_started',
  'brand_pro_checkout_started', 'brand_pro_activated', 'brand_pro_renewed',
  'founding_lifetime_checkout_started', 'founding_lifetime_activated',
] as const;
export type Ga4SafeEvent = typeof GA4_SAFE_EVENTS[number];

const BLOCKED_KEYS = /(email|phone|mobile|name|paypal|capture|order_id|token|password|secret|message|evidence|drive)/i;

export function ga4Track(event: Ga4SafeEvent, params: Record<string, string | number | boolean> = {}): void {
  if (typeof window === 'undefined' || !window.gtag) return;
  if (!ga4Granted) return;                             // revoked/never granted → nothing is sent
  if (!(GA4_SAFE_EVENTS as readonly string[]).includes(event)) return;
  const safe: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(params)) {
    if (BLOCKED_KEYS.test(k)) continue;              // never emit sensitive payloads
    if (typeof v === 'string' && v.length > 60) continue;
    safe[k] = v;
  }
  // Many of these events fire on PayPal return URLs. Pin the sanitized location
  // so GA4 cannot auto-collect provider/internal identifiers from the live URL.
  const url = safeGa4Path(window.location.pathname, window.location.search);
  safe.page_path = url;
  safe.page_location = window.location.origin + url;
  window.gtag('event', event, safe);
}
