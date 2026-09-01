// Phase B1 marketplace repos.
import { v4 as uuidv4 } from 'uuid';
import { COLLECTIONS } from '../db/collections';
import { getCollection, stripId, stripIds } from '../db/mongo';
import type {
  ChannelRateCard,
  MarketplaceFinancialEvent,
  MarketplaceOrder,
  MarketplaceOrderStatus,
  MarketplaceOwnerPayout,
  MarketplacePaymentAttempt,
  MarketplacePaymentAttemptStatus,
} from '@/lib/types';

export const channelRateCardRepo = {
  async findByChannel(channel_id: string): Promise<ChannelRateCard | null> {
    const c = await getCollection<ChannelRateCard>(COLLECTIONS.CHANNEL_RATE_CARDS);
    return stripId(await c.findOne({ channel_id })) as ChannelRateCard | null;
  },
  async upsert(card: ChannelRateCard): Promise<ChannelRateCard> {
    const c = await getCollection<ChannelRateCard>(COLLECTIONS.CHANNEL_RATE_CARDS);
    await c.updateOne({ channel_id: card.channel_id }, { $set: card }, { upsert: true });
    return stripId(await c.findOne({ channel_id: card.channel_id })) as ChannelRateCard;
  },
  async deleteByChannel(channel_id: string): Promise<void> {
    const c = await getCollection<ChannelRateCard>(COLLECTIONS.CHANNEL_RATE_CARDS);
    await c.deleteOne({ channel_id });
  },
  async listOwner(owner_user_id: string): Promise<ChannelRateCard[]> {
    const c = await getCollection<ChannelRateCard>(COLLECTIONS.CHANNEL_RATE_CARDS);
    return stripIds(await c.find({ owner_user_id }).toArray()) as ChannelRateCard[];
  },
};

export const marketplaceOrderRepo = {
  async insert(o: MarketplaceOrder): Promise<MarketplaceOrder> {
    const c = await getCollection<MarketplaceOrder>(COLLECTIONS.MARKETPLACE_ORDERS);
    await c.insertOne(o);
    return stripId(o) as MarketplaceOrder;
  },
  async findById(id: string): Promise<MarketplaceOrder | null> {
    const c = await getCollection<MarketplaceOrder>(COLLECTIONS.MARKETPLACE_ORDERS);
    return stripId(await c.findOne({ id })) as MarketplaceOrder | null;
  },
  async update(id: string, patch: Partial<MarketplaceOrder>): Promise<MarketplaceOrder> {
    const c = await getCollection<MarketplaceOrder>(COLLECTIONS.MARKETPLACE_ORDERS);
    await c.updateOne({ id }, { $set: { ...patch, updated_at: new Date() } });
    return stripId(await c.findOne({ id })) as MarketplaceOrder;
  },
  async listByOwner(owner_user_id: string, status?: MarketplaceOrderStatus): Promise<MarketplaceOrder[]> {
    const c = await getCollection<MarketplaceOrder>(COLLECTIONS.MARKETPLACE_ORDERS);
    const q: Record<string, unknown> = { owner_user_id };
    if (status) q.status = status;
    return stripIds(await c.find(q).sort({ created_at: -1 }).limit(500).toArray()) as MarketplaceOrder[];
  },
  async listByBuyer(buyer_user_id: string): Promise<MarketplaceOrder[]> {
    const c = await getCollection<MarketplaceOrder>(COLLECTIONS.MARKETPLACE_ORDERS);
    return stripIds(await c.find({ buyer_user_id }).sort({ created_at: -1 }).limit(500).toArray()) as MarketplaceOrder[];
  },
  async listAdmin(filter: { status?: MarketplaceOrderStatus } = {}): Promise<MarketplaceOrder[]> {
    const c = await getCollection<MarketplaceOrder>(COLLECTIONS.MARKETPLACE_ORDERS);
    const q: Record<string, unknown> = {};
    if (filter.status) q.status = filter.status;
    return stripIds(await c.find(q).sort({ created_at: -1 }).limit(500).toArray()) as MarketplaceOrder[];
  },
  /**
   * B1.1.2 — find any order that has already recorded this exact
   * (payment_method, normalized reference). Used to block cross-order reuse
   * of the same payment identifier.
   */
  async findByPaymentIdentity(payment_method: string, payment_reference_normalized: string): Promise<MarketplaceOrder | null> {
    const c = await getCollection<MarketplaceOrder>(COLLECTIONS.MARKETPLACE_ORDERS);
    return stripId(await c.findOne({ payment_method: payment_method as MarketplaceOrder['payment_method'], payment_reference_normalized })) as MarketplaceOrder | null;
  },
};

export const marketplaceFinancialEventRepo = {
  async append(evt: Omit<MarketplaceFinancialEvent, 'id' | 'created_at'>): Promise<MarketplaceFinancialEvent> {
    const c = await getCollection<MarketplaceFinancialEvent>(COLLECTIONS.MARKETPLACE_FINANCIAL_EVENTS);
    const doc: MarketplaceFinancialEvent = { id: uuidv4(), created_at: new Date(), ...evt };
    await c.insertOne(doc);
    return stripId(doc) as MarketplaceFinancialEvent;
  },
  async listByOrder(order_id: string): Promise<MarketplaceFinancialEvent[]> {
    const c = await getCollection<MarketplaceFinancialEvent>(COLLECTIONS.MARKETPLACE_FINANCIAL_EVENTS);
    return stripIds(await c.find({ order_id }).sort({ created_at: 1 }).toArray()) as MarketplaceFinancialEvent[];
  },
};

// B2 — manual owner payouts.
export const marketplaceOwnerPayoutRepo = {
  async insert(p: MarketplaceOwnerPayout): Promise<MarketplaceOwnerPayout> {
    const c = await getCollection<MarketplaceOwnerPayout>(COLLECTIONS.MARKETPLACE_OWNER_PAYOUTS);
    await c.insertOne(p);
    return stripId(p) as MarketplaceOwnerPayout;
  },
  async findById(id: string): Promise<MarketplaceOwnerPayout | null> {
    const c = await getCollection<MarketplaceOwnerPayout>(COLLECTIONS.MARKETPLACE_OWNER_PAYOUTS);
    return stripId(await c.findOne({ id })) as MarketplaceOwnerPayout | null;
  },
  async findByOrder(order_id: string): Promise<MarketplaceOwnerPayout | null> {
    const c = await getCollection<MarketplaceOwnerPayout>(COLLECTIONS.MARKETPLACE_OWNER_PAYOUTS);
    return stripId(await c.findOne({ order_id })) as MarketplaceOwnerPayout | null;
  },
  async findByPayoutIdentity(method: string, normalized: string): Promise<MarketplaceOwnerPayout | null> {
    const c = await getCollection<MarketplaceOwnerPayout>(COLLECTIONS.MARKETPLACE_OWNER_PAYOUTS);
    return stripId(await c.findOne({
      payout_method: method as MarketplaceOwnerPayout['payout_method'],
      payout_reference_normalized: normalized,
    })) as MarketplaceOwnerPayout | null;
  },
  async listAdmin(): Promise<MarketplaceOwnerPayout[]> {
    const c = await getCollection<MarketplaceOwnerPayout>(COLLECTIONS.MARKETPLACE_OWNER_PAYOUTS);
    return stripIds(await c.find({}).sort({ created_at: -1 }).limit(500).toArray()) as MarketplaceOwnerPayout[];
  },
};


// ============================================================
// Phase B3 — Marketplace PayPal Checkout attempts
// ============================================================
export const marketplacePaymentAttemptRepo = {
  async insert(a: MarketplacePaymentAttempt): Promise<MarketplacePaymentAttempt> {
    const c = await getCollection<MarketplacePaymentAttempt>(COLLECTIONS.MARKETPLACE_PAYMENT_ATTEMPTS);
    await c.insertOne(a);
    return stripId(a) as MarketplacePaymentAttempt;
  },
  async findById(id: string): Promise<MarketplacePaymentAttempt | null> {
    const c = await getCollection<MarketplacePaymentAttempt>(COLLECTIONS.MARKETPLACE_PAYMENT_ATTEMPTS);
    return stripId(await c.findOne({ id })) as MarketplacePaymentAttempt | null;
  },
  async findByProviderOrderId(provider: string, provider_order_id: string): Promise<MarketplacePaymentAttempt | null> {
    const c = await getCollection<MarketplacePaymentAttempt>(COLLECTIONS.MARKETPLACE_PAYMENT_ATTEMPTS);
    return stripId(await c.findOne({
      provider: provider as MarketplacePaymentAttempt['provider'],
      provider_order_id,
    })) as MarketplacePaymentAttempt | null;
  },
  async findByProviderCaptureId(provider: string, provider_capture_id: string): Promise<MarketplacePaymentAttempt | null> {
    const c = await getCollection<MarketplacePaymentAttempt>(COLLECTIONS.MARKETPLACE_PAYMENT_ATTEMPTS);
    return stripId(await c.findOne({
      provider: provider as MarketplacePaymentAttempt['provider'],
      provider_capture_id,
    })) as MarketplacePaymentAttempt | null;
  },
  async listByOrder(marketplace_order_id: string): Promise<MarketplacePaymentAttempt[]> {
    const c = await getCollection<MarketplacePaymentAttempt>(COLLECTIONS.MARKETPLACE_PAYMENT_ATTEMPTS);
    return stripIds(await c.find({ marketplace_order_id }).sort({ created_at: -1 }).toArray()) as MarketplacePaymentAttempt[];
  },
  async listAdmin(filter: { status?: MarketplacePaymentAttemptStatus } = {}): Promise<MarketplacePaymentAttempt[]> {
    const c = await getCollection<MarketplacePaymentAttempt>(COLLECTIONS.MARKETPLACE_PAYMENT_ATTEMPTS);
    const q: Record<string, unknown> = {};
    if (filter.status) q.status = filter.status;
    return stripIds(await c.find(q).sort({ created_at: -1 }).limit(500).toArray()) as MarketplacePaymentAttempt[];
  },
  async update(id: string, patch: Partial<MarketplacePaymentAttempt>): Promise<MarketplacePaymentAttempt> {
    const c = await getCollection<MarketplacePaymentAttempt>(COLLECTIONS.MARKETPLACE_PAYMENT_ATTEMPTS);
    await c.updateOne({ id }, { $set: { ...patch, updated_at: new Date() } });
    return stripId(await c.findOne({ id })) as MarketplacePaymentAttempt;
  },
  /**
   * B3 — atomic conditional transition. Only writes when `id` is currently in
   * `from` status; used to make CAPTURE.COMPLETED idempotent even under a race
   * with the browser-return capture. Returns the updated document, or `null`
   * if the transition guard failed (meaning some other worker already moved
   * the row and the caller must treat this as an idempotent no-op).
   */
  async transitionIfIn(id: string, from: MarketplacePaymentAttemptStatus[], to: MarketplacePaymentAttemptStatus, extraPatch: Partial<MarketplacePaymentAttempt> = {}): Promise<MarketplacePaymentAttempt | null> {
    const c = await getCollection<MarketplacePaymentAttempt>(COLLECTIONS.MARKETPLACE_PAYMENT_ATTEMPTS);
    const now = new Date();
    const res = await c.findOneAndUpdate(
      { id, status: { $in: from } },
      { $set: { ...extraPatch, status: to, updated_at: now } },
      { returnDocument: 'after' },
    );
    return stripId(res as unknown as MarketplacePaymentAttempt | null);
  },
};
