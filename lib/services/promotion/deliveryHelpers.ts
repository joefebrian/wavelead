// Server-side helper for interleaving sponsored candidates into a discovery
// grid. Keeps organic items[] ordering untouched — we merely INSERT a Sponsored
// card at a fixed position. Density rule: at most 1 sponsored per >=5 organic.
import { promotionDeliveryService } from '@/lib/services/promotion/deliveryService';
import type { SponsoredPlacement } from '@/lib/types';

interface Ctx {
  placement: SponsoredPlacement;
  country_code?: string | null;
  category_slug?: string | null;
  search_query?: string | null;
  exclude_channel_id?: string | null;
}

/**
 * Fetch at most one sponsored candidate for the given discovery context.
 * Never throws; on failure returns [] so organic discovery still renders.
 */
export async function loadOneSponsored(ctx: Ctx) {
  return promotionDeliveryService.selectCandidates(
    { ...ctx, anonymous_session_id: null },
    1,
  ).catch(() => []);
}

/**
 * Whether the current grid has enough organic cards to also render a sponsored
 * card without producing an awkward layout (min 3 organic cards).
 */
export function shouldRenderSponsored(organicCount: number): boolean {
  return organicCount >= 3;
}
