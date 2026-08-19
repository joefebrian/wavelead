// M06.0 payment funding repositories.
import { Filter, Sort } from 'mongodb';
import { getCollection, stripId, stripIds } from '../db/mongo';
import { COLLECTIONS } from '../db/collections';
import type {
  PaymentFundingOrder,
  CampaignFundingLedgerEntry,
  PaymentWebhookEvent,
  FundingStatus,
} from '@/lib/types';

export const paymentFundingOrderRepo = {
  async findById(id: string): Promise<PaymentFundingOrder | null> {
    const c = await getCollection<PaymentFundingOrder>(COLLECTIONS.PAYMENT_FUNDING_ORDERS);
    return stripId(await c.findOne({ id })) as PaymentFundingOrder | null;
  },
  async findByProviderOrderId(provider_order_id: string): Promise<PaymentFundingOrder | null> {
    const c = await getCollection<PaymentFundingOrder>(COLLECTIONS.PAYMENT_FUNDING_ORDERS);
    return stripId(await c.findOne({ provider_order_id })) as PaymentFundingOrder | null;
  },
  async listForCampaign(campaign_id: string): Promise<PaymentFundingOrder[]> {
    const c = await getCollection<PaymentFundingOrder>(COLLECTIONS.PAYMENT_FUNDING_ORDERS);
    return stripIds(await c.find({ campaign_id }).sort({ created_at: -1 } as Sort).toArray()) as PaymentFundingOrder[];
  },
  async list(filter: Filter<PaymentFundingOrder> = {}): Promise<PaymentFundingOrder[]> {
    const c = await getCollection<PaymentFundingOrder>(COLLECTIONS.PAYMENT_FUNDING_ORDERS);
    return stripIds(await c.find(filter).sort({ created_at: -1 } as Sort).toArray()) as PaymentFundingOrder[];
  },
  async insert(doc: PaymentFundingOrder): Promise<PaymentFundingOrder> {
    const c = await getCollection<PaymentFundingOrder>(COLLECTIONS.PAYMENT_FUNDING_ORDERS);
    await c.insertOne(doc);
    return stripId(doc) as PaymentFundingOrder;
  },
  async update(id: string, patch: Partial<PaymentFundingOrder>): Promise<void> {
    const c = await getCollection<PaymentFundingOrder>(COLLECTIONS.PAYMENT_FUNDING_ORDERS);
    await c.updateOne({ id }, { $set: { ...patch, updated_at: new Date() } });
  },
  /**
   * Atomically transition funding status. Fails silently (returns false) if the
   * `from` guard is not the current status — lets callers safely retry without
   * double-crediting the ledger.
   */
  async transition(id: string, from: FundingStatus[], to: FundingStatus, patch: Partial<PaymentFundingOrder> = {}): Promise<boolean> {
    const c = await getCollection<PaymentFundingOrder>(COLLECTIONS.PAYMENT_FUNDING_ORDERS);
    const r = await c.updateOne(
      { id, status: { $in: from } },
      { $set: { ...patch, status: to, updated_at: new Date() } },
    );
    return r.modifiedCount === 1;
  },
};

export const campaignFundingLedgerRepo = {
  async list(filter: Filter<CampaignFundingLedgerEntry> = {}): Promise<CampaignFundingLedgerEntry[]> {
    const c = await getCollection<CampaignFundingLedgerEntry>(COLLECTIONS.CAMPAIGN_FUNDING_LEDGER);
    return stripIds(await c.find(filter).sort({ created_at: 1 } as Sort).toArray()) as CampaignFundingLedgerEntry[];
  },
  async insertIfAbsent(entry: CampaignFundingLedgerEntry): Promise<{ inserted: boolean; entry: CampaignFundingLedgerEntry | null }> {
    const c = await getCollection<CampaignFundingLedgerEntry>(COLLECTIONS.CAMPAIGN_FUNDING_LEDGER);
    try {
      await c.insertOne(entry);
      return { inserted: true, entry };
    } catch (err) {
      const msg = (err as { code?: number; message?: string }).message || '';
      if ((err as { code?: number }).code === 11000 || msg.includes('duplicate key')) {
        const existing = await c.findOne({ idempotency_key: entry.idempotency_key });
        return { inserted: false, entry: existing ? (stripId(existing) as CampaignFundingLedgerEntry) : null };
      }
      throw err;
    }
  },
  async balanceMicros(campaign_id: string): Promise<number> {
    const c = await getCollection<CampaignFundingLedgerEntry>(COLLECTIONS.CAMPAIGN_FUNDING_LEDGER);
    const rows = await c.find({ campaign_id }).toArray();
    let bal = 0;
    for (const r of rows) bal += r.direction === 'credit' ? r.amount_usd_micros : -r.amount_usd_micros;
    return bal;
  },
};

export const paymentWebhookEventRepo = {
  async recordIfAbsent(evt: PaymentWebhookEvent): Promise<{ inserted: boolean; existing: PaymentWebhookEvent | null }> {
    const c = await getCollection<PaymentWebhookEvent>(COLLECTIONS.PAYMENT_WEBHOOK_EVENTS);
    try {
      await c.insertOne(evt);
      return { inserted: true, existing: null };
    } catch (err) {
      if ((err as { code?: number }).code === 11000) {
        const existing = await c.findOne({ provider_event_id: evt.provider_event_id });
        return { inserted: false, existing: existing ? (stripId(existing) as PaymentWebhookEvent) : null };
      }
      throw err;
    }
  },
  async markProcessed(provider_event_id: string, ok: boolean, error: string | null = null): Promise<void> {
    const c = await getCollection<PaymentWebhookEvent>(COLLECTIONS.PAYMENT_WEBHOOK_EVENTS);
    await c.updateOne(
      { provider_event_id },
      { $set: { processed: ok, processed_at: new Date(), process_error: error } },
    );
  },
};
