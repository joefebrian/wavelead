// Canonical-origin resolver with strict allowlist.
//
// PURPOSE:
//   * PayPal return_url / cancel_url must land on the trusted WaveLead origin.
//   * PayPal webhook URL displayed in the admin UI must be deterministic (never
//     driven by request headers).
//   * All request-derived origin data (Host, X-Forwarded-Host, Origin) is
//     UNTRUSTED and only accepted if the normalized hostname is explicitly on
//     the allowlist.
//
// ALLOWLIST DERIVATION (never introduces net-new env vars beyond one optional):
//   1. Hostname of NEXT_PUBLIC_BASE_URL (the authoritative canonical origin)
//   2. Hostnames listed in optional comma-separated CANONICAL_HOSTS_ALLOWLIST
//      (used only if you want to trust both wavelead.org and www.wavelead.org)
//
// FAIL-CLOSED BEHAVIOUR:
//   * If a request's host/proto is not on the allowlist → we ignore it and
//     return the configured canonical origin.
//   * If NEXT_PUBLIC_BASE_URL is unset (e.g. local dev) → fall back to
//     http://localhost:3000 so preview / test runs still work.

const DEV_FALLBACK = 'http://localhost:3000';

function normalizeHost(h: string): string {
  return h.split(',')[0].trim().toLowerCase().replace(/:\d+$/, (m) => m); // keep port if present
}

function getAllowedHosts(): Set<string> {
  const hosts = new Set<string>();
  const base = process.env.NEXT_PUBLIC_BASE_URL;
  if (base) {
    try {
      const u = new URL(base);
      // Store hostname with optional port so :3000 works locally.
      hosts.add((u.host || u.hostname).toLowerCase());
      hosts.add(u.hostname.toLowerCase());
    } catch { /* malformed value → ignored */ }
  }
  const extras = process.env.CANONICAL_HOSTS_ALLOWLIST || '';
  for (const h of extras.split(',')) {
    const trimmed = h.trim().toLowerCase();
    if (trimmed) hosts.add(trimmed);
  }
  // Localhost always trusted for dev/test (never used in production because
  // NEXT_PUBLIC_BASE_URL is set to https://wavelead.org there and no request
  // will carry Host: localhost:3000 through Emergent's ingress).
  hosts.add('localhost:3000');
  hosts.add('localhost');
  return hosts;
}

/**
 * The deterministic canonical origin from NEXT_PUBLIC_BASE_URL.
 * NEVER derived from a request. Use this for URLs displayed to admins,
 * static pages, sitemaps, robots.txt, or any context where the URL must
 * not vary per-request.
 */
export function getConfiguredOrigin(): string {
  return (process.env.NEXT_PUBLIC_BASE_URL || DEV_FALLBACK).replace(/\/+$/, '');
}

interface HeadersLike {
  get(name: string): string | null;
}

/**
 * Resolve the origin from an incoming request, ONLY if the effective host is
 * in the allowlist. Falls back to the configured canonical origin otherwise.
 *
 * Use this for URLs that will be handed to a third party AND then bring the
 * user back into our app (e.g. PayPal return_url / cancel_url), so that the
 * user is returned to the same origin they came from — as long as that origin
 * is on the allowlist.
 */
export function resolveTrustedOrigin(headers: HeadersLike | null | undefined): string {
  if (!headers) return getConfiguredOrigin();
  const rawHost = normalizeHost(headers.get('x-forwarded-host') || headers.get('host') || '');
  const rawProto = (headers.get('x-forwarded-proto') || 'https').split(',')[0].trim().toLowerCase();
  if (!rawHost) return getConfiguredOrigin();
  if (rawProto !== 'https' && rawProto !== 'http') return getConfiguredOrigin();
  const allowed = getAllowedHosts();
  const hostnameOnly = rawHost.split(':')[0];
  if (allowed.has(rawHost) || allowed.has(hostnameOnly)) {
    return `${rawProto}://${rawHost}`;
  }
  return getConfiguredOrigin();
}

/** Convenience for the webhook URL displayed in admin panels (deterministic). */
export function getCanonicalWebhookUrl(path: string): string {
  return `${getConfiguredOrigin()}${path.startsWith('/') ? path : `/${path}`}`;
}
