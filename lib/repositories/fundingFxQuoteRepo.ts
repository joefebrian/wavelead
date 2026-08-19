// Repository for locked USD/IDR checkout quotes.
// Once created, a quote is IMMUTABLE — no field is ever mutated except status
// via a controlled state machine (`open` → `expired` / `consumed`).
import { getCollection } from '@/lib/db/mongo';
import { COLLECTIONS } from '@/lib/db/collections';
import type { FundingFxQuote, FundingFxQuoteStatus } from '@/lib/types';

async function coll() { return getCollection<FundingFxQuote>(COLLECTIONS.FUNDING_FX_QUOTES); }

export const fundingFxQuoteRepo = {
  async insert(row: FundingFxQuote): Promise<void> { const c = await coll(); await c.insertOne(row); },
  async findById(id: string): Promise<FundingFxQuote | null> { const c = await coll(); return (await c.findOne({ id })) as FundingFxQuote | null; },
  async listForCampaign(campaign_id: string): Promise<FundingFxQuote[]> {
    const c = await coll();
    return (await c.find({ campaign_id }).sort({ locked_at: -1 }).toArray()) as FundingFxQuote[];
  },
  /** Update ONLY the status. Any other write is rejected. */
  async transitionStatus(id: string, from: FundingFxQuoteStatus, to: FundingFxQuoteStatus): Promise<boolean> {
    const c = await coll();
    const r = await c.updateOne({ id, status: from }, { $set: { status: to } });
    return r.modifiedCount === 1;
  },
};
