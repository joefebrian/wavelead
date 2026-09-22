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
//   • Product events go through lib/analytics/events.ts (canonical helper).
//     This file is the ONLY place window.gtag() is called directly.
import { useEffect, useRef, useState, Suspense } from 'react';
import Script from 'next/script';
import { usePathname, useSearchParams } from 'next/navigation';
import { safeGa4Path } from '@/lib/analytics/ga4Location';
import { setGa4ConsentGranted, trackGa4Event, type Ga4Event, type Ga4Params, GA4_EVENTS } from '@/lib/analytics/events';

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
    setGa4ConsentGranted(granted);   // gate every trackGa4Event() immediately
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

// -----------------------------------------------------------------------------
// Backwards-compatible re-exports. All new code should import from
// '@/lib/analytics/events' directly.
// -----------------------------------------------------------------------------
export const GA4_SAFE_EVENTS = GA4_EVENTS;
export type Ga4SafeEvent = Ga4Event;
/** @deprecated Use `trackGa4Event` from '@/lib/analytics/events'. */
export function ga4Track(event: Ga4Event, params: Ga4Params = {}): void { trackGa4Event(event, params); }

