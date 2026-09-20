// M18 — Append-only store of REAL provider FX observations.
//
// Immutable audit facts: insert only. No update path exists on purpose, so a
// historical transaction's FX can never be rewritten by a later rate.
import { getCollection } from '@/lib/db/mongo';
import { COLLECTIONS } from '@/lib/db/collections';
import type { ProviderFxSnapshot } from '@/lib/services/fx/providerFxService';

async function coll() { return getCollection<ProviderFxSnapshot>(COLLECTIONS.PROVIDER_FX_SNAPSHOTS); }

export const providerFxSnapshotRepo = {
  async insert(row: ProviderFxSnapshot): Promise<void> {
    const c = await coll();
    await c.insertOne(row);
  },

  async findDuplicate(key: {
    provider: string; provider_object_id: string | null; provider_payload_path: string; rate_value: string;
  }): Promise<ProviderFxSnapshot | null> {
    const c = await coll();
    return (await c.findOne({
      provider: key.provider as 'paypal',
      provider_object_id: key.provider_object_id,
      provider_payload_path: key.provider_payload_path,
      rate_value: key.rate_value,
    })) as ProviderFxSnapshot | null;
  },

  async findLatestForPair(base: string, quote: string): Promise<ProviderFxSnapshot | null> {
    const c = await coll();
    const rows = await c.find({ source_currency: base.toUpperCase(), target_currency: quote.toUpperCase() })
      .sort({ observed_at: -1 }).limit(1).toArray();
    return (rows[0] as ProviderFxSnapshot) || null;
  },

  async listRecent(limit = 50): Promise<ProviderFxSnapshot[]> {
    const c = await coll();
    return (await c.find({}).sort({ observed_at: -1 }).limit(limit).toArray()) as ProviderFxSnapshot[];
  },

  async countAll(): Promise<number> {
    const c = await coll();
    return c.countDocuments({});
  },
};
