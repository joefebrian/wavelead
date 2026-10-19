// Central public-visibility policy for channels.
//
// EXACTLY ONE definition of "what qualifies for public discovery" is used
// across every public surface:
//   • browse listing         → channelService.listPublic
//   • direct public lookup    → channelService.getPublicBySlug
//   • weighted search         → searchService.searchApproved
//   • homepage / discovery    → discoveryService.*
//   • editorial curation      → curationService.getSectionCurated
//   • sponsored delivery      → promotion/deliveryService
//   • sitemap                 → app/sitemap.ts
//
// ---------------------------------------------------------------------------
// FINALIST READINESS (production inventory cleanup)
// ---------------------------------------------------------------------------
// The policy is a *visibility projection only*. It NEVER mutates, deletes or
// re-moderates a record. Every exclusion below is reversible by editing this
// file alone — no migration, no new DB column, no status/verification change.
//
// Exclusion evidence, in order of strength:
//
//   1. `is_test_fixture: true`  — durable, explicit internal marker set by
//      test helpers or by a one-off op tag on a retained financial anchor.
//      PRIMARY signal; works even when slug/name look organic.
//
//   2. `is_demo: true`          — durable marker written by lib/seed/seedData
//      for the demonstration catalogue. Demo rows are approved on purpose so
//      that pre-launch previews had content; they must never appear in a
//      production marketplace.
//
//   3. Generated QA/load-test slug families — machine-generated records from
//      the milestone backend suites. These are matched with a *strict* shape
//      (`<family>-<8 hex>`) so an organic slug such as `b2b-marketing` or
//      `gb-channel-news` can never be caught by accident.
//
//   4. Operational/QA slug prefixes (`smoke-`, `hardening-`, `qa-`,
//      `inject-test-`, `reject-test-`, `pending-test-`, …).
//
//   5. Legacy fixture patterns (`slug ^test-`, `name ^"Test "`) retained for
//      pre-M06.1 rows that were never explicitly marked.
//
//   6. Seed-only WhatsApp references (`whatsapp.com/channel/demo-…`) — these
//      are not resolvable public WhatsApp Channel invites.
//
//   7. Non-public `follower_count_source` values (`demo_seed`, `smoke`,
//      `qa_seed`). NOTE: plain `seed` and `test` are deliberately NOT in this
//      list — legitimate rows can legitimately carry them, and every actual
//      fixture using them is already caught by (1)/(3)/(4)/(5).
//
// What this policy explicitly does NOT do:
//   • It does not approve, reject, verify or un-verify anything. Moderation
//     state (`status`) and ownership state (`verification_status`) are read,
//     never written.
//   • It does not grant sponsorship, promotion or owner-only capability.
//     Public discoverability and commercial eligibility stay independent.
//   • It does not touch financial history (ledger_transactions,
//     payment_funding_orders, …), follower observations or ownership records.
//
// `is_test_fixture` / `is_demo` are INTERNAL. They must not be settable via
// public submission (the Zod schema strips unknown keys) and must not be
// leaked in public API responses (sanitizeChannel drops is_test_fixture).
import type { Filter } from 'mongodb';
import type { Channel } from '@/lib/types';

// ---------------------------------------------------------------------------
// Pattern definitions (single source of truth, shared by Mongo + in-memory)
// ---------------------------------------------------------------------------

/**
 * Machine-generated QA / load-test channel families.
 * Shape is intentionally strict: `<family>-<exactly 8 lowercase hex>`.
 * Real-world slugs like `b2b-marketing-tips` or `gb-chess-club` do NOT match.
 */
export const QA_GENERATED_SLUG_RE = /^(?:b2-ch|b2a|b2b|b2brs|b21-smoke|gb-ch|gc-ch|ut-ch)-[0-9a-f]{8}$/i;

/**
 * Operational / QA slug prefixes used by smoke scripts and milestone suites.
 * Anchored with a trailing separator so `qa-` cannot match `qatar-news`.
 */
export const OPS_FIXTURE_SLUG_RE =
  /^(?:smoke|hardening|qa|inject-test|reject-test|pending-test|pending-curation|m0\d-test|m0\d-final)[-_]/i;

/** Legacy (pre-M06.1) fixture slug pattern. */
export const LEGACY_FIXTURE_SLUG_RE = /^test-/i;

/** Legacy (pre-M06.1) fixture name pattern. */
export const LEGACY_FIXTURE_NAME_RE = /^Test /;

/** Seed-only WhatsApp references that are not resolvable public invites. */
export const SEED_WHATSAPP_URL_RE = /whatsapp\.com\/channel\/demo-/i;

/** `follower_count_source` values that are never a real public observation. */
export const NON_PUBLIC_FOLLOWER_SOURCES = ['demo_seed', 'smoke', 'qa_seed'] as const;

// ---------------------------------------------------------------------------
// Mongo clauses
// ---------------------------------------------------------------------------

/**
 * The canonical exclusion clauses, expressed as an `$and` array so that
 * several predicates may target the SAME field (`slug` is constrained three
 * times) without object-key collisions, and so a caller-supplied `slug` /
 * `name` predicate can never silently replace a visibility rule.
 */
export const PUBLIC_CHANNEL_EXCLUSION_CLAUSES: Record<string, unknown>[] = [
  { is_test_fixture: { $ne: true } },
  { is_demo: { $ne: true } },
  { slug: { $not: QA_GENERATED_SLUG_RE } },
  { slug: { $not: OPS_FIXTURE_SLUG_RE } },
  { slug: { $not: LEGACY_FIXTURE_SLUG_RE } },
  { name: { $not: LEGACY_FIXTURE_NAME_RE } },
  { whatsapp_url: { $not: SEED_WHATSAPP_URL_RE } },
  { follower_count_source: { $nin: [...NON_PUBLIC_FOLLOWER_SOURCES] } },
];

/**
 * @deprecated Kept for backward compatibility with pre-finalist callers that
 * shallow-merged these three keys. New code should use
 * `buildPublicChannelFilter` / `buildPublicChannelMongoFilter`, which apply
 * the full clause set.
 */
export const PUBLIC_CHANNEL_VISIBILITY_EXCLUSION = {
  is_test_fixture: { $ne: true },
  slug: { $not: { $regex: '^test-', $options: 'i' } },
  name: { $not: { $regex: '^Test ', $options: 'i' } },
} as const;

/**
 * Merge the canonical public-visibility clauses into a caller-supplied filter.
 *
 * Any `$and` already present on the base filter is preserved and extended, so
 * this is safe to call on composed filters (e.g. search's `$or` branch).
 */
export function buildPublicChannelFilter(base: Record<string, unknown> = {}): Record<string, unknown> {
  const { $and: baseAnd, ...rest } = base;
  const inherited = Array.isArray(baseAnd)
    ? (baseAnd as Record<string, unknown>[])
    : baseAnd
      ? [baseAnd as Record<string, unknown>]
      : [];
  return { ...rest, $and: [...inherited, ...PUBLIC_CHANNEL_EXCLUSION_CLAUSES] };
}

/**
 * Mongo `Filter<Channel>`-typed variant. Callers passing a typed filter (e.g.
 * channelService.listPublic) can consume this without extra casts, and may
 * still assign additional scalar predicates (`category_id`, `country_code`)
 * onto the returned object afterwards.
 */
export function buildPublicChannelMongoFilter(base: Filter<Channel> = {}): Filter<Channel> {
  return buildPublicChannelFilter(base as unknown as Record<string, unknown>) as unknown as Filter<Channel>;
}

// ---------------------------------------------------------------------------
// In-memory equivalents
// ---------------------------------------------------------------------------

/**
 * Cheap heuristic: is this slug obviously a fixture that would be excluded
 * from public visibility? Used by direct-lookup fast paths that want to
 * refuse before hitting the DB.
 */
export function isObviousPublicFixtureSlug(slug: string): boolean {
  const s = String(slug || '');
  return LEGACY_FIXTURE_SLUG_RE.test(s) || QA_GENERATED_SLUG_RE.test(s) || OPS_FIXTURE_SLUG_RE.test(s);
}

type VisibilityInput = Pick<Channel, 'slug' | 'name'> & {
  is_test_fixture?: boolean;
  is_demo?: boolean;
  whatsapp_url?: string | null;
  follower_count_source?: string | null;
};

/**
 * In-memory check for a single channel doc — the exact mirror of
 * PUBLIC_CHANNEL_EXCLUSION_CLAUSES. Handy for direct-lookup paths that have
 * already fetched the row, and for sponsored-delivery candidate screening.
 */
export function isChannelPublicallyVisible(c: VisibilityInput): boolean {
  if (c.is_test_fixture === true) return false;
  if (c.is_demo === true) return false;
  if (isObviousPublicFixtureSlug(c.slug)) return false;
  if (LEGACY_FIXTURE_NAME_RE.test(c.name || '')) return false;
  if (c.whatsapp_url && SEED_WHATSAPP_URL_RE.test(c.whatsapp_url)) return false;
  if (c.follower_count_source &&
      (NON_PUBLIC_FOLLOWER_SOURCES as readonly string[]).includes(c.follower_count_source)) return false;
  return true;
}

/**
 * Audit helper (read-only). Returns the reason a channel is suppressed from
 * public discovery, or null when it passes. Used by targeted tests and by the
 * operator-facing inventory audit script; never used to mutate a record.
 */
export function publicVisibilitySuppressionReason(c: VisibilityInput): string | null {
  if (c.is_test_fixture === true) return 'is_test_fixture';
  if (c.is_demo === true) return 'is_demo';
  if (QA_GENERATED_SLUG_RE.test(c.slug || '')) return 'qa_generated_slug';
  if (OPS_FIXTURE_SLUG_RE.test(c.slug || '')) return 'ops_fixture_slug';
  if (LEGACY_FIXTURE_SLUG_RE.test(c.slug || '')) return 'legacy_fixture_slug';
  if (LEGACY_FIXTURE_NAME_RE.test(c.name || '')) return 'legacy_fixture_name';
  if (c.whatsapp_url && SEED_WHATSAPP_URL_RE.test(c.whatsapp_url)) return 'seed_whatsapp_url';
  if (c.follower_count_source &&
      (NON_PUBLIC_FOLLOWER_SOURCES as readonly string[]).includes(c.follower_count_source)) {
    return 'non_public_follower_source';
  }
  return null;
}
