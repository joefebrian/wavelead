// Emergent Managed Google Auth vendor adapter.
//
// EVERY vendor-specific string / assumption lives here. If Emergent's contract
// differs from what we currently observe, patch ONLY this file. Downstream
// business logic (googleLinkService) never touches vendor internals.
//
// Confirmed by Emergent Support (2026-08-24):
//   * NO Google Client ID / Secret required — Emergent runs the OAuth client
//   * Exchange path is EXACTLY /auth/v1/env/oauth/session-data
//   * Session ID is one-time; endpoint returns 404 after redeem/expire/evict
//   * Custom domains work with no per-domain allowlist inside Emergent
//
// Not yet independently verified (isolated below so we can lock after 1st click):
//   * Exchange host, method, header, body
//   * Callback delivery mechanism (fragment vs query)
//   * Response schema (Zod .passthrough() until confirmed)
//
// Fail-closed: any deviation raises and we do NOT mint wl_session.
import { z } from 'zod';

// Canonical PUBLIC managed-auth start host. Browser-facing; must always be a
// publicly-reachable https host.
const PUBLIC_START_URL = 'https://auth.emergentagent.com/';

// Resolve the BROWSER-facing start base. EMERGENT_AUTH_START_URL may override it,
// but we HARD-REFUSE any value that is not a public https host — the browser must
// never be sent to an internal/service-discovery host (e.g. the 2026-09-03
// incident where EMERGENT_AUTH_HOST=http://as.int.apis.emergentagent.com leaked
// to the browser → ERR_ADDRESS_UNREACHABLE), http://, localhost, or a private host.
function resolveBrowserStartBase(): string {
  const override = (process.env.EMERGENT_AUTH_START_URL || '').trim();
  if (!override) return PUBLIC_START_URL;
  try {
    const u = new URL(override);
    const host = u.hostname.toLowerCase();
    const unsafe =
      u.protocol !== 'https:' ||
      host === 'localhost' ||
      host.startsWith('127.') ||
      host.endsWith('.local') ||
      host.endsWith('.internal') ||
      host.includes('.int.') ||               // *.int.apis.emergentagent.com and similar
      host.endsWith('.svc.cluster.local');
    return unsafe ? PUBLIC_START_URL : override;
  } catch {
    return PUBLIC_START_URL;
  }
}

// -------- Contract knobs (env-driven so we never redeploy for a URL change) --------
function cfg() {
  // EXCHANGE host: the backend API host the SERVER calls to redeem a session id
  // for the Google identity (GET .../session-data with X-Session-ID). This is a
  // SERVER-SIDE call only and MAY legitimately be an internal host — it is never
  // exposed to the browser.
  const exchangeHost = (process.env.EMERGENT_AUTH_HOST || 'https://demobackend.emergentagent.com').replace(/\/+$/, '');
  // START host: the MANAGED-AUTH entry point the BROWSER is redirected to. Always
  // public https (guarded). auth.emergentagent.com 302s to Google consent, then
  // back to <callback>#session_id=... for one-time redemption.
  //
  // INCIDENT FIX (2026-09-03): the old code composed the browser start URL as
  // EMERGENT_AUTH_HOST + '/auth/v1/env/oauth'. In production EMERGENT_AUTH_HOST is
  // the INTERNAL host http://as.int.apis.emergentagent.com, so the browser was
  // navigated to an unreachable internal http host BEFORE Google. The browser
  // start URL is now decoupled from EMERGENT_AUTH_HOST and forced to a public
  // https host (see resolveBrowserStartBase).
  const startUrl = resolveBrowserStartBase().replace(/\/+$/, '');
  return {
    startUrl,
    exchangeHost,
    exchangePath: process.env.EMERGENT_AUTH_SESSION_PATH || '/auth/v1/env/oauth/session-data',
    // Managed auth expects GET with X-Session-ID; keep POST as a tolerant fallback.
    exchangeMethods: (process.env.EMERGENT_AUTH_SESSION_METHOD || 'GET,POST').split(',').map((m) => m.trim().toUpperCase()),
    enabled: (process.env.AUTH_GOOGLE_ENABLED || '').toLowerCase() === 'true',
  };
}

export function isGoogleAuthEnabled(): boolean {
  return cfg().enabled;
}

export function buildStartUrl(callbackUrl: string): string {
  const { startUrl } = cfg();
  // startUrl has trailing slashes stripped; normalize back to a single "/" base
  // so the result is exactly https://auth.emergentagent.com/?redirect=<encoded>.
  const u = new URL(`${startUrl}/`);
  u.searchParams.set('redirect', callbackUrl);
  return u.toString();
}

// Session-id shape guard — accept opaque URL-safe token up to a sane cap.
export const sessionIdSchema = z.string().min(1).max(1024).regex(/^[A-Za-z0-9._~+=/-]+$/);

// Response schema — tolerant on purpose. `.passthrough()` retains unknown fields.
// After the first successful click in preview we will tighten this to `.strict()`.
const identityResponseSchema = z.object({
  email: z.string().email(),
  // Any of these may or may not be present:
  name: z.string().nullish(),
  picture: z.string().url().nullish(),
  // If present, DISCARD it — we mint our own wl_session.
  session_token: z.string().nullish(),
  // Google's stable identifier — persisted as google_sub when available.
  sub: z.string().nullish(),
  id: z.string().nullish(),
  // Some Emergent envs return the identity nested under `user`.
}).passthrough();

export interface EmergentIdentity {
  email: string;                     // normalized (trim + lowercase)
  google_sub: string | null;
  name: string | null;
  picture: string | null;
}

/**
 * Redeem a one-time Emergent session id for a verified Google identity.
 * Fails closed on any deviation from the expected shape.
 * NEVER logs the session id, NEVER returns Emergent's raw response upstream.
 */
export async function exchangeSessionId(sessionId: string): Promise<EmergentIdentity> {
  const parsedId = sessionIdSchema.safeParse(sessionId);
  if (!parsedId.success) throw new EmergentAuthError('invalid_session_id_shape', 400);

  const c = cfg();
  const url = `${c.exchangeHost}${c.exchangePath}`;
  let lastStatus = 0;
  let lastBody: unknown = null;

  for (const method of c.exchangeMethods) {
    const res = await fetch(url, {
      method,
      headers: {
        'X-Session-ID': parsedId.data,
        Accept: 'application/json',
      },
      // POST with empty body is safe; GET ignores.
      body: method === 'GET' ? undefined : '',
      cache: 'no-store',
    });
    lastStatus = res.status;
    if (res.status === 404) {
      // Definitive Emergent semantics — the session id was already redeemed / expired / evicted.
      throw new EmergentAuthError('session_expired_or_redeemed', 401);
    }
    if (res.status === 405) {
      // Method not allowed — try the next configured method.
      continue;
    }
    if (!res.ok) {
      try { lastBody = await res.text(); } catch { /* swallow */ }
      throw new EmergentAuthError(`upstream_${res.status}`, 502);
    }
    const json: unknown = await res.json().catch(() => null);
    if (!json || typeof json !== 'object') throw new EmergentAuthError('malformed_upstream_json', 502);
    // Some Emergent envs nest under `user` — accept either.
    const candidate = (json as { user?: unknown }).user ?? json;
    const parsed = identityResponseSchema.safeParse(candidate);
    if (!parsed.success) throw new EmergentAuthError('unsupported_identity_shape', 502);

    return {
      email: parsed.data.email.trim().toLowerCase(),
      google_sub: parsed.data.sub || parsed.data.id || null,
      name: parsed.data.name ?? null,
      picture: parsed.data.picture ?? null,
    };
  }

  // All methods exhausted without a definitive answer.
  void lastBody;
  throw new EmergentAuthError(`upstream_no_accepted_method_${lastStatus}`, 502);
}

export class EmergentAuthError extends Error {
  constructor(public code: string, public httpStatus: number) {
    super(code);
  }
}
