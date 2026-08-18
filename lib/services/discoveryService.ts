// Discovery service. All homepage/discovery data flows through here so that
// UI never touches Mongo directly, and we keep a single place for policy
// (approved-only, safe-labels, etc.).
import { channelRepo } from '../repositories/channelRepo';
import { categoryRepo } from '../repositories/categoryRepo';
import { COLLECTIONS } from '../db/collections';
import { getCollection } from '../db/mongo';
import { COUNTRIES } from '../constants/countries';
import type { Category, Channel, PublicChannel } from '@/lib/types';

function sanitize(c: Channel): PublicChannel {
  const { owner_id: _o, verification_status, ...rest } = c;
  void _o;
  return {
    ...rest,
    is_verified: verification_status === 'verified' || verification_status === 'official',
  };
}

export interface CategoryWithCount extends Category { channel_count: number; }
export interface CountryWithCount { code: string; slug: string; name: string; flag: string; channel_count: number; }

export const discoveryService = {
  async getPopular(limit = 6): Promise<PublicChannel[]> {
    // "Popular on WaveLead" — featured, then follower_count. Honest label
    // since we don't yet have real Follow Intent volume.
    const items = await channelRepo.list({
      filter: { status: 'approved' },
      sort: { is_featured: -1, follower_count: -1 },
      limit,
    });
    return items.map(sanitize);
  },

  async getRising(limit = 6): Promise<PublicChannel[]> {
    // "New & Noteworthy" — recent, verified or featured, active.
    const items = await channelRepo.list({
      filter: { status: 'approved', activity_level: 'active' },
      sort: { published_at: -1, is_featured: -1 },
      limit,
    });
    return items.map(sanitize);
  },

  async getTop({ country, limit = 5 }: { country?: string; limit?: number } = {}): Promise<PublicChannel[]> {
    const filter: Record<string, unknown> = { status: 'approved' };
    if (country) filter.country_code = country.toUpperCase();
    const items = await channelRepo.list({ filter, sort: { follower_count: -1 }, limit });
    return items.map(sanitize);
  },

  async getCategoryCounts(): Promise<CategoryWithCount[]> {
    const [cats, coll] = await Promise.all([
      categoryRepo.listActive(),
      getCollection<Channel>(COLLECTIONS.CHANNELS),
    ]);
    const agg = await coll.aggregate<{ _id: string; count: number }>([
      { $match: { status: 'approved' } },
      { $group: { _id: '$category_id', count: { $sum: 1 } } },
    ]).toArray();
    const byCat = new Map<string, number>(agg.map((r) => [r._id, r.count]));
    return cats.map((c) => ({ ...c, channel_count: byCat.get(c.id) || 0 }));
  },

  async getCountryCounts(): Promise<CountryWithCount[]> {
    const coll = await getCollection<Channel>(COLLECTIONS.CHANNELS);
    const agg = await coll.aggregate<{ _id: string; count: number }>([
      { $match: { status: 'approved' } },
      { $group: { _id: '$country_code', count: { $sum: 1 } } },
    ]).toArray();
    const byCode = new Map<string, number>(agg.map((r) => [r._id, r.count]));
    return COUNTRIES.map((c) => ({ ...c, channel_count: byCode.get(c.code) || 0 }));
  },

  async getHomepageBundle() {
    const [popular, rising, topIndonesia, categories, countries, stats] = await Promise.all([
      discoveryService.getPopular(6),
      discoveryService.getRising(6),
      discoveryService.getTop({ country: 'ID', limit: 5 }),
      discoveryService.getCategoryCounts(),
      discoveryService.getCountryCounts(),
      discoveryService.getStats(),
    ]);
    return { popular, rising, topIndonesia, categories, countries, stats };
  },

  async getStats() {
    const coll = await getCollection<Channel>(COLLECTIONS.CHANNELS);
    const totalApproved = await coll.countDocuments({ status: 'approved' });
    return { totalApproved };
  },
};
