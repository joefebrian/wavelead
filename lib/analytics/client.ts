'use client';
// M11-Batch3 — Client-side analytics helper.
//
// Contract:
//   • The client optimistically POSTs to /api/analytics/events using
//     keepalive:true so navigations don't drop the beacon.
//   • The SERVER decides whether to persist — if the visitor has not
//     opted-in to Analytics, the endpoint drops the payload with 204.
//   • We NEVER read consent state from JS to decide whether to send; the
//     server is the source of truth.
//   • session_id is a per-tab identifier held only in sessionStorage; it is
//     never persisted server-side beyond the analytics rows themselves.
import type { AnalyticsEventName } from '@/lib/types';

type SafePrimitive = string | number | boolean | null;

function getSessionId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const key = 'wl_analytics_sid';
    let sid = sessionStorage.getItem(key);
    if (!sid) {
      sid = (crypto?.randomUUID?.() as string | undefined) || Math.random().toString(36).slice(2);
      sessionStorage.setItem(key, sid);
    }
    return sid;
  } catch { return null; }
}

function hostFromReferrer(): string | null {
  if (typeof document === 'undefined') return null;
  try {
    const ref = document.referrer;
    if (!ref) return null;
    const u = new URL(ref);
    if (u.hostname === window.location.hostname) return null;
    return u.hostname.toLowerCase();
  } catch { return null; }
}

function utmFromSearch(): { source: string | null; medium: string | null; campaign: string | null } {
  if (typeof window === 'undefined') return { source: null, medium: null, campaign: null };
  try {
    const q = new URL(window.location.href).searchParams;
    return { source: q.get('utm_source'), medium: q.get('utm_medium'), campaign: q.get('utm_campaign') };
  } catch { return { source: null, medium: null, campaign: null }; }
}

export async function trackEvent(name: AnalyticsEventName, metadata?: Record<string, SafePrimitive>): Promise<void> {
  if (typeof window === 'undefined') return;
  try {
    const utm = utmFromSearch();
    const body = {
      event_name: name,
      pathname: window.location.pathname,
      referrer_domain: hostFromReferrer(),
      utm_source: utm.source,
      utm_medium: utm.medium,
      utm_campaign: utm.campaign,
      session_id: getSessionId(),
      metadata: metadata || {},
    };
    await fetch('/api/analytics/events', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body), keepalive: true,
    });
  } catch { /* analytics is best-effort */ }
}
