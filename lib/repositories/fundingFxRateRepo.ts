// Repository for admin-managed USD/IDR FX rates.
// Rates are append-only; deactivating an old rate does not delete history.
import { getCollection } from '@/lib/db/mongo';
import { COLLECTIONS } from '@/lib/db/collections';
import type { FundingFxRate } from '@/lib/types';

async function coll() { return getCollection<FundingFxRate>(COLLECTIONS.FUNDING_FX_RATES); }

export const fundingFxRateRepo = {
  async insert(row: FundingFxRate): Promise<void> { const c = await coll(); await c.insertOne(row); },
  async findById(id: string): Promise<FundingFxRate | null> { const c = await coll(); return (await c.findOne({ id })) as FundingFxRate | null; },
  async listAll(): Promise<FundingFxRate[]> {
    const c = await coll();
    return (await c.find({}).sort({ effective_from: -1 }).toArray()) as FundingFxRate[];
  },
  async findActive(base: string, quote: string): Promise<FundingFxRate | null> {
    const c = await coll();
    return (await c.findOne({ base_currency: base, quote_currency: quote, active: true })) as FundingFxRate | null;
  },
  /** Atomic swap: deactivate any current active rate for this pair, then insert the new active row. */
  async activate(row: FundingFxRate): Promise<void> {
    const c = await coll();
    await c.updateMany(
      { base_currency: row.base_currency, quote_currency: row.quote_currency, active: true },
      { $set: { active: false, effective_until: new Date(), updated_at: new Date() } },
    );
    await c.insertOne(row);
  },
  async deactivate(id: string): Promise<void> {
    const c = await coll();
    await c.updateOne({ id }, { $set: { active: false, effective_until: new Date(), updated_at: new Date() } });
  },
};
