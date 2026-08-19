// Discovery service. All homepage/discovery data flows through here so that
// UI never touches Mongo directly, and we keep a single place for policy
// (approved-only, safe-labels, curated-first-with-fallback).
import { channelRepo } from '../repositories/channelRepo';
import { categoryRepo } from '../repositories/categoryRepo';
import { COLLECTIONS } from '../db/collections';
import { getCollection } from '../db/mongo';
import { COUNTRIES } from '../constants/countries';
import { sanitizeChannel } from '../utils/sanitize';
import { curationService } from './curationService';
import type { Category, Channel, PublicChannel } from '@/lib/types';

const sanitize = sanitizeChannel;

// M06 release hardening: hide obvious test/dev fixture channels from all
// public discovery surfaces. Test fixtures use slugs starting with `test-`
// and names starting with `Test `. We match at the discovery boundary (not
// at insert) so previously-created rows are also hidden without deleting
// their history. Financial ledger data is never touched by this filter.
const PUBLIC_TEST_FIXTURE_EXCLUSION = {
  slug: { $not: { $regex: '^test-', $options: 'i' } },
  name: { $not: { $regex: '^Test ', $options: 'i' } },
} as const;

/** Merge the public-safe filter with a caller-supplied filter. */
function publicFilter<T>(base: T): T {
  return { ...(base as Record<string, unknown>), ...PUBLIC_TEST_FIXTURE_EXCLUSION } as unknown as T;
}

export interface CategoryWithCount extends Category { channel_count: number; }
export interface CountryWithCount { code: string; slug: string; name: string; flag: string; channel_count: number; }

type Section = 'popular' | 'new_noteworthy' | 'featured';

// Fill a section: curated slots first (in priority order), then deterministic
// fallback ranking to fill remaining positions. Never duplicates the same
// channel across curated + fallback.
async function fillSection(section: Section, limit: number, fallback: () => Promise<PublicChannel[]>): Promise<PublicChannel[]> {
  const curated = await curationService.getSectionCurated(section);
  const usedIds = new Set(curated.map((c) => c.id));
  if (curated.length >= limit) return curated.slice(0, limit);
  const rest = (await fallback()).filter((c) => !usedIds.has(c.id));
  return [...curated, ...rest].slice(0, limit);
}

export const discoveryService = {
  async getPopular(limit = 6): Promise<PublicChannel[]> {
    return fillSection('popular', limit, async () => {
      // Fallback: featured then follower_count. Approved only.
      const items = await channelRepo.list({
        filter: publicFilter({ status: 'approved' }),
        sort: { is_featured: -1, follower_count: -1 },
        limit: limit * 2,
      });
      return items.map(sanitize);
    });
  },

  async getRising(limit = 6): Promise<PublicChannel[]> {
    return fillSection('new_noteworthy', limit, async () => {
      // Fallback: newest active approved channels.
      const items = await channelRepo.list({
        filter: publicFilter({ status: 'approved', activity_level: 'active' }),
        sort: { published_at: -1, is_featured: -1 },
        limit: limit * 2,
      });
      return items.map(sanitize);
    });
  },

  async getFeatured(limit = 6): Promise<PublicChannel[]> {
    return fillSection('featured', limit, async () => {
      const items = await channelRepo.list({
        filter: publicFilter({ status: 'approved', is_featured: true }),
        sort: { follower_count: -1 },
        limit: limit * 2,
      });
      return items.map(sanitize);
    });
  },

  async getFeaturedCurated(limit = 6): Promise<PublicChannel[]> {
    // Featured section renders ONLY manually curated slots (approved-only).
    // No fallback here — if moderators haven't curated any, the section is
    // simply hidden on the homepage. Popular already surfaces is_featured
    // channels via its own boost, so we avoid visual duplication.
    const curated = await curationService.getSectionCurated('featured');
    return curated.slice(0, limit);
  },

  async getTop({ country, limit = 5 }: { country?: string; limit?: number } = {}): Promise<PublicChannel[]> {
    // Top Channels stays algorithmic (behavior/follower_count), NOT curated.
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
      { $match: publicFilter({ status: 'approved' }) },
      { $group: { _id: '$category_id', count: { $sum: 1 } } },
    ]).toArray();
    const byCat = new Map<string, number>(agg.map((r) => [r._id, r.count]));
    return cats.map((c) => ({ ...c, channel_count: byCat.get(c.id) || 0 }));
  },

  async getCountryCounts(): Promise<CountryWithCount[]> {
    const coll = await getCollection<Channel>(COLLECTIONS.CHANNELS);
    const agg = await coll.aggregate<{ _id: string; count: number }>([
      { $match: publicFilter({ status: 'approved' }) },
      { $group: { _id: '$country_code', count: { $sum: 1 } } },
    ]).toArray();
    const byCode = new Map<string, number>(agg.map((r) => [r._id, r.count]));
    return COUNTRIES.map((c) => ({ ...c, channel_count: byCode.get(c.code) || 0 }));
  },

  async getHomepageBundle() {
    const [popular, rising, featured, topIndonesia, categories, countries, stats] = await Promise.all([
      discoveryService.getPopular(6),
      discoveryService.getRising(6),
      discoveryService.getFeaturedCurated(6),
      discoveryService.getTop({ country: 'ID', limit: 5 }),
      discoveryService.getCategoryCounts(),
      discoveryService.getCountryCounts(),
      discoveryService.getStats(),
    ]);
    return { popular, rising, featured, topIndonesia, categories, countries, stats };
  },

  async getStats() {
    const coll = await getCollection<Channel>(COLLECTIONS.CHANNELS);
    const totalApproved = await coll.countDocuments(publicFilter({ status: 'approved' }));
    return { totalApproved };
  },
};
