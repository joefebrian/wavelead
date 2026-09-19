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

// M17.1 — one-shot guard for the auth → checkout handoff.
//
// A click on a paid CTA is explicit purchase intent, so after authentication we
// may resume the checkout automatically. But a page refresh, a browser "back",
// or a replayed URL must NOT start a second PayPal order. This returns true at
// most ONCE per browser session per product. (The server independently reuses
// any open order, so this is belt-and-braces, not the only protection.)
const RESUME_KEY_PREFIX = 'wl_intent_resumed_';

export function consumeIntentResumeOnce(intent: CommercialIntent): boolean {
  if (typeof window === 'undefined') return false;
  const key = `${RESUME_KEY_PREFIX}${intent}`;
  try {
    if (window.sessionStorage.getItem(key)) return false;
    window.sessionStorage.setItem(key, String(Date.now()));
    return true;
  } catch {
    return false;   // storage disabled → never auto-resume, user clicks again
  }
}

/** Test/utility helper — forget the one-shot resume marker. */
export function resetIntentResume(intent: CommercialIntent): void {
  if (typeof window === 'undefined') return;
  try { window.sessionStorage.removeItem(`${RESUME_KEY_PREFIX}${intent}`); } catch { /* ignore */ }
}
