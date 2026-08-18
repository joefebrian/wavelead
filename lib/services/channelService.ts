import { channelRepo } from '../repositories/channelRepo';
import { categoryRepo } from '../repositories/categoryRepo';
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

function sanitize(c: Channel): PublicChannel {
  const { owner_id: _o, verification_status, ...rest } = c;
  void _o;
  return {
    ...rest,
    is_verified: verification_status === 'verified' || verification_status === 'official',
  };
}

export const channelService = {
  async listPublic({ category, country, q, sort = 'newest', limit = 24, skip = 0 }: ListArgs = {}): Promise<{ items: PublicChannel[]; total: number }> {
    const filter: Filter<Channel> = { status: 'approved' };
    if (category) {
      const cat = await categoryRepo.findBySlug(category);
      if (!cat) return { items: [], total: 0 };
      filter.category_id = cat.id;
    }
    if (country) filter.country_code = country.toUpperCase();
    if (q) filter.$or = [
      { name: { $regex: q, $options: 'i' } },
      { description: { $regex: q, $options: 'i' } },
    ];
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
