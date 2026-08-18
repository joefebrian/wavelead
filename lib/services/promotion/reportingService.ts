// M05.1 campaign performance reporting. Aggregates sponsored events for the
// caller's own campaigns. Owner isolation is enforced up-front.
import { promotionCampaignRepo } from '@/lib/repositories/promotionRepo';
import { getCollection } from '@/lib/db/mongo';
import { COLLECTIONS } from '@/lib/db/collections';
import { HttpError, ROLES, rankOf } from '@/lib/auth/rbac';
import type { Actor, EventRecord, SponsoredPlacement } from '@/lib/types';
import { SPONSORED_PLACEMENTS } from '@/lib/types';

interface CampaignKpis {
  sponsored_impressions: number;
  sponsored_profile_views: number;
  unique_sponsored_profile_views: number;
  follow_clicks: number;
  unique_follow_intents: number;
  estimated_spend_usd_minor: number;
  profile_ctr_pct: number | null;
  follow_intent_rate_pct: number | null;
  cost_per_unique_follow_intent_usd_minor: number | null;
  effective_cpm_usd_minor: number | null;
}

export const promotionReportingService = {
  async forOwner(actor: Actor | null, campaign_id: string) {
    if (!actor) throw new HttpError(401, 'Authentication required');
    const camp = await promotionCampaignRepo.findById(campaign_id);
    if (!camp) throw new HttpError(404, 'Campaign not found');
    if (camp.owner_user_id !== actor.user.id && rankOf(actor.user.role) < rankOf(ROLES.ADMIN)) {
      throw new HttpError(403, 'Not your campaign');
    }
    const events = await getCollection<EventRecord>(COLLECTIONS.EVENTS);
    const cursor = events.find({ campaign_id: campaign_id, traffic_type: 'sponsored' } as unknown as Record<string, unknown>);
    const rows = await cursor.toArray();
    // Overall KPIs.
    const overall = computeKpis(rows, camp.estimated_spend_usd_minor);
    // Per-placement breakdown.
    const byPlacement: Record<SponsoredPlacement, CampaignKpis> = {} as Record<SponsoredPlacement, CampaignKpis>;
    for (const p of SPONSORED_PLACEMENTS) {
      const scoped = rows.filter((r) => r.placement === p);
      // Approximate spend per placement in proportion to its impressions share.
      const totalImps = rows.filter((r) => r.event_type === 'channel_impression').length || 1;
      const scopedImps = scoped.filter((r) => r.event_type === 'channel_impression').length;
      const spendShare = Math.round((scopedImps / totalImps) * camp.estimated_spend_usd_minor);
      byPlacement[p] = computeKpis(scoped, spendShare);
    }
    // Timeseries (UTC day).
    const byDay: Record<string, { imps: number; views: number; ufi: number }> = {};
    for (const r of rows) {
      const day = new Date(r.created_at as unknown as Date).toISOString().slice(0, 10);
      byDay[day] = byDay[day] || { imps: 0, views: 0, ufi: 0 };
      if (r.event_type === 'channel_impression') byDay[day].imps += 1;
      if (r.event_type === 'channel_profile_view') byDay[day].views += 1;
    }
    // Unique follow intents per day.
    const uniqueDay = new Map<string, Set<string>>();
    for (const r of rows.filter((x) => x.event_type === 'follow_click')) {
      const day = new Date(r.created_at as unknown as Date).toISOString().slice(0, 10);
      const key = `${r.anonymous_session_id || 'anon'}:${r.channel_id}`;
      if (!uniqueDay.has(day)) uniqueDay.set(day, new Set());
      uniqueDay.get(day)!.add(key);
    }
    for (const [day, set] of uniqueDay) {
      byDay[day] = byDay[day] || { imps: 0, views: 0, ufi: 0 };
      byDay[day].ufi = set.size;
    }
    const timeseries = Object.entries(byDay).sort(([a], [b]) => a < b ? -1 : 1).map(([date, v]) => ({ date, ...v }));
    return {
      campaign: {
        id: camp.id, name: camp.name, status: camp.status, objective: camp.objective,
        placements: camp.placements, targeting: camp.targeting,
        budget_total_usd_minor: camp.budget_total_usd_minor,
        budget_daily_usd_minor: camp.budget_daily_usd_minor,
        estimated_spend_usd_minor: camp.estimated_spend_usd_minor,
        budget_remaining_usd_minor: Math.max(0, camp.budget_total_usd_minor - camp.estimated_spend_usd_minor),
        start_at: camp.start_at, end_at: camp.end_at,
      },
      overall,
      by_placement: byPlacement,
      timeseries,
    };
  },
};

function computeKpis(rows: EventRecord[], spend: number): CampaignKpis {
  const imps = rows.filter((r) => r.event_type === 'channel_impression').length;
  const views = rows.filter((r) => r.event_type === 'channel_profile_view').length;
  const uniqViews = new Set(rows.filter((r) => r.event_type === 'channel_profile_view').map((r) => `${r.anonymous_session_id}:${r.channel_id}`)).size;
  const followClicks = rows.filter((r) => r.event_type === 'follow_click').length;
  const ufi = new Set(rows.filter((r) => r.event_type === 'follow_click').map((r) => `${r.anonymous_session_id}:${r.channel_id}`)).size;
  const profile_ctr_pct = imps > 0 ? Math.round((views / imps) * 10000) / 100 : null;
  const follow_intent_rate_pct = uniqViews > 0 ? Math.round((ufi / uniqViews) * 10000) / 100 : null;
  const cost_per_unique_follow_intent_usd_minor = ufi > 0 ? Math.round(spend / ufi) : null;
  const effective_cpm_usd_minor = imps > 0 ? Math.round((spend / imps) * 1000) : null;
  return {
    sponsored_impressions: imps,
    sponsored_profile_views: views,
    unique_sponsored_profile_views: uniqViews,
    follow_clicks: followClicks,
    unique_follow_intents: ufi,
    estimated_spend_usd_minor: spend,
    profile_ctr_pct,
    follow_intent_rate_pct,
    cost_per_unique_follow_intent_usd_minor,
    effective_cpm_usd_minor,
  };
}
