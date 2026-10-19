import { Filter, Sort } from 'mongodb';
import { getCollection, stripId, stripIds } from '../db/mongo';
import { COLLECTIONS } from '../db/collections';
import {
  EFFECTIVE_FOLLOWERS_ADD_FIELDS,
  EFFECTIVE_FOLLOWERS_FIELD,
  EFFECTIVE_FOLLOWERS_SORT,
  FEATURED_THEN_FOLLOWERS_SORT,
} from '../utils/followerCount';
import type { Channel } from '@/lib/types';

async function coll() { return getCollection<Channel>(COLLECTIONS.CHANNELS); }

export interface ListArgs {
  filter?: Filter<Channel>;
  sort?: Sort;
  limit?: number;
  skip?: number;
}

export interface RankedListArgs {
  filter?: Filter<Channel>;
  limit?: number;
  skip?: number;
  /** Put manually featured channels above the follower ranking. */
  featuredFirst?: boolean;
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
  /**
   * Follower-ranked listing.
   *
   * Ranks on the EFFECTIVE follower count — max(follower_count,
   * public_followers_count) — which is the same number the discovery cards
   * display. Sorting on `follower_count` alone left every real submitted
   * channel tied at 0 (their observed figure lives in public_followers_count),
   * so the order was effectively arbitrary and a channel showing "Follower
   * count unavailable" could outrank one showing 1.3M followers.
   *
   * Channels with no observation at all collapse to 0 and therefore sort
   * BELOW every known numeric count. Ties break on `id` (a unique UUID), so
   * the ordering is total and pagination can neither repeat nor skip a row.
   * No number is invented.
   */
  async listRanked({ filter = {}, limit = 24, skip = 0, featuredFirst = false }: RankedListArgs = {}): Promise<Channel[]> {
    const c = await coll();
    const rows = await c.aggregate([
      { $match: filter },
      { $addFields: EFFECTIVE_FOLLOWERS_ADD_FIELDS },
      { $sort: featuredFirst ? FEATURED_THEN_FOLLOWERS_SORT : EFFECTIVE_FOLLOWERS_SORT },
      { $skip: Math.max(0, skip) },
      { $limit: Math.max(1, limit) },
      { $project: { [EFFECTIVE_FOLLOWERS_FIELD]: 0 } },
    ]).toArray();
    return stripIds(rows) as Channel[];
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
  // M15 — leads addressed to channels this user owns.
  async listByOwner(ownerId: string): Promise<Channel[]> {
    const c = await coll();
    return stripIds(await c.find({ owner_id: ownerId }).toArray()) as Channel[];
  },
};
