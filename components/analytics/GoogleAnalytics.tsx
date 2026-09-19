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

export const GA4_MEASUREMENT_ID = 'G-MYGZLGH4SR';

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
    const url = `${pathname}${qs ? `?${qs}` : ''}`;
    if (last.current === url) return;      // de-dupe: one view per navigation
    last.current = url;
    window.gtag('event', 'page_view', { page_path: url, page_location: window.location.origin + url });
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
  if (!(GA4_SAFE_EVENTS as readonly string[]).includes(event)) return;
  const safe: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(params)) {
    if (BLOCKED_KEYS.test(k)) continue;              // never emit sensitive payloads
    if (typeof v === 'string' && v.length > 60) continue;
    safe[k] = v;
  }
  window.gtag('event', event, safe);
}
