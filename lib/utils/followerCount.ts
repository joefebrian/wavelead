// Canonical "how many followers do we actually know about" helper.
//
// WaveLead stores TWO independent follower numbers on a channel:
//   • follower_count          — the owner-submitted / verified evidence value
//                               (follower_count_source: 'submitter' | 'owner' | …)
//   • public_followers_count  — the number observed on the public WhatsApp
//                               Channel page by the metadata fetcher.
//
// The discovery cards have always DISPLAYED `follower_count || public_followers_count`,
// but every ranking query sorted on `follower_count` alone. Real submitted
// channels land with follower_count = 0 and the observed number in
// public_followers_count, so they ALL tied at 0 and came back in arbitrary
// natural order — which is why a channel showing "Follower count unavailable"
// could outrank one showing 1,300,000 followers on /top and /trending.
//
// This module is the single source of truth for the effective number, exposed
// both as an in-memory function (for rendering) and as a Mongo aggregation
// expression (for sorting), so the two can never drift apart again.
//
// NOTHING here invents a number. When both inputs are absent the effective
// count is 0 and the UI must render its honest "unavailable" state.

export interface FollowerCountInput {
  follower_count?: number | null;
  public_followers_count?: number | null;
}

/** Largest follower figure we can honestly stand behind. 0 ⇒ unknown. */
export function effectiveFollowerCount(c: FollowerCountInput): number {
  const submitted = typeof c.follower_count === 'number' && c.follower_count > 0 ? c.follower_count : 0;
  const observed =
    typeof c.public_followers_count === 'number' && c.public_followers_count > 0 ? c.public_followers_count : 0;
  return Math.max(submitted, observed);
}

/** True when we hold no usable follower observation at all. */
export function hasNoFollowerObservation(c: FollowerCountInput): boolean {
  return effectiveFollowerCount(c) === 0;
}

/** Temporary field name used only inside ranking aggregations. */
export const EFFECTIVE_FOLLOWERS_FIELD = '_effective_followers';

/**
 * `$addFields` stage mirroring `effectiveFollowerCount`. Missing/null values
 * collapse to 0 so unknown counts sort BELOW every known numeric count.
 */
export const EFFECTIVE_FOLLOWERS_ADD_FIELDS = {
  [EFFECTIVE_FOLLOWERS_FIELD]: {
    $max: [{ $ifNull: ['$follower_count', 0] }, { $ifNull: ['$public_followers_count', 0] }],
  },
} as const;

/**
 * Deterministic ranking order. `id` is a UUID and unique, so the sort is
 * total — identical inputs always produce an identical page, and pagination
 * can never repeat or skip a row.
 */
export const EFFECTIVE_FOLLOWERS_SORT: Record<string, 1 | -1> = {
  [EFFECTIVE_FOLLOWERS_FIELD]: -1,
  follower_count: -1,
  id: 1,
};

/** Same ordering, but manually featured channels first. */
export const FEATURED_THEN_FOLLOWERS_SORT: Record<string, 1 | -1> = {
  is_featured: -1,
  [EFFECTIVE_FOLLOWERS_FIELD]: -1,
  follower_count: -1,
  id: 1,
};
