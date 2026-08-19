// M06.0 Phase 4 — Refund repository.
import { Filter, Sort } from 'mongodb';
import { getCollection, stripId, stripIds } from '../db/mongo';
import { COLLECTIONS } from '../db/collections';
import type { PaymentRefund } from '@/lib/types';

export const paymentRefundRepo = {
  async insert(r: PaymentRefund): Promise<void> {
    const c = await getCollection<PaymentRefund>(COLLECTIONS.PAYMENT_REFUNDS);
    await c.insertOne(r);
  },
  async findById(id: string): Promise<PaymentRefund | null> {
    const c = await getCollection<PaymentRefund>(COLLECTIONS.PAYMENT_REFUNDS);
    return stripId(await c.findOne({ id })) as PaymentRefund | null;
  },
  async list(filter: Filter<PaymentRefund> = {}, sort: Sort = { created_at: -1 } as Sort): Promise<PaymentRefund[]> {
    const c = await getCollection<PaymentRefund>(COLLECTIONS.PAYMENT_REFUNDS);
    return stripIds(await c.find(filter).sort(sort).toArray()) as PaymentRefund[];
  },
  async listForCampaign(campaign_id: string): Promise<PaymentRefund[]> {
    return this.list({ campaign_id });
  },
  async listForOwner(owner_user_id: string): Promise<PaymentRefund[]> {
    return this.list({ owner_user_id });
  },
  async findPendingForFunding(funding_order_id: string): Promise<PaymentRefund | null> {
    const c = await getCollection<PaymentRefund>(COLLECTIONS.PAYMENT_REFUNDS);
    return stripId(await c.findOne({ funding_order_id, status: { $in: ['pending', 'processing'] } })) as PaymentRefund | null;
  },
  async update(id: string, patch: Partial<PaymentRefund>): Promise<void> {
    const c = await getCollection<PaymentRefund>(COLLECTIONS.PAYMENT_REFUNDS);
    await c.updateOne({ id }, { $set: { ...patch, updated_at: new Date() } });
  },
  /** Atomic status transition — refuses updates when the row moved on. */
  async transition(id: string, from: PaymentRefund['status'][], to: PaymentRefund['status'], patch: Partial<PaymentRefund> = {}): Promise<boolean> {
    const c = await getCollection<PaymentRefund>(COLLECTIONS.PAYMENT_REFUNDS);
    const r = await c.updateOne({ id, status: { $in: from } }, { $set: { status: to, ...patch, updated_at: new Date() } });
    return r.modifiedCount === 1;
  },
};
