// Phase A — Sponsored ranking / relevance / quality / pacing.
//
// Two-stage design (as approved):
//
//   Stage 1 — ELIGIBILITY (this file exports isEligibleByRelevance +
//     isEligibleByPacing). A campaign that fails any eligibility check is
//     removed BEFORE ranking. No budget amount may override eligibility.
//
//   Stage 2 — RANK: eligible campaigns are scored with
//     sponsored_rank = relevance × quality × pacing_score
//     Budget is NEVER a direct ranking input. Under-delivered campaigns get a
//     higher pacing_score than over-delivered campaigns (relative to their own
//     schedule), but the absolute budget size does not increase rank.
//
// All scores are in the interval [0, 1]. Cold-start channels receive neutral
// baselines rather than zero so a brand-new verified channel is not punished
// for lack of history.
import type { Channel, PromotionCampaign, SponsoredPlacement } from '@/lib/types';

// Relevance below this threshold → INELIGIBLE. No budget can override.
export const MIN_RELEVANCE_THRESHOLD = 0.35;
// Spend-velocity tolerance. Estimated spend up to (target × 1.15) is fine.
export const PACING_TOLERANCE = 0.15;
// If a campaign is in the final 10% of its schedule AND under-delivered
// (< 90% of budget consumed), it is exempted from pacing throttling so late
// catch-up delivery can happen.
export const CATCHUP_ELAPSED_THRESHOLD = 0.9;
export const CATCHUP_DELIVERED_THRESHOLD = 0.9;

export interface RankContext {
  placement: SponsoredPlacement;
  country_code: string | null;
  language: string | null;
  category_slug: string | null;
  search_query: string | null;
  exclude_channel_id: string | null;
  now: Date;
}

export interface RankBreakdown {
  relevance: number;
  quality: number;
  pacing_score: number;
  sponsored_rank: number;
  paced_out: boolean;
  catchup_exempt: boolean;
  // Purely for debugging/observability — NEVER referenced in ranking math.
  target_spend_usd_minor: number;
  elapsed_fraction: number;
}

// ---------------------------------------------------------------------------
// Query relevance (tokenized token-set overlap). Deliberately small and
// deterministic — no ML, no external data.
// ---------------------------------------------------------------------------
const STOPWORDS = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'for', 'on', 'with', 'is', 'are', 'be', 'this', 'that', 'my', 'your', 'our']);
function tokenize(s: string | null | undefined): string[] {
  if (!s) return [];
  return s.toLowerCase().replace(/[^a-z0-9\s]+/g, ' ').split(/\s+/).filter((t) => t && !STOPWORDS.has(t) && t.length >= 2);
}
function tokenSetOverlap(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const sb = new Set(b);
  let hit = 0;
  for (const t of a) if (sb.has(t)) hit++;
  return hit / a.length; // recall relative to query terms
}

// ---------------------------------------------------------------------------
// Relevance
// ---------------------------------------------------------------------------
export function computeRelevance(camp: PromotionCampaign, ch: Channel, ctx: RankContext): number {
  const target = camp.targeting;
  const chCountry = (ch.country_code || '').toUpperCase();
  const chLang = (ch.primary_language || '').toLowerCase();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chCategory = ((ch as any).primary_category_slug || (ch as any).category_slug || '').toLowerCase();

  const countryFit = ctx.country_code ? (chCountry === ctx.country_code.toUpperCase() ? 1 : (target.countries.includes(ctx.country_code.toUpperCase()) ? 0.6 : 0)) : 0.5;
  const languageFit = ctx.language ? (chLang === ctx.language.toLowerCase() ? 1 : (target.languages.includes(ctx.language.toLowerCase()) ? 0.6 : 0)) : 0.5;
  const categoryFit = ctx.category_slug ? (chCategory === ctx.category_slug.toLowerCase() ? 1 : (target.categories.includes(ctx.category_slug.toLowerCase()) ? 0.6 : 0)) : 0.5;

  switch (ctx.placement) {
    case 'sponsored_search': {
      // Query dominates for search. Metadata acts only as tie-breaker.
      const q = tokenize(ctx.search_query);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const chTokens = tokenize([ch.name, ch.short_description, chCategory, ((ch as any).description || '')].filter(Boolean).join(' '));
      // No query supplied (e.g. admin peek, or ranker invoked outside the
      // search box context): fall back to metadata-only relevance so we do
      // not artificially fail every candidate at the threshold. When a real
      // query IS supplied, low overlap correctly drops relevance below the
      // threshold and the candidate is rejected.
      if (q.length === 0) {
        return clamp01(0.5 * countryFit + 0.3 * languageFit + 0.2 * categoryFit + 0.2);
      }
      const queryFit = tokenSetOverlap(q, chTokens);
      // A query with zero token overlap is very low relevance regardless of
      // metadata targeting → below threshold → INELIGIBLE. This is the exact
      // guarantee "broad channel matching three metadata fields does NOT
      // outrank a channel highly relevant to the user's query".
      return clamp01(0.7 * queryFit + 0.15 * languageFit + 0.15 * countryFit);
    }
    case 'sponsored_category':
      return clamp01(0.7 * categoryFit + 0.15 * countryFit + 0.15 * languageFit);
    case 'sponsored_country':
      return clamp01(0.7 * countryFit + 0.15 * categoryFit + 0.15 * languageFit);
    case 'sponsored_related_channel':
      // Related to source channel: category is the primary signal. Exclude self.
      if (ctx.exclude_channel_id && ch.id === ctx.exclude_channel_id) return 0;
      return clamp01(0.6 * categoryFit + 0.4 * languageFit);
    case 'sponsored_homepage':
    default:
      // Broad placement — reward context fit if we know context, else neutral.
      if (ctx.country_code || ctx.language) return clamp01(0.5 * countryFit + 0.5 * languageFit);
      return 0.7;
  }
}

export function isEligibleByRelevance(relevance: number): boolean {
  return relevance >= MIN_RELEVANCE_THRESHOLD;
}

// ---------------------------------------------------------------------------
// Quality
// ---------------------------------------------------------------------------
export function computeQuality(camp: PromotionCampaign, ch: Channel): number {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const vs = (ch as any).verification_status;
  // Verified is a filter earlier — but keep an explicit graded value here so
  // quality can differentiate verified vs official.
  const verificationScore = vs === 'official' ? 1.0 : vs === 'verified' ? 0.8 : 0.5;

  // Profile completeness signals (each 0/1, weighted). Neutral if metadata
  // fields are minimal on the channel schema.
  const hasLogo = ch.logo_url ? 1 : 0;
  const hasDescription = ch.short_description && ch.short_description.length >= 20 ? 1 : 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const hasCategory = ((ch as any).primary_category_slug || (ch as any).category_slug) ? 1 : 0;
  const completeness = (hasLogo + hasDescription + hasCategory) / 3;

  // Historical CTR — only meaningful with sufficient sample. Cold-start
  // campaigns receive a NEUTRAL baseline (0.5) rather than 0.
  const impressions = camp.delivered_impressions || 0;
  // We do not have per-campaign click counts on the campaign doc — use a
  // conservative CTR proxy that is neutral until enough data accrues.
  const ctrProxy = impressions >= 100 ? 0.6 : 0.5; // cold-start neutral

  // Weighted sum, each component capped by construction so no single signal
  // can dominate. Cap the final quality at 1.
  return clamp01(0.45 * verificationScore + 0.25 * completeness + 0.30 * ctrProxy);
}

// ---------------------------------------------------------------------------
// Pacing
// ---------------------------------------------------------------------------
export interface PacingResult {
  paced_out: boolean;              // eligibility signal
  catchup_exempt: boolean;         // set true when in final window under-delivered
  pacing_score: number;            // ranking signal [0.3, 1]
  target_spend_usd_minor: number;  // debug
  elapsed_fraction: number;        // debug
}
export function computePacing(camp: PromotionCampaign, now: Date): PacingResult {
  const startMs = new Date(camp.start_at).getTime();
  const endMs = new Date(camp.end_at).getTime();
  const dur = Math.max(endMs - startMs, 1);
  const rawElapsed = (now.getTime() - startMs) / dur;
  const elapsed = Math.max(0, Math.min(1, rawElapsed));
  // At the very start (< 5% elapsed) we skip velocity checks and let a small
  // trickle through. Cold-start campaigns must not be immediately throttled.
  const effectiveElapsed = Math.max(elapsed, 0.05);
  const target = Math.max(1, Math.round(camp.budget_total_usd_minor * effectiveElapsed));
  const spent = camp.estimated_spend_usd_minor;
  const deliveryRatio = spent / target; // >1 means ahead of pace

  const catchup = elapsed > CATCHUP_ELAPSED_THRESHOLD &&
    (spent < camp.budget_total_usd_minor * CATCHUP_DELIVERED_THRESHOLD);

  const pacedOut = !catchup && deliveryRatio > (1 + PACING_TOLERANCE);

  // Ranking signal: under-delivered → high score, over-delivered → low.
  // Never below 0.3 so a perfectly-on-pace but slightly-ahead campaign is not
  // completely deranked (still competes on relevance × quality).
  let score = 1 - Math.min(1, Math.max(0, deliveryRatio - 0.2));
  if (catchup) score = Math.max(score, 0.9);
  score = Math.max(0.3, Math.min(1, score));

  return {
    paced_out: pacedOut,
    catchup_exempt: catchup,
    pacing_score: score,
    target_spend_usd_minor: target,
    elapsed_fraction: elapsed,
  };
}

// ---------------------------------------------------------------------------
// Final rank
// ---------------------------------------------------------------------------
export function scoreCandidate(camp: PromotionCampaign, ch: Channel, ctx: RankContext): RankBreakdown {
  const relevance = computeRelevance(camp, ch, ctx);
  const quality = computeQuality(camp, ch);
  const p = computePacing(camp, ctx.now);
  // sponsored_rank = relevance × quality × pacing_score. Budget IS NOT here.
  const rank = relevance * quality * p.pacing_score;
  return {
    relevance,
    quality,
    pacing_score: p.pacing_score,
    sponsored_rank: rank,
    paced_out: p.paced_out,
    catchup_exempt: p.catchup_exempt,
    target_spend_usd_minor: p.target_spend_usd_minor,
    elapsed_fraction: p.elapsed_fraction,
  };
}

function clamp01(x: number): number { return Math.max(0, Math.min(1, x)); }

// Purely-internal handles for targeted tests.
export const _internals = { MIN_RELEVANCE_THRESHOLD, PACING_TOLERANCE, CATCHUP_ELAPSED_THRESHOLD, CATCHUP_DELIVERED_THRESHOLD };
