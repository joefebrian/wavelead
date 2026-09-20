// M18 GA4 consent/privacy audit — GA4 URL privacy sanitizer.
//
// WHY: GA4 automatically attaches the browser URL (page_location) to every hit.
// Several WaveLead surfaces are PayPal return_urls, so the live URL can contain
// provider identifiers (PayPal appends ?token=<order id>&PayerID=<payer id>) and
// internal commercial identifiers (brand_pro, activation, order, attempt,
// founding_lifetime, funding). None of those may reach GA4.
//
// Policy: ALLOWLIST. Only non-sensitive, analytics-relevant query keys survive;
// everything else is dropped. Identifier-shaped PATH segments are normalized to
// `[id]` (analytics data only — real application routes are never changed).
export const GA4_SAFE_QUERY_KEYS = [
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'page', 'tab', 'sort', 'category', 'status',
] as const;

const MAX_VALUE_LEN = 60;

// M18 audit (URL PATH IDS) — private surfaces carry internal object identifiers
// in the path itself (e.g. /dashboard/channels/<uuid>/verify). Those are
// normalized to a generic route pattern BEFORE the path is handed to GA4.
// This affects ONLY what analytics receives — real application routes are
// untouched. Slug-based public surfaces (/channels/<slug>, /category/<slug>)
// do not match these shapes, so useful non-sensitive context is preserved.
const ID_SEGMENT_PATTERNS: RegExp[] = [
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, // uuid
  /^[0-9a-f]{16,}$/i,                                                // hex token / ObjectId
  /^\d{4,}$/,                                                        // long numeric id
  /^(?=.*\d)(?=.*[a-z])[a-z0-9_-]{20,}$/i,                           // long opaque token
];

/** Replaces identifier-shaped path segments with the literal `[id]`. */
export function normalizeGa4Pathname(pathname: string): string {
  const raw = (pathname || '/').split('?')[0].split('#')[0] || '/';
  if (raw === '/') return '/';
  const out = raw
    .split('/')
    .map((seg) => (seg && ID_SEGMENT_PATTERNS.some((re) => re.test(seg)) ? '[id]' : seg))
    .join('/');
  return out || '/';
}

/**
 * Returns the normalized `pathname` plus ONLY allowlisted query parameters.
 * Never throws; on any parsing problem it degrades to the bare path.
 */
export function safeGa4Path(pathname: string, query?: string | null): string {
  const base = normalizeGa4Pathname(pathname);
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
