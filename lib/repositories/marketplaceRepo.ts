// Phase B1 marketplace repos.
import { v4 as uuidv4 } from 'uuid';
import { COLLECTIONS } from '../db/collections';
import { getCollection, stripId, stripIds } from '../db/mongo';
import type {
  ChannelRateCard,
  MarketplaceFinancialEvent,
  MarketplaceOrder,
  MarketplaceOrderStatus,
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
