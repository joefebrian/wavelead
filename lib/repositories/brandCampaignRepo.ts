// M18 — Brand Launch Campaigns: repository.
//
// ISOLATED collections (brand_campaigns / brand_campaign_applications).
// promotion_campaigns is a different, owner-side domain and is NOT touched.
import { getCollection } from '@/lib/db/mongo';
import { COLLECTIONS } from '@/lib/db/collections';
import type { BrandCampaign, BrandCampaignApplication } from '@/lib/services/brandCampaignService';

async function campaigns() { return getCollection<BrandCampaign>(COLLECTIONS.BRAND_CAMPAIGNS); }
async function applications() { return getCollection<BrandCampaignApplication>(COLLECTIONS.BRAND_CAMPAIGN_APPLICATIONS); }

export const brandCampaignRepo = {
  async insert(row: BrandCampaign): Promise<void> { await (await campaigns()).insertOne(row); },
  async findById(id: string): Promise<BrandCampaign | null> {
    return ((await campaigns()).findOne({ id })) as Promise<BrandCampaign | null>;
  },
  async update(id: string, patch: Partial<BrandCampaign>): Promise<void> {
    const c = await campaigns();
    await c.updateOne({ id }, { $set: { ...patch, updated_at: new Date() } });
  },
  async listForBrand(brandUserId: string): Promise<BrandCampaign[]> {
    const c = await campaigns();
    return (await c.find({ brand_user_id: brandUserId }).sort({ created_at: -1 }).toArray()) as BrandCampaign[];
  },
  /** Publicly visible opportunities: open campaigns only. */
  async listOpen(limit = 100): Promise<BrandCampaign[]> {
    const c = await campaigns();
    return (await c.find({ status: 'open' }).sort({ created_at: -1 }).limit(limit).toArray()) as BrandCampaign[];
  },
  async listAll(limit = 200): Promise<BrandCampaign[]> {
    const c = await campaigns();
    return (await c.find({}).sort({ created_at: -1 }).limit(limit).toArray()) as BrandCampaign[];
  },

  async insertApplication(row: BrandCampaignApplication): Promise<void> { await (await applications()).insertOne(row); },
  async findApplication(id: string): Promise<BrandCampaignApplication | null> {
    return ((await applications()).findOne({ id })) as Promise<BrandCampaignApplication | null>;
  },
  async updateApplication(id: string, patch: Partial<BrandCampaignApplication>): Promise<void> {
    const c = await applications();
    await c.updateOne({ id }, { $set: { ...patch, updated_at: new Date() } });
  },
  async listApplicationsForCampaign(campaignId: string): Promise<BrandCampaignApplication[]> {
    const c = await applications();
    return (await c.find({ campaign_id: campaignId }).sort({ created_at: -1 }).toArray()) as BrandCampaignApplication[];
  },
  async listApplicationsForCreator(userId: string): Promise<BrandCampaignApplication[]> {
    const c = await applications();
    return (await c.find({ creator_user_id: userId }).sort({ created_at: -1 }).toArray()) as BrandCampaignApplication[];
  },
  /** Duplicate guard: one live application per (campaign, channel). */
  async findLiveApplication(campaignId: string, channelId: string): Promise<BrandCampaignApplication | null> {
    const c = await applications();
    return (await c.findOne({
      campaign_id: campaignId, channel_id: channelId, status: { $ne: 'withdrawn' },
    })) as BrandCampaignApplication | null;
  },
  async countApplications(campaignId: string, status?: string): Promise<number> {
    const c = await applications();
    return c.countDocuments(status
      ? { campaign_id: campaignId, status: status as BrandCampaignApplication['status'] }
      : { campaign_id: campaignId });
  },
};
