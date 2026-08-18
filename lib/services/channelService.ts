import { channelRepo } from '../repositories/channelRepo';
import { categoryRepo } from '../repositories/categoryRepo';
import { searchService } from './searchService';
import { sanitizeChannel } from '../utils/sanitize';
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
      // Route text queries through the weighted search service.
      return searchService.searchApproved({ q, category, country, limit });
    }
    const filter: Filter<Channel> = { status: 'approved' };
    if (category) {
      const cat = await categoryRepo.findBySlug(category);
      if (!cat) return { items: [], total: 0 };
      filter.category_id = cat.id;
    }
    if (country) filter.country_code = country.toUpperCase();
    let sortSpec: Sort = { created_at: -1 };
    if (sort === 'top') sortSpec = { follower_count: -1 };
    if (sort === 'trending') sortSpec = { is_featured: -1, follower_count: -1 };
    const [items, total] = await Promise.all([
      channelRepo.list({ filter, sort: sortSpec, limit, skip }),
      channelRepo.count(filter),
    ]);
    return { items: items.map(sanitize), total };
  },

  async getPublicBySlug(slug: string): Promise<PublicChannel | null> {
    const c = await channelRepo.findBySlug(slug);
    if (!c || c.status !== 'approved') return null;
    return sanitize(c);
  },

  async getFeatured(limit = 6): Promise<PublicChannel[]> {
    const items = await channelRepo.list({
      filter: { status: 'approved', is_featured: true },
      sort: { follower_count: -1 },
      limit,
    });
    return items.map(sanitize);
  },

  async getStats(): Promise<{ totalApproved: number; totalPending: number }> {
    const [totalApproved, totalPending] = await Promise.all([
      channelRepo.count({ status: 'approved' }),
      channelRepo.count({ status: 'pending_review' }),
    ]);
    return { totalApproved, totalPending };
  },
};
