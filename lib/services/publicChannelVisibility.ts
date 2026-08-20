// Central public-visibility policy for channels.
//
// EXACTLY ONE definition of "what qualifies for public discovery" is used
// across every public surface:
//   • browse listing         → channelService.listPublic
//   • direct public lookup   → channelService.getPublicBySlug
//   • weighted search        → searchService.searchApproved
//   • homepage bundle        → discoveryService.*
//
// Composition:
//   1. `is_test_fixture: { $ne: true }` — durable, explicit marker set by
//      test helpers OR by a one-off op tag on a retained financial anchor
//      (e.g. smoke-ch-m06p3). This is the PRIMARY signal and works even
//      when the channel's slug/name looks organic.
//   2. Backward-compatible fixture-pattern exclusion (`slug ^test-` /
//      `name ^Test `) for pre-M06.1 rows we never explicitly marked. New
//      test helpers should prefer setting `is_test_fixture: true` so this
//      pattern branch can eventually be retired.
//
// Financial history (ledger_transactions, payment_funding_orders, etc.)
// is NEVER filtered by this predicate. This is a public-visibility
// projection, not a data-lifecycle mutator.
//
// The `is_test_fixture` field is INTERNAL. It must not be settable via
// public submission (Zod schema strips unknown keys) and must not be
// leaked in public API responses (sanitizeChannel drops it).
import type { Filter } from 'mongodb';
import type { Channel } from '@/lib/types';

/**
 * The visibility exclusion clauses. Compose with `$and` semantics against
 * any base filter (Mongo shallow-merges these keys since they don't collide
 * with typical predicates like `status`, `category_id`, `country_code`).
 */
export const PUBLIC_CHANNEL_VISIBILITY_EXCLUSION = {
  is_test_fixture: { $ne: true },
  slug: { $not: { $regex: '^test-', $options: 'i' } },
  name: { $not: { $regex: '^Test ', $options: 'i' } },
} as const;

/** Merge the canonical public-visibility clauses into a caller-supplied filter. */
export function buildPublicChannelFilter<T extends Record<string, unknown>>(base: T = {} as T): T & typeof PUBLIC_CHANNEL_VISIBILITY_EXCLUSION {
  // Defensive: if the caller already scoped slug/name, we DO NOT overwrite
  // their predicate — but we still add the durable marker. In practice
  // callers scope by status/category_id/country_code only, so this is a
  // safety belt rather than a real collision resolver.
  const merged: Record<string, unknown> = { ...base };
  if (!('is_test_fixture' in merged)) merged.is_test_fixture = PUBLIC_CHANNEL_VISIBILITY_EXCLUSION.is_test_fixture;
  if (!('slug' in merged)) merged.slug = PUBLIC_CHANNEL_VISIBILITY_EXCLUSION.slug;
  if (!('name' in merged)) merged.name = PUBLIC_CHANNEL_VISIBILITY_EXCLUSION.name;
  return merged as T & typeof PUBLIC_CHANNEL_VISIBILITY_EXCLUSION;
}

/**
 * Mongo Filter<Channel>-typed variant. Callers passing a typed Filter (e.g.
 * channelService.listPublic) can consume this without extra casts.
 */
export function buildPublicChannelMongoFilter(base: Filter<Channel> = {}): Filter<Channel> {
  return buildPublicChannelFilter(base as unknown as Record<string, unknown>) as unknown as Filter<Channel>;
}

/**
 * Cheap heuristic: is this slug obviously a fixture that would be excluded
 * from public visibility? Used by direct-lookup fast paths that want to
 * refuse before hitting the DB.
 */
export function isObviousPublicFixtureSlug(slug: string): boolean {
  return /^test-/i.test(slug);
}

/**
 * In-memory check for a single channel doc. Handy for direct-lookup paths
 * that have already fetched the row and just need the public-visibility
 * verdict without another query.
 */
export function isChannelPublicallyVisible(c: Pick<Channel, 'slug' | 'name'> & { is_test_fixture?: boolean }): boolean {
  if (c.is_test_fixture === true) return false;
  if (/^test-/i.test(c.slug)) return false;
  if (/^Test /.test(c.name)) return false;
  return true;
}
