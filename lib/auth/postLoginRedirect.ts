// Role-aware post-login redirect resolver.
//
// The server is the SINGLE source of truth for where a freshly-authenticated
// user should land. The client MUST NOT independently prefer or re-validate
// `next` — it should only `router.push(response.redirect_to)`.
//
// Precedence:
//   1. If the user has must_change_password === true → /dashboard/settings/security
//      (the forced-password-change gate). This wins over both `next` and role
//      default so a compromised temp-password user cannot bypass the reset.
//   2. If a safe internal `next` is supplied → use it.
//   3. Otherwise → default landing for the DB-resolved role.
//
// NEVER trust the JWT `role` claim (there isn't one) — always pass the role
// from the freshly-loaded MongoDB user record.
import type { PublicUser, Role } from '@/lib/types';

/** Path a freshly-authenticated user lands on, per DB-resolved role. */
export function defaultLandingForRole(role: Role): string {
  switch (role) {
    case 'super_admin':   return '/admin';
    case 'admin':         return '/admin';
    case 'moderator':     return '/admin/moderation';
    case 'channel_owner': return '/dashboard';
    case 'business':      return '/dashboard';
    case 'user':          return '/dashboard';
    case 'visitor':       return '/dashboard';   // legally unreachable post-login
    default:              return '/dashboard';
  }
}

/**
 * A `next` value is safe iff it's an unambiguous same-origin path:
 *   - starts with a single '/'
 *   - does not start with '//' or '/\' (protocol-relative)
 *   - does not contain CR / LF / NUL / raw backslash (header/URL smuggling)
 *   - is not an absolute or protocol-relative URL
 *   - is not an API route (/api/*)
 */
export function isSafeInternalNext(next: unknown): next is string {
  if (typeof next !== 'string') return false;
  if (next.length === 0 || next.length > 512) return false;
  if (!next.startsWith('/')) return false;
  if (next.startsWith('//')) return false;
  if (next.startsWith('/\\')) return false;
  if (next.startsWith('/api/') || next === '/api') return false;
  // Reject any control characters (CR, LF, NUL) — prevents header injection.
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(next)) return false;
  // Reject backslash entirely — Windows-style paths and header-splitting.
  if (next.includes('\\')) return false;
  // Reject anything that parses as an absolute URL when combined with a base.
  //   e.g.  '/https://evil.com' does NOT parse as absolute (safe)
  //         '///evil.com'       starts with '//' (already rejected)
  try {
    const u = new URL(next, 'https://internal.invalid');
    // Force same-origin.
    if (u.origin !== 'https://internal.invalid') return false;
  } catch {
    return false;
  }
  return true;
}

/** Resolve the final redirect_to for a freshly-authenticated user. */
export function resolvePostLoginRedirect(params: {
  user: PublicUser;
  next?: unknown;
}): string {
  const { user, next } = params;
  // (1) forced password change wins over everything.
  const mustChange = (user as PublicUser & { must_change_password?: boolean }).must_change_password === true;
  if (mustChange) return '/dashboard/settings/security';
  // (2) safe next.
  if (isSafeInternalNext(next)) return next;
  // (3) role default.
  return defaultLandingForRole(user.role);
}
