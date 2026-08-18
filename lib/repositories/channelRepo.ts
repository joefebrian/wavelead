import { Filter, Sort } from 'mongodb';
import { getCollection, stripId, stripIds } from '../db/mongo';
import { COLLECTIONS } from '../db/collections';
import type { Channel } from '@/lib/types';

async function coll() { return getCollection<Channel>(COLLECTIONS.CHANNELS); }

export interface ListArgs {
  filter?: Filter<Channel>;
  sort?: Sort;
  limit?: number;
  skip?: number;
}

export const channelRepo = {
  async findBySlug(slug: string): Promise<Channel | null> {
    const c = await coll();
    return stripId(await c.findOne({ slug })) as Channel | null;
  },
  async findById(id: string): Promise<Channel | null> {
    const c = await coll();
    return stripId(await c.findOne({ id })) as Channel | null;
  },
  async list({ filter = {}, sort = { created_at: -1 }, limit = 24, skip = 0 }: ListArgs = {}): Promise<Channel[]> {
    const c = await coll();
    return stripIds(await c.find(filter).sort(sort).skip(skip).limit(limit).toArray()) as Channel[];
  },
  async count(filter: Filter<Channel> = {}): Promise<number> {
    const c = await coll();
    return c.countDocuments(filter);
  },
  async insert(doc: Channel): Promise<Channel> {
    const c = await coll();
    await c.insertOne(doc);
    return stripId(doc) as Channel;
  },
  async update(id: string, patch: Partial<Channel>): Promise<void> {
    const c = await coll();
    await c.updateOne({ id }, { $set: { ...patch, updated_at: new Date() } });
  },
};
