import { Filter, Sort } from 'mongodb';
import { getCollection, stripId, stripIds } from '../db/mongo';
import { COLLECTIONS } from '../db/collections';
import type {
  PromotionCampaign,
  PromotionRateCard,
  CampaignImpressionDedup,
  CampaignDailyMetric,
  SponsoredPlacement,
  PromotionCampaignStatus,
} from '@/lib/types';

// ==================== Campaigns ====================
export const promotionCampaignRepo = {
  async findById(id: string): Promise<PromotionCampaign | null> {
    const c = await getCollection<PromotionCampaign>(COLLECTIONS.PROMOTION_CAMPAIGNS);
    return stripId(await c.findOne({ id })) as PromotionCampaign | null;
  },
  async list(filter: Filter<PromotionCampaign> = {}, sort: Sort = { created_at: -1 }, limit = 50): Promise<PromotionCampaign[]> {
    const c = await getCollection<PromotionCampaign>(COLLECTIONS.PROMOTION_CAMPAIGNS);
    return stripIds(await c.find(filter).sort(sort).limit(limit).toArray()) as PromotionCampaign[];
  },
  async count(filter: Filter<PromotionCampaign> = {}): Promise<number> {
    const c = await getCollection<PromotionCampaign>(COLLECTIONS.PROMOTION_CAMPAIGNS);
    return c.countDocuments(filter);
  },
  async insert(doc: PromotionCampaign): Promise<PromotionCampaign> {
    const c = await getCollection<PromotionCampaign>(COLLECTIONS.PROMOTION_CAMPAIGNS);
    await c.insertOne(doc);
    return stripId(doc) as PromotionCampaign;
  },
  async update(id: string, patch: Partial<PromotionCampaign>): Promise<void> {
    const c = await getCollection<PromotionCampaign>(COLLECTIONS.PROMOTION_CAMPAIGNS);
    await c.updateOne({ id }, { $set: { ...patch, updated_at: new Date() } });
  },
  /**
   * Atomically deliver a sponsored impression. Deducts CPM spend from the
   * campaign only when there is enough remaining budget. Uses a Mongo
   * conditional update so concurrent impressions can never overspend.
   *
   * Returns { delivered: true, campaign } if the impression was recorded.
   * Returns { delivered: false } when budget is exhausted or status is
   * no longer active.
   */
  async atomicDeliverImpression(
    campaign_id: string,
    unit_spend_usd_minor: number,
  ): Promise<{ delivered: boolean; campaign: PromotionCampaign | null }> {
    const c = await getCollection<PromotionCampaign>(COLLECTIONS.PROMOTION_CAMPAIGNS);
    const now = new Date();
    const updated = await c.findOneAndUpdate(
      {
        id: campaign_id,
        status: 'active',
        $expr: {
          $lte: [
            { $add: ['$estimated_spend_usd_minor', unit_spend_usd_minor] },
            '$budget_total_usd_minor',
          ],
        },
      },
      {
        $inc: {
          delivered_impressions: 1,
          estimated_spend_usd_minor: unit_spend_usd_minor,
        },
        $set: { updated_at: now },
      },
      { returnDocument: 'after' },
    );
    if (!updated) return { delivered: false, campaign: null };
    return { delivered: true, campaign: stripId(updated) as PromotionCampaign };
  },
  async setStatus(id: string, status: PromotionCampaignStatus, patch: Partial<PromotionCampaign> = {}): Promise<void> {
    const c = await getCollection<PromotionCampaign>(COLLECTIONS.PROMOTION_CAMPAIGNS);
    await c.updateOne({ id }, { $set: { ...patch, status, updated_at: new Date() } });
  },
};

// ==================== Rate Cards ====================
export const promotionRateCardRepo = {
  async findById(id: string): Promise<PromotionRateCard | null> {
    const c = await getCollection<PromotionRateCard>(COLLECTIONS.PROMOTION_RATE_CARDS);
    return stripId(await c.findOne({ id })) as PromotionRateCard | null;
  },
  async list(filter: Filter<PromotionRateCard> = {}): Promise<PromotionRateCard[]> {
    const c = await getCollection<PromotionRateCard>(COLLECTIONS.PROMOTION_RATE_CARDS);
    return stripIds(await c.find(filter).sort({ placement: 1, country_code: 1 }).toArray()) as PromotionRateCard[];
  },
  async insert(doc: PromotionRateCard): Promise<PromotionRateCard> {
    const c = await getCollection<PromotionRateCard>(COLLECTIONS.PROMOTION_RATE_CARDS);
    await c.insertOne(doc);
    return stripId(doc) as PromotionRateCard;
  },
  async update(id: string, patch: Partial<PromotionRateCard>): Promise<void> {
    const c = await getCollection<PromotionRateCard>(COLLECTIONS.PROMOTION_RATE_CARDS);
    await c.updateOne({ id }, { $set: { ...patch, updated_at: new Date() } });
  },
  async upsertBySeedKey(seed_key: string, doc: PromotionRateCard): Promise<void> {
    const c = await getCollection<PromotionRateCard>(COLLECTIONS.PROMOTION_RATE_CARDS);
    const { created_at, ...rest } = doc;
    await c.updateOne(
      { seed_key },
      { $set: { ...rest, updated_at: new Date() }, $setOnInsert: { created_at } },
      { upsert: true },
    );
  },
  /**
   * Resolve rate by placement + optional country. Precedence:
   *   1. active country-specific rate
   *   2. active global rate (country_code === null)
   */
  async resolve(placement: SponsoredPlacement, country_code: string | null): Promise<PromotionRateCard | null> {
    const c = await getCollection<PromotionRateCard>(COLLECTIONS.PROMOTION_RATE_CARDS);
    const now = new Date();
    if (country_code) {
      const specific = await c.findOne({
        placement,
        country_code: country_code.toUpperCase(),
        active: true,
        effective_from: { $lte: now },
        $or: [{ effective_to: null }, { effective_to: { $gt: now } }],
      });
      if (specific) return stripId(specific) as PromotionRateCard;
    }
    const global = await c.findOne({
      placement,
      country_code: null,
      active: true,
      effective_from: { $lte: now },
      $or: [{ effective_to: null }, { effective_to: { $gt: now } }],
    });
    return stripId(global) as PromotionRateCard | null;
  },
};

// ==================== Impression Dedup ====================
export const campaignImpressionDedupRepo = {
  /**
   * Atomically enforce the frequency cap:
   *   same campaign + same anonymous session → max 3 impressions per rolling 24h.
   *
   * Uses a single conditional findOneAndUpdate with $expr to atomically check
   * whether the window has expired and either increment the counter or reset
   * the window. Two concurrent requests can never both see count=2 and both
   * increment to produce count=4 because Mongo evaluates the query and the
   * update as one operation and the returned document reflects the final
   * post-update state.
   */
  async tryIncrement(
    campaign_id: string,
    anonymous_session_id: string,
    now: Date,
    max_impressions: number,
    window_ms: number,
  ): Promise<{ allowed: boolean; state: CampaignImpressionDedup | null }> {
    const c = await getCollection<CampaignImpressionDedup>(COLLECTIONS.CAMPAIGN_IMPRESSION_DEDUP);
    const nextExpires = new Date(now.getTime() + window_ms);
    // Path 1: existing active window with room → atomic increment.
    const inc = await c.findOneAndUpdate(
      {
        campaign_id,
        anonymous_session_id,
        expires_at: { $gt: now },
        impression_count: { $lt: max_impressions },
      },
      {
        $inc: { impression_count: 1 },
        $set: { last_impression_at: now, updated_at: now },
      },
      { returnDocument: 'after' },
    );
    if (inc) return { allowed: true, state: stripId(inc) as CampaignImpressionDedup };

    // Path 2: expired window → reset (upsert) atomically.
    const reset = await c.findOneAndUpdate(
      {
        campaign_id,
        anonymous_session_id,
        expires_at: { $lte: now },
      },
      {
        $set: {
          impression_count: 1,
          window_started_at: now,
          last_impression_at: now,
          expires_at: nextExpires,
          updated_at: now,
        },
      },
      { returnDocument: 'after' },
    );
    if (reset) return { allowed: true, state: stripId(reset) as CampaignImpressionDedup };

    // Path 3: no doc → first-ever impression for this pair.
    try {
      const doc: CampaignImpressionDedup = {
        campaign_id,
        anonymous_session_id,
        impression_count: 1,
        window_started_at: now,
        last_impression_at: now,
        expires_at: nextExpires,
        created_at: now,
        updated_at: now,
      };
      await c.insertOne(doc as unknown as CampaignImpressionDedup);
      return { allowed: true, state: doc };
    } catch (err) {
      // Unique-index race: another concurrent request inserted first.
      // Retry the increment path once — if the window is now full, block.
      const retry = await c.findOneAndUpdate(
        {
          campaign_id,
          anonymous_session_id,
          expires_at: { $gt: now },
          impression_count: { $lt: max_impressions },
        },
        {
          $inc: { impression_count: 1 },
          $set: { last_impression_at: now, updated_at: now },
        },
        { returnDocument: 'after' },
      );
      if (retry) return { allowed: true, state: stripId(retry) as CampaignImpressionDedup };
      const existing = await c.findOne({ campaign_id, anonymous_session_id });
      return { allowed: false, state: existing ? (stripId(existing) as CampaignImpressionDedup) : null };
    }
  },
  async findOne(campaign_id: string, anonymous_session_id: string): Promise<CampaignImpressionDedup | null> {
    const c = await getCollection<CampaignImpressionDedup>(COLLECTIONS.CAMPAIGN_IMPRESSION_DEDUP);
    return stripId(await c.findOne({ campaign_id, anonymous_session_id })) as CampaignImpressionDedup | null;
  },
};

// ==================== Campaign Daily Metrics ====================
export const campaignDailyMetricRepo = {
  async list(filter: Filter<CampaignDailyMetric> = {}): Promise<CampaignDailyMetric[]> {
    const c = await getCollection<CampaignDailyMetric>(COLLECTIONS.CAMPAIGN_DAILY_METRICS);
    return stripIds(await c.find(filter).sort({ date: 1 }).toArray()) as CampaignDailyMetric[];
  },
  async upsertIncrement(
    campaign_id: string,
    channel_id: string,
    date: string,
    placement: SponsoredPlacement,
    incField: keyof CampaignDailyMetric,
    amount: number,
  ): Promise<void> {
    const c = await getCollection<CampaignDailyMetric>(COLLECTIONS.CAMPAIGN_DAILY_METRICS);
    const now = new Date();
    await c.updateOne(
      { campaign_id, date, placement },
      {
        $setOnInsert: {
          id: `${campaign_id}:${date}:${placement}`,
          campaign_id,
          channel_id,
          date,
          placement,
          sponsored_impressions: 0,
          sponsored_profile_views: 0,
          unique_sponsored_profile_views: 0,
          follow_clicks: 0,
          unique_follow_intents: 0,
          spend_usd_minor: 0,
        },
        $inc: { [incField]: amount } as unknown as Record<string, number>,
        $set: { last_aggregated_at: now },
      },
      { upsert: true },
    );
  },
};
