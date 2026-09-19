// M17 — Pending commercial intent (client-side, same-origin only).
//
// Purpose: a logged-out user who clicks a paid CTA must be able to finish the
// purchase after auth even if the auth platform forces a landing on
// /dashboard instead of honouring ?next=. We persist ONLY a short-lived
// intent KEY — never a URL from an untrusted source, never payment data — and
// map it to a hard-coded, same-origin destination.
//
// A payment is NEVER created from a stored intent. The user must click again.

export type CommercialIntent = 'founding_lifetime' | 'brand_pro';

const KEY = 'wl_commercial_intent';
const TTL_MS = 24 * 60 * 60 * 1000;   // stale after 24h — we never nag forever

interface StoredIntent { intent: CommercialIntent; at: number }

/** Hard-coded same-origin destinations. No open-redirect surface. */
export const INTENT_DESTINATION: Record<CommercialIntent, string> = {
  founding_lifetime: '/pricing?intent=founding-lifetime#founding-lifetime',
  brand_pro: '/pricing?intent=brand-pro#brand-pro',
};

export const INTENT_LABEL: Record<CommercialIntent, { title: string; price: string; body: string; cta: string }> = {
  founding_lifetime: {
    title: 'Complete your Founding Lifetime purchase',
    price: '$100 one-time',
    body: 'No subscription. No recurring charge.',
    cta: 'Continue to Payment',
  },
  brand_pro: {
    title: 'Complete your Brand Pro Founding Beta purchase',
    price: '$15 / 30 days',
    body: 'Manual renewal during Founding Beta. No automatic recurring charge.',
    cta: 'Continue to Payment',
  },
};

export function rememberCommercialIntent(intent: CommercialIntent): void {
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(KEY, JSON.stringify({ intent, at: Date.now() } as StoredIntent)); } catch { /* storage disabled */ }
}

export function readCommercialIntent(): CommercialIntent | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredIntent;
    if (!parsed?.intent || !(parsed.intent in INTENT_DESTINATION)) { clearCommercialIntent(); return null; }
    if (!parsed.at || Date.now() - parsed.at > TTL_MS) { clearCommercialIntent(); return null; }   // stale
    return parsed.intent;
  } catch { return null; }
}

export function clearCommercialIntent(): void {
  if (typeof window === 'undefined') return;
  try { window.localStorage.removeItem(KEY); } catch { /* ignore */ }
}
