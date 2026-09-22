/**
 * SEC-005 — Constant-time authentication for server-to-server cron endpoints.
 *
 * Rules enforced here (do not weaken):
 *  - CRON_SECRET is read from process.env only.
 *  - Missing env secret is fail-closed (`missing`).
 *  - Missing/empty provided secret is unauthorized.
 *  - Comparison uses crypto.timingSafeEqual on Buffers of the SAME length.
 *  - Mismatched length is unauthorized (never call timingSafeEqual with
 *    unequal-length Buffers — that throws in older Node runtimes).
 *  - The secret is NEVER logged, printed, echoed, or returned.
 *  - Query-string authentication is forbidden — callers must only accept
 *    the `x-cron-secret` request header.
 */
import crypto from 'crypto';

export type CronAuthResult = 'ok' | 'missing' | 'unauthorized';

/**
 * Verify an incoming cron caller secret against the configured CRON_SECRET.
 *
 * @param providedHeader raw value of the `x-cron-secret` request header
 *   (or `null`/`undefined` when absent).
 * @returns
 *   'missing'      -> CRON_SECRET env var is not set (respond 503).
 *   'unauthorized' -> header missing / wrong length / wrong value (respond 401).
 *   'ok'           -> header matches the configured secret.
 */
export function verifyCronSecret(providedHeader: string | null | undefined): CronAuthResult {
  const secret = process.env.CRON_SECRET;
  if (!secret) return 'missing';

  const provided = providedHeader ?? '';
  if (!provided) return 'unauthorized';

  // timingSafeEqual requires equal-length Buffers. A length mismatch is itself
  // a wrong-secret signal — reject before the crypto compare.
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(secret, 'utf8');
  if (a.length !== b.length) return 'unauthorized';

  try {
    return crypto.timingSafeEqual(a, b) ? 'ok' : 'unauthorized';
  } catch {
    return 'unauthorized';
  }
}
