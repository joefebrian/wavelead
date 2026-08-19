// Sponsored candidate delivery. Returns a small ranked list of eligible
// sponsored campaigns for the given placement + context. Never touches organic
// ranking data. Frequency cap + budget accounting are enforced at the
// impression-acknowledgement step, not at candidate selection.
import { promotionCampaignRepo, promotionRateCardRepo, campaignImpressionDedupRepo } from '@/lib/repositories/promotionRepo';
import { channelRepo } from '@/lib/repositories/channelRepo';
import { reconcileCampaign } from './campaignStateService';
import { issueAttributionToken } from './attributionTokenService';
import type {
  Channel,
  PromotionCampaign,
  SponsoredPlacement,
  AcquisitionSource,
} from '@/lib/types';
import { PLACEMENT_TO_SOURCE } from '@/lib/types';

const FREQ_CAP_MAX = 3;
const FREQ_CAP_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface DeliveryContext {
  placement: SponsoredPlacement;
  anonymous_session_id: string | null;
  country_code?: string | null;
  language?: string | null;
  category_slug?: string | null;
  exclude_channel_id?: string | null;    // e.g. for related_channel: never self-promote
  search_query?: string | null;
}

export interface SponsoredCandidate {
  campaign_id: string;
  channel: {
    id: string;
    slug: string;
    name: string;
    short_description: string | null;
    logo_url: string | null;
    country_code: string | null;
    primary_language: string | null;
    is_verified: boolean;
    is_official: boolean;
  };
  traffic_type: 'sponsored';
  source: AcquisitionSource;
  placement: SponsoredPlacement;
  attribution_token: string;
  delivery_metadata: {
    position_hint: number;   // 0-indexed insertion slot inside items[]
  };
}

function matchesTargeting(camp: PromotionCampaign, ctx: DeliveryContext, ch: Channel): boolean {
  const t = camp.targeting;
  if (t.countries.length && ctx.country_code) {
    if (!t.countries.includes(ctx.country_code.toUpperCase())) return false;
  }
  if (t.languages.length && ctx.language) {
    if (!t.languages.includes(ctx.language.toLowerCase())) return false;
  }
  if (t.categories.length && ctx.category_slug) {
    if (!t.categories.includes(ctx.category_slug.toLowerCase())) return false;
  }
  // Placement-specific relevance safeguard: a campaign placed on
  // sponsored_category should have EITHER a matching category in targeting
  // OR the promoted channel itself in the target category.
  if (ctx.placement === 'sponsored_category' && ctx.category_slug) {
    if (!t.categories.length && !ch.slug) return false;
  }
  if (ctx.placement === 'sponsored_country' && ctx.country_code) {
    if (!t.countries.length && !ch.country_code) return false;
    if (t.countries.length && !t.countries.includes(ctx.country_code.toUpperCase())) return false;
  }
  if (ctx.placement === 'sponsored_related_channel' && ctx.exclude_channel_id && ch.id === ctx.exclude_channel_id) {
    return false;
  }
  return true;
}

interface CandidateWithChannel { camp: PromotionCampaign; ch: Channel; cpm_usd_minor: number; }

async function loadEligibleCampaigns(placement: SponsoredPlacement): Promise<PromotionCampaign[]> {
  // Return campaigns whose stored status is a candidate for delivery.
  // reconcileCampaign() below will finalize state before we serve.
  const raw = await promotionCampaignRepo.list({
    placements: placement,
    status: { $in: ['active', 'scheduled'] },
  } as unknown as Record<string, unknown>);
  return raw;
}

export const promotionDeliveryService = {
  async selectCandidates(ctx: DeliveryContext, limit = 1): Promise<SponsoredCandidate[]> {
    // Trending / Top must never carry sponsored content — defensive guard.
    // (Callers should not even invoke us for those pages, but be safe.)
    if (!['sponsored_search', 'sponsored_homepage', 'sponsored_category', 'sponsored_country', 'sponsored_related_channel'].includes(ctx.placement)) {
      return [];
    }
    const now = new Date();
    const rawCamps = await loadEligibleCampaigns(ctx.placement);
    const candidates: CandidateWithChannel[] = [];
    const { campaignFundingService } = await import('@/lib/services/payments/campaignFundingService');
    for (const raw of rawCamps) {
      const camp = await reconcileCampaign(raw, now);
      if (camp.status !== 'active') continue;
      if (camp.estimated_spend_usd_minor >= camp.budget_total_usd_minor) continue;
      // M06.0: campaigns can only deliver after they are funded (or waived).
      const funding = await campaignFundingService.fundingSummary(camp.id);
      if (!funding.funded) continue;
      const ch = await channelRepo.findById(camp.channel_id);
      if (!ch || ch.status !== 'approved') continue;
      const vs = (ch as unknown as { verification_status?: string }).verification_status;
      if (vs !== 'verified' && vs !== 'official') continue;
      if (!matchesTargeting(camp, ctx, ch)) continue;
      // Frequency cap peek (do NOT increment here — candidate selection is not an impression).
      if (ctx.anonymous_session_id) {
        const state = await campaignImpressionDedupRepo.findOne(camp.id, ctx.anonymous_session_id);
        if (state && state.expires_at > now && state.impression_count >= FREQ_CAP_MAX) continue;
      }
      const rate = await promotionRateCardRepo.resolve(ctx.placement, ctx.country_code || null);
      if (!rate) continue;
      candidates.push({ camp, ch, cpm_usd_minor: rate.cpm_usd_minor });
    }
    if (candidates.length === 0) return [];
    // Fair rotation: shuffle then sort deterministically by remaining pacing
    // headroom. For M05.1 keep it simple — randomize using session salt so a
    // single session sees consistent-ish results per refresh.
    const salt = ctx.anonymous_session_id ? [...ctx.anonymous_session_id].reduce((s, c) => s + c.charCodeAt(0), 0) : Date.now();
    candidates.sort((a, b) => {
      const remA = a.camp.budget_total_usd_minor - a.camp.estimated_spend_usd_minor;
      const remB = b.camp.budget_total_usd_minor - b.camp.estimated_spend_usd_minor;
      if (remA !== remB) return remB - remA;
      return ((a.camp.id.charCodeAt(0) + salt) % 7) - ((b.camp.id.charCodeAt(0) + salt) % 7);
    });
    const picked = candidates.slice(0, limit);
    const source = PLACEMENT_TO_SOURCE[ctx.placement];
    return picked.map((c, idx) => ({
      campaign_id: c.camp.id,
      channel: {
        id: c.ch.id,
        slug: c.ch.slug,
        name: c.ch.name,
        short_description: c.ch.short_description,
        logo_url: c.ch.logo_url,
        country_code: c.ch.country_code,
        primary_language: c.ch.primary_language,
        is_verified: ((c.ch as unknown as { verification_status?: string }).verification_status === 'verified'),
        is_official: ((c.ch as unknown as { verification_status?: string }).verification_status === 'official'),
      },
      traffic_type: 'sponsored',
      source,
      placement: ctx.placement,
      attribution_token: issueAttributionToken({
        campaign_id: c.camp.id,
        channel_id: c.ch.id,
        source,
        placement: ctx.placement,
        anonymous_session_id: ctx.anonymous_session_id,
      }),
      delivery_metadata: {
        // Density rule: 1 sponsored per ~6 organic. Place at index 2 (3rd card) by default.
        position_hint: 2 + idx * 6,
      },
    }));
  },

  /**
   * Acknowledge a rendered sponsored impression. Enforces:
   *  - valid campaign, still active
   *  - frequency cap (atomic increment)
   *  - budget/pacing (atomic conditional spend)
   * Returns { recorded: true } only when the campaign should be billed AND the
   * impression analytics event should be persisted.
   */
  async acknowledgeImpression(input: {
    campaign_id: string;
    placement: SponsoredPlacement;
    anonymous_session_id: string | null;
    country_code?: string | null;
  }): Promise<{ recorded: boolean; reason?: string; unit_spend_usd_minor?: number; channel_id?: string }> {
    const now = new Date();
    const raw = await promotionCampaignRepo.findById(input.campaign_id);
    if (!raw) return { recorded: false, reason: 'not_found' };
    const camp = await reconcileCampaign(raw, now);
    if (camp.status !== 'active') return { recorded: false, reason: `status_${camp.status}` };
    if (!camp.placements.includes(input.placement)) return { recorded: false, reason: 'placement_mismatch' };
    if (!input.anonymous_session_id) return { recorded: false, reason: 'no_session' };
    // Frequency cap (atomic).
    const cap = await campaignImpressionDedupRepo.tryIncrement(
      camp.id,
      input.anonymous_session_id,
      now,
      FREQ_CAP_MAX,
      FREQ_CAP_WINDOW_MS,
    );
    if (!cap.allowed) return { recorded: false, reason: 'frequency_capped' };
    // Resolve rate from snapshot first (locks historical price), fall back to
    // live rate card if the campaign somehow has no snapshot for the placement.
    const snap = camp.rate_snapshot?.find((s) => s.placement === input.placement);
    let cpm = snap?.cpm_usd_minor;
    if (!cpm) {
      const card = await promotionRateCardRepo.resolve(input.placement, input.country_code || null);
      if (!card) return { recorded: false, reason: 'no_rate_card' };
      cpm = card.cpm_usd_minor;
    }
    // Per-impression spend = cpm / 1000 (in minor units). Use integer math so we
    // never accumulate float drift.
    const unit_spend_usd_minor = Math.ceil(cpm / 1000);
    // Atomic budget check + increment.
    const delivered = await promotionCampaignRepo.atomicDeliverImpression(camp.id, unit_spend_usd_minor);
    if (!delivered.delivered) return { recorded: false, reason: 'budget_exhausted' };
    return { recorded: true, unit_spend_usd_minor, channel_id: camp.channel_id };
  },
};

export const _internals = { FREQ_CAP_MAX, FREQ_CAP_WINDOW_MS };
