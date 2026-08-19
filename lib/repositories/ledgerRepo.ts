// M06.0 Phase 3 — Ledger repository. Append-only; never update or delete a
// posted transaction. Idempotency is enforced by a unique index on
// `idempotency_key`; a duplicate insert throws MongoServerError code 11000.
import { Filter, Sort } from 'mongodb';
import { getCollection, stripId, stripIds } from '../db/mongo';
import { COLLECTIONS } from '../db/collections';
import type { LedgerTransaction } from '@/lib/types';

export const ledgerRepo = {
  async insertIfAbsent(txn: LedgerTransaction): Promise<{ inserted: boolean; existing: LedgerTransaction | null }> {
    const c = await getCollection<LedgerTransaction>(COLLECTIONS.LEDGER_TRANSACTIONS);
    try {
      await c.insertOne(txn);
      return { inserted: true, existing: null };
    } catch (err) {
      const e = err as { code?: number; message?: string };
      if (e.code === 11000 || (e.message || '').includes('duplicate key')) {
        const found = await c.findOne({ idempotency_key: txn.idempotency_key });
        return { inserted: false, existing: found ? (stripId(found) as LedgerTransaction) : null };
      }
      throw err;
    }
  },
  async list(filter: Filter<LedgerTransaction> = {}, opts: { limit?: number; sort?: Sort } = {}): Promise<LedgerTransaction[]> {
    const c = await getCollection<LedgerTransaction>(COLLECTIONS.LEDGER_TRANSACTIONS);
    const cursor = c.find(filter).sort(opts.sort ?? ({ created_at: 1 } as Sort));
    if (opts.limit && opts.limit > 0) cursor.limit(opts.limit);
    return stripIds(await cursor.toArray()) as LedgerTransaction[];
  },
  async listForCampaign(campaign_id: string): Promise<LedgerTransaction[]> {
    return this.list({ campaign_id });
  },
  async findByIdempotencyKey(key: string): Promise<LedgerTransaction | null> {
    const c = await getCollection<LedgerTransaction>(COLLECTIONS.LEDGER_TRANSACTIONS);
    return stripId(await c.findOne({ idempotency_key: key })) as LedgerTransaction | null;
  },
};
