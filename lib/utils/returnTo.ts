// M15 — safe same-origin returnTo validator.
//
// Prevents open-redirect abuse. Accepts:
//   • absolute-path URLs starting with a single "/" and not "//"
//   • same-origin fully-qualified URLs (host === NEXT_PUBLIC_BASE_URL host)
// Rejects:
//   • external hostnames
//   • schema/JavaScript-flavored URLs
//   • protocol-relative "//" paths
//   • empty/undefined
//
// Returns a safe path string suitable for `router.push()`; falls back to
// `/dashboard` when the input is missing or unsafe.

const DEFAULT_FALLBACK = '/dashboard';

export function sanitizeReturnTo(input: string | null | undefined, fallback: string = DEFAULT_FALLBACK): string {
  if (!input || typeof input !== 'string') return fallback;
  const raw = input.trim();
  if (!raw) return fallback;
  // Reject protocol-relative // and any absolute URL where the origin is
  // different from ours. Accept absolute paths starting with a single "/".
  if (raw.startsWith('//')) return fallback;
  if (raw.startsWith('/')) {
    // Also reject the pattern "/\\" and control chars.
    if (/[\s\r\n\t]/.test(raw)) return fallback;
    return raw;
  }
  // Fully-qualified URL — must match our own origin.
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return fallback;
    const base = process.env.NEXT_PUBLIC_BASE_URL || '';
    if (!base) return fallback;
    const baseUrl = new URL(base);
    if (url.host !== baseUrl.host) return fallback;
    return url.pathname + url.search + url.hash;
  } catch {
    return fallback;
  }
}
