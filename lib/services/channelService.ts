import { channelRepo } from '../repositories/channelRepo';
import { categoryRepo } from '../repositories/categoryRepo';
import { searchService } from './searchService';
import { sanitizeChannel } from '../utils/sanitize';
import { buildPublicChannelMongoFilter, isChannelPublicallyVisible, isObviousPublicFixtureSlug } from './publicChannelVisibility';
import type { Channel, PublicChannel } from '@/lib/types';
import type { Filter, Sort } from 'mongodb';

interface ListArgs {
  category?: string;
  country?: string;
  q?: string;
  sort?: 'newest' | 'top' | 'trending';
  limit?: number;
  skip?: number;
}

const sanitize = sanitizeChannel;

export const channelService = {
  async listPublic({ category, country, q, sort = 'newest', limit = 24, skip = 0 }: ListArgs = {}): Promise<{ items: PublicChannel[]; total: number }> {
    if (q && q.trim()) {
      // Route text queries through the weighted search service, which
      // itself applies the same buildPublicChannelFilter policy.
      return searchService.searchApproved({ q, category, country, limit });
    }
    const filter: Filter<Channel> = buildPublicChannelMongoFilter({ status: 'approved' });
    if (category) {
      const cat = await categoryRepo.findBySlug(category);
      if (!cat) return { items: [], total: 0 };
      filter.category_id = cat.id;
    }
    if (country) filter.country_code = country.toUpperCase();
    // Finalist hotfix: 'top' / 'trending' rank on the EFFECTIVE follower count
    // (max of owner-submitted and publicly-observed), which is the number the
    // cards actually display. Ranking on `follower_count` alone left every
    // real submitted channel tied at 0. Category/country scoping is already
    // applied to `filter`, so it is honoured BEFORE ranking.
    if (sort === 'top' || sort === 'trending') {
      const [items, total] = await Promise.all([
        channelRepo.listRanked({ filter, limit, skip, featuredFirst: sort === 'trending' }),
        channelRepo.count(filter),
      ]);
      return { items: items.map(sanitize), total };
    }
    const sortSpec: Sort = { created_at: -1 };
    const [items, total] = await Promise.all([
      channelRepo.list({ filter, sort: sortSpec, limit, skip }),
      channelRepo.count(filter),
    ]);
    return { items: items.map(sanitize), total };
  },

  async getPublicBySlug(slug: string): Promise<PublicChannel | null> {
    // Fast-path refusal for obviously-fixture slugs (avoids a DB hit).
    if (isObviousPublicFixtureSlug(slug)) return null;
    const c = await channelRepo.findBySlug(slug);
    if (!c || c.status !== 'approved') return null;
    // Defense in depth: even if slug looked organic, apply the full
    // visibility predicate (durable marker + name pattern).
    if (!isChannelPublicallyVisible(c)) return null;
    return sanitize(c);
  },

  async getFeatured(limit = 6): Promise<PublicChannel[]> {
    const items = await channelRepo.listRanked({
      filter: buildPublicChannelMongoFilter({ status: 'approved', is_featured: true }),
      limit,
    });
    return items.map(sanitize);
  },

  async getStats(): Promise<{ totalApproved: number; totalPending: number }> {
    const [totalApproved, totalPending] = await Promise.all([
      channelRepo.count(buildPublicChannelMongoFilter({ status: 'approved' })),
      channelRepo.count({ status: 'pending_review' }),
    ]);
    return { totalApproved, totalPending };
  },
};
