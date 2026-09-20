// M18 GA4 consent/privacy audit — GA4 URL privacy sanitizer.
//
// WHY: GA4 automatically attaches the browser URL (page_location) to every hit.
// Several WaveLead surfaces are PayPal return_urls, so the live URL can contain
// provider identifiers (PayPal appends ?token=<order id>&PayerID=<payer id>) and
// internal commercial identifiers (brand_pro, activation, order, attempt,
// founding_lifetime, funding). None of those may reach GA4.
//
// Policy: ALLOWLIST. Only non-sensitive, analytics-relevant query keys survive;
// everything else is dropped. The path itself is preserved unchanged.
export const GA4_SAFE_QUERY_KEYS = [
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'page', 'tab', 'sort', 'category', 'status',
] as const;

const MAX_VALUE_LEN = 60;

/**
 * Returns `pathname` plus ONLY allowlisted query parameters.
 * Never throws; on any parsing problem it degrades to the bare path.
 */
export function safeGa4Path(pathname: string, query?: string | null): string {
  const base = (pathname || '/').split('?')[0].split('#')[0] || '/';
  if (!query) return base;
  const kept: string[] = [];
  try {
    const sp = new URLSearchParams(query.startsWith('?') ? query.slice(1) : query);
    for (const key of GA4_SAFE_QUERY_KEYS) {
      const value = sp.get(key);
      if (!value) continue;
      if (value.length > MAX_VALUE_LEN) continue;       // no long opaque blobs
      if (value.includes('@')) continue;                // never an email-shaped value
      kept.push(`${key}=${encodeURIComponent(value)}`);
    }
  } catch { return base; }
  return kept.length ? `${base}?${kept.join('&')}` : base;
}
